# Changelog

All notable changes to this project will be documented in this file.

This project is still in early development, so the current history is mostly feature additions.

The format loosely follows Keep a Changelog and uses semantic versioning where practical.

## [0.7.1] - 2026-04-30

### Bug fixes

- Fixed race condition with registering cards in ha.

## [0.7.0] - 2026-04-30

### Bug fixes

- Fixed a parser issue

## [0.6.0] - 2026-04-30

### Added features

- Split the dashboard experience into three separate Lovelace cards:
  - `custom:s2jyarbo-control-card`
  - `custom:s2jyarbo-map-card`
  - `custom:s2jyarbo-advanced-card`
- Added the control card for serial number, battery, Wi-Fi signal strength, satellite count, plan selection, start percentage, and start/pause/resume/stop controls
- Added the advanced card for detailed status, diagnostics, firmware, GPS, network, shutdown/restart, volume, and Wi-Fi details
- Promoted the map view into its own `custom:s2jyarbo-map-card`
- Added aerial/background image support to the map card:
  - image upload and persistent storage through Home Assistant
  - manual placement with Shift-drag pan, scroll zoom, and Ctrl-scroll rotation
  - opacity control
  - rotate and flip controls
  - background image placement save/clear flow
  - clear confirmation
  - unsaved-change protection when closing the panel, leaving edit mode, or navigating away
  - placement import/export JSON for backup/restore on another Home Assistant instance
- Added a background image edit tool inside map edit mode
- Added notification toast display for Yarbo notifications

### Changed

- The old overview card is no longer the recommended dashboard card setup; use the three separate cards instead
- Background image controls are hidden until edit mode is enabled and the background image tool is opened
- Map frontend now registers `custom:s2jyarbo-map-card` directly

### Bug fixes

- Prevented map refreshes from interrupting active map/object editing
- Prevented background image placement from snapping back during refreshes by preserving draft placement state
- Removed the failed image-anchor-to-SVG matching workflow in favor of manual placement

## [0.5.0] - 2026-04-24

### Added features

- Added Memory pathing with trimmer side selection

### Bug Fixes

- Fixed a background update of SVG causing loss of click hold lock on editing object.

## Internal changes

- Change the way panning is done. Now to move you need to shift or ctrl where as before it was shift to pan.

## [0.4.0] - 2026-04-24

### Added features

- Added Home Assistant-persisted edit warning acknowledgement before map editing can be used
- Added pathway and no-go zone editing from the main map, including:
  - point insert, drag, and delete
  - whole-object move with Ctrl-drag
  - object rotation with Shift-scroll
  - no-go zone resize with Ctrl-scroll
  - save and delete commands through Home Assistant API views
- Added no-go zone edit context actions:
  - `ToCircle`
  - `addSquare`
  - `addCircle`
- Added unsaved-change protection for active map edits, including internal Home Assistant dashboard navigation
- Added compact MDI icon controls for the main map toolbar and edit toolbar

### Changed

- Delete confirmation dialogs now use object-specific wording for pathways and no-go zones

## [0.3.0] - 2026-4-23

### Added features

- Start percentage slider under the plan selector on the main overview card
- Map widgets now render `plan_feedback` overlays with visited vs remaining plan path state
- Map widgets now show a plan summary pill with:
  - plan name
  - progress
  - remaining area
  - estimate
- Map widgets now render `recharge_feedback.path` as a cyan dotted return-to-dock route
- Map widgets now render `cloud_points_feedback.tmp_barrier_points` as tomato collision/barrier overlays

### Bug fixes

- `start_plan` no longer inherits stale cached progress percentages from prior runs
- Card plan button state now follows `DeviceMSG` planning flags first, so paused plans correctly switch back to play/resume and stopped plans no longer stay stuck in pause
- `planning_paused` and related planning flags are now parsed correctly from `0/1` integer payloads
- `plan_feedback` progress now uses `actualCleanArea / totalCleanArea` instead of the higher stale-completion path
- `plan_feedback` estimate times now treat `leftTime` and `totalTime` as seconds instead of incorrectly inflating them into hours
- Starting a new plan now clears stale `recharge_feedback` so the previous dock-return path does not leak into the next session
- The map now uses fixed GPS offset correction values instead of the previous browser-learned auto-calibration routine
- Battery recharge action is now disabled while charging without greying out the battery icon
- Battery tooltip is removed when recharge is disabled because the unit is already charging
- Boundary plan lines now stay in the green color family for both pending and visited states

### Internal changes

- Frontend cache-busting remains based on `st_mtime_ns` in `panel.py` to reduce stale-module issues on Home Assistant `2026.4.x`
- Fixed GPS offset values are currently duplicated in both map widget files and must be updated together if recalibrated

## [0.2.0] - 2026-4-22

### Changed

- The overview card now uses the custom local-map widget directly instead of the previous native HA/OpenStreetMap-based map path
- The integrated map now renders decoded `get_map` geometry, dock geometry, live heading, zoom/pan controls, follow mode, and breadcrumb trails inside the main overview card
- Mower-head telemetry is now used to vary trail width between a thin travel line and the full 550 mm cutting width
- Dock-based GPS calibration can now be learned and reused by the integrated map widget

## [0.1.0] - 2026-04-16

### Added

- Initial Home Assistant custom integration workspace and local Docker development environment
- Config flow for:
  - broker host/IP
  - broker port
  - TLS
  - Yarbo serial number
- MQTT runtime using `paho-mqtt`
- Subscription to `snowbot/<serial>/#`
- MQTT reconnect handling and persistent topic/sample storage
- Topic discovery and sample viewing in the `S2JYarbo Topics` sidebar panel
- Expandable topic samples with support for:
  - JSON
  - text
  - hex dump
  - compressed payload decoding
  - packet metadata
- `device/data_feedback` pairing to `app/get_*` and `app/read_*` commands
- Merged `device/DeviceMSG` document to accumulate keys observed across messages
- Clear sample and clear-all actions in the topics panel
- Diagnostic sensor entities for:
  - MQTT connection state
  - discovered topic count
- Device tracker entity for Yarbo GPS/RTK location
- Overview custom card with one widget per configured device
- Native map view with:
  - live device marker
  - custom directional heading icon
  - optional trail toggle
  - decoded `get_map` overlay rendering
- Device summary parsing from:
  - `device/DeviceMSG`
  - `device/heart_beat`
  - `device/data_feedback`
- Heartbeat-derived working state handling
- Plan dropdown populated from `read_all_plan`
- Command actions from the overview card:
  - start plan
  - stop
  - recharge
  - shutdown
  - restart
  - volume update
  - bulk refresh
- Automatic stale-data refresh if the current summary is missing or older than one hour
- Wi-Fi details from `get_connect_wifi_name`
- Local brand assets for the integration
- HACS metadata via `hacs.json`
- MIT license for distribution
- GitHub Actions for HACS validation and `hassfest`
- Initial project documentation and development workflow notes

### Changed

- Distribution-facing name updated to `S2JYarbo Home Assistant Integration`
- README updated from scaffold-level setup notes to current integration behavior and UI usage
- Button styling updated to use MDI icons and compact icon-only controls where appropriate
- Shutdown and restart actions now require an explicit enable step before use

### Notes

- The integration is still evolving from observed MQTT traffic and cached command payloads.
- Current releases are feature-driven development snapshots rather than stable public releases.
