### Current architecture

- Backend entry setup lives in `custom_components/s2jyarbo/__init__.py`
- MQTT runtime and topic/sample persistence live in `custom_components/s2jyarbo/mqtt.py`
- MQTT topic helpers and constants live in `custom_components/s2jyarbo/const.py`
- Summary parsing from observed payloads lives in `custom_components/s2jyarbo/device_data.py`
- Home Assistant entities live in:
  - `custom_components/s2jyarbo/sensor.py`
  - `custom_components/s2jyarbo/device_tracker.py`
- Config flow lives in `custom_components/s2jyarbo/config_flow.py`
- Custom HTTP/API views and panel registration live in `custom_components/s2jyarbo/panel.py`
- Frontend custom UI lives in:
  - `custom_components/s2jyarbo/panel/s2jyarbo-topics-panel.js`
  - `custom_components/s2jyarbo/panel/s2jyarbo-overview-card.js`
  - `custom_components/s2jyarbo/panel/s2jyarbo-map-card.js`

### Protocol assumptions already encoded

- Primary subscription is `snowbot/<serial>/#`
- Most request topics are under `snowbot/<serial>/app/...`
- Device state is primarily derived from:
  - `device/DeviceMSG`
  - `device/heart_beat`
  - `device/data_feedback`
- Some payloads are zlib-compressed JSON
- `device/data_feedback` often includes a top-level `topic` field and that is preferred for request/response pairing
- Some request payloads are inferred from cached samples rather than formal documentation

### Important implementation details

- The Topics sidebar stores the latest sample per topic, not a full history
- `device/DeviceMSG` is also deep-merged over time into a separate merged document so fields that appear intermittently are not lost
- The overview card uses a mix of:
  - dashboard API responses
  - live HA entity state
  - an embedded local-map widget fed from the same dashboard entry data
  - cached command response data
- The old native HA/OpenStreetMap path is no longer the active map inside the overview card; the overview now mounts the embedded local-map widget from `s2jyarbo-map-card.js`
- `s2jyarbo-map-card.js` is the shared embedded live map widget used by the overview card and now includes the pathway/no-go zone editor
- `s2jyarbo-map-dev-card.js` registers the standalone development card as `custom:s2jyarbo-map-card` and should stay aligned with the main widget when map/editor behavior changes
- The map widgets persist per-device zoom scale in browser storage
- Map editing uses backend API views in `panel.py` for `save_pathway`, `delete_pathway`, `save_nogozone`, `delete_nogozone`, and `edit_acknowledgement`
- The edit warning acknowledgement is persisted in Home Assistant storage under `s2jyarbo_edit_acknowledgements`; the acknowledgement id currently remains `dev_map_edit_warning_v1` for continuity with earlier DEV-card testing
- Edit mode disables live refresh while active and uses an unsaved-change guard for cross/cancel, End Edit, browser unload, dashboard link clicks, and Home Assistant SPA route changes
- Current editor controls are:
  - Ctrl-drag to move a selected pathway/no-go zone or active draft
  - Shift-scroll to rotate
  - Ctrl-scroll to resize no-go zones
  - right-click no-go zone actions for `ToCircle`, `addSquare`, and `addCircle`
- GPS position correction is currently a fixed hard-coded offset, not a learned dock-calibration routine
- Trail rendering semantics are:
  - `2px` width for transit / mower off
  - `0.55m` width for cutting / mower on
  - magenta segments indicate reverse travel
- `plan_feedback` overlays are reconstructed from:
  - `cleanPathProgress`
  - `finishIds`
  - `clean_index`
- `recharge_feedback.path` is rendered as a cyan dotted route
- `cloud_points_feedback.tmp_barrier_points` is rendered as tomato collision/barrier strips
- The overview plan action button state should follow `DeviceMSG` planning flags first:
  - `on_going_planning`
  - `planning_paused`
- `planning_paused` and similar flags can arrive as `0/1` integers, not only booleans
- The mower-head state is inferred from `mower_head_info03/04` blade speed and RPM values parsed into the summary/status entity
- Frontend changes usually require a hard refresh because Home Assistant caches panel/card JS aggressively
- Some features intentionally rely on cached command payloads so they can mirror what the mobile app has already been seen sending
- Home Assistant `2026.4.x` frontend caching can make JS edits look ignored if cache-busting is too coarse; `panel.py` now uses `st_mtime_ns` for extra JS URLs and that should be preserved

### Known problem areas

- Broker behavior around echoing `app/*` publishes back to subscribers is inconsistent; do not assume outbound commands will appear again as inbound topic samples
- Topic and response payloads are still being reverse-engineered from observed traffic
- Large topic samples can trigger recorder attribute-size warnings in Home Assistant
- The overview card has a lot of UI state and behavior in a single file; future work may benefit from splitting it into smaller helpers
- The embedded widget path has its own `shadowRoot`; if map CSS appears to be ignored inside the overview card, verify the embedded path is loading the full shared stylesheet, not a minimal stub
- Overlay positioning on the map is sensitive to both SVG letterboxing and internal drawing padding; if map labels drift into the black border again, inspect `_updateCanvasInsets()` first
- The fixed GPS offset values currently live in both map widget files; if they need changing, update both copies together

### Safe next-step priorities

- Replace inferred command payloads with documented/validated Yarbo protocol structures where possible
- Add explicit logging or debug tooling for inbound MQTT topic flow when investigating missing messages
- Add tests around payload parsing and command/response pairing
- Consider a bounded per-topic history instead of only latest-sample storage when protocol discovery is the goal
- Reduce frontend complexity by factoring repeated control/button/map logic into smaller methods or modules
- Add tests or debug instrumentation around the embedded map widget lifecycle, especially `entryData` ingestion and cached frontend module updates
- Move the fixed GPS offset into a configurable or backend-managed setting if per-device calibration becomes necessary

### Working rules for a future agent

- Do not assume the current MQTT payload shapes are complete or stable
- Prefer reusing cached command samples before inventing new request bodies
- When changing map or overview behavior, preserve live updates and avoid forcing the user to lose zoom/pan state
- When touching the local map widget, verify both the standalone render path and the embedded overview path, because they share logic but have different `shadowRoot` structure
- When changing button actions, keep Home Assistant auth-aware API calls through the existing backend views rather than raw browser fetches
- If investigating missing `app/*` topics, verify the broker delivery path before changing the subscription code
- If changing map rendering, editor behavior, or GPS correction behavior, update both `s2jyarbo-map-card.js` and `s2jyarbo-map-dev-card.js` so the dev card and main card stay aligned
