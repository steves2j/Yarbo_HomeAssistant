# Yarbo Home Assistant

Home Assistant custom integration workspace for Yarbo devices using MQTT.

This repository contains:

- the `yarbo` custom integration in `custom_components/yarbo`
- a local Docker-based Home Assistant development instance
- a custom Yarbo topics sidebar panel
- a custom Yarbo overview card for the Home Assistant dashboard

The integration is currently MQTT-first. It subscribes to `snowbot/<serial>/#`, captures topic samples, builds device summaries from `device/DeviceMSG`, `device/heart_beat`, and `device/data_feedback`, and exposes those details through Home Assistant entities and custom UI.

See [CHANGELOG.md](CHANGELOG.md) for feature history.

## Overview snapshot

![Yarbo Home Assistant overview widget](example.jpg)

## Current capabilities

- Config flow with:
  - broker host or IP
  - broker port
  - TLS on or off
  - Yarbo serial number
- Local-push MQTT runtime with automatic reconnect
- Subscription to all device topics under `snowbot/<serial>/#`
- Topic discovery and sample capture in the `Yarbo Topics` sidebar panel
- Pairing of `app/get_*` and `app/read_*` commands with `device/data_feedback`
- Merged `device/DeviceMSG` document to capture fields that appear across multiple messages
- Diagnostic sensor entities for MQTT/runtime state
- Device tracker entity from GPS / RTK data
- Overview dashboard card with one widget per configured Yarbo device
- Native HA map with live marker and decoded `get_map` overlay support
- Plan dropdown populated from `read_all_plan`
- Device commands from the overview card:
  - start plan
  - stop
  - recharge
  - shutdown
  - restart
  - volume update
  - bulk refresh
- Auto-refresh of stale device data when `Last Updated` is missing or older than one hour

## Project layout

```text
.
├── .github/workflows/          # Validation workflows
├── .homeassistant/              # Local Home Assistant config directory
├── custom_components/
│   └── yarbo/                   # Yarbo custom integration
├── scripts/                     # Local workflow helpers
├── CHANGELOG.md                 # Project change log
├── LICENSE                      # Distribution license
├── docker-compose.yml           # Local Home Assistant instance
├── hacs.json                    # HACS metadata
├── pyproject.toml               # Ruff configuration
└── requirements-dev.txt         # Optional local tooling
```

## Install in Home Assistant

### HACS

Once this repository is published and available on GitHub, the recommended install path is HACS.

1. Open `HACS -> Integrations`
2. Open the menu and choose `Custom repositories`
3. Add:
   - Repository: `https://github.com/steves2j/Yarbo_HomeAssistant`
   - Category: `Integration`
4. Search for `Yarbo Home Assistant Integration`
5. Install it
6. Restart Home Assistant
7. Add the integration from `Settings -> Devices & Services`

### Manual install

1. Copy `custom_components/yarbo` into your Home Assistant config directory under `custom_components/`
2. Restart Home Assistant
3. Add the integration from `Settings -> Devices & Services`

Example target path:

```text
<config>/
└── custom_components/
    └── yarbo/
```

## Quick start

### 1. Start local Home Assistant

```bash
./scripts/ha-up.sh
```

Open `http://localhost:8123`.

On first run, complete the Home Assistant onboarding flow.

### 2. Add Yarbo

In Home Assistant:

1. Open `Settings`
2. Open `Devices & Services`
3. Click `Add Integration`
4. Search for `Yarbo Home Assistant Integration`
5. Enter:
   - broker host/IP
   - port
   - TLS setting
   - device serial number

### 3. Useful local commands

```bash
./scripts/ha-logs.sh
./scripts/ha-down.sh
./scripts/bootstrap.sh
source .venv/bin/activate
./scripts/lint.sh
```

## Release and distribution notes

The repository now includes the minimum scaffolding for a normal HACS-style custom integration release:

- `hacs.json`
- `LICENSE`
- GitHub workflow for HACS validation
- GitHub workflow for `hassfest`

For a clean public release:

1. Push the repository to GitHub
2. Make sure the repository description, topics, and branding are set appropriately on GitHub
3. Bump `custom_components/yarbo/manifest.json` `version`
4. Update `CHANGELOG.md`
5. Create a GitHub release/tag that matches the integration version
6. Verify the GitHub Actions pass

If the GitHub repository URL changes, update:

- `custom_components/yarbo/manifest.json`
- this README

## Home Assistant UI

### Devices & Services

Each config entry creates:

- `sensor.<name>_mqtt_connection`
- `sensor.<name>_discovered_mqtt_topics`
- `device_tracker.<name>_location`

The integration can be reconfigured from the Yarbo card menu in `Settings -> Devices & Services`.

### Yarbo Topics sidebar

The custom admin-only sidebar panel is registered as `Yarbo Topics`.

It shows:

- discovered topics
- latest sample per topic
- command/response pairing for `app/get_*` and `app/read_*`
- packet metadata
- merged `DeviceMSG` document

### Yarbo overview card

The custom card is auto-registered as `yarbo-overview-card`.

Use it in Lovelace as:

```yaml
type: custom:yarbo-overview-card
```

The card renders one widget per Yarbo config entry and includes:

- connection state
- satellite count
- battery and recharge action
- live map
- plan selection
- start / stop controls
- advanced controls for shutdown, restart, volume, and Wi-Fi details

## MQTT behavior

The integration currently expects:

- requests on `snowbot/<serial>/app/...`
- live state from:
  - `device/DeviceMSG`
  - `device/heart_beat`
  - `device/data_feedback`

Notes:

- `device/DeviceMSG` payloads may be zlib-compressed JSON
- `device/data_feedback` is paired back to the originating command topic, preferably using the `topic` field inside the payload
- some brokers do not echo outbound `app/*` publishes back to subscribers; the integration does not rely on that echo for core device state updates

## Development notes

- Code changes in `custom_components/yarbo` are mounted directly into the local Home Assistant container.
- Frontend changes usually require a hard browser refresh.
- Backend changes usually require reloading the integration or restarting Home Assistant.
- The custom panel/frontend bundle is served from `custom_components/yarbo/panel/`.

## Known limitations

- This is still a custom integration under active development, not a finished package.
- Some Yarbo MQTT payloads and command shapes are being derived from observed traffic and cached samples.
- Native HA recorder may warn when topic/entity attributes become very large.

## Reference docs

- Home Assistant development environment:
  - https://developers.home-assistant.io/docs/development_environment/
- Home Assistant config flows:
  - https://developers.home-assistant.io/docs/core/integration/config_flow/
- Home Assistant custom integration branding:
  - https://developers.home-assistant.io/docs/core/integration/brand_images
- Home Assistant frontend icons:
  - https://www.home-assistant.io/docs/frontend/icons/

## AI acknowledgement

There is no pretence. Most of this code was developed using AI. AI is a tool, not a replacement for a developer, and it handles a lot of the boring boilerplate work. It still makes enough mistakes that a human developer is required, as it is not yet at a stage where it can write unsupervised code reliably. Do not hate AI; see it as a tool, the next generation of autocomplete. Autocomplete with benefits.

## AI agent notes

This section is intended as handoff context for a future coding agent continuing work on this repository.

### Current architecture

- Backend entry setup lives in `custom_components/yarbo/__init__.py`
- MQTT runtime and topic/sample persistence live in `custom_components/yarbo/mqtt.py`
- MQTT topic helpers and constants live in `custom_components/yarbo/const.py`
- Summary parsing from observed payloads lives in `custom_components/yarbo/device_data.py`
- Home Assistant entities live in:
  - `custom_components/yarbo/sensor.py`
  - `custom_components/yarbo/device_tracker.py`
- Config flow lives in `custom_components/yarbo/config_flow.py`
- Custom HTTP/API views and panel registration live in `custom_components/yarbo/panel.py`
- Frontend custom UI lives in:
  - `custom_components/yarbo/panel/yarbo-topics-panel.js`
  - `custom_components/yarbo/panel/yarbo-overview-card.js`

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
  - cached command response data
- Frontend changes usually require a hard refresh because Home Assistant caches panel/card JS aggressively
- Some features intentionally rely on cached command payloads so they can mirror what the mobile app has already been seen sending

### Known problem areas

- Broker behavior around echoing `app/*` publishes back to subscribers is inconsistent; do not assume outbound commands will appear again as inbound topic samples
- Topic and response payloads are still being reverse-engineered from observed traffic
- Large topic samples can trigger recorder attribute-size warnings in Home Assistant
- The overview card has a lot of UI state and behavior in a single file; future work may benefit from splitting it into smaller helpers

### Safe next-step priorities

- Replace inferred command payloads with documented/validated Yarbo protocol structures where possible
- Add explicit logging or debug tooling for inbound MQTT topic flow when investigating missing messages
- Add tests around payload parsing and command/response pairing
- Consider a bounded per-topic history instead of only latest-sample storage when protocol discovery is the goal
- Reduce frontend complexity by factoring repeated control/button/map logic into smaller methods or modules

### Working rules for a future agent

- Do not assume the current MQTT payload shapes are complete or stable
- Prefer reusing cached command samples before inventing new request bodies
- When changing map or overview behavior, preserve live updates and avoid forcing the user to lose zoom/pan state
- When changing button actions, keep Home Assistant auth-aware API calls through the existing backend views rather than raw browser fetches
- If investigating missing `app/*` topics, verify the broker delivery path before changing the subscription code
