/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { View } from "@web/views/view";

import { isLocalDebugEnabled } from "@local_debug/utils/local_debug_utils";

patch(View.prototype, {
    async loadView(props) {
        await super.loadView(...arguments);

        if (!isLocalDebugEnabled()) {
            return;
        }

        const viewType = this.env.config.viewType || props.type || "";
        const viewId = this.env.config.viewId || false;
        const rawArch = this.env.config.rawArch || "";
        const viewInfo = this.componentProps?.info || {};
        const searchViewId = viewInfo.searchViewId || false;
        const searchRawArch = viewInfo.searchViewArch || "";

        this.env.bus.trigger("LOCAL_DEBUG:VIEW-INFO", {
            actionId: this.env.config.actionId || false,
            component: this,
            resModel: this.props.resModel,
            searchRawArch,
            searchViewId,
            viewId,
            rawArch,
            viewType,
        });
    },
});
