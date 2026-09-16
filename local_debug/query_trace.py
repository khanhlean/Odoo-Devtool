# -*- coding: utf-8 -*-

import hashlib
import re
import threading
import time
import uuid
from collections import OrderedDict


SELECT_PREFIX_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
TABLE_FROM_RE = re.compile(r'\bfrom\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\b', re.IGNORECASE)
WHITESPACE_RE = re.compile(r"\s+")
NPLUSONE_PROBE_COUNT = 10
NPLUSONE_PROBE_SAMPLE_QUERY = (
    'SELECT count(*) FROM "res_partner" WHERE "res_partner"."id" = %s'
)

DEFAULT_IGNORED_TABLES = frozenset(
    {
        "ir_config_parameter",
        "ir_model",
        "ir_model_data",
        "ir_translation",
        "ir_ui_view",
    }
)


def _to_text(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value or "")


def normalize_query_signature(query):
    return WHITESPACE_RE.sub(" ", _to_text(query).strip()).lower()


def get_select_table(signature):
    match = TABLE_FROM_RE.search(signature)
    return match.group(1) if match else ""


def get_nplusone_probe_ids(count=NPLUSONE_PROBE_COUNT):
    return list(range(1, int(count or 0) + 1))


def _safe_preview(value, max_length=120):
    preview = repr(value)
    if len(preview) > max_length:
        return preview[: max_length - 3] + "..."
    return preview


def _params_preview(params):
    if isinstance(params, dict):
        items = tuple(sorted(params.items()))
    elif isinstance(params, (list, tuple)):
        items = tuple(params)
    elif params is None:
        items = ()
    else:
        items = (params,)
    return _safe_preview(items)


def _params_hash(params):
    preview = _params_preview(params)
    return hashlib.sha1(preview.encode("utf-8", "replace")).hexdigest()


class QueryGroup:
    def __init__(self, signature, table, max_param_samples):
        self.signature = signature
        self.table = table
        self.count = 0
        self.total_ms = 0.0
        self.param_hashes = set()
        self.sample_params = []
        self.max_param_samples = max_param_samples

    def add(self, params, delay):
        self.count += 1
        self.total_ms += max(float(delay or 0), 0.0) * 1000

        param_hash = _params_hash(params)
        self.param_hashes.add(param_hash)

        if len(self.sample_params) < self.max_param_samples:
            preview = _params_preview(params)
            if preview not in self.sample_params:
                self.sample_params.append(preview)

    def is_nplusone(self, min_count, min_distinct_params):
        return self.count >= min_count and len(self.param_hashes) >= min_distinct_params

    def to_dict(self):
        return {
            "signature": self.signature,
            "table": self.table,
            "count": self.count,
            "distinct_params": len(self.param_hashes),
            "total_ms": round(self.total_ms, 2),
            "sample_params": list(self.sample_params),
        }


class NPlusOneDetector:
    def __init__(
        self,
        min_count=8,
        min_distinct_params=5,
        max_signatures=100,
        max_groups=10,
        max_param_samples=5,
        ignored_tables=None,
    ):
        self.min_count = min_count
        self.min_distinct_params = min_distinct_params
        self.max_signatures = max_signatures
        self.max_groups = max_groups
        self.max_param_samples = max_param_samples
        self.ignored_tables = set(ignored_tables or DEFAULT_IGNORED_TABLES)
        self.groups = OrderedDict()
        self.dropped_signatures = 0

    def record(self, query, params=None, delay=0):
        signature = normalize_query_signature(query)
        if not SELECT_PREFIX_RE.match(signature):
            return

        table = get_select_table(signature)
        if table in self.ignored_tables:
            return

        group = self.groups.get(signature)
        if group is None:
            if len(self.groups) >= self.max_signatures:
                self.dropped_signatures += 1
                return
            group = QueryGroup(signature, table, self.max_param_samples)
            self.groups[signature] = group

        group.add(params, delay)

    def summary(self):
        groups = [
            group.to_dict()
            for group in self.groups.values()
            if group.is_nplusone(self.min_count, self.min_distinct_params)
        ]
        groups.sort(
            key=lambda group: (
                group["count"],
                group["distinct_params"],
                group["total_ms"],
            ),
            reverse=True,
        )
        groups = groups[: self.max_groups]
        return {
            "nplusone_count": len(groups),
            "groups": groups,
            "dropped_signatures": self.dropped_signatures,
        }


class QueryTraceCollector:
    def __init__(self, detector=None):
        self.detector = detector or NPlusOneDetector()

    def hook(self, _cr, query, params, _query_start, query_time):
        self.detector.record(query, params, query_time)

    def summary(self):
        return self.detector.summary()


class QueryTraceStore:
    def __init__(self, max_entries=50, ttl_seconds=300):
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self._entries = OrderedDict()
        self._lock = threading.RLock()

    def put(self, summary):
        if not summary or not summary.get("nplusone_count"):
            return ""

        with self._lock:
            self._prune_locked()
            trace_id = uuid.uuid4().hex
            self._entries[trace_id] = {
                "created_at": time.time(),
                "summary": summary,
            }
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
            return trace_id

    def get(self, trace_id):
        if not trace_id:
            return {}

        with self._lock:
            self._prune_locked()
            entry = self._entries.get(trace_id)
            if not entry:
                return {}
            return entry["summary"]

    def _prune(self):
        with self._lock:
            self._prune_locked()

    def _prune_locked(self):
        expires_before = time.time() - self.ttl_seconds
        expired_keys = [
            trace_id
            for trace_id, entry in self._entries.items()
            if entry["created_at"] < expires_before
        ]
        for trace_id in expired_keys:
            self._entries.pop(trace_id, None)


QUERY_TRACE_STORE = QueryTraceStore()
