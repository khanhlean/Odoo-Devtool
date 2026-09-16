/** @odoo-module **/

import { cookie } from "@web/core/browser/cookie";
import { DebugMenu } from "@web/core/debug/debug_menu";
import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { WebClient } from "@web/webclient/webclient";
import { onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";

import {
    isLocalDebugChatterDisabled,
    getLocalDebugRuntimeInfo,
    isLocalDebugEnabled,
    syncLocalDebugChatterBodyClass,
    isLocalDebugHudCollapsed,
    setLocalDebugHudCollapsed,
} from "@local_debug/utils/local_debug_utils";
import {
    localDebugActionMethods,
} from "@local_debug/webclient/webclient_patch_actions";
import {
    ensurePerformanceInterceptor,
    LOCAL_DEBUG_RUNTIME_TOKEN_EVENT,
} from "@local_debug/webclient/webclient_patch_perf";
import {
    getLocalDebugModeBadgeClass,
    getLocalDebugModeLabel,
    getLocalDebugValueBadgeClass,
    getLocalDebugValueLabel,
    localDebugRuntimeMethods,
} from "@local_debug/webclient/webclient_patch_runtime";
import {
    localDebugViewInfoMethods,
} from "@local_debug/webclient/webclient_patch_view_info";

const RUNTIME_SYNC_POLL_INTERVAL_MS = 4000;

patch(WebClient.prototype, {
    setup() {
        super.setup(...arguments);
        this.dialogService = useService("dialog");
        this.notificationService = useService("notification");
        this.ormService = useService("orm");
        this.localDebugSwitchRef = useRef("localDebugSwitch");
        this.localDebugEnabled = isLocalDebugEnabled();
        syncLocalDebugChatterBodyClass();
        this._localDebugHudControllerKey = null;
        this._localDebugPendingViewInfo = new Map();
        this.localDebugHud = useState({
            chatterDisabled: isLocalDebugChatterDisabled(),
            debugControlsOpen: false,
            hudCollapsed: isLocalDebugHudCollapsed(),
            isLoading: false,
            nplusone: 0,
            queryTraceIds: [],
            queries: 0,
            serverTime: 0,
            syncStatus: "live",
            time: 0,
            model: "",
            action: "",
            search: "",
            searchRawArch: "",
            searchViewId: false,
            view: "",
            viewId: false,
            viewRawArch: "",
            viewType: "",
        });
        this._localDebugClientRuntimeToken =
            this.localDebugRuntimeInfo.runtimeToken || "";
        this._localDebugServerRuntimeToken = this._localDebugClientRuntimeToken;
        this._localDebugClientAssetsToken =
            this.localDebugRuntimeInfo.assetsToken || "";
        this._localDebugServerAssetsToken = this._localDebugClientAssetsToken;
        this._localDebugRuntimeSyncInterval = null;
        this._localDebugRuntimeSyncPolling = false;
        this._localDebugHudTimer = null;
        this._localDebugHudTimerStart = 0;
        this._localDebugLastBurstEnd = 0;
        this._localDebugSessionNPlusOneCount = 0;
        this._localDebugSessionTotalQueries = 0;
        this._localDebugSessionTotalDuration = 0;
        this._localDebugSessionQueryTraceIds = [];

        if (!this.env.debug && this.localDebugEnabled) {
            const systrayRegistry = registry.category("systray");
            if (!systrayRegistry.contains("local_debug.debug_menu")) {
                systrayRegistry.add(
                    "local_debug.debug_menu",
                    { Component: DebugMenu },
                    { sequence: 100 },
                );
            }
        }

        if (!this.hudShouldRender) {
            return;
        }

        ensurePerformanceInterceptor();

        this._localDebugOnPerfStart = () => {
            this._localDebugStartHudTimer();
        };
        this._localDebugOnPerf = ({ detail }) => {
            this._localDebugStopHudTimer();
            this._localDebugLastBurstEnd = Date.now();
            if (detail?.sqlQueries !== undefined) {
                this._localDebugSessionTotalQueries += detail.sqlQueries;
            }
            if (detail?.duration !== undefined) {
                this._localDebugSessionTotalDuration += detail.duration;
            }
            if (detail?.nPlusOneCount !== undefined) {
                this._localDebugSessionNPlusOneCount += detail.nPlusOneCount;
            }
            if (Array.isArray(detail?.queryTraceIds)) {
                for (const traceId of detail.queryTraceIds) {
                    if (
                        traceId &&
                        !this._localDebugSessionQueryTraceIds.includes(traceId)
                    ) {
                        this._localDebugSessionQueryTraceIds.push(traceId);
                    }
                }
            }
            this.localDebugHud.nplusone = this._localDebugSessionNPlusOneCount;
            this.localDebugHud.queryTraceIds = this._localDebugSessionQueryTraceIds;
            this.localDebugHud.queries = this._localDebugSessionTotalQueries;
            this.localDebugHud.serverTime =
                this._localDebugSessionTotalDuration;
            // Keep the client-side timer display as the live elapsed value.
        };
        this._localDebugOnUiUpdated = () => {
            syncLocalDebugChatterBodyClass();
            this._localDebugRefreshHudControllerInfo();
        };
        this._localDebugOnViewInfo = ({ detail }) => {
            this._localDebugApplyViewInfo(detail);
        };
        this._localDebugOnRuntimeToken = ({ detail }) => {
            this._localDebugApplyRuntimePayload(detail);
        };
        this._localDebugOnWindowPointerDown = ({ target }) => {
            if (!this.localDebugHud.debugControlsOpen) {
                return;
            }
            const debugSwitchElement = this.localDebugSwitchRef.el;
            if (debugSwitchElement && !debugSwitchElement.contains(target)) {
                this.localDebugHud.debugControlsOpen = false;
            }
        };
        this._localDebugOnWindowKeyDown = ({ key }) => {
            if (key === "Escape") {
                this.localDebugHud.debugControlsOpen = false;
            }
        };

        onMounted(() => {
            window.addEventListener(
                "local-debug-perf",
                this._localDebugOnPerf,
            );
            window.addEventListener(
                "local-debug-perf-start",
                this._localDebugOnPerfStart,
            );
            window.addEventListener(
                "mousedown",
                this._localDebugOnWindowPointerDown,
            );
            window.addEventListener("keydown", this._localDebugOnWindowKeyDown);
            window.addEventListener(
                LOCAL_DEBUG_RUNTIME_TOKEN_EVENT,
                this._localDebugOnRuntimeToken,
            );
            this.env.bus.addEventListener(
                "ACTION_MANAGER:UI-UPDATED",
                this._localDebugOnUiUpdated,
            );
            this.env.bus.addEventListener(
                "LOCAL_DEBUG:VIEW-INFO",
                this._localDebugOnViewInfo,
            );
            this._localDebugApplyRuntimePayload(this.localDebugRuntimeInfo);
            this._localDebugRefreshHudControllerInfo();
            if (this.localDebugRuntimeInfo.pollRuntime) {
                this._localDebugPollRuntimeSync();
                this._localDebugRuntimeSyncInterval = window.setInterval(() => {
                    this._localDebugPollRuntimeSync();
                }, RUNTIME_SYNC_POLL_INTERVAL_MS);
            }
        });

        onWillUnmount(() => {
            window.removeEventListener(
                "local-debug-perf",
                this._localDebugOnPerf,
            );
            window.removeEventListener(
                "local-debug-perf-start",
                this._localDebugOnPerfStart,
            );
            window.removeEventListener(
                "mousedown",
                this._localDebugOnWindowPointerDown,
            );
            window.removeEventListener("keydown", this._localDebugOnWindowKeyDown);
            window.removeEventListener(
                LOCAL_DEBUG_RUNTIME_TOKEN_EVENT,
                this._localDebugOnRuntimeToken,
            );
            this.env.bus.removeEventListener(
                "ACTION_MANAGER:UI-UPDATED",
                this._localDebugOnUiUpdated,
            );
            this.env.bus.removeEventListener(
                "LOCAL_DEBUG:VIEW-INFO",
                this._localDebugOnViewInfo,
            );
            this._localDebugStopHudTimer();
            if (this._localDebugRuntimeSyncInterval) {
                window.clearInterval(this._localDebugRuntimeSyncInterval);
                this._localDebugRuntimeSyncInterval = null;
            }
        });
    },

    get hudShouldRender() {
        return Boolean(this.localDebugEnabled);
    },

    get localDebugThemeClass() {
        return cookie.get("color_scheme") === "dark"
            ? "o_local_debug_theme_dark"
            : "o_local_debug_theme_light";
    },

    _localDebugStartHudTimer() {
        if (this._localDebugHudTimer) {
            // Already tracking a burst, don't restart or reset.
            return;
        }

        const now = Date.now();
        const isRecent = now - this._localDebugLastBurstEnd < 1500;

        this.localDebugHud.isLoading = true;

        if (!isRecent) {
            this._localDebugSessionTotalQueries = 0;
            this._localDebugSessionTotalDuration = 0;
            this._localDebugSessionNPlusOneCount = 0;
            this._localDebugSessionQueryTraceIds = [];
            this.localDebugHud.queries = 0;
            this.localDebugHud.nplusone = 0;
            this.localDebugHud.queryTraceIds = [];
            this.localDebugHud.serverTime = 0;
            this.localDebugHud.time = 0;
            this._localDebugHudTimerStart = now;
        } else {
            this.localDebugHud.queries = this._localDebugSessionTotalQueries;
            this._localDebugHudTimerStart = now - this.localDebugHud.time;
        }

        this._localDebugHudTimer = window.setInterval(() => {
            this.localDebugHud.time = Math.round(
                Date.now() - this._localDebugHudTimerStart,
            );
        }, 30);
    },

    _localDebugStopHudTimer() {
        if (this._localDebugHudTimer) {
            window.clearInterval(this._localDebugHudTimer);
            this._localDebugHudTimer = null;
        }
        this.localDebugHud.isLoading = false;
    },

    get localDebugRuntimeInfo() {
        return getLocalDebugRuntimeInfo();
    },

    get localDebugCurrentDebugValue() {
        return this.localDebugRuntimeInfo.currentDebug || "";
    },

    get localDebugDebugLabel() {
        return getLocalDebugValueLabel(this.localDebugCurrentDebugValue);
    },

    get localDebugDebugBadgeClass() {
        return getLocalDebugValueBadgeClass(
            this.localDebugCurrentDebugValue,
        );
    },

    get localDebugDevModeLabel() {
        return getLocalDebugModeLabel(this.localDebugRuntimeInfo.devMode);
    },

    get localDebugDevBadgeClass() {
        return getLocalDebugModeBadgeClass(
            this.localDebugRuntimeInfo.devMode,
        );
    },

    get localDebugSyncLabel() {
        return this.localDebugHud.syncStatus === "reload"
            ? "RELOAD"
            : "LIVE";
    },

    get localDebugSyncBadgeClass() {
        return this.localDebugHud.syncStatus === "reload"
            ? "o_local_debug_badge--warning"
            : "o_local_debug_badge--success";
    },

    get localDebugSyncDotClass() {
        return this.localDebugHud.syncStatus === "reload"
            ? "o_local_debug_sync_dot--reload"
            : "o_local_debug_sync_dot--live";
    },

    get localDebugSyncTitle() {
        if (this.localDebugHud.syncStatus === "reload") {
            return "New backend runtime or assets source is ready. Reload this tab to apply the latest Python/XML/assets state.";
        }
        return "This tab is synced with the current backend runtime.";
    },

    get localDebugChatterDisabled() {
        return this.localDebugHud.chatterDisabled;
    },

    get localDebugChatterLabel() {
        return this.localDebugChatterDisabled ? "Off" : "On";
    },

    get localDebugChatterIconClass() {
        return this.localDebugChatterDisabled
            ? "fa fa-eye-slash"
            : "fa fa-comments-o";
    },

    get localDebugChatterChipClass() {
        return this.localDebugChatterDisabled
            ? "o_local_debug_chip--chatter-off"
            : "o_local_debug_chip--chatter-on";
    },

    get localDebugChatterTitle() {
        return this.localDebugChatterDisabled
            ? "Chatter auto-load is disabled for the next form views opened in this tab. The current view is not reloaded."
            : "Chatter auto-load is enabled for the next form views opened in this tab. The current view is not reloaded.";
    },

    get localDebugHudTimeClass() {
        const time = this.localDebugHud.time;
        let colorClass = "text-success";
        if (time >= 3000) {
            colorClass = "text-danger fw-bold";
        } else if (time >= 1500) {
            colorClass = "text-warning";
        }
        return `font-monospace ${colorClass}`;
    },

    get localDebugHudServerTimeClass() {
        const time = this.localDebugHud.serverTime;
        let colorClass = "text-success";
        if (time >= 1000) {
            colorClass = "text-danger fw-bold";
        } else if (time >= 500) {
            colorClass = "text-warning";
        }
        return `font-monospace ${colorClass}`;
    },

    isLocalDebugModeActive(debugValue) {
        return this.localDebugCurrentDebugValue === debugValue;
    },

    toggleLocalDebugControls() {
        this.localDebugHud.debugControlsOpen =
            !this.localDebugHud.debugControlsOpen;
    },

    toggleLocalDebugHudCollapsed() {
        this.localDebugHud.hudCollapsed = !this.localDebugHud.hudCollapsed;
        setLocalDebugHudCollapsed(this.localDebugHud.hudCollapsed);
        if (this.localDebugHud.hudCollapsed) {
            this.localDebugHud.debugControlsOpen = false;
        }
    },

    ...localDebugRuntimeMethods,
    ...localDebugViewInfoMethods,
    ...localDebugActionMethods,
});
