"""Sidebar panel and API views for S2JYarbo."""

from __future__ import annotations

import base64
import binascii
import json
from pathlib import Path
from typing import Any
import zlib

from aiohttp import web
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import (
    HomeAssistantView,
    StaticPathConfig,
    require_admin,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN
from .device_data import is_device_message_topic
from .mqtt import YarboMqttClient

PANEL_FRONTEND_PATH = "s2jyarbo-topics"
PANEL_STATIC_URL = "/s2jyarbo_static"
PANEL_API_URL = "/api/s2jyarbo/topics"
DASHBOARD_API_URL = "/api/s2jyarbo/dashboard"
REQUEST_DEVICE_MSG_API_URL = "/api/s2jyarbo/request_device_msg"
REQUEST_MAP_API_URL = "/api/s2jyarbo/request_map"
REFRESH_DEVICE_DATA_API_URL = "/api/s2jyarbo/refresh_device_data"
START_PLAN_API_URL = "/api/s2jyarbo/start_plan"
STOP_API_URL = "/api/s2jyarbo/stop"
SHUTDOWN_API_URL = "/api/s2jyarbo/shutdown"
RESTART_API_URL = "/api/s2jyarbo/restart"
SET_VOLUME_API_URL = "/api/s2jyarbo/set_volume"
RECHARGE_API_URL = "/api/s2jyarbo/recharge"
PANEL_MODULE_NAME = "s2jyarbo-topics-panel"
OVERVIEW_CARD_MODULE_NAME = "s2jyarbo-overview-card"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the S2JYarbo sidebar panel and supporting HTTP endpoints."""
    panel_dir = Path(__file__).parent / "panel"
    panel_module = panel_dir / f"{PANEL_MODULE_NAME}.js"
    overview_module = panel_dir / f"{OVERVIEW_CARD_MODULE_NAME}.js"
    module_version = int(panel_module.stat().st_mtime)
    overview_module_version = int(overview_module.stat().st_mtime)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_STATIC_URL, str(panel_dir), cache_headers=False)]
    )
    hass.http.register_view(YarboTopicsView(hass))
    hass.http.register_view(YarboDashboardView(hass))
    hass.http.register_view(YarboRequestDeviceMessageView(hass))
    hass.http.register_view(YarboRequestMapView(hass))
    hass.http.register_view(YarboRefreshDeviceDataView(hass))
    hass.http.register_view(YarboStartPlanView(hass))
    hass.http.register_view(YarboStopView(hass))
    hass.http.register_view(YarboShutdownView(hass))
    hass.http.register_view(YarboRestartView(hass))
    hass.http.register_view(YarboSetVolumeView(hass))
    hass.http.register_view(YarboRechargeView(hass))
    frontend.add_extra_js_url(
        hass,
        f"{PANEL_STATIC_URL}/{OVERVIEW_CARD_MODULE_NAME}.js?v={overview_module_version}",
    )

    await panel_custom.async_register_panel(
        hass=hass,
        frontend_url_path=PANEL_FRONTEND_PATH,
        webcomponent_name=PANEL_MODULE_NAME,
        module_url=f"{PANEL_STATIC_URL}/{PANEL_MODULE_NAME}.js?v={module_version}",
        sidebar_title="S2JYarbo Topics",
        sidebar_icon="mdi:format-list-bulleted-square",
        require_admin=True,
        config_panel_domain=DOMAIN,
    )


class YarboTopicsView(HomeAssistantView):
    """Serve current Yarbo-discovered MQTT topics."""

    url = PANEL_API_URL
    name = "api:s2jyarbo:topics"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the API view."""
        self._hass = hass

    @require_admin
    async def get(self, request: web.Request) -> web.Response:
        """Return discovered MQTT topics for all Yarbo config entries."""
        entries: list[dict[str, Any]] = []
        runtimes: dict[str, YarboMqttClient] = self._hass.data.get(DOMAIN, {})

        for entry in self._hass.config_entries.async_entries(DOMAIN):
            runtime = runtimes.get(entry.entry_id)
            entries.append(_serialize_entry(entry, runtime))

        return self.json(entries)

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        """Handle topic-sample actions for the panel."""
        payload = await request.json()
        action = payload.get("action")
        entry_id = payload.get("entry_id")
        topic = payload.get("topic")

        if action == "clear_all":
            runtimes: dict[str, YarboMqttClient] = self._hass.data.get(DOMAIN, {})

            for entry in self._hass.config_entries.async_entries(DOMAIN):
                runtime = runtimes.get(entry.entry_id)
                if runtime is not None:
                    await runtime.async_clear_all_topic_data()

            return self.json(
                [
                    _serialize_entry(entry, runtimes.get(entry.entry_id))
                    for entry in self._hass.config_entries.async_entries(DOMAIN)
                ]
            )

        if not isinstance(entry_id, str) or not isinstance(topic, str):
            return web.Response(status=400, text="entry_id and topic are required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        if not await runtime.async_clear_topic_sample(topic):
            return web.Response(status=404, text="Topic sample not found")

        return self.json(_serialize_entry(entry, runtime))


class YarboDashboardView(HomeAssistantView):
    """Serve device-summary data for the Yarbo Overview card."""

    url = DASHBOARD_API_URL
    name = "api:s2jyarbo:dashboard"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the dashboard API view."""
        self._hass = hass

    async def get(self, request: web.Request) -> web.Response:
        """Return one dashboard card entry per Yarbo config entry."""
        entries: list[dict[str, Any]] = []
        runtimes: dict[str, YarboMqttClient] = self._hass.data.get(DOMAIN, {})
        requested_entry_ids = _resolve_dashboard_entry_ids(
            self._hass,
            entry_id=request.query.get("entry_id"),
            entity_id=request.query.get("entity_id"),
            device_id=request.query.get("device_id"),
        )

        for entry in self._hass.config_entries.async_entries(DOMAIN):
            if requested_entry_ids is not None and entry.entry_id not in requested_entry_ids:
                continue

            if _is_entry_hidden_from_dashboard(self._hass, entry):
                continue

            runtime = runtimes.get(entry.entry_id)
            entries.append(_serialize_dashboard_entry(self._hass, entry, runtime))

        return self.json(entries)


class YarboRequestDeviceMessageView(HomeAssistantView):
    """Handle widget actions for requesting a fresh DeviceMSG payload."""

    url = REQUEST_DEVICE_MSG_API_URL
    name = "api:s2jyarbo:request_device_msg"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the device action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Request a fresh DeviceMSG payload for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic = await runtime.async_request_device_message()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboRequestMapView(HomeAssistantView):
    """Handle widget actions for requesting a fresh map payload."""

    url = REQUEST_MAP_API_URL
    name = "api:s2jyarbo:request_map"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the map action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Request a fresh map payload for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic = await runtime.async_request_map()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboRefreshDeviceDataView(HomeAssistantView):
    """Handle widget actions for requesting a full refresh bundle."""

    url = REFRESH_DEVICE_DATA_API_URL
    name = "api:s2jyarbo:refresh_device_data"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the refresh action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish the standard refresh bundle for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topics = await runtime.async_refresh_device_data()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topics": topics,
            }
        )


class YarboStartPlanView(HomeAssistantView):
    """Handle widget actions for starting a plan."""

    url = START_PLAN_API_URL
    name = "api:s2jyarbo:start_plan"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the plan action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Start a selected plan for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        plan_id = payload.get("plan_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if plan_id is None:
            return web.Response(status=400, text="plan_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic = await runtime.async_start_plan(plan_id)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "plan_id": str(plan_id),
                "topic": topic,
            }
        )


class YarboRechargeView(HomeAssistantView):
    """Handle widget actions for sending a recharge command."""

    url = RECHARGE_API_URL
    name = "api:s2jyarbo:recharge"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the recharge action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a recharge command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic = await runtime.async_recharge()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboStopView(HomeAssistantView):
    """Handle widget actions for sending a stop command."""

    url = STOP_API_URL
    name = "api:s2jyarbo:stop"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the stop action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a stop command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic = await runtime.async_stop()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboShutdownView(HomeAssistantView):
    """Handle widget actions for sending a shutdown command."""

    url = SHUTDOWN_API_URL
    name = "api:s2jyarbo:shutdown"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the shutdown action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a shutdown command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic = await runtime.async_shutdown()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboRestartView(HomeAssistantView):
    """Handle widget actions for sending a restart command."""

    url = RESTART_API_URL
    name = "api:s2jyarbo:restart"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the restart action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a restart command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic = await runtime.async_restart()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboSetVolumeView(HomeAssistantView):
    """Handle widget actions for updating the sound volume."""

    url = SET_VOLUME_API_URL
    name = "api:s2jyarbo:set_volume"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the volume action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish updated sound settings for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        percent = payload.get("percent")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if percent is None:
            return web.Response(status=400, text="percent is required")

        entry = next(
            (
                config_entry
                for config_entry in self._hass.config_entries.async_entries(DOMAIN)
                if config_entry.entry_id == entry_id
            ),
            None,
        )
        runtime: YarboMqttClient | None = self._hass.data.get(DOMAIN, {}).get(entry_id)

        if entry is None or runtime is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            topic, volume = await runtime.async_set_volume(percent)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
                "volume": volume,
            }
        )


def _serialize_entry(
    entry: ConfigEntry,
    runtime: YarboMqttClient | None,
) -> dict[str, Any]:
    """Serialize a Yarbo entry for the panel API."""
    if runtime is None:
        return {
            "entry_id": entry.entry_id,
            "title": entry.title,
            "connection_state": "not_loaded",
            "subscribed_topic": None,
            "topics": [],
            "discovered_topics": [],
            "topic_count": 0,
            "message_count": 0,
            "last_topic": None,
            "last_received": None,
        }

    state = runtime.state
    pending_command_topics = set(state.pending_command_topics)
    topics = []
    merged_device_message = _serialize_device_message_merge(state)
    for topic in state.discovered_topics:
        topic_payload: dict[str, Any] = {
            "name": topic,
            "sample": state.topic_samples.get(topic),
            "awaiting_response": topic in pending_command_topics,
        }
        if merged_device_message is not None and is_device_message_topic(topic):
            topic_payload["merged_document"] = merged_device_message
        topics.append(topic_payload)

    return {
        "entry_id": entry.entry_id,
        "title": entry.title,
        "connection_state": state.connection_state,
        "subscribed_topic": state.subscribed_topic,
        "topics": topics,
        "discovered_topics": state.discovered_topics,
        "topic_count": len(state.discovered_topics),
        "message_count": state.message_count,
        "last_topic": state.last_topic,
        "last_received": state.last_received,
    }


def _serialize_device_message_merge(state: Any) -> dict[str, Any] | None:
    """Serialize the accumulated DeviceMSG merge document for the sidebar."""
    merged_document = getattr(state, "device_message_merged_document", None)
    if merged_document is None:
        return None

    return {
        "body": json.dumps(merged_document, indent=2, ensure_ascii=False),
        "message_count": getattr(state, "device_message_merge_count", 0),
        "first_received": getattr(state, "device_message_merge_first_received", None),
        "last_received": getattr(state, "device_message_merge_last_received", None),
    }


def _serialize_dashboard_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    runtime: YarboMqttClient | None,
) -> dict[str, Any]:
    """Serialize a Yarbo entry for the Overview dashboard card."""
    state = runtime.state if runtime is not None else None
    return {
        "entry_id": entry.entry_id,
        "title": entry.title,
        "serial_number": entry.data.get("serial_number"),
        "connection_state": state.connection_state if state else "not_loaded",
        "status_entity_id": _find_status_entity_id(hass, entry.entry_id),
        "tracker_entity_id": _find_tracker_entity_id(hass, entry.entry_id),
        "location": state.device_summary.get("location") if state and state.device_summary else None,
        "summary": state.device_summary if state else None,
        "plans": _extract_plan_options(state.topic_samples) if state else [],
        "site_map": _extract_site_map(state.topic_samples) if state else None,
        "wifi": _extract_wifi_details(state.topic_samples) if state else None,
        "notification_count": state.notification_count if state else 0,
        "last_notification": state.last_notification if state else None,
        "recent_notifications": state.notification_history[-5:] if state else [],
    }


def _is_entry_hidden_from_dashboard(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Return True when an entry should be hidden from the overview dashboard."""
    if entry.disabled_by is not None:
        return True

    entity_registry = er.async_get(hass)
    registry_entries = er.async_entries_for_config_entry(entity_registry, entry.entry_id)
    if not registry_entries:
        return False

    return all(registry_entry.disabled_by is not None for registry_entry in registry_entries)


def _resolve_dashboard_entry_ids(
    hass: HomeAssistant,
    *,
    entry_id: str | None,
    entity_id: str | None,
    device_id: str | None,
) -> set[str] | None:
    """Resolve dashboard selectors to one or more config entry ids."""
    requested_ids: set[str] = set()

    if entry_id:
        requested_ids.add(entry_id)

    if entity_id:
        entity_entry = er.async_get(hass).async_get(entity_id)
        if entity_entry and entity_entry.config_entry_id:
            requested_ids.add(entity_entry.config_entry_id)

    if device_id:
        device_entry = dr.async_get(hass).async_get(device_id)
        if device_entry:
            requested_ids.update(device_entry.config_entries)

    return requested_ids or None


def _extract_plan_options(topic_samples: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    """Return plan options from the paired read_all_plan command response."""
    for topic, sample in topic_samples.items():
        if not topic.endswith("/app/read_all_plan"):
            continue

        response_sample = sample.get("response_sample")
        if not isinstance(response_sample, dict):
            continue

        response_body = response_sample.get("body")
        if not isinstance(response_body, str):
            continue

        plans = _parse_plan_options(response_body)
        if plans:
            return plans

    return []


def _parse_plan_options(response_body: str) -> list[dict[str, str]]:
    """Parse the read_all_plan response body into dropdown options."""
    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return []

    if not isinstance(payload, dict):
        return []

    data_section = payload.get("data")
    if isinstance(data_section, dict):
        candidate_plans = data_section.get("data")
    else:
        candidate_plans = data_section

    if not isinstance(candidate_plans, list):
        return []

    options: list[dict[str, str]] = []
    seen_ids: set[str] = set()

    for candidate in candidate_plans:
        if not isinstance(candidate, dict):
            continue

        plan_id = candidate.get("id")
        plan_name = candidate.get("name")
        if plan_id is None or plan_name is None:
            continue

        plan_id_text = str(plan_id)
        if plan_id_text in seen_ids:
            continue

        seen_ids.add(plan_id_text)
        options.append(
            {
                "id": plan_id_text,
                "name": str(plan_name),
            }
        )

    return options


def _extract_site_map(topic_samples: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Return decoded site-map geometry from a paired get_map response."""
    for topic, sample in topic_samples.items():
        if not topic.endswith("/app/get_map"):
            continue

        response_sample = sample.get("response_sample")
        if not isinstance(response_sample, dict):
            continue

        response_body = response_sample.get("body")
        if not isinstance(response_body, str):
            continue

        site_map = _parse_site_map_response(response_body)
        if site_map is not None:
            site_map["captured_at"] = response_sample.get("captured_at")
            return site_map

    return None


def _extract_wifi_details(topic_samples: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Return connected Wi-Fi details from a paired get_connect_wifi_name response."""
    for topic, sample in topic_samples.items():
        if not topic.endswith("/app/get_connect_wifi_name"):
            continue

        response_sample = sample.get("response_sample")
        if not isinstance(response_sample, dict):
            continue

        response_body = response_sample.get("body")
        if not isinstance(response_body, str):
            continue

        try:
            payload = json.loads(response_body)
        except json.JSONDecodeError:
            continue

        if not isinstance(payload, dict):
            continue

        wifi_data = payload.get("data")
        if not isinstance(wifi_data, dict):
            continue

        return {
            "name": wifi_data.get("name"),
            "security": wifi_data.get("security"),
            "signal": wifi_data.get("signal"),
            "ip": wifi_data.get("ip"),
            "saved": wifi_data.get("saved"),
        }

    return None


def _parse_site_map_response(response_body: str) -> dict[str, Any] | None:
    """Parse a get_map response into a lightweight geometry payload."""
    try:
        outer_payload = json.loads(response_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(outer_payload, dict):
        return None

    encoded_map = outer_payload.get("data")
    if not isinstance(encoded_map, str):
        return None

    try:
        compressed_map = base64.b64decode(encoded_map)
        decoded_map = zlib.decompress(compressed_map).decode("utf-8")
        inner_payload = json.loads(decoded_map)
    except (ValueError, UnicodeDecodeError, binascii.Error, zlib.error):
        return None

    if not isinstance(inner_payload, dict):
        return None

    areas = _extract_map_shapes(inner_payload.get("areas"), closed=True)
    nogozones = _extract_map_shapes(inner_payload.get("nogozones"), closed=True)
    pathways = _extract_map_shapes(inner_payload.get("pathways"), closed=False)
    electric_fence = _extract_map_shapes(inner_payload.get("elec_fence"), closed=True)
    charging_points = _extract_charging_points(inner_payload.get("allchargingData"))
    reference = (
        _extract_map_reference(inner_payload.get("areas"))
        or _extract_map_reference(inner_payload.get("nogozones"))
        or _extract_map_reference(inner_payload.get("pathways"))
        or _extract_map_reference(inner_payload.get("elec_fence"))
    )

    if (
        reference is None
        and not areas
        and not nogozones
        and not pathways
        and not electric_fence
        and not charging_points
    ):
        return None

    return {
        "reference": reference,
        "areas": areas,
        "nogozones": nogozones,
        "pathways": pathways,
        "electric_fence": electric_fence,
        "charging_points": charging_points,
    }


def _extract_map_shapes(
    candidates: Any,
    *,
    closed: bool,
) -> list[dict[str, Any]]:
    """Return simplified local-coordinate shapes."""
    if not isinstance(candidates, list):
        return []

    shapes: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        points = _extract_xy_points(candidate.get("range"))
        minimum_points = 3 if closed else 2
        if len(points) < minimum_points:
            continue

        shapes.append(
            {
                "id": candidate.get("id"),
                "name": candidate.get("name") or "",
                "points": points,
            }
        )

    return shapes


def _extract_charging_points(candidates: Any) -> list[dict[str, Any]]:
    """Return simplified charging point markers."""
    if not isinstance(candidates, list):
        return []

    charging_points: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        point = _extract_xy_point(candidate.get("chargingPoint"))
        if point is None:
            continue

        charging_points.append(
            {
                "id": candidate.get("id"),
                "name": candidate.get("name") or "",
                "point": point,
                "start_point": _extract_xy_point(candidate.get("startPoint")),
            }
        )

    return charging_points


def _extract_map_reference(candidates: Any) -> dict[str, float] | None:
    """Return the first valid geographic reference from map geometry."""
    if not isinstance(candidates, list):
        return None

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        reference = candidate.get("ref")
        if not isinstance(reference, dict):
            continue

        latitude = _coerce_float(reference.get("latitude"))
        longitude = _coerce_float(reference.get("longitude"))
        if latitude is None or longitude is None:
            continue

        if abs(latitude) < 0.000001 and abs(longitude) < 0.000001:
            continue

        return {
            "latitude": round(latitude, 9),
            "longitude": round(longitude, 9),
        }

    return None


def _extract_xy_points(raw_points: Any) -> list[dict[str, float]]:
    """Return rounded x/y map points."""
    if not isinstance(raw_points, list):
        return []

    points: list[dict[str, float]] = []
    for raw_point in raw_points:
        point = _extract_xy_point(raw_point)
        if point is not None:
            points.append(point)

    return points


def _extract_xy_point(raw_point: Any) -> dict[str, float] | None:
    """Return one rounded x/y map point."""
    if not isinstance(raw_point, dict):
        return None

    x_value = _coerce_float(raw_point.get("x"))
    y_value = _coerce_float(raw_point.get("y"))
    if x_value is None or y_value is None:
        return None

    return {
        "x": round(x_value, 3),
        "y": round(y_value, 3),
    }


def _coerce_float(value: Any) -> float | None:
    """Return a float when the value is numeric."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None

    return result


def _find_status_entity_id(hass: HomeAssistant, entry_id: str) -> str | None:
    """Return the status sensor entity_id for a Yarbo config entry."""
    entity_registry = er.async_get(hass)
    entity_id = entity_registry.async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{entry_id}_integration_status",
    )
    return entity_id


def _find_tracker_entity_id(hass: HomeAssistant, entry_id: str) -> str | None:
    """Return the tracker entity_id for a Yarbo config entry."""
    entity_registry = er.async_get(hass)
    entity_id = entity_registry.async_get_entity_id(
        "device_tracker",
        DOMAIN,
        f"{entry_id}_location",
    )
    return entity_id
