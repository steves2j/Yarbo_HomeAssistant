"""Sidebar panel and API views for S2JYarbo."""

from __future__ import annotations

import base64
import binascii
import json
import zlib
from pathlib import Path
from typing import Any

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
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

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
PAUSE_API_URL = "/api/s2jyarbo/pause"
RESUME_API_URL = "/api/s2jyarbo/resume"
STOP_API_URL = "/api/s2jyarbo/stop"
SHUTDOWN_API_URL = "/api/s2jyarbo/shutdown"
RESTART_API_URL = "/api/s2jyarbo/restart"
SET_VOLUME_API_URL = "/api/s2jyarbo/set_volume"
RECHARGE_API_URL = "/api/s2jyarbo/recharge"
SAVE_PATHWAY_API_URL = "/api/s2jyarbo/save_pathway"
SAVE_SIDEWALK_API_URL = "/api/s2jyarbo/save_sidewalk"
DELETE_PATHWAY_API_URL = "/api/s2jyarbo/delete_pathway"
DELETE_SIDEWALK_API_URL = "/api/s2jyarbo/delete_sidewalk"
SAVE_MEMORY_PATH_SETTINGS_API_URL = "/api/s2jyarbo/save_memory_path_settings"
SAVE_NOGOZONE_API_URL = "/api/s2jyarbo/save_nogozone"
DELETE_NOGOZONE_API_URL = "/api/s2jyarbo/delete_nogozone"
EDIT_ACKNOWLEDGEMENT_API_URL = "/api/s2jyarbo/edit_acknowledgement"
AERIAL_OVERLAY_API_URL = "/api/s2jyarbo/aerial_overlay"
PANEL_MODULE_NAME = "s2jyarbo-topics-panel"
BASE_CARD_MODULE_NAME = "s2jyarbo-base-card"
CONTROL_CARD_MODULE_NAME = "s2jyarbo-control-card"
MAP_CARD_MODULE_NAME = "s2jyarbo-map-card"
ADVANCED_CARD_MODULE_NAME = "s2jyarbo-advanced-card"
DEV_MAP_CARD_MODULE_NAME = "s2jyarbo-map-dev-card"
STORAGE_VERSION = 1
EDIT_ACKNOWLEDGEMENT_STORAGE_KEY = f"{DOMAIN}_edit_acknowledgements"
EDIT_ACKNOWLEDGEMENT_ID = "dev_map_edit_warning_v1"
AERIAL_OVERLAY_STORAGE_KEY = f"{DOMAIN}_aerial_overlays"
MAX_AERIAL_IMAGE_DATA_LENGTH = 12_000_000


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the S2JYarbo sidebar panel and supporting HTTP endpoints."""
    panel_dir = Path(__file__).parent / "panel"
    panel_module = panel_dir / f"{PANEL_MODULE_NAME}.js"
    base_module = panel_dir / f"{BASE_CARD_MODULE_NAME}.js"
    control_module = panel_dir / f"{CONTROL_CARD_MODULE_NAME}.js"
    map_module = panel_dir / f"{MAP_CARD_MODULE_NAME}.js"
    advanced_module = panel_dir / f"{ADVANCED_CARD_MODULE_NAME}.js"
    dev_map_module = panel_dir / f"{DEV_MAP_CARD_MODULE_NAME}.js"
    module_version = panel_module.stat().st_mtime_ns
    base_module_version = base_module.stat().st_mtime_ns
    control_module_version = control_module.stat().st_mtime_ns
    map_module_version = map_module.stat().st_mtime_ns
    advanced_module_version = advanced_module.stat().st_mtime_ns
    dev_map_module_version = dev_map_module.stat().st_mtime_ns
    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_STATIC_URL, str(panel_dir), cache_headers=False)]
    )
    hass.http.register_view(YarboTopicsView(hass))
    hass.http.register_view(YarboDashboardView(hass))
    hass.http.register_view(YarboRequestDeviceMessageView(hass))
    hass.http.register_view(YarboRequestMapView(hass))
    hass.http.register_view(YarboRefreshDeviceDataView(hass))
    hass.http.register_view(YarboStartPlanView(hass))
    hass.http.register_view(YarboPauseView(hass))
    hass.http.register_view(YarboResumeView(hass))
    hass.http.register_view(YarboStopView(hass))
    hass.http.register_view(YarboShutdownView(hass))
    hass.http.register_view(YarboRestartView(hass))
    hass.http.register_view(YarboSetVolumeView(hass))
    hass.http.register_view(YarboRechargeView(hass))
    hass.http.register_view(YarboSavePathwayView(hass))
    hass.http.register_view(YarboSaveSidewalkView(hass))
    hass.http.register_view(YarboDeletePathwayView(hass))
    hass.http.register_view(YarboDeleteSidewalkView(hass))
    hass.http.register_view(YarboSaveMemoryPathSettingsView(hass))
    hass.http.register_view(YarboSaveNoGoZoneView(hass))
    hass.http.register_view(YarboDeleteNoGoZoneView(hass))
    hass.http.register_view(YarboEditAcknowledgementView(hass))
    hass.http.register_view(YarboAerialOverlayView(hass))
    frontend.add_extra_js_url(
        hass,
        f"{PANEL_STATIC_URL}/{MAP_CARD_MODULE_NAME}.js?v={map_module_version}",
    )
    frontend.add_extra_js_url(
        hass,
        f"{PANEL_STATIC_URL}/{DEV_MAP_CARD_MODULE_NAME}.js?v={dev_map_module_version}",
    )
    frontend.add_extra_js_url(
        hass,
        f"{PANEL_STATIC_URL}/{BASE_CARD_MODULE_NAME}.js?v={base_module_version}",
    )
    frontend.add_extra_js_url(
        hass,
        f"{PANEL_STATIC_URL}/{CONTROL_CARD_MODULE_NAME}.js?v={control_module_version}",
    )
    frontend.add_extra_js_url(
        hass,
        f"{PANEL_STATIC_URL}/{ADVANCED_CARD_MODULE_NAME}.js?v={advanced_module_version}",
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
        self._aerial_overlay_store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            AERIAL_OVERLAY_STORAGE_KEY,
        )

    async def get(self, request: web.Request) -> web.Response:
        """Return one dashboard card entry per Yarbo config entry."""
        entries: list[dict[str, Any]] = []
        runtimes: dict[str, YarboMqttClient] = self._hass.data.get(DOMAIN, {})
        aerial_overlays = await self._aerial_overlay_store.async_load() or {}
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
            entries.append(
                _serialize_dashboard_entry(
                    self._hass,
                    entry,
                    runtime,
                    aerial_overlay=_normalize_aerial_overlay(
                        aerial_overlays.get(entry.entry_id)
                    ),
                )
            )

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
        percent = payload.get("percent", 0)

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
            topic = await runtime.async_start_plan(plan_id, percent)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        await runtime.async_clear_topic_samples_by_suffixes(
            {"/device/recharge_feedback"}
        )

        return self.json(
            {
                "entry_id": entry.entry_id,
                "plan_id": str(plan_id),
                "percent": percent,
                "topic": topic,
            }
        )


class YarboPauseView(HomeAssistantView):
    """Handle widget actions for pausing a plan."""

    url = PAUSE_API_URL
    name = "api:s2jyarbo:pause"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the pause action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Pause the current plan for one Yarbo device."""
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
            topic = await runtime.async_pause()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboResumeView(HomeAssistantView):
    """Handle widget actions for resuming a plan."""

    url = RESUME_API_URL
    name = "api:s2jyarbo:resume"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the resume action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Resume the current plan for one Yarbo device."""
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
            topic = await runtime.async_resume()
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
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
            topic = await runtime.async_stop_command()
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


class YarboSavePathwayView(HomeAssistantView):
    """Handle widget actions for saving a pathway."""

    url = SAVE_PATHWAY_API_URL
    name = "api:s2jyarbo:save_pathway"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the save_pathway action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a save_pathway command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        command_payload = payload.get("payload")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if not isinstance(command_payload, dict):
            return web.Response(status=400, text="payload is required")

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
            topic = await runtime.async_save_pathway(command_payload)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboSaveSidewalkView(HomeAssistantView):
    """Handle widget actions for saving a memory path."""

    url = SAVE_SIDEWALK_API_URL
    name = "api:s2jyarbo:save_sidewalk"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the save_sidewalk action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a save_sidewalk command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        command_payload = payload.get("payload")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if not isinstance(command_payload, dict):
            return web.Response(status=400, text="payload is required")

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
            topic = await runtime.async_save_sidewalk(command_payload)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboDeletePathwayView(HomeAssistantView):
    """Handle widget actions for deleting a pathway."""

    url = DELETE_PATHWAY_API_URL
    name = "api:s2jyarbo:delete_pathway"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the delete_pathway action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a del_pathway command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        command_payload = payload.get("payload")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if not isinstance(command_payload, dict):
            return web.Response(status=400, text="payload is required")

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
            topic = await runtime.async_delete_pathway(command_payload)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboDeleteSidewalkView(HomeAssistantView):
    """Handle widget actions for deleting a memory path."""

    url = DELETE_SIDEWALK_API_URL
    name = "api:s2jyarbo:delete_sidewalk"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the delete_sidewalk action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a del_sidewalk command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        command_payload = payload.get("payload")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if not isinstance(command_payload, dict):
            return web.Response(status=400, text="payload is required")

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
            topic = await runtime.async_delete_sidewalk(command_payload)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboSaveMemoryPathSettingsView(HomeAssistantView):
    """Handle widget actions for saving memory path settings."""

    url = SAVE_MEMORY_PATH_SETTINGS_API_URL
    name = "api:s2jyarbo:save_memory_path_settings"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the memory path settings action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a save_mower_path_memory_params command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        command_payload = payload.get("payload")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if not isinstance(command_payload, dict):
            return web.Response(status=400, text="payload is required")

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
            topic = await runtime.async_save_memory_path_settings(command_payload)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboSaveNoGoZoneView(HomeAssistantView):
    """Handle widget actions for saving a no-go zone."""

    url = SAVE_NOGOZONE_API_URL
    name = "api:s2jyarbo:save_nogozone"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the save_nogozone action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a save_nogozone command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        command_payload = payload.get("payload")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if not isinstance(command_payload, dict):
            return web.Response(status=400, text="payload is required")

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
            topic = await runtime.async_save_nogozone(command_payload)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboDeleteNoGoZoneView(HomeAssistantView):
    """Handle widget actions for deleting a no-go zone."""

    url = DELETE_NOGOZONE_API_URL
    name = "api:s2jyarbo:delete_nogozone"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the delete_nogozone action API view."""
        self._hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Publish a del_nogozone command for one Yarbo device."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        command_payload = payload.get("payload")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if not isinstance(command_payload, dict):
            return web.Response(status=400, text="payload is required")

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
            topic = await runtime.async_delete_nogozone(command_payload)
        except ValueError as err:
            return web.Response(status=400, text=str(err))
        except RuntimeError as err:
            return web.Response(status=409, text=str(err))

        return self.json(
            {
                "entry_id": entry.entry_id,
                "topic": topic,
            }
        )


class YarboEditAcknowledgementView(HomeAssistantView):
    """Persist the map edit warning acknowledgement in Home Assistant."""

    url = EDIT_ACKNOWLEDGEMENT_API_URL
    name = "api:s2jyarbo:edit_acknowledgement"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the edit acknowledgement API view."""
        self._hass = hass
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            EDIT_ACKNOWLEDGEMENT_STORAGE_KEY,
        )

    async def get(self, request: web.Request) -> web.Response:
        """Return stored edit acknowledgement state for one Yarbo entry."""
        entry_id = request.query.get("entry_id")
        if not isinstance(entry_id, str) or not entry_id:
            return web.Response(status=400, text="entry_id is required")

        entry = _find_config_entry(self._hass, entry_id)
        if entry is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        acknowledgement = await self._async_get_acknowledgement(entry.entry_id)
        return self.json(
            {
                "entry_id": entry.entry_id,
                "acknowledgement_id": EDIT_ACKNOWLEDGEMENT_ID,
                "acknowledged": acknowledgement is not None,
                "acknowledged_at": (
                    acknowledgement.get("acknowledged_at")
                    if acknowledgement
                    else None
                ),
                "acknowledged_by": (
                    acknowledgement.get("acknowledged_by")
                    if acknowledgement
                    else None
                ),
            }
        )

    async def post(self, request: web.Request) -> web.Response:
        """Store edit acknowledgement state for one Yarbo entry."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        acknowledged = payload.get("acknowledged")

        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")
        if acknowledged is not True:
            return web.Response(status=400, text="acknowledged=true is required")

        entry = _find_config_entry(self._hass, entry_id)
        if entry is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        stored = await self._store.async_load() or {}
        entries = stored.get("entries")
        if not isinstance(entries, dict):
            entries = {}

        acknowledgement = {
            "acknowledgement_id": EDIT_ACKNOWLEDGEMENT_ID,
            "acknowledged": True,
            "acknowledged_at": dt_util.utcnow().isoformat(),
            "acknowledged_by": "frontend",
        }
        entry_acknowledgements = entries.get(entry.entry_id)
        if not isinstance(entry_acknowledgements, dict):
            entry_acknowledgements = {}
        entry_acknowledgements[EDIT_ACKNOWLEDGEMENT_ID] = acknowledgement
        entries[entry.entry_id] = entry_acknowledgements
        stored["entries"] = entries
        await self._store.async_save(stored)

        return self.json(
            {
                "entry_id": entry.entry_id,
                **acknowledgement,
            }
        )

    async def _async_get_acknowledgement(self, entry_id: str) -> dict[str, Any] | None:
        """Return the stored acknowledgement for an entry, if present."""
        stored = await self._store.async_load() or {}
        entries = stored.get("entries")
        if not isinstance(entries, dict):
            return None

        entry_acknowledgements = entries.get(entry_id)
        if not isinstance(entry_acknowledgements, dict):
            return None

        acknowledgement = entry_acknowledgements.get(EDIT_ACKNOWLEDGEMENT_ID)
        if (
            not isinstance(acknowledgement, dict)
            or acknowledgement.get("acknowledged") is not True
        ):
            return None

        return acknowledgement


class YarboAerialOverlayView(HomeAssistantView):
    """Persist aerial image overlay calibration for a Yarbo map."""

    url = AERIAL_OVERLAY_API_URL
    name = "api:s2jyarbo:aerial_overlay"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the aerial overlay API view."""
        self._hass = hass
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            AERIAL_OVERLAY_STORAGE_KEY,
        )

    async def get(self, request: web.Request) -> web.Response:
        """Return stored aerial overlay state for one Yarbo entry."""
        entry_id = request.query.get("entry_id")
        if not isinstance(entry_id, str) or not entry_id:
            return web.Response(status=400, text="entry_id is required")

        entry = _find_config_entry(self._hass, entry_id)
        if entry is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        overlays = await self._store.async_load() or {}
        return self.json(
            {
                "entry_id": entry.entry_id,
                "aerial_overlay": _normalize_aerial_overlay(
                    overlays.get(entry.entry_id)
                ),
            }
        )

    async def post(self, request: web.Request) -> web.Response:
        """Store aerial overlay image and calibration state for one Yarbo entry."""
        payload = await request.json()
        entry_id = payload.get("entry_id")
        if not isinstance(entry_id, str):
            return web.Response(status=400, text="entry_id is required")

        entry = _find_config_entry(self._hass, entry_id)
        if entry is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        try:
            aerial_overlay = _normalize_aerial_overlay(payload.get("aerial_overlay"))
        except ValueError as err:
            return web.Response(status=400, text=str(err))

        if aerial_overlay is None:
            return web.Response(status=400, text="aerial_overlay is required")

        aerial_overlay["updated_at"] = dt_util.utcnow().isoformat()
        overlays = await self._store.async_load() or {}
        overlays[entry.entry_id] = aerial_overlay
        await self._store.async_save(overlays)
        return self.json(
            {
                "entry_id": entry.entry_id,
                "aerial_overlay": aerial_overlay,
            }
        )

    async def delete(self, request: web.Request) -> web.Response:
        """Delete stored aerial overlay state for one Yarbo entry."""
        entry_id = request.query.get("entry_id")
        if not isinstance(entry_id, str) or not entry_id:
            return web.Response(status=400, text="entry_id is required")

        entry = _find_config_entry(self._hass, entry_id)
        if entry is None:
            return web.Response(status=404, text="S2JYarbo entry not found")

        overlays = await self._store.async_load() or {}
        overlays.pop(entry.entry_id, None)
        await self._store.async_save(overlays)
        return self.json(
            {
                "entry_id": entry.entry_id,
                "aerial_overlay": None,
            }
        )


def _find_config_entry(hass: HomeAssistant, entry_id: str) -> ConfigEntry | None:
    """Return a S2JYarbo config entry by id."""
    return next(
        (
            config_entry
            for config_entry in hass.config_entries.async_entries(DOMAIN)
            if config_entry.entry_id == entry_id
        ),
        None,
    )


def _normalize_aerial_overlay(value: Any) -> dict[str, Any] | None:
    """Normalize stored aerial overlay data."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("aerial_overlay must be an object")

    image_data = value.get("image_data")
    if image_data is not None:
        if not isinstance(image_data, str) or not image_data.startswith("data:image/"):
            raise ValueError("aerial_overlay.image_data must be an image data URL")
        if len(image_data) > MAX_AERIAL_IMAGE_DATA_LENGTH:
            raise ValueError("aerial_overlay.image_data is too large")

    image_width = _coerce_float(value.get("image_width"))
    image_height = _coerce_float(value.get("image_height"))
    opacity = _coerce_float(value.get("opacity"))
    if opacity is None:
        opacity = 0.62

    points = []
    raw_points = value.get("points")
    if isinstance(raw_points, list):
        for item in raw_points[:20]:
            if not isinstance(item, dict):
                continue
            image = item.get("image")
            map_point = item.get("map")
            if not isinstance(image, dict) or not isinstance(map_point, dict):
                continue

            image_x = _coerce_float(image.get("x"))
            image_y = _coerce_float(image.get("y"))
            map_x = _coerce_float(map_point.get("x"))
            map_y = _coerce_float(map_point.get("y"))
            if None in (image_x, image_y, map_x, map_y):
                continue

            points.append(
                {
                    "image": {"x": image_x, "y": image_y},
                    "map": {"x": map_x, "y": map_y},
                }
            )

    transform = None
    raw_transform = value.get("transform")
    if isinstance(raw_transform, dict):
        transform_values = {
            key: _coerce_float(raw_transform.get(key))
            for key in ("a", "b", "c", "d", "e", "f")
        }
        if all(item is not None for item in transform_values.values()):
            transform_g = _coerce_float(raw_transform.get("g"))
            transform_h = _coerce_float(raw_transform.get("h"))
            if transform_g is not None:
                transform_values["g"] = transform_g
            if transform_h is not None:
                transform_values["h"] = transform_h
            transform = transform_values

    return {
        "image_data": image_data,
        "image_width": image_width,
        "image_height": image_height,
        "opacity": max(0.05, min(1, opacity)),
        "points": points,
        "transform": transform,
        "updated_at": value.get("updated_at") if isinstance(value.get("updated_at"), str) else None,
    }


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
    *,
    aerial_overlay: dict[str, Any] | None = None,
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
        "preview_area_path": _extract_preview_area_path(state.topic_samples) if state else None,
        "plan_feedback": _extract_plan_feedback(state.topic_samples) if state else None,
        "cloud_points_feedback": _extract_cloud_points_feedback(state.topic_samples) if state else None,
        "recharge_feedback": _extract_recharge_feedback(state.topic_samples) if state else None,
        "wifi": _extract_wifi_details(state.topic_samples) if state else None,
        "aerial_overlay": aerial_overlay,
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


def _extract_preview_area_path(topic_samples: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Return preview_snowbot_area_path geometry from the cached command sample."""
    for topic, sample in topic_samples.items():
        if not topic.endswith("/app/preview_snowbot_area_path"):
            continue

        body = sample.get("body")
        if not isinstance(body, str):
            continue

        preview_path = _parse_preview_area_path(body)
        if preview_path is not None:
            preview_path["captured_at"] = sample.get("captured_at")
            return preview_path

    return None


def _extract_plan_feedback(topic_samples: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Return plan feedback geometry from cached device or command responses."""
    device_sample = topic_samples.get(
        next(
            (topic for topic in topic_samples if topic.endswith("/device/plan_feedback")),
            "",
        ),
    )
    if isinstance(device_sample, dict):
        body = device_sample.get("body")
        if isinstance(body, str):
            feedback = _parse_plan_feedback_body(body)
            if feedback is not None:
                feedback["captured_at"] = device_sample.get("captured_at")
                feedback["source_topic"] = "device/plan_feedback"
                return feedback

    command_sample = topic_samples.get(
        next(
            (topic for topic in topic_samples if topic.endswith("/app/get_plan_feedback")),
            "",
        ),
    )
    if not isinstance(command_sample, dict):
        return None

    response_sample = command_sample.get("response_sample")
    if not isinstance(response_sample, dict):
        return None

    response_body = response_sample.get("body")
    if not isinstance(response_body, str):
        return None

    feedback = _parse_plan_feedback_body(response_body)
    if feedback is None:
        return None

    feedback["captured_at"] = response_sample.get("captured_at")
    feedback["source_topic"] = "app/get_plan_feedback"
    return feedback


def _extract_cloud_points_feedback(topic_samples: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Return temporary barrier geometry from cached cloud_points_feedback messages."""
    device_sample = topic_samples.get(
        next(
            (topic for topic in topic_samples if topic.endswith("/device/cloud_points_feedback")),
            "",
        ),
    )
    if not isinstance(device_sample, dict):
        return None

    body = device_sample.get("body")
    if not isinstance(body, str):
        return None

    feedback = _parse_cloud_points_feedback_body(body)
    if feedback is None:
        return None

    feedback["captured_at"] = device_sample.get("captured_at")
    feedback["source_topic"] = "device/cloud_points_feedback"
    return feedback


def _extract_recharge_feedback(topic_samples: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Return local recharge path geometry from cached recharge_feedback messages."""
    device_sample = topic_samples.get(
        next(
            (topic for topic in topic_samples if topic.endswith("/device/recharge_feedback")),
            "",
        ),
    )
    if not isinstance(device_sample, dict):
        return None

    body = device_sample.get("body")
    if not isinstance(body, str):
        return None

    feedback = _parse_recharge_feedback_body(body)
    if feedback is None:
        return None

    feedback["captured_at"] = device_sample.get("captured_at")
    feedback["source_topic"] = "device/recharge_feedback"
    return feedback


def _parse_site_map_response(response_body: str) -> dict[str, Any] | None:
    """Parse a get_map response into a lightweight geometry payload."""
    try:
        outer_payload = json.loads(response_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(outer_payload, dict):
        return None

    inner_payload = _extract_site_map_payload(outer_payload)
    if not isinstance(inner_payload, dict):
        return None

    areas = _extract_map_shapes(inner_payload.get("areas"), closed=True)
    nogozones = _extract_map_shapes(inner_payload.get("nogozones"), closed=True)
    pathways = _extract_map_shapes(inner_payload.get("pathways"), closed=False)
    sidewalks = _extract_map_shapes(inner_payload.get("sidewalks"), closed=False)
    electric_fence = _extract_map_shapes(inner_payload.get("elec_fence"), closed=True)
    charging_points = _extract_charging_points(inner_payload.get("allchargingData"))
    reference = (
        _extract_map_reference(inner_payload.get("areas"))
        or _extract_map_reference(inner_payload.get("nogozones"))
        or _extract_map_reference(inner_payload.get("pathways"))
        or _extract_map_reference(inner_payload.get("sidewalks"))
        or _extract_map_reference(inner_payload.get("elec_fence"))
    )

    if (
        reference is None
        and not areas
        and not nogozones
        and not pathways
        and not sidewalks
        and not electric_fence
        and not charging_points
    ):
        return None

    return {
        "reference": reference,
        "areas": areas,
        "nogozones": nogozones,
        "pathways": pathways,
        "sidewalks": sidewalks,
        "electric_fence": electric_fence,
        "charging_points": charging_points,
    }


def _extract_site_map_payload(outer_payload: dict[str, Any]) -> dict[str, Any] | None:
    """Return the map geometry object from old or new get_map response formats."""
    candidate = outer_payload.get("data")
    if isinstance(candidate, dict):
        return candidate

    if candidate is None and _looks_like_site_map_payload(outer_payload):
        return outer_payload

    if not isinstance(candidate, str):
        return None

    try:
        compressed_map = base64.b64decode(candidate)
        decoded_map = zlib.decompress(compressed_map).decode("utf-8")
        decoded_payload = json.loads(decoded_map)
    except (ValueError, UnicodeDecodeError, binascii.Error, zlib.error):
        return None

    return decoded_payload if isinstance(decoded_payload, dict) else None


def _looks_like_site_map_payload(payload: dict[str, Any]) -> bool:
    """Return True when a payload already looks like a decoded map object."""
    return any(
        key in payload
        for key in (
            "areas",
            "nogozones",
            "pathways",
            "sidewalks",
            "elec_fence",
            "allchargingData",
        )
    )


def _parse_preview_area_path(response_body: str) -> dict[str, Any] | None:
    """Parse a preview_snowbot_area_path payload into lightweight local geometry."""
    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    points = _extract_xy_points(payload.get("range"))
    if len(points) < 2:
        return None

    raw_reference = payload.get("ref")
    latitude = _coerce_float(raw_reference.get("latitude")) if isinstance(raw_reference, dict) else None
    longitude = _coerce_float(raw_reference.get("longitude")) if isinstance(raw_reference, dict) else None
    reference = None
    if latitude is not None and longitude is not None:
        reference = {
            "latitude": round(latitude, 9),
            "longitude": round(longitude, 9),
        }

    return {
        "id": payload.get("id"),
        "algorithm_type": payload.get("algorithm_type"),
        "points": points,
        "reference": reference,
    }


def _parse_plan_feedback_body(response_body: str) -> dict[str, Any] | None:
    """Parse plan_feedback payloads into lightweight local geometry."""
    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    candidate = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(candidate, dict):
        return None

    raw_segments = candidate.get("cleanPathProgress")
    if not isinstance(raw_segments, list):
        return None

    segments: list[dict[str, Any]] = []
    for raw_segment in raw_segments:
        if not isinstance(raw_segment, dict):
            continue

        points = _extract_xy_points(raw_segment.get("path"))
        if len(points) < 2:
            continue

        segments.append(
            {
                "id": raw_segment.get("id"),
                "type": raw_segment.get("type"),
                "clean_index": raw_segment.get("clean_index"),
                "clean_times": raw_segment.get("clean_times"),
                "points": points,
                "path_slope": raw_segment.get("path_slope")
                if isinstance(raw_segment.get("path_slope"), list)
                else [],
            }
        )

    actual_clean_area = _coerce_float(candidate.get("actualCleanArea"))
    finish_clean_area = _coerce_float(candidate.get("finishCleanArea"))
    total_clean_area = _coerce_float(candidate.get("totalCleanArea"))
    raw_finish_ids = candidate.get("finishIds")
    finish_ids: list[dict[str, Any]] = []
    if isinstance(raw_finish_ids, list):
        for raw_finish in raw_finish_ids:
            if not isinstance(raw_finish, dict):
                continue
            finish_ids.append(
                {
                    "id": raw_finish.get("id"),
                    "move_type": raw_finish.get("move_type"),
                    "clean_times": raw_finish.get("clean_times"),
                }
            )
    completed_clean_area = actual_clean_area
    if completed_clean_area is None:
        completed_clean_area = finish_clean_area
    remaining_clean_area = None
    progress_percent = None
    if total_clean_area is not None and completed_clean_area is not None:
        remaining_clean_area = max(total_clean_area - completed_clean_area, 0.0)
        if total_clean_area > 0:
            progress_percent = min(
                100.0,
                max(0.0, (completed_clean_area / total_clean_area) * 100.0),
            )

    state = candidate.get("state")
    return {
        "plan_id": candidate.get("planId"),
        "state": state,
        "plan_running": state == 1,
        "clean_area_id": candidate.get("cleanAreaId"),
        "actual_clean_area": actual_clean_area,
        "finish_clean_area": finish_clean_area,
        "completed_clean_area": completed_clean_area,
        "remaining_clean_area": remaining_clean_area,
        "total_clean_area": total_clean_area,
        "progress_percent": progress_percent,
        "left_time": _coerce_float(candidate.get("leftTime")),
        "total_time": _coerce_float(candidate.get("totalTime")),
        "duration": _coerce_float(candidate.get("duration")),
        "finish_ids": finish_ids,
        "segments": segments,
    }


def _parse_cloud_points_feedback_body(response_body: str) -> dict[str, Any] | None:
    """Parse cloud_points_feedback payloads into local barrier segments."""
    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    raw_segments = payload.get("tmp_barrier_points")
    if not isinstance(raw_segments, list):
        return None

    segments: list[dict[str, Any]] = []
    for index, raw_segment in enumerate(raw_segments):
        points = _extract_xy_points(raw_segment)
        if len(points) < 2:
            continue

        segments.append(
            {
                "id": index,
                "points": points,
            }
        )

    if not segments:
        return None

    return {
        "rotate_rad": _coerce_float(payload.get("rotate_rad")),
        "segments": segments,
    }


def _parse_recharge_feedback_body(response_body: str) -> dict[str, Any] | None:
    """Parse recharge_feedback payloads into lightweight local geometry."""
    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    points = _extract_xy_points(payload.get("path"))
    if len(points) < 2:
        return None

    return {
        "state": payload.get("state"),
        "running_state": payload.get("runningState"),
        "left_time": _coerce_float(payload.get("leftTime")),
        "total_time": _coerce_float(payload.get("totalTime")),
        "points": points,
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
                "type": candidate.get("type"),
                "enable": candidate.get("enable"),
                "blade_height": candidate.get("blade_height"),
                "en_blade": candidate.get("en_blade"),
                "plan_speed": candidate.get("plan_speed"),
                "connectids": candidate.get("connectids") if isinstance(candidate.get("connectids"), list) else [],
                "head_type": candidate.get("head_type"),
                "snowPiles": candidate.get("snowPiles") if isinstance(candidate.get("snowPiles"), list) else [],
                "points": points,
                "trimming_edges": _extract_trimming_edges(candidate.get("trimming_edges")),
            }
        )

    return shapes


def _extract_trimming_edges(candidates: Any) -> list[dict[str, Any]]:
    """Return simplified memory-path trimming edge geometry."""
    if not isinstance(candidates, list):
        return []

    edges: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        points = _extract_xy_points(candidate.get("range"))
        if len(points) < 2:
            continue

        edges.append(
            {
                "id": candidate.get("id"),
                "ref": candidate.get("ref") if isinstance(candidate.get("ref"), dict) else None,
                "points": points,
            }
        )

    return edges


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
                "straight_phi": _coerce_float(candidate.get("straightPhi")),
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
