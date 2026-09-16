# Local Debug

Local-only debug helpers for Odoo 19 development.

This README is the single source of truth for the module.

## Purpose

- Speed up daily local debug flows
- Reduce accidental side effects after restoring real databases to a dev machine
- Surface technical context directly in the backend UI
- Help inspect view-load performance quickly

## Configuration

Add these flags to `odoo.conf`:

```ini
; ### LOCAL DEBUG ###
local_debug = True
local_debug_localhost_only = True
local_debug_default_uid = 2
local_debug_auto = True
local_debug_show_portal = False
local_debug_allow_db_update = False
local_debug_runtime_sync = True
```

## Current Features

### Local DB safety

- Reuses Odoo neutralization behavior when `local_debug=True`
- Disables scheduled actions in local debug mode
- Hides neutralization banner views that are noisy during local work

### Fast login and user switching

- Auto login with `default_uid`
- Adds `debug=1` on the first backend redirect when needed
- Supports quick internal-user switching from `/web/login`
- Can expose portal users when configured
- Adds quick switch actions in the backend user menu

### Session payload and runtime context

- Injects `local_debug` into frontend session payloads
- Exposes:
  - `enabled`
  - `default_uid`
  - `current_debug`
  - `dev_mode`
  - `runtime_token`
  - `assets_token`

### Webclient HUD

- Shows a dedicated debug strip below the navbar
- Surfaces:
  - SQL queries
  - N+1 query candidates
  - `Client`
  - `Server`
  - Model
  - View
  - Search view
  - Action
- Supports quick access to core debug actions such as View, Computed Arch, SearchView, Model, Action, Fields, and Filters

### Runtime sync awareness

- Compares the current tab runtime token and assets token with the active backend state
- Shows `LIVE` or `RELOAD` so the tab state is obvious
- Can be disabled using `local_debug_runtime_sync = False` in `odoo.conf`, which completely disables background polling and hides the live status indicator dot on the HUD

### Local chatter toggle

- Adds a `Chatter` chip to the HUD
- `Chatter: Off` disables automatic chatter loading for form views in the current browser
- The state is stored in browser `localStorage`
- Toggling the chip updates the preference immediately on the HUD
- The new preference applies to the next form views opened in the tab
- The current view is not reloaded just because the toggle changed
- When disabled, chatter is not mounted and does not fetch thread data

## Technical Architecture

### Backend

- `controllers/debug_login.py`
  Login, switch, payload, runtime, and view-info endpoints
- `models/debug_login_service.py`
  Shared service for config, users, snapshot, payload, and runtime
- `models/ir_http.py`
  Session payload injection, response headers for metrics/runtime tracking, and lightweight N+1 query candidate tracing
- `query_trace.py`
  Per-request SQL signature grouping and short-lived in-memory trace storage
- `__init__.py`
  Local neutralization hook

### Frontend

- `static/src/webclient/webclient_patch.js`
  Thin `WebClient` entry patch
- `static/src/webclient/webclient_patch_perf.js`
  Fetch/XHR interception and request-burst metrics
- `static/src/webclient/webclient_patch_runtime.js`
  Runtime sync helpers
- `static/src/webclient/webclient_patch_view_info.js`
  View/search-view/action context helpers
- `static/src/webclient/webclient_patch_actions.js`
  Copy/open/debug actions and local HUD toggles
- `static/src/webclient/webclient_patch_chatter.js`
  Local-only chatter suppression for form views
- `static/src/core/debug/view_patch.js`
  Pushes controller/view info into the bus when views update
- `static/src/local_debug_hud/*`
  HUD templates and styles

## Metric Semantics

### N+1

- Detects repeated `SELECT` query signatures with distinct params in the same request
- Uses a lightweight `query_hooks` collector and avoids formatting full SQL by default
- Shows only a count on the HUD unless suspicious groups are found
- Detail is stored in memory with a short TTL and loaded only when requested
- The debug controls include an `N+1` probe button that runs repeated ORM `search_count` calls for local validation

### Client

- Browser-side elapsed time for the tracked request burst
- Live counter while the request burst is pending

### Server

- Sum of backend duration values returned through `X-Odoo-Duration-ms`
- Final value only
- Never shown as a fake live counter

### Pending behavior

- While loading, the metric chip shows a loading state
- `Server` uses `...` until the real value is available

## Known Limitations

- Metrics depend on custom backend headers
- Some UI-only interactions do not create new requests, so they are outside the current metric scope
- The chatter toggle is intentionally local-only and browser-specific
- When chatter is disabled, attachment preview and other mail-driven form extras are also skipped with it

## Safety Notes

- This module is for local development
- It is not intended as a production feature set
- Local-only behaviors should stay scoped to local environments

## Roadmap

1. Keep the split webclient architecture easy to extend
2. Preserve one canonical README only
3. Keep metric labels technically honest
4. Refine local-only UX only when it does not distort semantics
