# -*- coding: utf-8 -*-

import threading
import time

from odoo import api, models
from odoo.http import request

from ..query_trace import QUERY_TRACE_STORE, QueryTraceCollector

NPLUSONE_IGNORED_PATH_PREFIXES = (
    "/longpolling/",
    "/local_debug/query_trace",
    "/local_debug/runtime",
    "/local_debug/view_info",
    "/web/assets/",
    "/websocket",
)


class IrHttp(models.AbstractModel):
    _inherit = "ir.http"

    @classmethod
    def _dispatch(cls, endpoint):
        start_time = time.perf_counter()
        cr = request.env.cr if request and request.env else None
        collector = None
        query_hook = None
        start_count = 0
        if cr:
            start_count = getattr(cr, "sql_log_count", 0)

        if cr and cls._local_debug_should_collect_query_trace():
            collector = QueryTraceCollector()
            query_hook = collector.hook
            current_thread = threading.current_thread()
            if not hasattr(current_thread, "query_hooks"):
                current_thread.query_hooks = []
            current_thread.query_hooks.append(query_hook)

        try:
            result = super()._dispatch(endpoint)
        finally:
            if query_hook:
                query_hooks = getattr(threading.current_thread(), "query_hooks", [])
                if query_hook in query_hooks:
                    query_hooks.remove(query_hook)

        if cr:
            end_count = getattr(cr, "sql_log_count", 0)
            query_count = max(end_count - start_count, 0)
            duration = (time.perf_counter() - start_time) * 1000
            query_trace_summary = collector.summary() if collector else {}
            query_trace_id = QUERY_TRACE_STORE.put(query_trace_summary)

            if hasattr(request, "future_response"):
                request.future_response.headers["X-Odoo-SQL-Queries"] = str(query_count)
                request.future_response.headers["X-Odoo-Duration-ms"] = str(int(duration))
                if collector:
                    request.future_response.headers[
                        "X-Local-Debug-NPlusOne-Count"
                    ] = str(query_trace_summary.get("nplusone_count", 0))
                    if query_trace_id:
                        request.future_response.headers[
                            "X-Local-Debug-Query-Trace-Id"
                        ] = query_trace_id

        if request and hasattr(request, "future_response"):
            runtime_token = (
                request.env["local.debug.login.service"]
                .sudo()
                .get_runtime_payload()
                .get("runtime_token")
            )
            if runtime_token:
                request.future_response.headers[
                    "X-Local-Debug-Runtime-Token"
                ] = runtime_token

        return result

    @classmethod
    def _local_debug_should_collect_query_trace(cls):
        if not request or not request.env:
            return False
        path = request.httprequest.path if request.httprequest else ""
        if path.startswith(NPLUSONE_IGNORED_PATH_PREFIXES):
            return False
        return (
            request.env["local.debug.login.service"]
            .sudo()
            .is_available()
        )

    def _get_local_debug_session_payload(self):
        return (
            self.env["local.debug.login.service"]
            .sudo()
            .get_session_payload()
        )

    def session_info(self):
        session_info = super().session_info()
        session_info["local_debug"] = (
            self._get_local_debug_session_payload()
        )
        return session_info

    @api.model
    def get_frontend_session_info(self):
        session_info = super().get_frontend_session_info()
        session_info["local_debug"] = (
            self._get_local_debug_session_payload()
        )
        return session_info
