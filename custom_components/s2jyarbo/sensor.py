"""Sensor platform for Yarbo."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_NAME, CONF_PORT, EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_SERIAL_NUMBER, CONF_TLS, DOMAIN
from .mqtt import YarboMqttClient

SENSOR_DESCRIPTION = SensorEntityDescription(
    key="integration_status",
    translation_key="integration_status",
    entity_category=EntityCategory.DIAGNOSTIC,
    icon="mdi:robot-mower",
)

DISCOVERED_TOPICS_DESCRIPTION = SensorEntityDescription(
    key="discovered_topics",
    translation_key="discovered_topics",
    entity_category=EntityCategory.DIAGNOSTIC,
    icon="mdi:format-list-bulleted",
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Yarbo sensor entities from a config entry."""
    runtime: YarboMqttClient = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            YarboStatusSensor(entry, runtime),
            YarboDiscoveredTopicsSensor(entry, runtime),
        ]
    )


class YarboBaseSensor(SensorEntity):
    """Base sensor for Yarbo diagnostic entities."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, runtime: YarboMqttClient) -> None:
        """Initialize the status sensor."""
        self._entry = entry
        self._runtime = runtime
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            manufacturer="Yarbo",
            model="MQTT Integration",
            name=entry.data.get(CONF_NAME, entry.title),
        )

    async def async_added_to_hass(self) -> None:
        """Register for runtime updates."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                self._runtime.dispatcher_signal,
                self.async_write_ha_state,
            )
        )


class YarboStatusSensor(YarboBaseSensor):
    """Expose the MQTT connection state."""

    entity_description = SENSOR_DESCRIPTION

    def __init__(self, entry: ConfigEntry, runtime: YarboMqttClient) -> None:
        """Initialize the status sensor."""
        super().__init__(entry, runtime)
        self._attr_unique_id = f"{entry.entry_id}_integration_status"

    @property
    def native_value(self) -> str:
        """Return the current sensor state."""
        return self._runtime.state.connection_state

    @property
    def extra_state_attributes(self) -> dict[str, str | int | float | bool | None]:
        """Return diagnostic attributes for the MQTT connection."""
        state = self._runtime.state
        summary = state.device_summary or {}
        location = summary.get("location") or {}
        return {
            "broker_host": self._entry.data[CONF_HOST],
            "broker_port": self._entry.data[CONF_PORT],
            "tls": self._entry.data[CONF_TLS],
            "serial_number": self._entry.data[CONF_SERIAL_NUMBER],
            "subscribed_topic": state.subscribed_topic,
            "discovered_topic_count": len(state.discovered_topics),
            "last_topic": state.last_topic,
            "last_payload": state.last_payload,
            "last_received": state.last_received,
            "last_error": state.last_error,
            "message_count": state.message_count,
            "battery_level": summary.get("battery_level"),
            "battery_current": summary.get("battery_current"),
            "battery_voltage": summary.get("battery_voltage"),
            "battery_health": summary.get("battery_health"),
            "working_state": summary.get("working_state"),
            "working_state_label": summary.get("working_state_label"),
            "working_state_source": summary.get("working_state_source"),
            "charging_status": summary.get("charging_status"),
            "error_code": summary.get("error_code"),
            "plan_msg": summary.get("plan_msg"),
            "schedule_msg": summary.get("schedule_msg"),
            "machine_controller": summary.get("machine_controller"),
            "heading": summary.get("heading"),
            "left_wheel_speed": summary.get("left_wheel_speed"),
            "right_wheel_speed": summary.get("right_wheel_speed"),
            "left_wheel_distance": summary.get("left_wheel_distance"),
            "right_wheel_distance": summary.get("right_wheel_distance"),
            "left_blade_motor_speed": summary.get("left_blade_motor_speed"),
            "right_blade_motor_speed": summary.get("right_blade_motor_speed"),
            "left_blade_motor_rpm": summary.get("left_blade_motor_rpm"),
            "right_blade_motor_rpm": summary.get("right_blade_motor_rpm"),
            "rtk_fix_label": summary.get("rtk_fix_label"),
            "summary_source": summary.get("summary_source"),
            "body_firmware_version": summary.get("body_firmware_version"),
            "head_firmware_version": summary.get("head_firmware_version"),
            "ambient_temperature": summary.get("ambient_temperature"),
            "stop_button_state": summary.get("stop_button_state"),
            "mqtt_server_status": summary.get("mqtt_server_status"),
            "ntrip_service_status": summary.get("ntrip_service_status"),
            "dns_status": summary.get("dns_status"),
            "latitude": location.get("latitude"),
            "longitude": location.get("longitude"),
            "heartbeat_received_at": summary.get("heartbeat_received_at"),
            "updated_at": summary.get("updated_at"),
            "notification_count": state.notification_count,
            "last_notification_level": (state.last_notification or {}).get("level"),
            "last_notification_title": (state.last_notification or {}).get("title"),
            "last_notification_message": (state.last_notification or {}).get("message"),
            "last_notification_at": (state.last_notification or {}).get("received_at"),
            "recent_notifications": state.notification_history[-5:],
        }


class YarboDiscoveredTopicsSensor(YarboBaseSensor):
    """Expose the discovered MQTT topics."""

    entity_description = DISCOVERED_TOPICS_DESCRIPTION

    def __init__(self, entry: ConfigEntry, runtime: YarboMqttClient) -> None:
        """Initialize the discovered topics sensor."""
        super().__init__(entry, runtime)
        self._attr_unique_id = f"{entry.entry_id}_discovered_topics"

    @property
    def native_value(self) -> int:
        """Return the number of discovered topics."""
        return len(self._runtime.state.discovered_topics)

    @property
    def extra_state_attributes(self) -> dict[str, str | int | list[str] | None]:
        """Return the discovered topics and related metadata."""
        state = self._runtime.state
        return {
            "subscribed_topic": state.subscribed_topic,
            "last_discovered_topic": state.last_discovered_topic,
            "last_topic": state.last_topic,
            "message_count": state.message_count,
            "discovered_topics": state.discovered_topics,
        }
