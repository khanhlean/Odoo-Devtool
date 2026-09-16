/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { Dialog } from "@web/core/dialog/dialog";
import { registry } from "@web/core/registry";
import { session } from "@web/session";
import { user } from "@web/core/user";

import {
    getLocalDebugPayload,
    getLocalDebugSessionInfo,
    isLocalDebugEnabled,
    switchToDebugUser,
} from "@local_debug/utils/local_debug_utils";
import { Component } from "@odoo/owl";

class LocalDebugSnapshotDialog extends Component {
    static template = "local_debug.LocalDebugSnapshotDialog";
    static components = { Dialog };
    static props = {
        close: Function,
        lines: Array,
    };
}

function makeSnapshotLines(payload) {
    const snapshot = payload.snapshot || {};
    const companies =
        user.activeCompanies?.map((company) => company.name).join(", ") ||
        (snapshot.allowed_companies || []).join(", ");
    return [
        { label: "UID", value: snapshot.uid || user.userId || "" },
        { label: "Name", value: snapshot.name || user.name || "" },
        { label: "Login", value: snapshot.login || user.login || "" },
        {
            label: "Type",
            value: snapshot.user_type || (user.isInternalUser ? "internal" : "portal"),
        },
        { label: "DB", value: snapshot.db || session.db || "" },
        { label: "Lang", value: snapshot.lang || user.context.lang || "" },
        {
            label: "Company",
            value: user.activeCompany?.name || snapshot.current_company || "",
        },
        { label: "Companies", value: companies || "-" },
        {
            label: "Debug",
            value: payload.current_debug || snapshot.current_debug || "off",
        },
        { label: "Default UID", value: payload.default_uid || snapshot.default_uid || "" },
    ];
}

async function openSnapshot(env) {
    const payload = await getLocalDebugPayload(true);
    env.services.dialog.add(LocalDebugSnapshotDialog, {
        lines: makeSnapshotLines(payload),
    });
}

function localDebugSnapshotItem({ env }) {
    if (!isLocalDebugEnabled()) {
        return null;
    }
    return {
        type: "item",
        description: _t("Local Debug Snapshot"),
        callback: () => openSnapshot(env),
        sequence: 600,
        section: "tools",
    };
}

function resetToDefaultUserItem() {
    const sessionInfo = getLocalDebugSessionInfo();
    if (!sessionInfo.enabled || !sessionInfo.default_uid) {
        return null;
    }
    return {
        type: "item",
        description: _t("Reset To Default User"),
        callback: () => switchToDebugUser(sessionInfo.default_uid),
        sequence: 620,
        section: "tools",
    };
}

registry
    .category("debug")
    .category("default")
    .add("local_debug_snapshot", localDebugSnapshotItem)
    .add("local_debug_reset_default_user", resetToDefaultUserItem);
