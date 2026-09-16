# -*- coding: utf-8 -*-

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from werkzeug.exceptions import NotFound

from odoo import http
from odoo.addons.web.controllers import home as web_home
from odoo.http import request

from ..query_trace import QUERY_TRACE_STORE


class Home(web_home.Home):
    def _get_local_debug_service(self):
        return request.env["local.debug.login.service"].sudo()

    def _login_redirect(self, uid, redirect=None):
        redirect_url = super()._login_redirect(uid, redirect=redirect)
        return self._get_local_debug_service().apply_first_login_debug(redirect_url)

    def _normalize_redirect(self, redirect, strip_debug=False):
        if not redirect:
            return "/odoo"
        if not redirect.startswith("/"):
            return "/odoo"

        parts = urlsplit(redirect)
        query = parse_qsl(parts.query, keep_blank_values=True)
        if strip_debug:
            query = [(key, value) for key, value in query if key != "debug"]
        return urlunsplit(
            ("", "", parts.path or "/odoo", urlencode(query), parts.fragment)
        )

    def _switch_to_user(self, user, redirect=None):
        redirect = self._normalize_redirect(redirect, strip_debug=True)

        request.session.logout(keep_db=True)
        request.session["pre_login"] = user.login
        request.session["pre_uid"] = user.id
        request.session.finalize(request.env)
        request.update_env(user=request.session.uid)
        request.update_context(**request.session.context)
        request.session.touch()
        return request.redirect(self._login_redirect(request.session.uid, redirect=redirect))

    @http.route()
    def web_login(self, redirect=None, **kw):
        web_home.ensure_db()
        service = self._get_local_debug_service()
        if (
            request.httprequest.method == "GET"
            and not request.session.uid
            and service.is_auto_login_enabled()
        ):
            user = service.get_switchable_user(service.get_default_uid())
            if user:
                return self._switch_to_user(user, redirect=redirect)

        response = super().web_login(redirect=redirect, **kw)
        if getattr(response, "qcontext", None) is not None:
            response.qcontext["local_debug"] = service.get_login_page_context()
        return response

    @http.route(
        "/local_debug/switch",
        type="http",
        auth="none",
        methods=["GET"],
        readonly=False,
        sitemap=False,
    )
    def local_debug_switch(self, user_id=None, redirect=None, **kwargs):
        web_home.ensure_db()
        service = self._get_local_debug_service()
        if not service.is_available():
            raise NotFound()

        user = service.get_switchable_user(user_id)
        if not user:
            raise NotFound()

        return self._switch_to_user(user, redirect=redirect)

    @http.route(
        "/local_debug/payload",
        type="jsonrpc",
        auth="user",
        readonly=True,
    )
    def local_debug_payload(self):
        return self._get_local_debug_service().get_backend_menu_payload()

    @http.route(
        "/local_debug/view_info",
        type="jsonrpc",
        auth="user",
        readonly=True,
    )
    def local_debug_view_info(self, view_id=None):
        return self._get_local_debug_service().get_view_technical_info(view_id)

    @http.route(
        "/local_debug/runtime",
        type="jsonrpc",
        auth="user",
        readonly=True,
    )
    def local_debug_runtime(self):
        return self._get_local_debug_service().get_runtime_payload()

    @http.route(
        "/local_debug/query_trace",
        type="jsonrpc",
        auth="user",
        readonly=True,
    )
    def local_debug_query_trace(self, trace_id=None):
        if not self._get_local_debug_service().is_available():
            raise NotFound()
        return QUERY_TRACE_STORE.get(trace_id)

    @http.route(
        "/local_debug/test_nplusone",
        type="jsonrpc",
        auth="user",
        readonly=True,
    )
    def local_debug_test_nplusone(self):
        service = self._get_local_debug_service()
        if not service.is_available():
            raise NotFound()
        return service.run_nplusone_probe()
