"""Helpers for parsing Yarbo device messages."""

from __future__ import annotations

import json
from typing import Any

from homeassistant.util import dt as dt_util

DEVICE_MESSAGE_TOPIC_SUFFIX = "/device/DeviceMSG"
HEARTBEAT_TOPIC_SUFFIX = "/device/heart_beat"
DATA_FEEDBACK_TOPIC_SUFFIX = "/device/data_feedback"

_GGA_FIX_QUALITY_LABELS = {
    0: "No fix",
    1: "GPS",
    2: "DGPS",
    4: "RTK fixed",
    5: "RTK float",
    6: "Dead reckoning",
}


def is_device_message_topic(topic: str) -> bool:
    """Return True when the topic carries a device snapshot message."""
    return topic.endswith(DEVICE_MESSAGE_TOPIC_SUFFIX)


def is_heartbeat_topic(topic: str) -> bool:
    """Return True when the topic carries the device heartbeat state."""
    return topic.endswith(HEARTBEAT_TOPIC_SUFFIX)


def is_data_feedback_topic(topic: str) -> bool:
    """Return True when the topic carries a get_device_msg response."""
    return topic.endswith(DATA_FEEDBACK_TOPIC_SUFFIX)


def parse_device_message_body(
    message_body: str,
    received_at: str | None = None,
) -> dict[str, Any] | None:
    """Parse a formatted DeviceMSG JSON payload into a dashboard summary."""
    try:
        payload = json.loads(message_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    return parse_device_message_payload(payload, received_at)


def parse_data_feedback_body(
    message_body: str,
    received_at: str | None = None,
) -> dict[str, Any] | None:
    """Parse a data_feedback JSON payload into a dashboard summary."""
    try:
        payload = json.loads(message_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    data = _as_dict(payload.get("data"))
    if not data:
        return None

    summary = parse_device_message_payload(data, received_at)
    summary["summary_source"] = "data_feedback"
    summary["data_feedback_state"] = _as_int(payload.get("state"))
    summary["data_feedback_message"] = _as_str(payload.get("msg"))
    summary["data_feedback_topic"] = _as_str(payload.get("topic"))
    return summary


def parse_heartbeat_body(
    message_body: str,
    received_at: str | None = None,
) -> dict[str, Any] | None:
    """Parse a heartbeat JSON payload into a working-state summary."""
    try:
        payload = json.loads(message_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    return parse_heartbeat_payload(payload, received_at)


def parse_device_message_payload(
    payload: dict[str, Any],
    received_at: str | None = None,
) -> dict[str, Any]:
    """Parse raw DeviceMSG payload data."""
    battery = _as_dict(payload.get("BatteryMSG"))
    state = _as_dict(payload.get("StateMSG"))
    rtk = _as_dict(payload.get("RTKMSG"))
    running = _as_dict(payload.get("RunningStatusMSG"))
    combined_odom = _as_dict(payload.get("CombinedOdom"))
    wheel_speed = _as_dict(payload.get("WheelSpeedMSG"))
    rtk_base_data = _as_dict(payload.get("rtk_base_data"))
    rover = _as_dict(rtk_base_data.get("rover"))
    head = _as_dict(payload.get("HeadMsg"))
    head_serial = _as_dict(payload.get("HeadSerialMsg"))
    body_version = _as_dict(payload.get("BodyVersionMsg"))
    electric = _as_dict(payload.get("EletricMSG"))
    head_version_check = _as_dict(payload.get("HeadAndVersionCheck"))
    net = _as_dict(payload.get("NetMSG"))
    body = _as_dict(payload.get("BodyMsg"))
    wireless_recharge = _as_dict(payload.get("wireless_recharge"))
    abnormal = _as_dict(payload.get("abnormal_msg"))
    mower_head_info03 = _as_dict(payload.get("mower_head_info03"))
    mower_head_info04 = _as_dict(payload.get("mower_head_info04"))

    location = _parse_gga_sentence(_as_str(rover.get("gngga")))
    fix_quality = _as_int(location.get("fix_quality")) if location else None

    return {
        "battery_level": _as_int(battery.get("capacity")),
        "battery_current": _as_int(battery.get("current")),
        "battery_voltage": _as_int(battery.get("voltage")),
        "battery_health": _as_int(battery.get("health")),
        "battery_status": _as_int(battery.get("status")),
        "battery_error": _as_int(battery.get("temp_err")),
        "working_state": _as_int(state.get("working_state")),
        "working_state_source": "device_msg",
        "working_state_label": None,
        "charging_status": _as_int(state.get("charging_status")),
        "error_code": _as_int(state.get("error_code")),
        "plan_msg": _as_str(state.get("plan_msg")),
        "schedule_msg": _as_str(state.get("schedule_msg")),
        "auto_draw_waiting_state": _as_int(state.get("auto_draw_waiting_state")),
        "machine_controller": _as_int(state.get("machine_controller")),
        "self_check_status": _as_int(state.get("self_check_status")),
        "robot_follow_state": _as_bool(state.get("robot_follow_state")),
        "on_going_planning": _as_bool(state.get("on_going_planning")),
        "planning_paused": _as_bool(state.get("planning_paused")),
        "volume": _as_float(state.get("volume")),
        "sound_enabled": _as_bool(state.get("enable_sound")),
        "rain_sensor": _as_int(running.get("rain_sensor_data")),
        "pitch": _as_float(running.get("head_gyro_pitch")),
        "roll": _as_float(running.get("head_gyro_roll")),
        "heading": _as_float(rtk.get("heading")),
        "heading_status": _as_int(rtk.get("heading_status")),
        "rtk_status": _as_str(rtk.get("status")),
        "rtk_fix_quality": fix_quality,
        "rtk_fix_label": _fix_quality_label(fix_quality),
        "head_type": _as_int(head.get("head_type")),
        "head_serial": _as_str(head_serial.get("head_sn")),
        "head_firmware_version": _as_str(head_version_check.get("head_firmware_version")),
        "body_firmware_version": _as_str(body_version.get("body_fw_version")),
        "body_serial": _as_str(body_version.get("body_sn")),
        "ambient_temperature": _as_float(electric.get("body_ambient_ntc_temp")),
        "battery_mos_temperature": _as_float(electric.get("mos_temp")),
        "recharge_state": _as_int(body.get("recharge_state")),
        "stop_button_state": _as_int(body.get("body_stop_button_state")),
        "external_button_state": _as_int(body.get("external_button_state")),
        "left_wheel_fault_state": _as_int(body.get("left_wheel_fault_state")),
        "right_wheel_fault_state": _as_int(body.get("right_wheel_fault_state")),
        "mqtt_server_status": _as_int(net.get("mqtt_server")),
        "ntrip_service_status": _as_int(net.get("ntrip_service")),
        "dns_status": _as_int(net.get("dns")),
        "wireless_recharge_state": _as_int(wireless_recharge.get("state")),
        "wireless_recharge_error_code": _as_int(wireless_recharge.get("error_code")),
        "abnormal_error_code": _as_int(abnormal.get("error_code")),
        "combined_odom_x": _as_float(combined_odom.get("x")),
        "combined_odom_y": _as_float(combined_odom.get("y")),
        "combined_odom_heading": _as_float(combined_odom.get("phi")),
        "combined_odom_confidence": _as_float(payload.get("combined_odom_confidence")),
        "left_wheel_speed": _as_float(wheel_speed.get("left")),
        "right_wheel_speed": _as_float(wheel_speed.get("right")),
        "left_wheel_distance": _as_float(wheel_speed.get("dist_left")),
        "right_wheel_distance": _as_float(wheel_speed.get("dist_right")),
        "left_blade_motor_speed": _as_float(mower_head_info03.get("left_blade_motor_speed")),
        "right_blade_motor_speed": _as_float(mower_head_info04.get("right_blade_motor_speed")),
        "left_blade_motor_rpm": _as_float(mower_head_info03.get("left_blade_motor_rpm")),
        "right_blade_motor_rpm": _as_float(mower_head_info04.get("right_blade_motor_rpm")),
        "location": location,
        "summary_source": "device_msg",
        "updated_at": _format_timestamp(payload.get("timestamp")) or received_at,
    }


def parse_heartbeat_payload(
    payload: dict[str, Any],
    received_at: str | None = None,
) -> dict[str, Any] | None:
    """Parse raw heartbeat payload data."""
    working_state = _as_int(payload.get("working_state"))
    if working_state is None:
        return None

    return {
        "working_state": working_state,
        "working_state_source": "heartbeat",
        "working_state_label": _heartbeat_working_state_label(working_state),
        "heartbeat_received_at": received_at,
    }


def _parse_gga_sentence(sentence: str | None) -> dict[str, Any] | None:
    """Parse an NMEA GGA sentence into lat/lon and RTK fix metadata."""
    if not sentence:
        return None

    parts = sentence.strip().split(",")
    if len(parts) < 10 or not parts[0].endswith("GGA"):
        return None

    fix_quality = _as_int(parts[6])
    satellites = _as_int(parts[7])
    hdop = _as_float(parts[8])
    altitude = _as_float(parts[9])

    latitude = _dm_to_decimal(parts[2], parts[3], degree_digits=2)
    longitude = _dm_to_decimal(parts[4], parts[5], degree_digits=3)

    return {
        "latitude": latitude,
        "longitude": longitude,
        "altitude": altitude,
        "fix_quality": fix_quality,
        "fix_label": _fix_quality_label(fix_quality),
        "satellites": satellites,
        "hdop": hdop,
    }


def _dm_to_decimal(value: str, hemisphere: str, degree_digits: int) -> float | None:
    """Convert NMEA degrees/minutes into decimal degrees."""
    if not value or not hemisphere:
        return None

    try:
        degrees = float(value[:degree_digits])
        minutes = float(value[degree_digits:])
    except ValueError:
        return None

    decimal = degrees + (minutes / 60)
    if hemisphere in {"S", "W"}:
        decimal *= -1

    return round(decimal, 7)


def _fix_quality_label(value: int | None) -> str | None:
    """Return a human-readable RTK/GPS fix label."""
    if value is None:
        return None

    return _GGA_FIX_QUALITY_LABELS.get(value, f"Fix {value}")


def _heartbeat_working_state_label(value: int | None) -> str | None:
    """Return a human-readable heartbeat working-state label when known."""
    if value == 0:
        return "Asleep"

    return None


def _format_timestamp(value: Any) -> str | None:
    """Convert a numeric timestamp into ISO 8601."""
    timestamp = _as_float(value)
    if timestamp is None:
        return None

    return dt_util.utc_from_timestamp(timestamp).isoformat()


def _as_dict(value: Any) -> dict[str, Any]:
    """Return a dict or an empty dict."""
    return value if isinstance(value, dict) else {}


def _as_str(value: Any) -> str | None:
    """Return a stripped string value when present."""
    if value is None:
        return None

    rendered = str(value).strip()
    return rendered or None


def _as_int(value: Any) -> int | None:
    """Return an int value when coercion is possible."""
    if value in (None, ""):
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    """Return a float value when coercion is possible."""
    if value in (None, ""):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_bool(value: Any) -> bool | None:
    """Return a bool value when the payload carries one."""
    if isinstance(value, bool):
        return value

    if isinstance(value, int):
        if value == 0:
            return False
        if value == 1:
            return True

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"0", "false", "off", "no"}:
            return False
        if normalized in {"1", "true", "on", "yes"}:
            return True

    return None
