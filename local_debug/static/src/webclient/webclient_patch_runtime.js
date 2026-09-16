/** @odoo-module **/

import { rpc } from "@web/core/network/rpc";

export function getLocalDebugValueLabel(debugValue) {
    return debugValue || "off";
}

export function getLocalDebugValueBadgeClass(debugValue) {
    if (debugValue?.includes("tests")) {
        return "o_local_debug_badge--danger";
    }
    if (debugValue?.includes("assets")) {
        return "o_local_debug_badge--warning";
    }
    if (debugValue) {
        return "o_local_debug_badge--info";
    }
    return "o_local_debug_badge--muted";
}

function getLocalDebugModeList(devMode) {
    return [...new Set(Array.isArray(devMode) ? devMode : [])].filter(Boolean);
}

export function getLocalDebugModeLabel(devMode) {
    const modes = getLocalDebugModeList(devMode);
    return modes.length ? modes.join("+") : "none";
}

export function getLocalDebugModeBadgeClass(devMode) {
    const modes = getLocalDebugModeList(devMode);
    if (modes.includes("reload")) {
        return "o_local_debug_badge--success";
    }
    if (modes.length) {
        return "o_local_debug_badge--info";
    }
    return "o_local_debug_badge--muted";
}

export const localDebugRuntimeMethods = {
    _localDebugRefreshSyncStatus() {
        const runtimeChanged =
            Boolean(this._localDebugServerRuntimeToken) &&
            this._localDebugServerRuntimeToken !== this._localDebugClientRuntimeToken;
        const assetsChanged =
            this.localDebugCurrentDebugValue.includes("assets") &&
            Boolean(this._localDebugServerAssetsToken) &&
            this._localDebugServerAssetsToken !== this._localDebugClientAssetsToken;

        this.localDebugHud.syncStatus =
            runtimeChanged || assetsChanged ? "reload" : "live";
    },

    _localDebugApplyRuntimePayload(runtimePayload) {
        if (!runtimePayload) {
            return;
        }
        if (runtimePayload.runtimeToken || runtimePayload.runtime_token) {
            this._localDebugServerRuntimeToken =
                runtimePayload.runtimeToken || runtimePayload.runtime_token;
        }
        if (runtimePayload.assetsToken || runtimePayload.assets_token) {
            this._localDebugServerAssetsToken =
                runtimePayload.assetsToken || runtimePayload.assets_token;
        }
        this._localDebugRefreshSyncStatus();
    },

    async _localDebugPollRuntimeSync() {
        if (this._localDebugRuntimeSyncPolling) {
            return;
        }
        this._localDebugRuntimeSyncPolling = true;
        try {
            const runtimePayload = await rpc("/local_debug/runtime", {});
            this._localDebugApplyRuntimePayload(runtimePayload);
        } catch {
            // Ignore transient polling failures while the backend is restarting.
        } finally {
            this._localDebugRuntimeSyncPolling = false;
        }
    },
};
