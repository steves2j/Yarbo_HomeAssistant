"""Config flow for Yarbo."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_NAME, CONF_PORT
from homeassistant.data_entry_flow import FlowResult

from .const import (
    CONF_SERIAL_NUMBER,
    CONF_TLS,
    DEFAULT_NAME,
    DEFAULT_PORT,
    DEFAULT_TLS_PORT,
    DOMAIN,
)


def _build_schema(defaults: dict[str, Any]) -> vol.Schema:
    """Build the config flow schema."""
    return vol.Schema(
        {
            vol.Required(CONF_NAME, default=defaults[CONF_NAME]): str,
            vol.Required(CONF_HOST, default=defaults[CONF_HOST]): str,
            vol.Required(CONF_PORT, default=defaults[CONF_PORT]): vol.All(
                vol.Coerce(int),
                vol.Range(min=1, max=65535),
            ),
            vol.Required(CONF_TLS, default=defaults[CONF_TLS]): bool,
            vol.Required(
                CONF_SERIAL_NUMBER,
                default=defaults[CONF_SERIAL_NUMBER],
            ): str,
        }
    )


def _default_values() -> dict[str, Any]:
    """Return default values for the initial config flow."""
    return {
        CONF_NAME: DEFAULT_NAME,
        CONF_HOST: "",
        CONF_PORT: DEFAULT_PORT,
        CONF_TLS: False,
        CONF_SERIAL_NUMBER: "",
    }


def _normalize_input(user_input: dict[str, Any]) -> dict[str, Any]:
    """Normalize submitted config flow data."""
    normalized = {
        CONF_NAME: user_input[CONF_NAME].strip(),
        CONF_HOST: user_input[CONF_HOST].strip(),
        CONF_PORT: int(user_input[CONF_PORT]),
        CONF_TLS: bool(user_input[CONF_TLS]),
        CONF_SERIAL_NUMBER: user_input[CONF_SERIAL_NUMBER].strip(),
    }

    if normalized[CONF_TLS] and normalized[CONF_PORT] == DEFAULT_PORT:
        normalized[CONF_PORT] = DEFAULT_TLS_PORT

    return normalized


def _validate_input(data: dict[str, Any]) -> dict[str, str]:
    """Validate config flow input."""
    errors: dict[str, str] = {}

    if not data[CONF_NAME]:
        errors["base"] = "name_required"
    elif not data[CONF_HOST]:
        errors["base"] = "host_required"
    elif not data[CONF_SERIAL_NUMBER]:
        errors["base"] = "serial_number_required"

    return errors


class YarboConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Yarbo."""

    VERSION = 1
    MINOR_VERSION = 0

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        defaults = _default_values()
        errors: dict[str, str] = {}

        if user_input is not None:
            defaults.update(user_input)
            normalized = _normalize_input(user_input)
            errors = _validate_input(normalized)
            if not errors:
                return self.async_create_entry(
                    title=normalized[CONF_NAME],
                    data=normalized,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_build_schema(defaults),
            errors=errors,
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle reconfiguring an existing entry."""
        entry = self._get_reconfigure_entry()
        defaults = {
            CONF_NAME: entry.data.get(CONF_NAME, entry.title),
            CONF_HOST: entry.data.get(CONF_HOST, ""),
            CONF_PORT: entry.data.get(CONF_PORT, DEFAULT_PORT),
            CONF_TLS: entry.data.get(CONF_TLS, False),
            CONF_SERIAL_NUMBER: entry.data.get(CONF_SERIAL_NUMBER, ""),
        }
        errors: dict[str, str] = {}

        if user_input is not None:
            defaults.update(user_input)
            normalized = _normalize_input(user_input)
            errors = _validate_input(normalized)
            if not errors:
                self.hass.config_entries.async_update_entry(
                    entry,
                    title=normalized[CONF_NAME],
                    data=normalized,
                )
                await self.hass.config_entries.async_reload(entry.entry_id)
                return self.async_abort(reason="reconfigure_successful")

        return self.async_show_form(
            step_id="reconfigure",
            data_schema=_build_schema(defaults),
            errors=errors,
        )
