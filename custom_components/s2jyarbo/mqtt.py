"""MQTT runtime for the Yarbo integration."""

from __future__ import annotations

import json
import logging
import ssl
import gzip
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any
import zlib

import paho.mqtt.client as mqtt
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_SERIAL_NUMBER,
    CONF_TLS,
    DEFAULT_TOPIC_PREFIX,
    DOMAIN,
    build_connect_wifi_name_topic,
    STATE_CONNECTED,
    STATE_CONNECTING,
    STATE_CONNECTION_FAILED,
    STATE_DISCONNECTED,
    build_device_message_request_topic,
    build_get_sound_param_topic,
    build_map_request_topic,
    build_pause_topic,
    build_recharge_topic,
    build_read_all_plan_topic,
    build_read_global_params_topic,
    build_read_schedules_topic,
    build_read_tow_params_topic,
    build_restart_topic,
    build_resume_topic,
    build_shutdown_topic,
    build_sound_param_topic,
    build_stop_topic,
    build_start_plan_topic,
    build_subscription_topic,
)
from .device_data import (
    is_data_feedback_topic,
    is_device_message_topic,
    is_heartbeat_topic,
    parse_data_feedback_body,
    parse_device_message_body,
    parse_heartbeat_body,
)

_LOGGER = logging.getLogger(__name__)
_KEEPALIVE = 60
_STORAGE_VERSION = 1
_NOTIFICATION_HISTORY_LIMIT = 25
_LOW_BATTERY_THRESHOLD = 20
_GENERIC_SUCCESS_FEEDBACK_MESSAGES = {
    "device messages retrieved successfully.",
    "mower area settings loaded successfully.",
    "successfully connected to the physical controller.",
}


def _callback_api_version() -> mqtt.CallbackAPIVersion:
    """Return the newest supported callback API version.

    Paho exposes this as VERSION2 in the installed Home Assistant environment.
    Keep a fallback for API_VERSION2 in case the enum naming changes again.
    """
    version2 = getattr(mqtt.CallbackAPIVersion, "VERSION2", None)
    if version2 is not None:
        return version2

    return mqtt.CallbackAPIVersion.API_VERSION2


@dataclass(slots=True)
class YarboMqttState:
    """Current MQTT state for a config entry."""

    connection_state: str = STATE_DISCONNECTED
    subscribed_topic: str | None = None
    discovered_topics: list[str] = field(default_factory=list)
    pending_command_topics: list[str] = field(default_factory=list)
    topic_samples: dict[str, dict[str, Any]] = field(default_factory=dict)
    heartbeat_summary: dict[str, Any] | None = None
    device_summary: dict[str, Any] | None = None
    device_message_merged_document: dict[str, Any] | list[Any] | None = None
    device_message_merge_count: int = 0
    device_message_merge_first_received: str | None = None
    device_message_merge_last_received: str | None = None
    notification_history: list[dict[str, Any]] = field(default_factory=list)
    last_notification: dict[str, Any] | None = None
    notification_count: int = 0
    last_discovered_topic: str | None = None
    last_payload: str | None = None
    last_topic: str | None = None
    last_received: str | None = None
    last_error: str | None = None
    message_count: int = 0


class YarboMqttClient:
    """Manage a single MQTT connection for a Yarbo config entry."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the MQTT runtime."""
        self._hass = hass
        self._entry = entry
        self._host: str = entry.data[CONF_HOST]
        self._port: int = entry.data[CONF_PORT]
        self._use_tls: bool = entry.data[CONF_TLS]
        self._serial_number: str = entry.data[CONF_SERIAL_NUMBER]
        self._dispatcher_signal = f"{DOMAIN}_{entry.entry_id}_mqtt_state"
        self._notification_signal = f"{DOMAIN}_{entry.entry_id}_notification"
        self._client: mqtt.Client | None = None
        self._store = Store[dict[str, Any]](
            hass,
            _STORAGE_VERSION,
            f"{DOMAIN}_{entry.entry_id}_topics",
        )
        self._connect_failures = 0
        self.state = YarboMqttState(
            subscribed_topic=build_subscription_topic(self._serial_number)
        )

    @property
    def dispatcher_signal(self) -> str:
        """Return the dispatcher signal for runtime updates."""
        return self._dispatcher_signal

    @property
    def notification_signal(self) -> str:
        """Return the dispatcher signal for runtime notifications."""
        return self._notification_signal

    async def async_start(self) -> None:
        """Start the MQTT client."""
        await self._async_load_discovered_topics()
        await self._hass.async_add_executor_job(self._start)

    async def async_stop(self) -> None:
        """Stop the MQTT client."""
        await self._hass.async_add_executor_job(self._stop)

    async def async_clear_topic_sample(self, topic: str) -> bool:
        """Clear the stored sample for a topic so the next message replaces it."""
        if topic not in self.state.topic_samples:
            return False

        return await self.async_clear_topic_samples_matching({topic})

    async def async_clear_topic_samples_matching(self, topics: set[str]) -> bool:
        """Clear one or more exact cached topic samples."""
        if not topics:
            return False

        matched_topics = {topic for topic in topics if topic in self.state.topic_samples}
        if not matched_topics:
            return False

        pending_command_topics = [
            pending_topic
            for pending_topic in self.state.pending_command_topics
            if pending_topic not in matched_topics
        ]
        updated_samples = {
            existing_topic: sample
            for existing_topic, sample in self.state.topic_samples.items()
            if existing_topic not in matched_topics
        }
        self._apply_state_update(
            {
                "pending_command_topics": pending_command_topics,
                "topic_samples": updated_samples,
            },
            notify=False,
        )
        await self._async_save_store(
            topics=self.state.discovered_topics,
            topic_samples=updated_samples,
            heartbeat_summary=self.state.heartbeat_summary,
            device_summary=self.state.device_summary,
            device_message_merged_document=self.state.device_message_merged_document,
            device_message_merge_count=self.state.device_message_merge_count,
            device_message_merge_first_received=self.state.device_message_merge_first_received,
            device_message_merge_last_received=self.state.device_message_merge_last_received,
            notification_history=self.state.notification_history,
            notification_count=self.state.notification_count,
        )
        return True

    async def async_clear_topic_samples_by_suffixes(self, suffixes: set[str]) -> bool:
        """Clear cached topic samples whose topics end with one of the given suffixes."""
        if not suffixes:
            return False

        matched_topics = {
            topic
            for topic in self.state.topic_samples
            if any(topic.endswith(suffix) for suffix in suffixes)
        }
        return await self.async_clear_topic_samples_matching(matched_topics)

    async def async_clear_all_topic_data(self) -> None:
        """Clear all discovered topics and cached samples for this entry."""
        cleared_state = {
            "discovered_topics": [],
            "pending_command_topics": [],
            "topic_samples": {},
            "last_discovered_topic": None,
            "last_payload": None,
            "last_topic": None,
            "last_received": None,
            "message_count": 0,
            "device_message_merged_document": None,
            "device_message_merge_count": 0,
            "device_message_merge_first_received": None,
            "device_message_merge_last_received": None,
            "notification_history": [],
            "last_notification": None,
            "notification_count": 0,
        }
        self._apply_state_update(cleared_state)
        await self._async_save_store(
            topics=[],
            topic_samples={},
            heartbeat_summary=self.state.heartbeat_summary,
            device_summary=self.state.device_summary,
            device_message_merged_document=None,
            device_message_merge_count=0,
            device_message_merge_first_received=None,
            device_message_merge_last_received=None,
            notification_history=[],
            notification_count=0,
        )

    async def async_request_device_message(self) -> str:
        """Publish a request for the device to send a fresh DeviceMSG payload."""
        return await self._hass.async_add_executor_job(self._request_device_message)

    async def async_request_map(self) -> str:
        """Publish a request for the device to send its current map."""
        return await self._hass.async_add_executor_job(self._request_map)

    async def async_refresh_device_data(self) -> list[str]:
        """Publish a bundle of refresh commands for the device."""
        return await self._hass.async_add_executor_job(self._refresh_device_data)

    async def async_start_plan(self, plan_id: str | int, percent: str | int | float = 0) -> str:
        """Publish a command to start the selected plan."""
        return await self._hass.async_add_executor_job(self._start_plan, plan_id, percent)

    async def async_stop(self) -> str:
        """Publish a command to stop the current action."""
        return await self._hass.async_add_executor_job(self._stop_command)

    async def async_pause(self) -> str:
        """Publish a command to pause the current plan."""
        return await self._hass.async_add_executor_job(self._pause_command)

    async def async_resume(self) -> str:
        """Publish a command to resume the current plan."""
        return await self._hass.async_add_executor_job(self._resume_command)

    async def async_shutdown(self) -> str:
        """Publish a command to shut the device down."""
        return await self._hass.async_add_executor_job(self._shutdown_command)

    async def async_restart(self) -> str:
        """Publish a command to restart the device."""
        return await self._hass.async_add_executor_job(self._restart_command)

    async def async_set_volume(self, percent: str | int | float) -> tuple[str, float]:
        """Publish updated sound settings for the device."""
        return await self._hass.async_add_executor_job(self._set_volume, percent)

    async def async_recharge(self) -> str:
        """Publish a command to send the device back to recharge."""
        return await self._hass.async_add_executor_job(self._recharge)

    async def _async_save_store(
        self,
        *,
        topics: list[str],
        topic_samples: dict[str, dict[str, Any]],
        heartbeat_summary: dict[str, Any] | None,
        device_summary: dict[str, Any] | None,
        device_message_merged_document: dict[str, Any] | list[Any] | None,
        device_message_merge_count: int,
        device_message_merge_first_received: str | None,
        device_message_merge_last_received: str | None,
        notification_history: list[dict[str, Any]],
        notification_count: int,
    ) -> None:
        """Persist the MQTT discovery cache for this entry."""
        payload: dict[str, Any] = {
            "topics": topics,
            "topic_samples": topic_samples,
        }
        if heartbeat_summary is not None:
            payload["heartbeat_summary"] = heartbeat_summary
        if device_summary is not None:
            payload["device_summary"] = device_summary
        if device_message_merged_document is not None:
            payload["device_message_merged_document"] = device_message_merged_document
        if device_message_merge_count > 0:
            payload["device_message_merge_count"] = device_message_merge_count
        if device_message_merge_first_received is not None:
            payload["device_message_merge_first_received"] = device_message_merge_first_received
        if device_message_merge_last_received is not None:
            payload["device_message_merge_last_received"] = device_message_merge_last_received
        if notification_history:
            payload["notification_history"] = notification_history
        if notification_count > 0:
            payload["notification_count"] = notification_count

        await self._store.async_save(payload)

    def _start(self) -> None:
        """Start the MQTT client from a worker thread."""
        if self._client is not None:
            return

        client = mqtt.Client(
            _callback_api_version(),
            client_id=f"{DOMAIN}-{self._entry.entry_id}",
            protocol=mqtt.MQTTv311,
            reconnect_on_failure=True,
        )
        client.enable_logger(_LOGGER)
        client.suppress_exceptions = True
        client.on_connect = self._handle_connect
        client.on_connect_fail = self._handle_connect_fail
        client.on_disconnect = self._handle_disconnect
        client.on_message = self._handle_message
        client.reconnect_delay_set(min_delay=1, max_delay=30)

        if self._use_tls:
            client.tls_set_context(ssl.create_default_context())

        self._client = client
        self._update_state(connection_state=STATE_CONNECTING, last_error=None)
        client.connect_async(self._host, self._port, keepalive=_KEEPALIVE)
        client.loop_start()

    def _stop(self) -> None:
        """Stop the MQTT client from a worker thread."""
        client = self._client
        self._client = None
        self._connect_failures = 0

        if client is None:
            return

        try:
            client.disconnect()
        finally:
            client.loop_stop()

        self._update_state(connection_state=STATE_DISCONNECTED)

    def _request_device_message(self) -> str:
        """Request a fresh DeviceMSG payload from the device."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_device_message_request_topic(self._serial_number)
        compressed_payload = zlib.compress(b"{}")
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed DeviceMSG request to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _request_map(self) -> str:
        """Request a fresh map payload from the device."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_map_request_topic(self._serial_number)
        payload = _build_map_request_payload(
            topic_samples=self.state.topic_samples,
            serial_number=self._serial_number,
        )
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        compressed_payload = zlib.compress(payload_bytes)
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed map request to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _refresh_device_data(self) -> list[str]:
        """Publish the standard refresh bundle for stale or missing device data."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        commands = [
            (
                build_map_request_topic(self._serial_number),
                _build_map_request_payload(
                    topic_samples=self.state.topic_samples,
                    serial_number=self._serial_number,
                ),
            ),
            (
                build_read_all_plan_topic(self._serial_number),
                _build_cached_json_payload(
                    topic_samples=self.state.topic_samples,
                    topic=build_read_all_plan_topic(self._serial_number),
                ),
            ),
            (
                build_read_global_params_topic(self._serial_number),
                _build_cached_json_payload(
                    topic_samples=self.state.topic_samples,
                    topic=build_read_global_params_topic(self._serial_number),
                    default_payload={"id": 1},
                ),
            ),
            (
                build_read_schedules_topic(self._serial_number),
                _build_cached_json_payload(
                    topic_samples=self.state.topic_samples,
                    topic=build_read_schedules_topic(self._serial_number),
                ),
            ),
            (
                build_read_tow_params_topic(self._serial_number),
                _build_cached_json_payload(
                    topic_samples=self.state.topic_samples,
                    topic=build_read_tow_params_topic(self._serial_number),
                ),
            ),
            (
                build_device_message_request_topic(self._serial_number),
                _build_cached_json_payload(
                    topic_samples=self.state.topic_samples,
                    topic=build_device_message_request_topic(self._serial_number),
                ),
            ),
            (
                build_connect_wifi_name_topic(self._serial_number),
                _build_cached_json_payload(
                    topic_samples=self.state.topic_samples,
                    topic=build_connect_wifi_name_topic(self._serial_number),
                ),
            ),
            (
                build_get_sound_param_topic(self._serial_number),
                _build_cached_json_payload(
                    topic_samples=self.state.topic_samples,
                    topic=build_get_sound_param_topic(self._serial_number),
                ),
            ),
        ]

        published_topics: list[str] = []
        for topic, payload in commands:
            payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            compressed_payload = zlib.compress(payload_bytes)
            info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                raise RuntimeError(f"MQTT publish failed with code {info.rc} for {topic}")

            published_topics.append(topic)
            _LOGGER.info(
                "Published refresh command to %s (%s bytes)",
                topic,
                len(compressed_payload),
            )

        return published_topics

    def _start_plan(self, plan_id: str | int, percent: str | int | float = 0) -> str:
        """Publish a command to start a plan."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        resolved_plan_id = _coerce_plan_id(plan_id)
        resolved_percent = int(round(_coerce_percentage(percent)))
        topic = build_start_plan_topic(self._serial_number)
        payload = _build_start_plan_payload(
            topic_samples=self.state.topic_samples,
            serial_number=self._serial_number,
            plan_id=resolved_plan_id,
            percent=resolved_percent,
        )
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        compressed_payload = zlib.compress(payload_bytes)
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed start_plan command to %s for plan %s at %s%% (%s bytes)",
            topic,
            resolved_plan_id,
            resolved_percent,
            len(compressed_payload),
        )
        return topic

    def _recharge(self) -> str:
        """Publish a command to send the device back to recharge."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_recharge_topic(self._serial_number)
        payload = _build_recharge_payload(
            topic_samples=self.state.topic_samples,
            serial_number=self._serial_number,
        )
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        compressed_payload = zlib.compress(payload_bytes)
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed recharge command to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _stop_command(self) -> str:
        """Publish a command to stop the current action."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_stop_topic(self._serial_number)
        payload_bytes = b"{}"
        compressed_payload = zlib.compress(payload_bytes)
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed stop command to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _pause_command(self) -> str:
        """Publish a command to pause the current plan."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_pause_topic(self._serial_number)
        compressed_payload = zlib.compress(b"{}")
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed pause command to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _resume_command(self) -> str:
        """Publish a command to resume the current plan."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_resume_topic(self._serial_number)
        compressed_payload = zlib.compress(b"{}")
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed resume command to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _shutdown_command(self) -> str:
        """Publish a command to shut the device down."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_shutdown_topic(self._serial_number)
        compressed_payload = zlib.compress(b"{}")
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed shutdown command to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _restart_command(self) -> str:
        """Publish a command to restart the device."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        topic = build_restart_topic(self._serial_number)
        compressed_payload = zlib.compress(b"{}")
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published compressed restart command to %s (%s bytes)",
            topic,
            len(compressed_payload),
        )
        return topic

    def _set_volume(self, percent: str | int | float) -> tuple[str, float]:
        """Publish updated sound settings for the device."""
        client = self._client
        if client is None:
            raise RuntimeError("MQTT client is not started")

        if self.state.connection_state != STATE_CONNECTED:
            raise RuntimeError("MQTT broker is not connected")

        resolved_percent = _coerce_percentage(percent)
        resolved_volume = round(resolved_percent / 100, 2)
        topic = build_sound_param_topic(self._serial_number)
        payload = _build_sound_param_payload(
            topic_samples=self.state.topic_samples,
            serial_number=self._serial_number,
            volume=resolved_volume,
        )
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        compressed_payload = zlib.compress(payload_bytes)
        info = client.publish(topic, payload=compressed_payload, qos=0, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"MQTT publish failed with code {info.rc}")

        _LOGGER.info(
            "Published sound settings to %s with volume %.2f (%s bytes)",
            topic,
            resolved_volume,
            len(compressed_payload),
        )
        return topic, resolved_volume

    def _handle_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        connect_flags: mqtt.ConnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None,
    ) -> None:
        """Handle a successful broker connection."""
        topic = build_subscription_topic(self._serial_number)
        self._connect_failures = 0
        client.subscribe(topic)
        self._update_state(
            connection_state=STATE_CONNECTED,
            subscribed_topic=topic,
            last_error=None,
        )
        _LOGGER.info(
            "Connected to MQTT broker %s:%s and subscribed to %s",
            self._host,
            self._port,
            topic,
        )

    def _handle_connect_fail(self, client: mqtt.Client, userdata: Any) -> None:
        """Handle an initial connection failure."""
        self._connect_failures += 1
        self._update_state(
            connection_state=STATE_CONNECTION_FAILED,
            last_error="Unable to connect to the MQTT broker",
        )
        log = _LOGGER.warning if self._connect_failures == 1 else _LOGGER.debug
        log("Unable to connect to MQTT broker %s:%s", self._host, self._port)

    def _handle_disconnect(
        self,
        client: mqtt.Client,
        userdata: Any,
        disconnect_flags: mqtt.DisconnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None,
    ) -> None:
        """Handle a broker disconnect."""
        self._connect_failures = 0
        if reason_code == 0:
            self._update_state(connection_state=STATE_DISCONNECTED)
            return

        self._update_state(
            connection_state=STATE_CONNECTION_FAILED,
            last_error=str(reason_code),
        )
        _LOGGER.warning(
            "Disconnected from MQTT broker %s:%s: %s",
            self._host,
            self._port,
            reason_code,
        )

    def _handle_message(
        self,
        client: mqtt.Client,
        userdata: Any,
        message: mqtt.MQTTMessage,
    ) -> None:
        """Handle an incoming MQTT message."""
        received_at = dt_util.utcnow().isoformat()
        self._hass.loop.call_soon_threadsafe(
            self._process_incoming_message,
            message.topic,
            bytes(message.payload),
            received_at,
            _extract_message_metadata(message),
        )
        _LOGGER.debug("Received MQTT message on %s", message.topic)

    async def _async_load_discovered_topics(self) -> None:
        """Load previously discovered topics from storage."""
        stored = await self._store.async_load() or {}
        topics = stored.get("topics", [])
        topic_samples = stored.get("topic_samples", {})
        heartbeat_summary = stored.get("heartbeat_summary")
        device_summary = stored.get("device_summary")
        device_message_merged_document = stored.get("device_message_merged_document")
        device_message_merge_count = int(stored.get("device_message_merge_count", 0) or 0)
        device_message_merge_first_received = stored.get("device_message_merge_first_received")
        device_message_merge_last_received = stored.get("device_message_merge_last_received")
        notification_history = _normalize_notification_history(
            stored.get("notification_history")
        )
        notification_count = int(
            stored.get("notification_count", len(notification_history)) or 0
        )

        if not topics and topic_samples:
            topics = list(topic_samples)

        updates: dict[str, Any] = {}
        if topics:
            updates["discovered_topics"] = topics
        if topic_samples:
            updates["topic_samples"] = topic_samples

        if heartbeat_summary is None:
            heartbeat_summary = _load_heartbeat_summary_from_samples(topic_samples)
        if heartbeat_summary is not None:
            updates["heartbeat_summary"] = heartbeat_summary

        sample_device_summary = _load_device_summary_from_samples(topic_samples)
        if device_summary is None:
            device_summary = sample_device_summary
        elif sample_device_summary is not None:
            device_summary = _merge_summary_update(device_summary, sample_device_summary)

        device_summary = _merge_heartbeat_into_summary(device_summary, heartbeat_summary)
        if device_summary is not None:
            updates["device_summary"] = device_summary

        if device_message_merged_document is None:
            device_message_merged_document = _load_device_message_merged_document_from_samples(
                topic_samples
            )
            if device_message_merged_document is not None:
                if device_message_merge_count <= 0:
                    device_message_merge_count = 1
                if device_message_merge_first_received is None:
                    device_message_merge_first_received = _load_first_device_message_received_at(
                        topic_samples
                    )
                if device_message_merge_last_received is None:
                    device_message_merge_last_received = _load_last_device_message_received_at(
                        topic_samples
                    )

        if device_message_merged_document is not None:
            updates["device_message_merged_document"] = device_message_merged_document
        if device_message_merge_count > 0:
            updates["device_message_merge_count"] = device_message_merge_count
        if device_message_merge_first_received is not None:
            updates["device_message_merge_first_received"] = device_message_merge_first_received
        if device_message_merge_last_received is not None:
            updates["device_message_merge_last_received"] = device_message_merge_last_received
        if notification_history:
            updates["notification_history"] = notification_history
            updates["last_notification"] = notification_history[-1]
        if notification_count > 0:
            updates["notification_count"] = notification_count

        if updates:
            self._apply_state_update(updates, notify=False)

    @callback
    def _process_incoming_message(
        self,
        topic: str,
        payload: bytes,
        received_at: str,
        packet_metadata: dict[str, Any],
    ) -> None:
        """Process a received MQTT message inside the HA event loop."""
        discovered_topics = self.state.discovered_topics
        topic_samples = self.state.topic_samples
        pending_command_topics = list(self.state.pending_command_topics)
        previous_summary = self.state.device_summary
        sample = _build_topic_sample(payload, received_at, packet_metadata)
        updates: dict[str, Any] = {
            "connection_state": STATE_CONNECTED,
            "last_payload": sample["body"],
            "last_topic": topic,
            "last_received": received_at,
            "last_error": None,
            "message_count": self.state.message_count + 1,
        }
        should_notify = False
        should_save = False
        paired_command_topic: str | None = None

        if _is_command_request_topic(topic):
            pending_command_topics.append(topic)
            updates["pending_command_topics"] = pending_command_topics
            updates["topic_samples"] = {
                **topic_samples,
                topic: {
                    **sample,
                    "response_sample": None,
                    "response_topic": None,
                },
            }
            should_notify = True
            should_save = True

        if is_device_message_topic(topic) or is_data_feedback_topic(topic):
            device_summary = _merge_heartbeat_into_summary(
                _merge_summary_update(
                    self.state.device_summary,
                    _build_device_summary_from_payload(topic, payload, received_at),
                ),
                self.state.heartbeat_summary,
            )
            if device_summary is not None:
                updates["device_summary"] = device_summary
                should_notify = True
                should_save = True

            if is_device_message_topic(topic):
                merged_document = _merge_device_message_document(
                    self.state.device_message_merged_document,
                    payload,
                )
                if merged_document is not None:
                    updates["device_message_merged_document"] = merged_document
                    updates["device_message_merge_count"] = (
                        self.state.device_message_merge_count + 1
                    )
                    updates["device_message_merge_first_received"] = (
                        self.state.device_message_merge_first_received or received_at
                    )
                    updates["device_message_merge_last_received"] = received_at
                    should_notify = True
                    should_save = True

            if is_data_feedback_topic(topic):
                paired_command_topic = _resolve_feedback_command_topic(
                    payload=payload,
                    serial_number=self._serial_number,
                    pending_command_topics=pending_command_topics,
                    topic_samples=updates.get("topic_samples", topic_samples),
                )
                if paired_command_topic is not None:
                    current_samples = updates.get("topic_samples", topic_samples)
                    paired_command_sample = current_samples.get(paired_command_topic)
                    if paired_command_sample is not None:
                        pending_command_topics = _remove_first_pending_command(
                            pending_command_topics,
                            paired_command_topic,
                        )
                        updates["pending_command_topics"] = pending_command_topics
                        updates["topic_samples"] = {
                            **current_samples,
                            paired_command_topic: {
                                **paired_command_sample,
                                "response_topic": topic,
                                "response_sample": {
                                    **sample,
                                    "paired_command_topic": paired_command_topic,
                                },
                            },
                        }
                        should_notify = True
                        should_save = True
        elif is_heartbeat_topic(topic):
            heartbeat_summary = _build_heartbeat_summary_from_payload(payload, received_at)
            if heartbeat_summary is not None:
                updates["heartbeat_summary"] = heartbeat_summary
                merged_summary = _merge_heartbeat_into_summary(
                    self.state.device_summary,
                    heartbeat_summary,
                )
                if merged_summary is not None:
                    updates["device_summary"] = merged_summary
                should_notify = True
                should_save = True

        if topic not in discovered_topics:
            new_topics = [*discovered_topics, topic]
            updates["discovered_topics"] = new_topics
            updates["last_discovered_topic"] = topic
            should_notify = True
            should_save = True

        updated_topic_sample = sample
        if _is_command_request_topic(topic):
            updated_topic_sample = {
                **sample,
                "response_sample": None,
                "response_topic": None,
            }
        updates["topic_samples"] = {
            **updates.get("topic_samples", topic_samples),
            topic: updated_topic_sample,
        }
        should_save = True
        should_notify = True

        current_summary = updates.get("device_summary", self.state.device_summary)
        notifications = _extract_runtime_notifications(
            topic=topic,
            payload=payload,
            received_at=received_at,
            previous_summary=previous_summary,
            current_summary=current_summary,
            paired_command_topic=paired_command_topic,
        )
        if notifications:
            notification_history = list(self.state.notification_history)
            for notification in notifications:
                notification_history = _append_notification_history(
                    notification_history,
                    notification,
                )
            updates["notification_history"] = notification_history
            updates["last_notification"] = notification_history[-1]
            updates["notification_count"] = self.state.notification_count + len(notifications)
            should_save = True
            should_notify = True

        if should_save:
            stored_topics = updates.get("discovered_topics", discovered_topics)
            stored_samples = updates.get("topic_samples", topic_samples)
            self._hass.async_create_task(
                self._async_save_store(
                    topics=stored_topics,
                    topic_samples=stored_samples,
                    heartbeat_summary=updates.get(
                        "heartbeat_summary",
                        self.state.heartbeat_summary,
                    ),
                    device_summary=updates.get(
                        "device_summary",
                        self.state.device_summary,
                    ),
                    device_message_merged_document=updates.get(
                        "device_message_merged_document",
                        self.state.device_message_merged_document,
                    ),
                    device_message_merge_count=updates.get(
                        "device_message_merge_count",
                        self.state.device_message_merge_count,
                    ),
                    device_message_merge_first_received=updates.get(
                        "device_message_merge_first_received",
                        self.state.device_message_merge_first_received,
                    ),
                    device_message_merge_last_received=updates.get(
                        "device_message_merge_last_received",
                        self.state.device_message_merge_last_received,
                    ),
                    notification_history=updates.get(
                        "notification_history",
                        self.state.notification_history,
                    ),
                    notification_count=updates.get(
                        "notification_count",
                        self.state.notification_count,
                    ),
                )
            )

        self._apply_state_update(updates, notify=should_notify)
        for notification in notifications:
            self._emit_runtime_notification(notification)

    def _update_state(self, **changes: Any) -> None:
        """Update state and notify Home Assistant."""
        self._hass.loop.call_soon_threadsafe(self._apply_state_update, changes)

    @callback
    def _apply_state_update(self, changes: dict[str, Any], notify: bool = True) -> None:
        """Apply state changes in the Home Assistant event loop."""
        for key, value in changes.items():
            setattr(self.state, key, value)

        if notify:
            async_dispatcher_send(self._hass, self._dispatcher_signal)

    @callback
    def _emit_runtime_notification(self, notification: dict[str, Any]) -> None:
        """Emit a runtime notification into Home Assistant surfaces."""
        async_dispatcher_send(self._hass, self._notification_signal, notification)
        self._hass.bus.async_fire(f"{DOMAIN}_notification", notification)

        if notification.get("level") not in {"warning", "error"}:
            return

        persistent_notification.async_create(
            self._hass,
            _render_persistent_notification_message(notification),
            title=notification.get("title") or "Yarbo notification",
            notification_id=f"{DOMAIN}_{self._entry.entry_id}_notification",
        )


def _build_topic_sample(
    payload: bytes,
    received_at: str,
    packet_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a display-ready sample for a topic payload."""
    sample_format, rendered_body, truncated, compression = _format_payload(payload)
    return {
        "format": sample_format,
        "body": rendered_body,
        "byte_length": len(payload),
        "captured_at": received_at,
        "truncated": truncated,
        "compression": compression,
        "metadata": packet_metadata or {},
    }


def _is_command_request_topic(topic: str) -> bool:
    """Return True for app/get_* and app/read_* command topics."""
    if "/app/" not in topic:
        return False

    topic_leaf = topic.rsplit("/", 1)[-1]
    return topic_leaf.startswith("get_") or topic_leaf.startswith("read_")


def _extract_data_feedback_command_topic(payload: bytes) -> str | None:
    """Return the command topic declared by a data_feedback payload."""
    payload_body = _extract_text_payload(payload)
    if payload_body is None:
        return None

    try:
        decoded = json.loads(payload_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(decoded, dict):
        return None

    command_topic = decoded.get("topic")
    if not isinstance(command_topic, str):
        return None

    return command_topic.strip() or None


def _coerce_plan_id(plan_id: str | int) -> int:
    """Return a validated integer plan id."""
    if isinstance(plan_id, bool):
        raise ValueError("plan_id must be an integer")

    try:
        resolved_plan_id = int(plan_id)
    except (TypeError, ValueError) as err:
        raise ValueError("plan_id must be an integer") from err

    if resolved_plan_id < 0:
        raise ValueError("plan_id must be zero or greater")

    return resolved_plan_id


def _coerce_percentage(percent: str | int | float) -> float:
    """Return a validated percentage between 0 and 100."""
    if isinstance(percent, bool):
        raise ValueError("percent must be numeric")

    try:
        resolved_percent = float(percent)
    except (TypeError, ValueError) as err:
        raise ValueError("percent must be numeric") from err

    if resolved_percent < 0 or resolved_percent > 100:
        raise ValueError("percent must be between 0 and 100")

    return resolved_percent


def _build_start_plan_payload(
    *,
    topic_samples: dict[str, dict[str, Any]],
    serial_number: str,
    plan_id: int,
    percent: int,
) -> dict[str, Any]:
    """Build the start_plan payload from cached command samples when available."""
    cached_topic = build_start_plan_topic(serial_number)
    payload: dict[str, Any] = {}

    cached_sample = topic_samples.get(cached_topic)
    if isinstance(cached_sample, dict) and cached_sample.get("format") == "json":
        cached_body = cached_sample.get("body")
        if isinstance(cached_body, str):
            try:
                decoded_payload = json.loads(cached_body)
            except json.JSONDecodeError:
                decoded_payload = None

            if isinstance(decoded_payload, dict):
                payload = decoded_payload

    payload["id"] = plan_id
    payload["percent"] = percent
    return payload


def _build_cached_json_payload(
    *,
    topic_samples: dict[str, dict[str, Any]],
    topic: str,
    default_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a JSON payload from a cached topic sample when available."""
    payload = dict(default_payload or {})
    cached_sample = topic_samples.get(topic)
    if not isinstance(cached_sample, dict) or cached_sample.get("format") != "json":
        return payload

    cached_body = cached_sample.get("body")
    if not isinstance(cached_body, str):
        return payload

    try:
        decoded_payload = json.loads(cached_body)
    except json.JSONDecodeError:
        return payload

    if isinstance(decoded_payload, dict):
        payload = decoded_payload
        for key, value in (default_payload or {}).items():
            payload.setdefault(key, value)

    return payload


def _build_map_request_payload(
    *,
    topic_samples: dict[str, dict[str, Any]],
    serial_number: str,
) -> dict[str, Any]:
    """Build the get_map payload from cached command samples when available."""
    cached_topic = build_map_request_topic(serial_number)
    payload: dict[str, Any] = {}

    cached_sample = topic_samples.get(cached_topic)
    if isinstance(cached_sample, dict) and cached_sample.get("format") == "json":
        cached_body = cached_sample.get("body")
        if isinstance(cached_body, str):
            try:
                decoded_payload = json.loads(cached_body)
            except json.JSONDecodeError:
                decoded_payload = None

            if isinstance(decoded_payload, dict):
                payload = decoded_payload

    return payload


def _build_recharge_payload(
    *,
    topic_samples: dict[str, dict[str, Any]],
    serial_number: str,
) -> dict[str, Any]:
    """Build the recharge payload from cached command samples when available."""
    cached_topic = build_recharge_topic(serial_number)
    payload: dict[str, Any] = {}

    cached_sample = topic_samples.get(cached_topic)
    if isinstance(cached_sample, dict) and cached_sample.get("format") == "json":
        cached_body = cached_sample.get("body")
        if isinstance(cached_body, str):
            try:
                decoded_payload = json.loads(cached_body)
            except json.JSONDecodeError:
                decoded_payload = None

            if isinstance(decoded_payload, dict):
                payload = decoded_payload

    payload.setdefault("cmd", 2)
    return payload


def _build_sound_param_payload(
    *,
    topic_samples: dict[str, dict[str, Any]],
    serial_number: str,
    volume: float,
) -> dict[str, Any]:
    """Build the set_sound_param payload from cached command samples when available."""
    cached_topic = build_sound_param_topic(serial_number)
    payload: dict[str, Any] = {}

    cached_sample = topic_samples.get(cached_topic)
    if isinstance(cached_sample, dict) and cached_sample.get("format") == "json":
        cached_body = cached_sample.get("body")
        if isinstance(cached_body, str):
            try:
                decoded_payload = json.loads(cached_body)
            except json.JSONDecodeError:
                decoded_payload = None

            if isinstance(decoded_payload, dict):
                payload = decoded_payload

    payload.setdefault("enable", True)
    payload["vol"] = volume
    payload.setdefault("mode", 0)
    return payload


def _normalize_command_topic(command_topic: str, serial_number: str) -> str:
    """Normalize command topics so data_feedback can match request topics reliably."""
    normalized = command_topic.strip().lstrip("/")
    full_prefix = f"{DEFAULT_TOPIC_PREFIX}/{serial_number}/"

    if normalized.startswith(full_prefix):
        return normalized

    if normalized.startswith("app/"):
        return f"{full_prefix}{normalized}"

    if "/app/" in normalized:
        app_index = normalized.index("/app/") + 1
        return f"{full_prefix}{normalized[app_index:]}"

    if normalized.startswith("get_") or normalized.startswith("read_"):
        return f"{full_prefix}app/{normalized}"

    return normalized


def _resolve_feedback_command_topic(
    *,
    payload: bytes,
    serial_number: str,
    pending_command_topics: list[str],
    topic_samples: dict[str, dict[str, Any]],
) -> str | None:
    """Resolve which command topic a data_feedback payload belongs to."""
    declared_topic = _extract_data_feedback_command_topic(payload)
    if declared_topic is not None:
        normalized_topic = _normalize_command_topic(declared_topic, serial_number)
        if normalized_topic in topic_samples or normalized_topic in pending_command_topics:
            return normalized_topic

    return pending_command_topics[0] if pending_command_topics else None


def _remove_first_pending_command(
    pending_command_topics: list[str],
    target_topic: str,
) -> list[str]:
    """Remove the first pending command matching the resolved topic."""
    updated_topics: list[str] = []
    removed = False

    for pending_topic in pending_command_topics:
        if not removed and pending_topic == target_topic:
            removed = True
            continue

        updated_topics.append(pending_topic)

    if not removed and pending_command_topics:
        return pending_command_topics[1:]

    return updated_topics


def _normalize_notification_history(value: Any) -> list[dict[str, Any]]:
    """Normalize stored notification history into a bounded list of dicts."""
    if not isinstance(value, list):
        return []

    history = [item for item in value if isinstance(item, dict)]
    return history[-_NOTIFICATION_HISTORY_LIMIT:]


def _extract_runtime_notifications(
    *,
    topic: str,
    payload: bytes,
    received_at: str,
    previous_summary: dict[str, Any] | None,
    current_summary: dict[str, Any] | None,
    paired_command_topic: str | None,
) -> list[dict[str, Any]]:
    """Extract runtime notifications from command feedback and state changes."""
    notifications: list[dict[str, Any]] = []

    if is_data_feedback_topic(topic):
        notifications.extend(
            _extract_data_feedback_notifications(
                payload=payload,
                received_at=received_at,
                paired_command_topic=paired_command_topic,
                source_topic=topic,
            )
        )

    notifications.extend(
        _extract_summary_transition_notifications(
            received_at=received_at,
            previous_summary=previous_summary,
            current_summary=current_summary,
            source_topic=topic,
        )
    )
    return notifications


def _extract_data_feedback_notifications(
    *,
    payload: bytes,
    received_at: str,
    paired_command_topic: str | None,
    source_topic: str,
) -> list[dict[str, Any]]:
    """Extract command-level notifications from device/data_feedback."""
    payload_body = _extract_text_payload(payload)
    if payload_body is None:
        return []

    try:
        decoded = json.loads(payload_body)
    except json.JSONDecodeError:
        return []

    if not isinstance(decoded, dict):
        return []

    state = _int_or_none(decoded.get("state"))
    message = _string_or_none(decoded.get("msg"))
    declared_topic = _string_or_none(decoded.get("topic"))
    command_topic = paired_command_topic
    if command_topic is None and declared_topic is not None:
        command_topic = declared_topic

    command_label = _humanize_command_topic(command_topic)
    notifications: list[dict[str, Any]] = []

    if state is not None and state != 0:
        notifications.append(
            _build_runtime_notification(
                event_type="command_failed",
                level="error",
                title=f"{command_label} failed",
                message=message
                or f"{command_label} returned state {state}.",
                received_at=received_at,
                source_topic=source_topic,
                command_topic=command_topic,
                code=state,
            )
        )
        return notifications

    if message and not _is_generic_feedback_message(message):
        notifications.append(
            _build_runtime_notification(
                event_type="command_notice",
                level="info",
                title=command_label,
                message=message,
                received_at=received_at,
                source_topic=source_topic,
                command_topic=command_topic,
            )
        )

    return notifications


def _extract_summary_transition_notifications(
    *,
    received_at: str,
    previous_summary: dict[str, Any] | None,
    current_summary: dict[str, Any] | None,
    source_topic: str,
) -> list[dict[str, Any]]:
    """Extract notifications from device-summary transitions."""
    if current_summary is None:
        return []

    previous_summary = previous_summary or {}
    notifications: list[dict[str, Any]] = []

    previous_error = _int_or_none(previous_summary.get("error_code")) or 0
    current_error = _int_or_none(current_summary.get("error_code")) or 0
    if current_error != 0 and current_error != previous_error:
        notifications.append(
            _build_runtime_notification(
                event_type="device_error",
                level="error",
                title="Device error",
                message=f"The device reported error code {current_error}.",
                received_at=received_at,
                source_topic=source_topic,
                code=current_error,
            )
        )

    previous_abnormal = _int_or_none(previous_summary.get("abnormal_error_code")) or 0
    current_abnormal = _int_or_none(current_summary.get("abnormal_error_code")) or 0
    if current_abnormal != 0 and current_abnormal != previous_abnormal:
        notifications.append(
            _build_runtime_notification(
                event_type="device_error",
                level="error",
                title="Abnormal condition",
                message=f"The device reported abnormal error code {current_abnormal}.",
                received_at=received_at,
                source_topic=source_topic,
                code=current_abnormal,
            )
        )

    previous_recharge_error = (
        _int_or_none(previous_summary.get("wireless_recharge_error_code")) or 0
    )
    current_recharge_error = (
        _int_or_none(current_summary.get("wireless_recharge_error_code")) or 0
    )
    if current_recharge_error != 0 and current_recharge_error != previous_recharge_error:
        notifications.append(
            _build_runtime_notification(
                event_type="device_error",
                level="error",
                title="Recharge error",
                message=(
                    "The device reported wireless recharge error code "
                    f"{current_recharge_error}."
                ),
                received_at=received_at,
                source_topic=source_topic,
                code=current_recharge_error,
            )
        )

    previous_battery = _int_or_none(previous_summary.get("battery_level"))
    current_battery = _int_or_none(current_summary.get("battery_level"))
    charging_status = _int_or_none(current_summary.get("charging_status")) or 0
    if (
        current_battery is not None
        and current_battery < _LOW_BATTERY_THRESHOLD
        and charging_status == 0
        and (previous_battery is None or previous_battery >= _LOW_BATTERY_THRESHOLD)
    ):
        notifications.append(
            _build_runtime_notification(
                event_type="low_battery",
                level="warning",
                title="Low battery",
                message=f"Battery level dropped to {current_battery}%.",
                received_at=received_at,
                source_topic=source_topic,
            )
        )

    previous_controller = _int_or_none(previous_summary.get("machine_controller"))
    current_controller = _int_or_none(current_summary.get("machine_controller"))
    if previous_controller not in (None, 0) and current_controller == 0:
        notifications.append(
            _build_runtime_notification(
                event_type="device_notice",
                level="warning",
                title="Controller disconnected",
                message="The device reported that the physical controller is disconnected.",
                received_at=received_at,
                source_topic=source_topic,
            )
        )

    for key, title in (
        ("plan_msg", "Plan update"),
        ("schedule_msg", "Schedule update"),
    ):
        previous_message = _string_or_none(previous_summary.get(key))
        current_message = _string_or_none(current_summary.get(key))
        if current_message and current_message != previous_message:
            notifications.append(
                _build_runtime_notification(
                    event_type="device_notice",
                    level="info",
                    title=title,
                    message=current_message,
                    received_at=received_at,
                    source_topic=source_topic,
                )
            )

    return notifications


def _append_notification_history(
    history: list[dict[str, Any]],
    notification: dict[str, Any],
) -> list[dict[str, Any]]:
    """Append a notification to bounded history, collapsing consecutive duplicates."""
    updated_history = list(history)
    if updated_history and updated_history[-1].get("id") == notification.get("id"):
        updated_history[-1] = notification
        return updated_history

    updated_history.append(notification)
    return updated_history[-_NOTIFICATION_HISTORY_LIMIT:]


def _build_runtime_notification(
    *,
    event_type: str,
    level: str,
    title: str,
    message: str,
    received_at: str,
    source_topic: str,
    command_topic: str | None = None,
    code: int | None = None,
) -> dict[str, Any]:
    """Build a normalized runtime notification payload."""
    identity_parts = [
        event_type,
        level,
        title.strip(),
        message.strip(),
        source_topic.strip(),
        (command_topic or "").strip(),
        str(code) if code is not None else "",
    ]
    identity = "|".join(identity_parts)
    notification_id = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:12]
    return {
        "id": notification_id,
        "event_type": event_type,
        "level": level,
        "title": title.strip(),
        "message": message.strip(),
        "received_at": received_at,
        "source_topic": source_topic,
        "command_topic": command_topic,
        "code": code,
    }


def _render_persistent_notification_message(notification: dict[str, Any]) -> str:
    """Render a runtime notification as a persistent-notification message."""
    lines = [notification.get("message") or "Yarbo reported a notification."]

    command_topic = notification.get("command_topic")
    if isinstance(command_topic, str) and command_topic:
        lines.append(f"Command: `{command_topic}`")

    source_topic = notification.get("source_topic")
    if isinstance(source_topic, str) and source_topic:
        lines.append(f"Source: `{source_topic}`")

    code = notification.get("code")
    if code is not None:
        lines.append(f"Code: `{code}`")

    received_at = notification.get("received_at")
    if isinstance(received_at, str) and received_at:
        lines.append(f"Received: `{received_at}`")

    return "\n\n".join(lines)


def _humanize_command_topic(command_topic: str | None) -> str:
    """Return a readable label for a Yarbo app command topic."""
    if not command_topic:
        return "Command"

    leaf = command_topic.strip().rstrip("/").rsplit("/", 1)[-1]
    if not leaf:
        return "Command"

    humanized = leaf.replace("_", " ").strip()
    return humanized[:1].upper() + humanized[1:]


def _is_generic_feedback_message(message: str) -> bool:
    """Return True when a feedback message is informational noise."""
    normalized = message.strip().lower()
    if not normalized:
        return True

    return normalized in _GENERIC_SUCCESS_FEEDBACK_MESSAGES


def _string_or_none(value: Any) -> str | None:
    """Return a stripped string when value is a non-empty string."""
    if not isinstance(value, str):
        return None

    stripped = value.strip()
    return stripped or None


def _int_or_none(value: Any) -> int | None:
    """Return an int when the value is int-like."""
    if isinstance(value, bool):
        return int(value)

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_message_metadata(message: mqtt.MQTTMessage) -> dict[str, Any]:
    """Extract safe packet metadata from a received MQTT message."""
    metadata: dict[str, Any] = {
        "qos": message.qos,
        "retain": bool(message.retain),
        "duplicate": bool(message.dup),
        "message_id": message.mid,
    }

    if message.timestamp:
        metadata["client_timestamp"] = dt_util.utc_from_timestamp(
            message.timestamp
        ).isoformat()

    properties = getattr(message, "properties", None)
    if properties is not None and hasattr(properties, "isEmpty") and not properties.isEmpty():
        property_values = properties.json()
        for key, value in property_values.items():
            metadata[_normalize_property_name(key)] = value

    return metadata


def _normalize_property_name(name: str) -> str:
    """Convert MQTT property names to snake_case keys."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def _extract_text_payload(payload: bytes) -> str | None:
    """Return the full textual payload, decompressing when needed."""
    text_payload = _decode_text_payload(payload)
    if text_payload is not None:
        return text_payload

    _, decompressed_payload = _decompress_payload(payload)
    if decompressed_payload is None:
        return None

    return _decode_text_payload(decompressed_payload)


def _format_payload(payload: bytes) -> tuple[str, str, bool, str | None]:
    """Return a rendered representation for a payload."""
    text_payload = _decode_text_payload(payload)
    if text_payload is not None:
        return (*_classify_text_payload(text_payload), None)

    compression, decompressed_payload = _decompress_payload(payload)
    if decompressed_payload is not None:
        text_payload = _decode_text_payload(decompressed_payload)
        if text_payload is not None:
            return (*_classify_text_payload(text_payload), compression)

    rendered_payload, truncated = _format_hexdump(payload)
    return "hex", rendered_payload, truncated, None


def _classify_text_payload(text_payload: str) -> tuple[str, str, bool]:
    """Return whether textual payload is plain text or JSON."""
    json_payload = _format_json_payload(text_payload)
    if json_payload is not None:
        return "json", *_truncate_text(json_payload)

    return "text", *_truncate_text(text_payload)


def _decode_text_payload(payload: bytes) -> str | None:
    """Decode a payload as UTF-8 text when it looks textual."""
    try:
        text_payload = payload.decode("utf-8")
    except UnicodeDecodeError:
        return None

    if not text_payload:
        return ""

    printable_chars = 0
    for char in text_payload:
        if char in "\r\n\t" or char.isprintable():
            printable_chars += 1
            continue

        return None

    if printable_chars / len(text_payload) < 0.95:
        return None

    return text_payload


def _format_json_payload(text_payload: str) -> str | None:
    """Pretty-print a JSON payload when the text parses cleanly."""
    try:
        decoded = json.loads(text_payload)
    except json.JSONDecodeError:
        return None

    return json.dumps(decoded, indent=2, ensure_ascii=False)


def _decompress_payload(payload: bytes) -> tuple[str | None, bytes | None]:
    """Try common compression formats used by device payloads."""
    decompressors: tuple[tuple[str, Any], ...] = (
        ("zlib", zlib.decompress),
        ("gzip", gzip.decompress),
        ("deflate", lambda data: zlib.decompress(data, -zlib.MAX_WBITS)),
    )

    for compression, decompressor in decompressors:
        try:
            return compression, decompressor(payload)
        except Exception:
            continue

    return None, None


def _truncate_text(text_payload: str) -> tuple[str, bool]:
    """Return the full text payload without truncation."""
    return text_payload, False


def _format_hexdump(payload: bytes) -> tuple[str, bool]:
    """Render a binary payload as a full hex dump."""
    rendered_payload = payload
    lines: list[str] = []

    for offset in range(0, len(rendered_payload), 16):
        chunk = rendered_payload[offset : offset + 16]
        hex_bytes = " ".join(f"{byte:02x}" for byte in chunk)
        ascii_bytes = "".join(
            chr(byte) if 32 <= byte <= 126 else "."
            for byte in chunk
        )
        lines.append(f"{offset:04x}  {hex_bytes:<47}  |{ascii_bytes}|")

    return "\n".join(lines), False


def _build_device_summary_from_sample(
    sample: dict[str, Any],
    received_at: str,
) -> dict[str, Any] | None:
    """Build the latest device summary from a DeviceMSG sample."""
    if sample.get("format") != "json":
        return None

    sample_body = sample.get("body")
    if not isinstance(sample_body, str):
        return None

    return parse_device_message_body(sample_body, sample.get("captured_at") or received_at)


def _build_device_summary_from_payload(
    topic: str,
    payload: bytes,
    received_at: str,
) -> dict[str, Any] | None:
    """Build a device summary from the full untruncated MQTT payload."""
    payload_body = _extract_text_payload(payload)
    if payload_body is None:
        return None

    if is_data_feedback_topic(topic):
        return parse_data_feedback_body(payload_body, received_at)

    if is_device_message_topic(topic):
        return parse_device_message_body(payload_body, received_at)

    return None


def _build_device_summary_from_topic(
    topic: str,
    sample: dict[str, Any],
    received_at: str,
) -> dict[str, Any] | None:
    """Build a device summary from either DeviceMSG or data_feedback."""
    if sample.get("format") != "json":
        return None

    sample_body = sample.get("body")
    if not isinstance(sample_body, str):
        return None

    sample_received_at = sample.get("captured_at") or received_at
    if is_data_feedback_topic(topic):
        return parse_data_feedback_body(sample_body, sample_received_at)

    if is_device_message_topic(topic):
        return parse_device_message_body(sample_body, sample_received_at)

    return None


def _build_heartbeat_summary_from_sample(
    sample: dict[str, Any],
    received_at: str,
) -> dict[str, Any] | None:
    """Build the latest heartbeat summary from a heartbeat sample."""
    if sample.get("format") != "json":
        return None

    sample_body = sample.get("body")
    if not isinstance(sample_body, str):
        return None

    return parse_heartbeat_body(sample_body, sample.get("captured_at") or received_at)


def _build_heartbeat_summary_from_payload(
    payload: bytes,
    received_at: str,
) -> dict[str, Any] | None:
    """Build a heartbeat summary from the full untruncated MQTT payload."""
    payload_body = _extract_text_payload(payload)
    if payload_body is None:
        return None

    return parse_heartbeat_body(payload_body, received_at)


def _load_device_summary_from_samples(
    topic_samples: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the latest persisted device summary from snapshot topics."""
    latest_summary: dict[str, Any] | None = None
    latest_captured_at = ""

    for topic, sample in topic_samples.items():
        if not (is_device_message_topic(topic) or is_data_feedback_topic(topic)):
            continue

        captured_at = sample.get("captured_at", "")
        summary = _build_device_summary_from_topic(topic, sample, captured_at)
        if summary is None:
            continue

        if latest_summary is None or captured_at >= latest_captured_at:
            latest_summary = summary
            latest_captured_at = captured_at

    return latest_summary


def _load_heartbeat_summary_from_samples(
    topic_samples: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the latest persisted heartbeat summary, if present."""
    for topic, sample in topic_samples.items():
        if is_heartbeat_topic(topic):
            return _build_heartbeat_summary_from_sample(sample, sample.get("captured_at", ""))

    return None


def _load_device_message_merged_document_from_samples(
    topic_samples: dict[str, dict[str, Any]],
) -> dict[str, Any] | list[Any] | None:
    """Return a merged DeviceMSG document from persisted samples when possible."""
    latest_document: dict[str, Any] | list[Any] | None = None
    latest_captured_at = ""

    for topic, sample in topic_samples.items():
        if not is_device_message_topic(topic):
            continue

        document = _decode_json_document_from_sample(sample)
        if document is None:
            continue

        captured_at = str(sample.get("captured_at", ""))
        if latest_document is None or captured_at >= latest_captured_at:
            latest_document = document
            latest_captured_at = captured_at

    return latest_document


def _load_first_device_message_received_at(
    topic_samples: dict[str, dict[str, Any]],
) -> str | None:
    """Return the oldest persisted DeviceMSG timestamp available."""
    timestamps = [
        str(sample.get("captured_at"))
        for topic, sample in topic_samples.items()
        if is_device_message_topic(topic) and sample.get("captured_at")
    ]
    if not timestamps:
        return None

    return min(timestamps)


def _load_last_device_message_received_at(
    topic_samples: dict[str, dict[str, Any]],
) -> str | None:
    """Return the newest persisted DeviceMSG timestamp available."""
    timestamps = [
        str(sample.get("captured_at"))
        for topic, sample in topic_samples.items()
        if is_device_message_topic(topic) and sample.get("captured_at")
    ]
    if not timestamps:
        return None

    return max(timestamps)


def _merge_device_message_document(
    existing_document: dict[str, Any] | list[Any] | None,
    payload: bytes,
) -> dict[str, Any] | list[Any] | None:
    """Merge a raw DeviceMSG payload into the accumulated observed document."""
    incoming_document = _decode_json_document_from_payload(payload)
    if incoming_document is None:
        return None

    return _merge_observed_document(existing_document, incoming_document)


def _decode_json_document_from_payload(
    payload: bytes,
) -> dict[str, Any] | list[Any] | None:
    """Decode a JSON document from a raw MQTT payload."""
    payload_body = _extract_text_payload(payload)
    if payload_body is None:
        return None

    try:
        decoded = json.loads(payload_body)
    except json.JSONDecodeError:
        return None

    if isinstance(decoded, (dict, list)):
        return decoded

    return None


def _decode_json_document_from_sample(
    sample: dict[str, Any],
) -> dict[str, Any] | list[Any] | None:
    """Decode a JSON document from a stored topic sample."""
    if sample.get("format") != "json":
        return None

    sample_body = sample.get("body")
    if not isinstance(sample_body, str):
        return None

    try:
        decoded = json.loads(sample_body)
    except json.JSONDecodeError:
        return None

    if isinstance(decoded, (dict, list)):
        return decoded

    return None


def _merge_observed_document(
    existing_value: Any,
    incoming_value: Any,
) -> Any:
    """Deep-merge observed JSON while preserving previously seen keys."""
    if existing_value is None:
        return _clone_observed_value(incoming_value)

    if incoming_value is None:
        return _clone_observed_value(existing_value)

    if isinstance(existing_value, dict) and isinstance(incoming_value, dict):
        merged = {key: _clone_observed_value(value) for key, value in existing_value.items()}
        for key, value in incoming_value.items():
            merged[key] = _merge_observed_document(merged.get(key), value)
        return merged

    if isinstance(existing_value, list) and isinstance(incoming_value, list):
        merged: list[Any] = []
        max_length = max(len(existing_value), len(incoming_value))
        for index in range(max_length):
            if index < len(existing_value) and index < len(incoming_value):
                merged.append(
                    _merge_observed_document(existing_value[index], incoming_value[index])
                )
            elif index < len(existing_value):
                merged.append(_clone_observed_value(existing_value[index]))
            else:
                merged.append(_clone_observed_value(incoming_value[index]))
        return merged

    if isinstance(existing_value, (dict, list)) and not isinstance(
        incoming_value, (dict, list)
    ):
        return _clone_observed_value(existing_value)

    if isinstance(incoming_value, (dict, list)) and not isinstance(
        existing_value, (dict, list)
    ):
        return _clone_observed_value(incoming_value)

    return _clone_observed_value(incoming_value)


def _clone_observed_value(value: Any) -> Any:
    """Clone merged JSON structures without sharing references."""
    if isinstance(value, dict):
        return {key: _clone_observed_value(item) for key, item in value.items()}

    if isinstance(value, list):
        return [_clone_observed_value(item) for item in value]

    return value


def _merge_heartbeat_into_summary(
    base_summary: dict[str, Any] | None,
    heartbeat_summary: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Overlay heartbeat working-state data onto a device summary."""
    if base_summary is None and heartbeat_summary is None:
        return None

    merged = dict(base_summary or {})
    if heartbeat_summary is None:
        return merged

    merged["working_state"] = heartbeat_summary.get("working_state")
    merged["working_state_source"] = heartbeat_summary.get("working_state_source")
    merged["working_state_label"] = heartbeat_summary.get("working_state_label")
    merged["heartbeat_received_at"] = heartbeat_summary.get("heartbeat_received_at")
    return merged


def _merge_summary_update(
    existing_summary: dict[str, Any] | None,
    incoming_summary: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Merge a partial device summary without losing prior non-null values."""
    if existing_summary is None:
        return dict(incoming_summary) if incoming_summary is not None else None

    if incoming_summary is None:
        return dict(existing_summary)

    return _merge_non_null(existing_summary, incoming_summary)


def _merge_non_null(
    existing_value: Any,
    incoming_value: Any,
) -> Any:
    """Recursively merge values, preserving existing data when updates are null."""
    if incoming_value is None:
        return existing_value

    if isinstance(existing_value, dict) and isinstance(incoming_value, dict):
        merged: dict[str, Any] = dict(existing_value)
        for key, value in incoming_value.items():
            merged[key] = _merge_non_null(existing_value.get(key), value)
        return merged

    return incoming_value
