"""Reference catalog of discovered S2JYarbo MQTT topic suffixes.

This module is intentionally static. It is a developer reference for the
currently known topic surface from two sources:

- topics explicitly referenced in the integration code
- topics captured in the local sample store

The catalog intentionally stores suffixes only so no real device serial number
needs to be committed to the repository.
"""

from __future__ import annotations

from .const import DEFAULT_TOPIC_PREFIX, build_subscription_topic


def build_app_topic(serial_number: str, command: str) -> str:
    """Build a full app topic for a serial number."""
    return f"{DEFAULT_TOPIC_PREFIX}/{serial_number}/app/{command}"


def build_device_topic(serial_number: str, topic: str) -> str:
    """Build a full device topic for a serial number."""
    return f"{DEFAULT_TOPIC_PREFIX}/{serial_number}/device/{topic}"


# Topic suffixes that are explicitly referenced by the current integration code.
CODE_KNOWN_APP_TOPIC_SUFFIXES: tuple[str, ...] = (
    "cmd_recharge",
    "del_nogozone",
    "del_pathway",
    "get_connect_wifi_name",
    "get_device_msg",
    "get_map",
    "get_plan_feedback",
    "get_sound_param",
    "pause",
    "preview_snowbot_area_path",
    "del_sidewalk",
    "read_all_plan",
    "read_global_params",
    "read_schedules",
    "read_tow_params",
    "resume",
    "restart",
    "save_pathway",
    "save_nogozone",
    "save_sidewalk",
    "save_mower_path_memory_params",
    "set_sound_param",
    "shutdown",
    "start_plan",
    "stop",
)

CODE_KNOWN_DEVICE_TOPIC_SUFFIXES: tuple[str, ...] = (
    "DeviceMSG",
    "cloud_points_feedback",
    "data_feedback",
    "heart_beat",
    "plan_feedback",
    "recharge_feedback",
)


# Topic suffixes captured so far from the local sample store.
SAMPLE_CAPTURED_APP_TOPIC_SUFFIXES: tuple[str, ...] = (
    "cmd_roller",
    "cmd_vel",
    "get_map",
    "get_plan_feedback",
    "read_all_plan",
    "read_gps_ref",
    "read_no_charge_period",
    "read_recharge_point",
    "read_schedules",
    "read_tow_params",
    "save_clean_area",
    "read_mower_path_memory_params",
    "save_pathway",
    "save_sidewalk",
    "save_mower_path_memory_params",
    "set_combined_odom_path_state",
    "set_working_state",
    "start_draw_cmd",
    "start_way_point",
)

SAMPLE_CAPTURED_DEVICE_TOPIC_SUFFIXES: tuple[str, ...] = (
    "DeviceMSG",
    "cloud_points_feedback",
    "combined_odom_path",
    "data_feedback",
    "heart_beat",
    "plan_feedback",
)


ALL_DISCOVERED_APP_TOPIC_SUFFIXES: tuple[str, ...] = tuple(
    sorted(set(CODE_KNOWN_APP_TOPIC_SUFFIXES) | set(SAMPLE_CAPTURED_APP_TOPIC_SUFFIXES))
)

ALL_DISCOVERED_DEVICE_TOPIC_SUFFIXES: tuple[str, ...] = tuple(
    sorted(
        set(CODE_KNOWN_DEVICE_TOPIC_SUFFIXES)
        | set(SAMPLE_CAPTURED_DEVICE_TOPIC_SUFFIXES)
    )
)

CODE_ONLY_APP_TOPIC_SUFFIXES: tuple[str, ...] = tuple(
    sorted(set(CODE_KNOWN_APP_TOPIC_SUFFIXES) - set(SAMPLE_CAPTURED_APP_TOPIC_SUFFIXES))
)

CODE_ONLY_DEVICE_TOPIC_SUFFIXES: tuple[str, ...] = tuple(
    sorted(
        set(CODE_KNOWN_DEVICE_TOPIC_SUFFIXES)
        - set(SAMPLE_CAPTURED_DEVICE_TOPIC_SUFFIXES)
    )
)

SAMPLE_ONLY_APP_TOPIC_SUFFIXES: tuple[str, ...] = tuple(
    sorted(set(SAMPLE_CAPTURED_APP_TOPIC_SUFFIXES) - set(CODE_KNOWN_APP_TOPIC_SUFFIXES))
)

SAMPLE_ONLY_DEVICE_TOPIC_SUFFIXES: tuple[str, ...] = tuple(
    sorted(
        set(SAMPLE_CAPTURED_DEVICE_TOPIC_SUFFIXES)
        - set(CODE_KNOWN_DEVICE_TOPIC_SUFFIXES)
    )
)


def build_code_known_topics(serial_number: str) -> tuple[str, ...]:
    """Expand code-known topic suffixes into full topics for one serial."""
    return (
        build_subscription_topic(serial_number),
        *(build_app_topic(serial_number, suffix) for suffix in CODE_KNOWN_APP_TOPIC_SUFFIXES),
        *(
            build_device_topic(serial_number, suffix)
            for suffix in CODE_KNOWN_DEVICE_TOPIC_SUFFIXES
        ),
    )


def build_sample_captured_topics(serial_number: str) -> tuple[str, ...]:
    """Expand sample-captured topic suffixes into full topics for one serial."""
    return (
        *(build_app_topic(serial_number, suffix) for suffix in SAMPLE_CAPTURED_APP_TOPIC_SUFFIXES),
        *(
            build_device_topic(serial_number, suffix)
            for suffix in SAMPLE_CAPTURED_DEVICE_TOPIC_SUFFIXES
        ),
    )


def build_all_discovered_topics(serial_number: str) -> tuple[str, ...]:
    """Return the union of code-known and sample-captured topics for one serial."""
    return tuple(
        sorted(
            set(build_code_known_topics(serial_number))
            | set(build_sample_captured_topics(serial_number))
        )
    )
