/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { session } from "@web/session";
import { user } from "@web/core/user";
import { UserMenu } from "@web/webclient/user_menu/user_menu";

patch(UserMenu.prototype, {
    setup() {
        super.setup(...arguments);
        this.dbName = `uid=${user.userId} | ${session.db}`;
    },
});
