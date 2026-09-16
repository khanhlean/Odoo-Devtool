/** @odoo-module **/

import { browser } from "@web/core/browser/browser";

export const LOCAL_DEBUG_RUNTIME_TOKEN_EVENT =
    "local-debug-runtime-token";

const PERF_FETCH_FLAG = "__localDebugPerfFetchWrapped__";
const PERF_XHR_FLAG = "__localDebugPerfXHRWrapped__";
const PERF_XHR_LISTENER_FLAG = "__localDebugPerfListenerAttached__";
const PERF_XHR_REQUEST_FLAG = "__localDebugPerfTrackedRequest__";
const PERF_XHR_URL_FLAG = "__localDebugPerfRequestUrl__";
const PERF_IDLE_WINDOW_MS = 150;
const PERF_IGNORED_PATH_PREFIXES = [
    "/longpolling/",
    "/local_debug/query_trace",
    "/local_debug/runtime",
    "/local_debug/view_info",
    "/web/assets/",
    "/websocket",
];

const performanceAccumulator = {
    duration: 0,
    flushTimeout: null,
    nPlusOneCount: 0,
    pendingRequests: 0,
    queryTraceIds: [],
    queries: 0,
};

function parseHeaderInteger(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function clearQueuedPerformanceFlush() {
    if (performanceAccumulator.flushTimeout) {
        window.clearTimeout(performanceAccumulator.flushTimeout);
        performanceAccumulator.flushTimeout = null;
    }
}

function normalizePerformanceUrl(url) {
    if (!url) {
        return null;
    }
    try {
        return new URL(url, window.location.href);
    } catch {
        return null;
    }
}

function isTrackablePerformanceUrl(url) {
    const normalizedUrl = normalizePerformanceUrl(url);
    if (!normalizedUrl || normalizedUrl.origin !== window.location.origin) {
        return false;
    }
    return !PERF_IGNORED_PATH_PREFIXES.some((prefix) =>
        normalizedUrl.pathname.startsWith(prefix),
    );
}

function dispatchAccumulatedPerformance() {
    if (
        !performanceAccumulator.queries &&
        !performanceAccumulator.duration &&
        !performanceAccumulator.nPlusOneCount
    ) {
        return;
    }

    browser.dispatchEvent(
        new CustomEvent("local-debug-perf", {
            detail: {
                sqlQueries: performanceAccumulator.queries,
                duration: performanceAccumulator.duration,
                nPlusOneCount: performanceAccumulator.nPlusOneCount,
                queryTraceIds: performanceAccumulator.queryTraceIds,
            },
        }),
    );
    performanceAccumulator.queries = 0;
    performanceAccumulator.duration = 0;
    performanceAccumulator.nPlusOneCount = 0;
    performanceAccumulator.queryTraceIds = [];
}

function dispatchRuntimeToken(runtimeToken) {
    if (!runtimeToken) {
        return;
    }

    browser.dispatchEvent(
        new CustomEvent(LOCAL_DEBUG_RUNTIME_TOKEN_EVENT, {
            detail: { runtimeToken },
        }),
    );
}

function scheduleAccumulatedPerformanceFlush() {
    clearQueuedPerformanceFlush();
    performanceAccumulator.flushTimeout = window.setTimeout(() => {
        performanceAccumulator.flushTimeout = null;
        if (performanceAccumulator.pendingRequests) {
            return;
        }
        dispatchAccumulatedPerformance();
    }, PERF_IDLE_WINDOW_MS);
}

function beginTrackedPerformanceRequest(url) {
    if (!isTrackablePerformanceUrl(url)) {
        return false;
    }
    clearQueuedPerformanceFlush();
    if (performanceAccumulator.pendingRequests === 0) {
        browser.dispatchEvent(new CustomEvent("local-debug-perf-start"));
    }
    performanceAccumulator.pendingRequests += 1;
    return true;
}

function finalizeTrackedPerformanceRequest(url, getHeader) {
    if (!isTrackablePerformanceUrl(url)) {
        return;
    }

    performanceAccumulator.pendingRequests = Math.max(
        performanceAccumulator.pendingRequests - 1,
        0,
    );

    const sqlQueries = parseHeaderInteger(getHeader("X-Odoo-SQL-Queries"));
    const duration = parseHeaderInteger(getHeader("X-Odoo-Duration-ms"));
    const nPlusOneCount = parseHeaderInteger(
        getHeader("X-Local-Debug-NPlusOne-Count"),
    );
    const queryTraceId = getHeader("X-Local-Debug-Query-Trace-Id");
    dispatchRuntimeToken(
        getHeader("X-Local-Debug-Runtime-Token"),
    );
    if (sqlQueries !== null) {
        performanceAccumulator.queries += sqlQueries;
    }
    if (duration !== null) {
        performanceAccumulator.duration += duration;
    }
    if (nPlusOneCount !== null) {
        performanceAccumulator.nPlusOneCount += nPlusOneCount;
    }
    if (queryTraceId) {
        performanceAccumulator.queryTraceIds.push(queryTraceId);
    }

    if (!performanceAccumulator.pendingRequests) {
        scheduleAccumulatedPerformanceFlush();
    }
}

function getFetchRequestUrl(resource) {
    if (typeof Request !== "undefined" && resource instanceof Request) {
        return resource.url;
    }
    if (typeof resource === "string") {
        return resource;
    }
    return resource?.url || null;
}

function attachPerformanceListener(xhr) {
    if (!xhr || xhr[PERF_XHR_LISTENER_FLAG]) {
        return xhr;
    }
    xhr.addEventListener("loadend", () => {
        if (!xhr[PERF_XHR_REQUEST_FLAG]) {
            return;
        }
        finalizeTrackedPerformanceRequest(
            xhr[PERF_XHR_URL_FLAG],
            (headerName) => xhr.getResponseHeader(headerName),
        );
        xhr[PERF_XHR_REQUEST_FLAG] = false;
    });
    xhr[PERF_XHR_LISTENER_FLAG] = true;
    return xhr;
}

function ensureFetchPerformanceInterceptor() {
    if (window[PERF_FETCH_FLAG]) {
        return;
    }

    const originalFetch = browser.fetch || window.fetch.bind(window);
    const wrappedFetch = async (...args) => {
        const requestUrl = getFetchRequestUrl(args[0]);
        const isTrackedRequest = beginTrackedPerformanceRequest(requestUrl);

        try {
            const response = await originalFetch(...args);
            if (isTrackedRequest) {
                finalizeTrackedPerformanceRequest(requestUrl, (headerName) =>
                    response.headers.get(headerName),
                );
            }
            return response;
        } catch (error) {
            if (isTrackedRequest) {
                finalizeTrackedPerformanceRequest(requestUrl, () => null);
            }
            throw error;
        }
    };

    browser.fetch = wrappedFetch;
    window.fetch = wrappedFetch;
    window[PERF_FETCH_FLAG] = true;
}

function ensureXHRPerformanceInterceptor() {
    const xhrPrototype = browser.XMLHttpRequest?.prototype;
    if (!xhrPrototype || xhrPrototype[PERF_XHR_FLAG]) {
        return;
    }

    const originalOpen = xhrPrototype.open;
    const originalSend = xhrPrototype.send;

    xhrPrototype.open = function (method, url, ...args) {
        attachPerformanceListener(this);
        this[PERF_XHR_URL_FLAG] = url;
        return originalOpen.apply(this, [method, url, ...args]);
    };

    xhrPrototype.send = function (...args) {
        this[PERF_XHR_REQUEST_FLAG] = beginTrackedPerformanceRequest(
            this[PERF_XHR_URL_FLAG],
        );
        return originalSend.apply(this, args);
    };
    xhrPrototype[PERF_XHR_FLAG] = true;
}

export function ensurePerformanceInterceptor() {
    ensureXHRPerformanceInterceptor();
    ensureFetchPerformanceInterceptor();
}
