"""Device tracker platform for Yarbo."""

from __future__ import annotations

from homeassistant.components.device_tracker import TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import CONF_SERIAL_NUMBER, DOMAIN
from .mqtt import YarboMqttClient


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the Yarbo device tracker."""
    runtime: YarboMqttClient = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([YarboDeviceTracker(entry, runtime)])


class YarboDeviceTracker(TrackerEntity):
    """Expose the latest Yarbo GPS location."""

    _attr_has_entity_name = True
    _attr_name = "Location"
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, runtime: YarboMqttClient) -> None:
        """Initialize the tracker entity."""
        self._entry = entry
        self._runtime = runtime
        self._attr_unique_id = f"{entry.entry_id}_location"
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

    @property
    def available(self) -> bool:
        """Return whether GPS data is currently available."""
        return self.latitude is not None and self.longitude is not None

    @property
    def latitude(self) -> float | None:
        """Return the current latitude."""
        return self._location_value("latitude")

    @property
    def longitude(self) -> float | None:
        """Return the current longitude."""
        return self._location_value("longitude")

    @property
    def location_accuracy(self) -> int:
        """Suppress the default HA accuracy circle without breaking tracker state."""
        return 0

    @property
    def extra_state_attributes(self) -> dict[str, str | int | float | None]:
        """Return extra GPS and device attributes."""
        summary = self._runtime.state.device_summary or {}
        location = summary.get("location") or {}
        return {
            "yarbo_entry_id": self._entry.entry_id,
            "serial_number": self._entry.data[CONF_SERIAL_NUMBER],
            "fix_quality": location.get("fix_quality"),
            "fix_label": location.get("fix_label"),
            "satellites": location.get("satellites"),
            "hdop": location.get("hdop"),
            "altitude": location.get("altitude"),
            "heading": summary.get("heading"),
            "updated_at": summary.get("updated_at"),
        }

    def _location_value(self, key: str) -> float | int | None:
        """Return a location field from the latest summary."""
        summary = self._runtime.state.device_summary or {}
        location = summary.get("location") or {}
        value = location.get(key)
        if isinstance(value, (int, float)):
            return value

        return None
