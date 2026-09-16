/** @odoo-module **/

import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { registry } from "@web/core/registry";

import {
    getLocalDebugPayload,
    isLocalDebugEnabled,
    switchToDebugUser,
} from "@local_debug/utils/local_debug_utils";
import { Component, onWillStart, useState, useRef } from "@odoo/owl";

export class LocalDebugUserMenu extends Component {
    static template = "local_debug.LocalDebugUserMenu";
    static components = { DropdownItem };
    static props = ["*"];

    setup() {
        this.listRef = useRef("userList");
        this.state = useState({
            enabled: false,
            showPortal: false,
            internalUsers: [],
            portalUsers: [],
        });

        onWillStart(async () => {
            if (!isLocalDebugEnabled()) {
                return;
            }
            try {
                const payload = await getLocalDebugPayload();
                this.state.enabled = !!payload.enabled;
                this.state.showPortal = !!payload.show_portal;
                this.state.internalUsers = payload.internal_users || [];
                this.state.portalUsers = payload.portal_users || [];
            } catch {
                this.state.enabled = false;
            }
        });
    }

    get shouldRender() {
        return (
            this.state.enabled &&
            (this.state.internalUsers.length || this.state.portalUsers.length)
        );
    }

    get shouldShowPortal() {
        return this.state.showPortal && this.state.portalUsers.length;
    }

    switchUser(userId) {
        switchToDebugUser(userId);
    }

    onSearchInput(ev) {
        // Dùng Vanilla JS để filter tránh OWL patch lại node input gây mất focus 
        // hoặc gây trigger logic resize không mong muốn của dropdown.
        const val = ev.target.value.trim().toLowerCase();
        if (!this.listRef.el) {
            return;
        }

        const dataNodes = this.listRef.el.querySelectorAll('.debug-user-data');
        for (const node of dataNodes) {
            const searchStr = node.dataset.search || "";
            const parentItem = node.closest('.debug-user-item');
            if (!parentItem) {
                continue;
            }

            if (!val || searchStr.includes(val)) {
                parentItem.style.setProperty("display", "", "important");
            } else {
                parentItem.style.setProperty("display", "none", "important");
            }
        }

        // Ẩn/hiện các header tương ứng nếu không có user nào
        const internalHeader = this.listRef.el.querySelector('.debug-internal-header');
        if (internalHeader) {
            const internalItems = this.listRef.el.querySelectorAll('.debug-internal-user');
            const hasVisibleInternal = Array.from(internalItems).some(
                el => window.getComputedStyle(el).display !== 'none'
            );
            internalHeader.style.setProperty("display", hasVisibleInternal ? "" : "none", "important");
        }

        const portalHeader = this.listRef.el.querySelector('.debug-portal-header');
        if (portalHeader) {
            const portalItems = this.listRef.el.querySelectorAll('.debug-portal-user');
            const hasVisiblePortal = Array.from(portalItems).some(
                el => window.getComputedStyle(el).display !== 'none'
            );
            portalHeader.style.setProperty("display", hasVisiblePortal ? "" : "none", "important");
        }
    }
}

function localDebugUserMenuItem() {
    return {
        type: "component",
        contentComponent: LocalDebugUserMenu,
        sequence: 69,
    };
}

registry.category("user_menuitems").add(
    "local_debug_user_menu",
    localDebugUserMenuItem
);
