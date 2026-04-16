"""Constants for the Yarbo integration."""

from __future__ import annotations

from homeassistant.const import CONF_HOST, CONF_PORT

DOMAIN = "yarbo"

CONF_SERIAL_NUMBER = "serial_number"
CONF_TLS = "tls"

DEFAULT_NAME = "Yarbo"
DEFAULT_PORT = 1883
DEFAULT_TLS_PORT = 8883
DEFAULT_TOPIC_PREFIX = "snowbot"

STATE_CONNECTING = "connecting"
STATE_CONNECTED = "connected"
STATE_DISCONNECTED = "disconnected"
STATE_CONNECTION_FAILED = "connection_failed"


def _build_app_topic(serial_number: str, command: str) -> str:
    """Build a Yarbo app topic for a serial number and command suffix."""
    return f"{DEFAULT_TOPIC_PREFIX}/{serial_number}/app/{command}"


def build_subscription_topic(serial_number: str) -> str:
    """Build the MQTT topic for a Yarbo serial number."""
    return f"{DEFAULT_TOPIC_PREFIX}/{serial_number}/#"


def build_device_message_request_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request a fresh DeviceMSG payload."""
    return _build_app_topic(serial_number, "get_device_msg")


def build_map_request_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request the current device map."""
    return _build_app_topic(serial_number, "get_map")


def build_read_all_plan_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request all plans."""
    return _build_app_topic(serial_number, "read_all_plan")


def build_read_global_params_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request global parameters."""
    return _build_app_topic(serial_number, "read_global_params")


def build_read_schedules_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request schedules."""
    return _build_app_topic(serial_number, "read_schedules")


def build_read_tow_params_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request tow parameters."""
    return _build_app_topic(serial_number, "read_tow_params")


def build_connect_wifi_name_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request current Wi-Fi details."""
    return _build_app_topic(serial_number, "get_connect_wifi_name")


def build_get_sound_param_topic(serial_number: str) -> str:
    """Build the MQTT topic used to request current sound settings."""
    return _build_app_topic(serial_number, "get_sound_param")


def build_start_plan_topic(serial_number: str) -> str:
    """Build the MQTT topic used to start a plan."""
    return _build_app_topic(serial_number, "start_plan")


def build_stop_topic(serial_number: str) -> str:
    """Build the MQTT topic used to stop the current action."""
    return _build_app_topic(serial_number, "stop")


def build_shutdown_topic(serial_number: str) -> str:
    """Build the MQTT topic used to shut the device down."""
    return _build_app_topic(serial_number, "shutdown")


def build_restart_topic(serial_number: str) -> str:
    """Build the MQTT topic used to restart the device."""
    return _build_app_topic(serial_number, "restart")


def build_sound_param_topic(serial_number: str) -> str:
    """Build the MQTT topic used to update sound settings."""
    return _build_app_topic(serial_number, "set_sound_param")


def build_recharge_topic(serial_number: str) -> str:
    """Build the MQTT topic used to command a recharge."""
    return _build_app_topic(serial_number, "cmd_recharge")


CONFIG_KEYS = (
    CONF_HOST,
    CONF_PORT,
    CONF_TLS,
    CONF_SERIAL_NUMBER,
)
