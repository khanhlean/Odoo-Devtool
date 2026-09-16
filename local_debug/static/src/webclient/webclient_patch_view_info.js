/** @odoo-module **/

import { rpc } from "@web/core/network/rpc";
import { registry } from "@web/core/registry";
import { user } from "@web/core/user";

const viewInfoCache = new Map();
let localDebugAccessRightsPromise;

async function getViewTechnicalInfo(viewId) {
    if (!viewId) {
        return null;
    }
    if (!viewInfoCache.has(viewId)) {
        viewInfoCache.set(
            viewId,
            rpc("/local_debug/view_info", { view_id: viewId }).catch(
                () => null,
            ),
        );
    }
    return viewInfoCache.get(viewId);
}

async function getLocalDebugAccessRights() {
    if (!localDebugAccessRightsPromise) {
        localDebugAccessRightsPromise = Promise.all([
            user.checkAccessRight("ir.ui.view", "write"),
        ]).then(([canEditView]) => ({ canEditView }));
    }
    return localDebugAccessRightsPromise;
}

export const localDebugViewInfoMethods = {
    _localDebugResetHudViewInfo(viewType = "") {
        this.localDebugHud.viewType = viewType;
        this.localDebugHud.viewId = false;
        this.localDebugHud.viewRawArch = "";
        this.localDebugHud.view = viewType || "";
        this.localDebugHud.searchViewId = false;
        this.localDebugHud.searchRawArch = "";
        this.localDebugHud.search = "";

        // Force reset session metrics when the view/action context definitively changes
        this._localDebugLastBurstEnd = 0;
        this._localDebugSessionNPlusOneCount = 0;
        this._localDebugSessionTotalQueries = 0;
        this._localDebugSessionTotalDuration = 0;
        this._localDebugSessionQueryTraceIds = [];
        this.localDebugHud.nplusone = 0;
        this.localDebugHud.queryTraceIds = [];
        this.localDebugHud.queries = 0;
        this.localDebugHud.serverTime = 0;
        this.localDebugHud.time = 0;
    },

    _localDebugGetControllerKey(controller) {
        if (!controller) {
            return null;
        }
        return (
            controller.jsId ||
            [
                controller?.action?.id || "action",
                controller?.props?.resModel || "",
                controller?.props?.type || controller?.view?.type || "",
            ].join(":")
        );
    },

    _localDebugGetViewInfoKey(actionId, resModel, viewType) {
        return [actionId || "action", resModel || "", viewType || ""].join(":");
    },

    _localDebugGetDetailViewInfoKey(detail) {
        return this._localDebugGetViewInfoKey(
            detail?.actionId,
            detail?.resModel,
            detail?.viewType,
        );
    },

    _localDebugGetControllerViewInfoKey(controller) {
        return this._localDebugGetViewInfoKey(
            controller?.action?.id,
            controller?.props?.resModel,
            controller?.props?.type || controller?.view?.type || "",
        );
    },

    _localDebugHydrateControllerViewInfo(controller) {
        if (!controller) {
            return null;
        }
        const detail = this._localDebugPendingViewInfo.get(
            this._localDebugGetControllerViewInfoKey(controller),
        );
        if (!detail) {
            return null;
        }
        controller.localDebugViewComponent =
            detail.component || controller.localDebugViewComponent;
        controller.localDebugViewId = detail.viewId || false;
        controller.localDebugRawArch = detail.rawArch || "";
        controller.localDebugSearchViewId = detail.searchViewId || false;
        controller.localDebugSearchRawArch = detail.searchRawArch || "";
        return detail;
    },

    _localDebugMatchesCurrentController(detail) {
        const controller = this.actionService.currentController;
        const currentActionId = controller?.action?.id || false;
        const currentViewType =
            controller?.props?.type || controller?.view?.type || "";
        const currentResModel = controller?.props?.resModel || "";

        return (
            (!detail.actionId || detail.actionId === currentActionId) &&
            detail.viewType === currentViewType &&
            detail.resModel === currentResModel
        );
    },

    _localDebugGetControllerDebugInfo(controller, viewType) {
        const actionViews = controller?.action?.views || [];
        const findActionViewId = (type) =>
            actionViews.find((view) => view[1] === type)?.[0] || false;

        return {
            searchRawArch: controller?.localDebugSearchRawArch || "",
            searchViewId:
                controller?.localDebugSearchViewId ||
                findActionViewId("search"),
            viewId:
                controller?.localDebugViewId || findActionViewId(viewType),
            viewRawArch: controller?.localDebugRawArch || "",
        };
    },

    async _localDebugGetCoreDebugItemMap() {
        const controller = this.actionService.currentController;
        const debugRegistry = registry.category("debug");
        const accessRights = await getLocalDebugAccessRights();
        const items = new Map();

        if (controller?.action) {
            for (const [key, factory] of debugRegistry
                .category("action")
                .getEntries()) {
                const item = factory({
                    accessRights,
                    action: controller.action,
                    env: this.env,
                });
                if (item) {
                    items.set(key, item);
                }
            }
        }

        const component = controller?.localDebugViewComponent;
        if (component) {
            for (const [key, factory] of debugRegistry
                .category("view")
                .getEntries()) {
                const item = factory({
                    accessRights,
                    component,
                    env: component.env,
                });
                if (item) {
                    items.set(key, item);
                }
            }
        }

        return items;
    },

    async _localDebugApplyDebugViewTarget(target, detail) {
        const controllerKey = this._localDebugGetControllerKey(
            this.actionService.currentController,
        );
        if (!detail?.viewId || !this._localDebugMatchesCurrentController(detail)) {
            return;
        }

        const labelField = target === "search" ? "search" : "view";
        const idField = target === "search" ? "searchViewId" : "viewId";
        const rawArchField =
            target === "search" ? "searchRawArch" : "viewRawArch";

        this.localDebugHud[idField] = detail.viewId;
        this.localDebugHud[rawArchField] = detail.rawArch || "";
        this.localDebugHud[labelField] = `#${detail.viewId}`;

        const viewInfo = await getViewTechnicalInfo(detail.viewId);
        if (
            !this._localDebugMatchesCurrentController(detail) ||
            controllerKey !==
                this._localDebugGetControllerKey(
                    this.actionService.currentController,
                )
        ) {
            return;
        }

        this.localDebugHud[labelField] =
            viewInfo?.label ||
            viewInfo?.xml_id ||
            viewInfo?.key ||
            `#${detail.viewId}`;
    },

    _localDebugRefreshHudControllerInfo() {
        const controller = this.actionService.currentController;
        const action = controller?.action || {};
        const viewType =
            controller?.props?.type || controller?.view?.type || "";
        const controllerKey = this._localDebugGetControllerKey(controller);

        this.localDebugHud.action =
            controller?.config?.actionXmlId ||
            action.path ||
            action.tag ||
            (action.id ? `#${action.id}` : "");

        if (!controller || action.type !== "ir.actions.act_window") {
            this._localDebugHudControllerKey = null;
            this.localDebugHud.model = "";
            this._localDebugResetHudViewInfo();
            return;
        }

        this.localDebugHud.model = controller?.props?.resModel || "";
        const controllerChanged = controllerKey !== this._localDebugHudControllerKey;
        this._localDebugHudControllerKey = controllerKey;
        this._localDebugHydrateControllerViewInfo(controller);

        if (controllerChanged) {
            this._localDebugResetHudViewInfo(viewType);
        } else {
            this.localDebugHud.viewType = viewType;
        }

        const debugInfo = this._localDebugGetControllerDebugInfo(
            controller,
            viewType,
        );
        const detailBase = {
            actionId: controller.action?.id || false,
            resModel: controller?.props?.resModel || "",
            viewType,
        };

        if (debugInfo.viewId) {
            this._localDebugApplyDebugViewTarget("view", {
                ...detailBase,
                rawArch: debugInfo.viewRawArch,
                viewId: debugInfo.viewId,
            });
        }

        if (debugInfo.searchViewId) {
            this._localDebugApplyDebugViewTarget("search", {
                ...detailBase,
                rawArch: debugInfo.searchRawArch,
                viewId: debugInfo.searchViewId,
            });
        }
    },

    async _localDebugApplyViewInfo(detail) {
        if (!detail) {
            return;
        }

        this._localDebugPendingViewInfo.set(
            this._localDebugGetDetailViewInfoKey(detail),
            detail,
        );

        const controller = this.actionService.currentController;
        if (!controller || !this._localDebugMatchesCurrentController(detail)) {
            return;
        }

        this._localDebugHudControllerKey = this._localDebugGetControllerKey(controller);
        this._localDebugHydrateControllerViewInfo(controller);

        await this._localDebugApplyDebugViewTarget("view", detail);

        if (detail?.searchViewId) {
            await this._localDebugApplyDebugViewTarget("search", {
                actionId: detail.actionId,
                rawArch: detail.searchRawArch || "",
                resModel: detail.resModel,
                viewId: detail.searchViewId,
                viewType: detail.viewType,
            });
        }
    },
};
