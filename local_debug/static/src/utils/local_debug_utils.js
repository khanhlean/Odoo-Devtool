/** @odoo-module **/

import { browser } from "@web/core/browser/browser";
import { rpc } from "@web/core/network/rpc";
import { session } from "@web/session";

let payloadPromise;
const DEFAULT_SWITCH_REDIRECT = "/odoo";
const LOCAL_DEBUG_DISABLE_CHATTER_STORAGE_KEY =
    "local_debug.disable_chatter";
const LOCAL_DEBUG_HUD_COLLAPSED_STORAGE_KEY =
    "local_debug.hud_collapsed";
const LOCAL_DEBUG_CHATTER_DISABLED_BODY_CLASS =
    "o_local_debug_chatter_disabled";

export function getLocalDebugSessionInfo() {
    return session.local_debug || {};
}

export function isLocalDebugEnabled() {
    return Boolean(getLocalDebugSessionInfo().enabled);
}

export function getLocalDebugRuntimeInfo() {
    const sessionInfo = getLocalDebugSessionInfo();
    return {
        assetsToken: sessionInfo.assets_token || "",
        currentDebug: window.odoo?.debug || sessionInfo.current_debug || "",
        devMode: Array.isArray(sessionInfo.dev_mode) ? sessionInfo.dev_mode : [],
        bootPid: sessionInfo.boot_pid || false,
        bootStartedAt: sessionInfo.boot_started_at || "",
        bootStartedLabel: sessionInfo.boot_started_label || "",
        runtimeToken: sessionInfo.runtime_token || "",
        pollRuntime: sessionInfo.poll_runtime !== false,
    };
}

export function isLocalDebugChatterDisabled() {
    return (
        isLocalDebugEnabled() &&
        browser.localStorage.getItem(
            LOCAL_DEBUG_DISABLE_CHATTER_STORAGE_KEY,
        ) === "1"
    );
}

export function syncLocalDebugChatterBodyClass() {
    document.body?.classList.toggle(
        LOCAL_DEBUG_CHATTER_DISABLED_BODY_CLASS,
        isLocalDebugChatterDisabled(),
    );
}

export function setLocalDebugChatterDisabled(disabled) {
    if (disabled) {
        browser.localStorage.setItem(
            LOCAL_DEBUG_DISABLE_CHATTER_STORAGE_KEY,
            "1",
        );
    } else {
        browser.localStorage.removeItem(
            LOCAL_DEBUG_DISABLE_CHATTER_STORAGE_KEY,
        );
    }
}

export function isLocalDebugHudCollapsed() {
    return (
        isLocalDebugEnabled() &&
        browser.localStorage.getItem(
            LOCAL_DEBUG_HUD_COLLAPSED_STORAGE_KEY,
        ) === "1"
    );
}

export function setLocalDebugHudCollapsed(collapsed) {
    if (collapsed) {
        browser.localStorage.setItem(
            LOCAL_DEBUG_HUD_COLLAPSED_STORAGE_KEY,
            "1",
        );
    } else {
        browser.localStorage.removeItem(
            LOCAL_DEBUG_HUD_COLLAPSED_STORAGE_KEY,
        );
    }
}

export async function getLocalDebugPayload(force = false) {
    if (!isLocalDebugEnabled()) {
        return { enabled: false, internal_users: [], portal_users: [], snapshot: {} };
    }
    if (!payloadPromise || force) {
        payloadPromise = rpc("/local_debug/payload");
    }
    return payloadPromise;
}

export function switchToDebugUser(userId, redirect = DEFAULT_SWITCH_REDIRECT) {
    const params = new URLSearchParams({
        user_id: `${userId}`,
        redirect,
    });
    browser.location.href = `/local_debug/switch?${params.toString()}`;
}
