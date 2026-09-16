# -*- coding: utf-8 -*-

import ipaddress
import os
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from odoo import api, models, SUPERUSER_ID
from odoo.http import request
from odoo.tools import config
from odoo.tools.misc import str2bool

from ..query_trace import get_nplusone_probe_ids

LOCAL_DEBUG_BOOT_STARTED_AT = datetime.now().astimezone().replace(microsecond=0)
LOCAL_DEBUG_BOOT_STARTED_AT_LABEL = LOCAL_DEBUG_BOOT_STARTED_AT.strftime("%H:%M:%S")
LOCAL_DEBUG_BOOT_PID = os.getpid()
LOCAL_DEBUG_RUNTIME_TOKEN = (
    f"{LOCAL_DEBUG_BOOT_PID}:{LOCAL_DEBUG_BOOT_STARTED_AT.isoformat()}"
)


class LocalDebugService(models.AbstractModel):
    _name = "local.debug.login.service"
    _description = "Local Debug Service"
    _FIRST_DEBUG_DONE_SESSION_KEY = "local_debug_first_debug_done"

    @api.model
    def _get_config_value(self, *keys):
        for key in keys:
            if not key:
                continue
            value = config.get(key)
            if value not in (None, ""):
                return value
        return None

    @api.model
    def _get_bool_config(self, *keys, default=False):
        value = self._get_config_value(*keys)
        if value is None:
            return default
        return str2bool(str(value), default)

    @api.model
    def _get_int_config(self, *keys, default=0):
        value = self._get_config_value(*keys)
        if value is None:
            return default
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @api.model
    def _is_loopback_address(self, remote_addr):
        if not remote_addr:
            return False
        try:
            return ipaddress.ip_address(remote_addr).is_loopback
        except ValueError:
            return remote_addr == "localhost"

    @api.model
    def is_enabled(self):
        return self._get_bool_config(
            "local_debug",
            "local_debug_login",
            default=False,
        )

    @api.model
    def is_localhost_only(self):
        return self._get_bool_config(
            "local_debug_localhost_only",
            "local_debug_login_localhost_only",
            default=True,
        )

    @api.model
    def is_local_request(self):
        if not request:
            return False
        remote_addr = (
            request.httprequest.environ.get("REMOTE_ADDR")
            or request.httprequest.remote_addr
        )
        return self._is_loopback_address(remote_addr)

    @api.model
    def is_available(self):
        return self.is_enabled() and (
            not self.is_localhost_only() or self.is_local_request()
        )

    @api.model
    def get_default_uid(self):
        return self._get_int_config(
            "local_debug_default_uid",
            "local_debug_login_default_uid",
            default=2,
        )

    @api.model
    def is_auto_login_enabled(self):
        return self.is_available() and self._get_bool_config(
            "local_debug_auto",
            "local_debug_login_auto",
            default=False,
        )

    @api.model
    def show_portal_users(self):
        return self._get_bool_config(
            "local_debug_show_portal",
            "local_debug_login_show_portal",
            default=True,
        )

    @api.model
    def _is_backend_path(self, path):
        return bool(path) and (
            path == "/odoo"
            or path.startswith("/odoo/")
            or path == "/web"
            or path.startswith("/web/")
        )

    @api.model
    def apply_first_login_debug(self, location):
        if not self.is_available() or not request:
            return location

        if request.session.get(self._FIRST_DEBUG_DONE_SESSION_KEY):
            return location

        if not location or not location.startswith("/"):
            return location

        parts = urlsplit(location)
        if not self._is_backend_path(parts.path):
            return location

        query = parse_qsl(parts.query, keep_blank_values=True)
        if any(key == "debug" for key, _value in query):
            request.session[self._FIRST_DEBUG_DONE_SESSION_KEY] = True
            return location

        query.append(("debug", "1"))
        request.session[self._FIRST_DEBUG_DONE_SESSION_KEY] = True
        return urlunsplit(
            ("", "", parts.path or "/odoo", urlencode(query), parts.fragment)
        )

    @api.model
    def _format_user(self, user, is_superuser=False):
        return {
            "id": user.id,
            "name": (
                f"Superuser - {user.name or user.login}"
                if is_superuser
                else (user.name or user.login)
            ),
            "login": user.login,
            "label": f"{user.name or user.login} ({user.login})",
            "current": bool(request and request.session.uid == user.id),
            "user_type": "portal" if user.share else "internal",
        }

    @api.model
    def _get_internal_users(self):
        users = self.env["res.users"].sudo().search(
            [
                ("active", "=", True),
                ("share", "=", False),
            ],
            order="name, login",
        )
        superuser = self.env["res.users"].sudo().browse(SUPERUSER_ID).exists()
        res = []
        if superuser and not superuser.share:
            res.append(self._format_user(superuser, is_superuser=True))
        for u in users:
            if u.id != SUPERUSER_ID:
                res.append(self._format_user(u))
        return res

    @api.model
    def _get_portal_users(self):
        if not self.show_portal_users():
            return []

        portal_group = self.env.ref("base.group_portal", raise_if_not_found=False)
        if not portal_group:
            return []

        users = self.env["res.users"].sudo().search(
            [
                ("active", "=", True),
                ("share", "=", True),
                ("group_ids", "in", portal_group.ids),
            ],
            order="name, login",
        )
        return [self._format_user(user) for user in users]

    @api.model
    def get_switchable_user(self, user_id):
        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            return self.env["res.users"]

        user = self.env["res.users"].sudo().browse(user_id).exists()
        if not user or (user.id != SUPERUSER_ID and not user.active):
            return self.env["res.users"]

        if not user.share:
            return user

        portal_group = self.env.ref("base.group_portal", raise_if_not_found=False)
        if portal_group and portal_group in user.group_ids:
            return user

        return self.env["res.users"]

    @api.model
    def _get_snapshot(self):
        if not request or not request.session.uid:
            return {}

        user = self.env.user.sudo()
        companies = user.company_ids.sudo() if user._is_internal() else self.env["res.company"]
        return {
            "uid": user.id,
            "login": user.login,
            "name": user.name,
            "user_type": "internal" if user._is_internal() else "portal",
            "db": self.env.cr.dbname,
            "lang": request.session.context.get("lang") or self.env.context.get("lang"),
            "current_company": user.company_id.name if user._is_internal() and user.company_id else "",
            "allowed_companies": companies.mapped("name"),
            "current_debug": request.session.debug or "",
            "default_uid": self.get_default_uid(),
        }

    @api.model
    def _get_assets_token(self):
        debug_value = request.session.debug if request else ""
        if "assets" not in (debug_value or ""):
            return ""

        asset_bundle = self.env["ir.qweb"].sudo()._get_asset_bundle(
            "web.assets_web",
            css=True,
            js=True,
            debug_assets=True,
        )
        return ":".join(
            [
                asset_bundle.get_checksum("css")[:12],
                asset_bundle.get_checksum("js")[:12],
            ]
        )

    @api.model
    def is_runtime_sync_enabled(self):
        return self._get_bool_config("local_debug_runtime_sync", default=True)

    @api.model
    def _get_runtime_payload(self):
        dev_mode = [
            mode for mode in dict.fromkeys(config["dev_mode"]) if mode and mode != "all"
        ]
        return {
            "current_debug": request.session.debug if request else "",
            "dev_mode": dev_mode,
            "boot_pid": LOCAL_DEBUG_BOOT_PID,
            "boot_started_at": LOCAL_DEBUG_BOOT_STARTED_AT.isoformat(),
            "boot_started_label": LOCAL_DEBUG_BOOT_STARTED_AT_LABEL,
            "runtime_token": LOCAL_DEBUG_RUNTIME_TOKEN,
            "assets_token": self._get_assets_token(),
            "poll_runtime": self.is_runtime_sync_enabled(),
        }

    @api.model
    def get_runtime_payload(self):
        return self._get_runtime_payload()

    @api.model
    def get_session_payload(self):
        enabled = self.is_available()
        return {
            "enabled": enabled,
            "default_uid": self.get_default_uid(),
            **self._get_runtime_payload(),
        }

    @api.model
    def _get_payload(self):
        enabled = self.is_available()
        return {
            "enabled": enabled,
            "default_uid": self.get_default_uid(),
            **self._get_runtime_payload(),
            "show_portal": self.show_portal_users(),
            "internal_users": self._get_internal_users() if enabled else [],
            "portal_users": self._get_portal_users() if enabled else [],
            "snapshot": self._get_snapshot() if enabled else {},
        }

    @api.model
    def get_login_page_context(self):
        payload = self._get_payload()
        payload["auto_login"] = self.is_auto_login_enabled()
        return payload

    @api.model
    def get_backend_menu_payload(self):
        return self._get_payload()

    @api.model
    def run_nplusone_probe(self):
        partner_model = (
            self.env["res.partner"]
            .sudo()
            .with_context(active_test=False, prefetch_fields=False)
        )
        probe_ids = get_nplusone_probe_ids()
        counts = []
        for partner_id in probe_ids:
            counts.append(partner_model.search_count([("id", "=", partner_id)]))

        return {
            "executed": len(probe_ids),
            "matched": sum(counts),
            "model": "res.partner",
            "method": "search_count",
        }

    @api.model
    def get_view_technical_info(self, view_id):
        try:
            view_id = int(view_id)
        except (TypeError, ValueError):
            return {}

        view = self.env["ir.ui.view"].sudo().browse(view_id).exists()
        if not view:
            return {}

        return {
            "id": view.id,
            "name": view.name or "",
            "xml_id": view.xml_id or "",
            "key": view.key or "",
            "label": view.xml_id or view.key or f"#{view.id}",
        }
