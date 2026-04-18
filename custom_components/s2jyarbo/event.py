"""Event platform for Yarbo notifications."""

from __future__ import annotations

from homeassistant.components.event import EventEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .mqtt import YarboMqttClient

EVENT_TYPES = [
    "command_notice",
    "command_failed",
    "device_error",
    "low_battery",
    "device_notice",
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Yarbo event entities from a config entry."""
    runtime: YarboMqttClient = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([YarboNotificationEvent(entry, runtime)])


class YarboNotificationEvent(EventEntity):
    """Expose Yarbo notifications as an event entity."""

    _attr_has_entity_name = True
    _attr_name = "Notifications"
    _attr_should_poll = False
    _attr_event_types = EVENT_TYPES

    def __init__(self, entry: ConfigEntry, runtime: YarboMqttClient) -> None:
        """Initialize the notification event entity."""
        self._entry = entry
        self._runtime = runtime
        self._attr_unique_id = f"{entry.entry_id}_notifications"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            manufacturer="Yarbo",
            model="MQTT Integration",
            name=entry.data.get(CONF_NAME, entry.title),
        )

    async def async_added_to_hass(self) -> None:
        """Register for runtime notification updates."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                self._runtime.notification_signal,
                self._handle_notification,
            )
        )

    @callback
    def _handle_notification(self, notification: dict) -> None:
        """Trigger a Home Assistant event for the latest Yarbo notification."""
        event_type = notification.get("event_type") or "device_notice"
        if event_type not in EVENT_TYPES:
            event_type = "device_notice"

        self._trigger_event(event_type, notification)
        self.async_write_ha_state()
