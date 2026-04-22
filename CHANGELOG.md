# Changelog

All notable changes to this project will be documented in this file.

This project is still in early development, so the current history is mostly feature additions.

The format loosely follows Keep a Changelog and uses semantic versioning where practical.

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
