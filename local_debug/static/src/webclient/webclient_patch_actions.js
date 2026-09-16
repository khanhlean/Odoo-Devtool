/** @odoo-module **/

import { browser } from "@web/core/browser/browser";
import { router } from "@web/core/browser/router";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { rpc } from "@web/core/network/rpc";

import {
    setLocalDebugChatterDisabled,
} from "@local_debug/utils/local_debug_utils";

async function copyTextToClipboard(text) {
    if (browser.navigator?.clipboard?.writeText) {
        await browser.navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "readonly");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
}

export const localDebugActionMethods = {
    _localDebugNotifyUnavailable(message, type = "warning") {
        this.notificationService.add(message, { type });
    },

    async _localDebugRunCoreDebugItemByKey(key, unavailableMessage) {
        try {
            const item = (await this._localDebugGetCoreDebugItemMap()).get(key);
            if (!item?.callback) {
                this._localDebugNotifyUnavailable(unavailableMessage);
                return;
            }
            await item.callback();
        } catch (error) {
            console.error(error);
            this._localDebugNotifyUnavailable(
                error?.message || unavailableMessage,
                "danger",
            );
        }
    },

    async openLocalDebugViewRecord() {
        await this._localDebugRunCoreDebugItemByKey(
            "editView",
            "Core debug action 'View' is not available on this screen.",
        );
    },

    async openLocalDebugComputedArch() {
        await this._localDebugRunCoreDebugItemByKey(
            "getView",
            "Core debug action 'Computed Arch' is not available on this screen.",
        );
    },

    async openLocalDebugSearchViewRecord() {
        await this._localDebugRunCoreDebugItemByKey(
            "editSearchView",
            "Core debug action 'SearchView' is not available on this screen.",
        );
    },

    async openLocalDebugModelRecord() {
        await this._localDebugRunCoreDebugItemByKey(
            "ViewModel",
            "Core debug action 'Model' is not available on this screen.",
        );
    },

    async openLocalDebugActionRecord() {
        await this._localDebugRunCoreDebugItemByKey(
            "editAction",
            "Core debug action 'Action' is not available on this screen.",
        );
    },

    async openLocalDebugFields() {
        await this._localDebugRunCoreDebugItemByKey(
            "viewFields",
            "Core debug action 'Fields' is not available on this screen.",
        );
    },

    async openLocalDebugFilters() {
        await this._localDebugRunCoreDebugItemByKey(
            "manageFilters",
            "Core debug action 'Filters' is not available on this screen.",
        );
    },

    switchLocalDebugMode(debugValue = "") {
        router.pushState({ debug: debugValue || 0 }, { reload: true });
    },

    toggleLocalDebugChatterDisabled() {
        const nextDisabled = !this.localDebugHud.chatterDisabled;
        setLocalDebugChatterDisabled(nextDisabled);
        this.localDebugHud.chatterDisabled = nextDisabled;
        this.notificationService.add(
            nextDisabled
                ? "Chatter disabled for the next opened form views."
                : "Chatter enabled for the next opened form views.",
            { type: "info" },
        );
    },

    async regenerateLocalDebugAssets() {
        try {
            await this.ormService.call(
                "ir.attachment",
                "regenerate_assets_bundles",
            );
            browser.location.reload();
        } catch (error) {
            console.error(error);
            this._localDebugNotifyUnavailable(
                error?.message || "Failed to regenerate assets.",
                "danger",
            );
        }
    },

    async triggerLocalDebugNPlusOneTest() {
        try {
            const result = await rpc("/local_debug/test_nplusone", {});
            this.notificationService.add(
                `N+1 probe executed ${result?.executed || 0} ORM ${result?.method || "queries"} calls.`,
                { type: "info" },
            );
        } catch (error) {
            console.error(error);
            this._localDebugNotifyUnavailable(
                error?.message || "Failed to run N+1 probe.",
                "danger",
            );
        }
    },

    async openLocalDebugNPlusOneDetail() {
        const traceIds = [...new Set(this.localDebugHud.queryTraceIds || [])].slice(-5);
        if (!traceIds.length) {
            this._localDebugNotifyUnavailable("No N+1 query detail is available.");
            return;
        }

        try {
            const traces = await Promise.all(
                traceIds.map((traceId) =>
                    rpc("/local_debug/query_trace", { trace_id: traceId }),
                ),
            );
            const groups = traces.flatMap((trace) => trace?.groups || []);
            if (!groups.length) {
                this._localDebugNotifyUnavailable("No N+1 query detail is available.");
                return;
            }

            const body = groups
                .slice(0, 10)
                .map((group, index) => {
                    const samples = (group.sample_params || []).join(", ");
                    return [
                        `${index + 1}. ${group.table || "unknown table"} - ${group.count}x, ${group.distinct_params} distinct params, ${group.total_ms} ms`,
                        group.signature,
                        samples ? `Samples: ${samples}` : "",
                    ].filter(Boolean).join("\n");
                })
                .join("\n\n");

            this.dialogService.add(AlertDialog, {
                title: "N+1 Query Candidates",
                body,
            });
        } catch (error) {
            console.error(error);
            this._localDebugNotifyUnavailable(
                error?.message || "Failed to load N+1 query detail.",
                "danger",
            );
        }
    },

    async copyLocalDebugValue(value, label) {
        if (!value) {
            this._localDebugNotifyUnavailable(
                `No ${label} value available to copy.`,
            );
            return;
        }

        try {
            await copyTextToClipboard(value);
            this.notificationService.add(`Copied ${label}: ${value}`, {
                type: "success",
            });
        } catch (error) {
            console.error(error);
            this.notificationService.add(`Failed to copy ${label}`, {
                type: "danger",
            });
        }
    },
};
