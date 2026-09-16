/** @odoo-module **/

import "@mail/chatter/web/form_renderer";

import { patch } from "@web/core/utils/patch";
import { FormRenderer } from "@web/views/form/form_renderer";

import {
    isLocalDebugChatterDisabled,
    isLocalDebugEnabled,
} from "@local_debug/utils/local_debug_utils";

patch(FormRenderer.prototype, {
    mailLayout() {
        const layout = super.mailLayout ? super.mailLayout(...arguments) : "NONE";
        if (!isLocalDebugEnabled() || !isLocalDebugChatterDisabled()) {
            return layout;
        }
        return "NONE";
    },
});
