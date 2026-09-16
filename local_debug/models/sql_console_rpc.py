# -*- coding: utf-8 -*-

import re
import time

from odoo import _, api, models
from odoo.exceptions import UserError
from odoo.tools import config
from odoo.tools.misc import str2bool


class LocalDebugSqlConsoleRpc(models.AbstractModel):
    _name = "local_debug.sql_console.rpc"
    _description = "Local Debug SQL Console RPC"

    @api.model
    def _serialize_value(self, value):
        if value is None:
            return None
        if isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    @api.model
    def _is_write_query(self, query):
        # 1. Loại bỏ comment single line '-- ...'
        q = re.sub(r'--.*$', '', query, flags=re.MULTILINE)
        # 2. Loại bỏ comment multi line '/* ... */'
        q = re.sub(r'/\*.*?\*/', '', q, flags=re.DOTALL)
        # 3. Loại bỏ chuỗi ký tự kẹp giữa nháy đơn '...' (bao gồm cả escape nháy đơn '')
        q = re.sub(r"'([^']|'')*'", '', q)
        # 4. Loại bỏ dollar-quoted string $$...$$
        q = re.sub(r'\$\$.*?\$\$', '', q, flags=re.DOTALL)
        
        # Chuẩn hóa chuỗi để so sánh
        q = q.strip().upper()
        if not q:
            return False
            
        # Các lệnh chỉ đọc/an toàn được phép bắt đầu
        allowed_starts = ("SELECT", "WITH", "EXPLAIN", "SHOW", "VALUES")
        if not any(q.startswith(start) for start in allowed_starts):
            return True
            
        # Kiểm tra xem có chứa từ khóa thay đổi dữ liệu nào không
        write_keywords = r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|INTO|SET|REPLACE)\b'
        if re.search(write_keywords, q):
            return True
            
        return False

    @api.model
    def execute_query(self, query, limit=0):
        query = (query or "").strip()
        if not query:
            raise UserError(_("SQL query is required."))

        allow_db_update = str2bool(str(config.get("local_debug_allow_db_update")), False)
        if not allow_db_update and self._is_write_query(query):
            raise UserError(_(
                "Tính năng cập nhật cơ sở dữ liệu hiện không khả dụng."
            ))

        try:
            limit = int(limit or 0)
        except (TypeError, ValueError):
            raise UserError(_("Limit must be an integer greater than or equal to 0."))

        if limit < 0:
            raise UserError(_("Limit must be greater than or equal to 0."))

        cr = self.env.cr
        started_at = time.perf_counter()
        cr.execute(query)
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        rowcount = cr.rowcount

        headers = []
        rows = []
        if cr.description:
            headers = [column[0] for column in cr.description]
            fetched_rows = cr.fetchall() if limit == 0 else cr.fetchmany(limit)
            rows = [
                [self._serialize_value(value) for value in row]
                for row in fetched_rows
            ]

        return {
            "headers": headers,
            "rows": rows,
            "duration_ms": duration_ms,
            "rowcount": rowcount,
        }
