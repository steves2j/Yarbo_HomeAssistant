
## Topic Format

- App-to-device command topics are published to `snowbot/<sn>/app/<topic>`.
- Device-to-app topics are published to `snowbot/<sn>/device/<topic>`.
- The bridge subscribes to the app side with a wildcard equivalent to `snowbot/<sn>/app/#`.
- `<sn>` is the robot serial number loaded at runtime.

## Immediate Reply Envelope

Many request topics reply immediately on `snowbot/<sn>/device/data_feedback` with this JSON:
```json
{"topic":"<original app topic>","state":0,"msg":"Human-readable status","data":{}}
```
- `state = 0` means success.
- `state = -1` means failure.
- `data` is either `""`, a JSON object, a JSON array, or a scalar serialized as JSON.

## Device Topics

| MQTT topic | Status | Expected payload | Evidence |
| --- | --- | --- | --- |
| `snowbot/<sn>/device/DeviceMSG` | confirmed | Large device snapshot; see abbreviated schema below. | `DeviceMsg.h` serializer and `GetDeviceMSGFunction` |
| `snowbot/<sn>/device/data_feedback` | confirmed | `{"topic":...,"state":0|-1,"msg":"...","data":...}` | `SubFunctions.h:data_feedback_pub_fun` |
| `snowbot/<sn>/device/log` | confirmed | `{"msg":"...","level":"Info|Debug|Warn|Error","sender":"<node>","timestamp":<float>}` | `log_controller.h` + `LogMsg.msg` |
| `snowbot/<sn>/device/plan_feedback` | confirmed | JSON string payload. Downstream code expects keys: `state`, `plan_id`, `area_ids`, `finish_ids`, `clean_area_id`, `start_time`, `duration`, `finish_clean_area`, `total_clean_area`, `left_time`, `total_time`. | `PubSub.h` + `data_report_node/msg_converter.py` |
| `snowbot/<sn>/device/recharge_feedback` | confirmed | String/JSON payload from recharge flow; exact schema not recoverable from installed `mqtt_bridge` headers. | `PubSub.h` |
| `snowbot/<sn>/device/cloud_points_feedback` | confirmed | String/JSON payload from cloud-point processing; exact schema not recoverable from installed `mqtt_bridge` headers. | `PubSub.h` |
| `snowbot/<sn>/device/patrol_feedback` | confirmed | JSON string; at minimum consumers expect `{"is_out_elec_fence": 0|1}`. | `PubSub.h` + `data_aggreator_async.py` |
| `snowbot/<sn>/device/begin_update` | confirmed | String payload used to trigger begin-update notifications. | `local_abstract.h` |
| `snowbot/<sn>/device/shutdown_signal` | confirmed | Empty/string-like shutdown notification topic. | `local_abstract.h` |

### `device/DeviceMSG` abbreviated schema

```json
{
  "timestamp": 1710000000.0,
  "EletricMSG": {...},
  "BatteryMSG": {...},
  "WheelSpeedMSG": {...},
  "RunningStatusMSG": {...},
  "RTKMSG": {...},
  "CombinedOdom": {"x":0.0,"y":0.0,"z":0.0},
  "StateMSG": {...},
  "NetMSG": {...},
  "BodyVersionMsg": {...},
  "HeadAndVersionCheck": {...},
  "HeadMsg": {...},
  "HeadSerialMsg": {...},
  "BodyMsg": {...},
  "DebugMsg": {...},
  "RadarMsg": {...},
  "HubInfoMSG": {...},
  "LedInfoMSG": {...},
  "version": "...",
  "ble_version": "...",
  "SoftwareUpdate": {...},
  "base_name": "...",
  "abnormal_msg": {...},
  "wireless_recharge": {...},
  "motor_info": {...},
  "mower_head_info01": {...},
  "mower_head_info02": {...},
  "mower_head_info03": {...},
  "mower_head_info04": {...},
  "hardware_version": {...},
  "ultrasonic_msg": {...},
  "net_type": 0,
  "net_module_status": {...},
  "halow_status": {...},
  "ntrip_server_type": "...",
  "min_app_version": "...",
  "camera_state": {...},
  "route_priority": {...},
  "rtk_base_data": {...},
  "rtcm_age": 0.0,
  "rtcm_info": {...},
  "rtcm_client_state": {...},
  "rtcm_stats_queue": {...},
  "base_status": 0,
  "car_info": {...},
  "green_grass_update_switch": 0,
  "ipcamera_ota_switch": 0,
  "system_info": {...},
  "modebase_info": {...},
  "chassis_version_msg": {...}
}
```

## App Topics

Each row below refers to the MQTT topic `snowbot/<sn>/app/<topic>`.

| App topic | Example JSON to send | Immediate response | Later response / state | Handler |
| --- | --- | --- | --- | --- |
| `able_to_charge`                    | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `AbleToChargeFunction` |
| `app_mode_base`                     | `{"lat_lon_hight": [36.0, -120.0, 10.0], "timestamp": "2026-04-24T12:00:00Z"}` | snowbot/<sn>/device/data_feedback | - | `AppModeBaseFunction` |
| `bag_record`                        | `{"data": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `AppBagFunction` |
| `batch_self_check`                  | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BatchSelfCheckFunction` |
| `blower_speed`                      | `{"vel": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BlowerSpeedFunction` |
| `body_current`                      | `{"left_wheel_current_samp": "<value>", "right_wheel_current_samp": "<value>", "rod_current": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BodyCurrentFunction` |
| `body_current_threshold`            | `{"motor_left_wheel_current_threshold": "<value>", "motor_right_wheel_current_threshold": "<value>", "rod_current_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BodyCurrentThresholdFunction` |
| `body_mcu_restart`                  | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BodyMcuRestartFunction` |
| `body_second_threshold`             | `{"push_rod_second_threshold": "<value>", "left_run_motor_second_threshold": "<value>", "right_run_motor_second_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BodySecondThresholdFunction` |
| `body_status_threshold`             | `{"push_rod_stop_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BodyStatusThresholdFunction` |
| `body_voltage_one`                  | `{"voltage5": "<value>", "voltage12": "<value>", "voltage24": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BodyVoltageOneFunction` |
| `body_voltage_threshold_one`        | `{"voltage5_threshold": "<value>", "voltage12_threshold": "<value>", "voltage24_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `BodyVoltageThresholdOneFunction` |
| `camera_video_save_switch`          | `{"state": 1}` | snowbot/<sn>/device/data_feedback | - | `CameraVideoSaveSwitchFunction` |
| `change_to_wifi`                    | `{"ssid": "example", "password": "example"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ChangeToWifiFunction` |
| `check_map_connectivity`            | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `CheckMapConnectivityFunction` |
| `chute_streeing_engine_cmd`         | `{"angle": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ChuteStreeingEngineCmdFunction` |
| `clean_push_rod_error_sign_cmd`     | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `CleanErrorSignCmdFunction` |
| `clear_cloud_points`                | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ClearCloudPointsFunction` |
| `clear_stuck`                       | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ClearStuckFunction` |
| `cmd_charging_point`                | `{"cmd": 1}` | snowbot/<sn>/device/data_feedback | snowbot/<sn>/device/recharge_feedback (async updates) | `CmdChargingPointFunction` |
| `cmd_chute`                         | `{"vel": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ChuteFunction` |
| `cmd_chute_streeing_work`           | `{"direction": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ChuteStreeingWorkCmdFunction` |
| `cmd_motor_protect`                 | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `MotorProtectFunction` |
| `cmd_recharge`                      | `{"cmd": 1}` | None | snowbot/<sn>/device/recharge_feedback (async updates) | `CmdRechargeFunction` |
| `cmd_recharge_verification`         | `{"cmd": 1}` | None | snowbot/<sn>/device/recharge_feedback (async updates) | `CmdRechargeVerificationFunction` |
| `cmd_roller`                        | `{"vel": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `setRollerFunction` |
| `cmd_save_para`                     | `{"ctrl_cmd": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SaveParaFunction` |
| `cmd_set_chute_angle`               | `{"cmd": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SetChuteFunction` |
| `cmd_vel`                           | `{"vel": 1, "rev": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SetVelFunction` |
| `conti_return_self_check`           | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ContiReturnSelfCheckFunction` |
| `control_direct`                    | `{"bucket_direct": "<value>", "pitch_motor": "<value>", "push_rod": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ControlDirectFunction` |
| `correct_map`                       | `{"data": {"...": "map correction payload"}}` | snowbot/<sn>/device/data_feedback | - | `CorrectMapFunction` |
| `ctrl_net_module_4G`                | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `Ctrl4GFunction` |
| `debug_blower_error`                | `{"data": 1}` | snowbot/<sn>/device/data_feedback | - | `DEBUG_BLOWER_ERRORFunction` |
| `default_setting_float_pid`         | `{"wheel_pid_p": 0.1, "wheel_pid_i": 0.1, "wheel_pid_d": 0.1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `DefaultSettingFloatPidFunction` |
| `del_all_area_params`               | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllAreaParamsFunction` |
| `del_all_blower_area_params`        | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllBlowerAreaParamsFunction` |
| `del_all_blower_pathway_params`     | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllBlowerPathwayParamsFunction` |
| `del_all_charging_point`            | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllChargingPointFunction` |
| `del_all_clean_area`                | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllCleanAreaFunction` |
| `del_all_deadend`                   | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllDeadendFunction` |
| `del_all_deadend_params`            | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllDeadendParamsFunction` |
| `del_all_elec_fence`                | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllElecFenceFunction` |
| `del_all_file`                      | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllFileFunction` |
| `del_all_map_backup`                | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllMapBackupFunction` |
| `del_all_mower_area_params`         | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllMowerAreaParamsFunction` |
| `del_all_mower_pathway_params`      | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllMowerPathwayParamsFunction` |
| `del_all_nogozone`                  | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllNoGoZoneFunction` |
| `del_all_novisionzone`              | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllNoVisionZoneFunction` |
| `del_all_pathway`                   | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllPathwayFunction` |
| `del_all_pathway_params`            | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllPathwayParamsFunction` |
| `del_all_plan`                      | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllPlanFunction` |
| `del_all_plan_history`              | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllPlanHistoryFunction` |
| `del_all_ps_area_params`            | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllPSAreaParamsFunction` |
| `del_all_sidewalk`                  | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllSidewalkFunction` |
| `del_all_sidewalk_params`           | `{}` | snowbot/<sn>/device/data_feedback | - | `DelAllSidewalkParamsFunction` |
| `del_area_params`                   | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelAreaParamsFunction` |
| `del_blower_area_params`            | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelBlowerAreaParamsFunction` |
| `del_blower_pathway_params`         | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelBlowerPathwayParamsFunction` |
| `del_charging_point`                | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelChargingPointFunction` |
| `del_clean_area`                    | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelCleanAreaFunction` |
| `del_deadend`                       | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelDeadendFunction` |
| `del_deadend_params`                | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelDeadendParamsFunction` |
| `del_elec_fence`                    | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelElecFenceFunction` |
| `del_global_params`                 | `{}` | snowbot/<sn>/device/data_feedback | - | `DelGlobalParamsFunction` |
| `del_list_area_params`              | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListAreaParamsFunction` |
| `del_list_clean_area`               | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListCleanAreaFunction` |
| `del_list_deadend_params`           | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListDeadendParamsFunction` |
| `del_list_mower_area_params`        | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListMowerAreaParamsFunction` |
| `del_list_mower_pathway_params`     | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListMowerPathwayParamsFunction` |
| `del_list_nogozone`                 | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListNoGoZoneFunction` |
| `del_list_novisionzone`             | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListNoVisionZoneFunction` |
| `del_list_pathway_params`           | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListPathwayParamsFunction` |
| `del_list_plan`                     | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListPlanFunction` |
| `del_list_ps_area_params`           | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListPSAreaParamsFunction` |
| `del_list_sidewalk_params`          | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelListSidewalkParamsFunction` |
| `del_map_backup`                    | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `DelMapBackupFunction` |
| `del_mower_area_params`             | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelMowerAreaParamsFunction` |
| `del_mower_pathway_params`          | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelMowerPathwayParamsFunction` |
| `del_nogozone`                      | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelNoGoZoneFunction` |
| `del_novisionzone`                  | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelNoVisionZoneFunction` |
| `del_pathway`                       | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelPathwayFunction` |
| `del_pathway_params`                | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelPathwayParamsFunction` |
| `del_plan`                          | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelPlanFunction` |
| `del_plan_history`                  | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelPlanHistoryFunction` |
| `del_ps_area_params`                | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelPSAreaParamsFunction` |
| `del_schedule`                      | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DeleteScheduleFunction` |
| `del_sidewalk`                      | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelSidewalkFunction` |
| `del_sidewalk_params`               | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `DelSidewalkParamsFunction` |
| `elec_navigation_ctrl`              | `{"elec_navigation_ctrl": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `elecNavigationCtrlFunction` |
| `enable_schedule`                   | `{"id": 1, "enable": 1}` | snowbot/<sn>/device/data_feedback | - | `EnableScheduleFunction` |
| `erase_map`                         | `{}` | snowbot/<sn>/device/data_feedback | - | `EraseMapFunction` |
| `fault_RGBlight_para`               | `{"fault_rgblight_para": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `faultRGBlightParaFunction` |
| `forget_wifi`                       | `{"ssid": "example"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ForgetWifiFunction` |
| `get_all_map_backup`                | `{}` | snowbot/<sn>/device/data_feedback | - | `GetAllMapBackupFunction` |
| `get_connect_wifi_name`             | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `GetConnectWifiNameFunction` |
| `get_controller`                    | `{}` | snowbot/<sn>/device/data_feedback | - | `GetControllerFunction` |
| `get_data_para`                     | `{"speed_msg": "<value>", "odometer_msg": "<value>", "running_state_msg": "<value>", "elec_navigation_msg": "<value>", "body_current_msg": "<value>", "head_current_msg": "<value>", "battery_status_msg": "<value>", "battery_cell_temp_msg": "<value>", "body_msg": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `GetDataParaFunction` |
| `get_device_msg`                    | `{}` | snowbot/<sn>/device/data_feedback | - | `GetDeviceMSGFunction` |
| `get_edge_path`                     | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `GetEdgePathFunction` |
| `get_grid_map`                      | `{}` | snowbot/<sn>/device/data_feedback | - | `GetGridMapFunction` |
| `get_grid_map_mirror`               | `{"polygons": "<value>"}` | snowbot/<sn>/device/data_feedback | - | `GetGridMapMirrorFunction` |
| `get_map`                           | `{"width": 256, "height": 256}` | snowbot/<sn>/device/data_feedback | - | `GetMapFunction` |
| `get_plan_feedback`                 | `{}` | None | snowbot/<sn>/device/plan_feedback | `GetPlanFeedbackFunction` |
| `get_plan_path`                     | `{"id": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `GetPlanPathFunction` |
| `get_recharge_path`                 | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `GetRechargePathFunction` |
| `get_saved_wifi_list`               | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `GetSavedWifiListFunction` |
| `get_state_msg`                     | `{}` | snowbot/<sn>/device/data_feedback | - | `GetStateMSGFunction` |
| `get_wifi_list`                     | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `GetWifiListFunction` |
| `head_elec_current`                 | `{"motor_current": "<value>", "bucket_current": "<value>", "pitch_angle_current": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeadElecCurrentFunction` |
| `head_elec_threshold`               | `{"motor_current_threshold": "<value>", "bucket_current_threshold": "<value>", "pitch_angle_current_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeadElecThresholdFunction` |
| `head_elec_voltage`                 | `{"power_voltage25": "<value>", "power_voltage25vb": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeadElecVoltageFunction` |
| `head_impact_ctrl`                  | `{"head_impact_ctrl": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `headImpactCtrlFunction` |
| `head_mcu_restart`                  | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeadMcuRestartFunction` |
| `head_para`                         | `{"trigger_time": "<value>", "release_time": "<value>", "head_knock_default": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeadParaFunction` |
| `head_second_threshold`             | `{"chute_pipe_second_threshold": "<value>", "pitch_motor_second_threshold": "<value>", "roll_motor_second_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeadSecondThresholdFunction` |
| `head_voltage_threshold`            | `{"power_voltage25_threshold": "<value>", "power_voltage25b_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeadVoltageThresholdFunction` |
| `heating_film_ctrl`                 | `{"type": 1, "power": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HeatingFilmCtrlFunction` |
| `hub_info`                          | `{"...": "hub info payload"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HubInfoFunction` |
| `hump_check`                        | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `HumpCheckFunction` |
| `ignore_obstacles`                  | `{}` | snowbot/<sn>/device/data_feedback | - | `SetGrassNotObstacleFunction` |
| `interactive_self_check`            | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `InteractiveSelfCheckFunction` |
| `laser_toggle`                      | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `LaserToggleFunction` |
| `light_board_para`                  | `{"roof_lights_enable": "<value>", "head_light": "<value>", "left_fill_light": "<value>", "right_fill_light": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `LightBoardParaFunction` |
| `light_ctrl`                        | `{"enable": 1, "vol": 50, "mode": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `lightCtrlFunction` |
| `manual_calibration_ctrl`           | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ManualCalibrationCtrlFunction` |
| `map_recovery`                      | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `MapRecoveryFunction` |
| `mode_base`                         | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ModeBaseFunction` |
| `module_lock_ctl`                   | `{"wire_charging_lock": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ModuleLockCtlFunction` |
| `motor_commutation_delay_para`      | `{"wheel_delay": "<value>", "rod_delay": "<value>", "steer_delay": "<value>", "bucket_commutation_delay": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `MotorCommutationDelayParaFunction` |
| `mower_head_sensor_switch`          | `{"state": 1}` | snowbot/<sn>/device/data_feedback | - | `MowerSensorSwitchFunction` |
| `mower_sensor_cmd`                  | `{"type": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `MowerSensorResetFunction` |
| `mower_speed_cmd`                   | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `MowerSpeedCmdFunction` |
| `mower_target_cmd`                  | `{"target": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `MowerTargetFunction` |
| `pair_base`                         | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `PairBaseFunction` |
| `pair_halow`                        | `{"data": "pairing payload"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `PairHalowFunction` |
| `pause`                             | `{}` | None | snowbot/<sn>/device/plan_feedback (async updates) | `PauseFunctiont` |
| `pause_schedule`                    | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `PauseScheduleFunction` |
| `plan_speed`                        | `{"vel": 1}` | snowbot/<sn>/device/data_feedback | - | `SetPlanSpeedFunction` |
| `preview_plan_path`                 | `{"id": 1, "percent": 1}` | snowbot/<sn>/device/data_feedback | - | `PreviewPlanPathFunction` |
| `preview_snowbot_area_path`         | `{}` | snowbot/<sn>/device/data_feedback | - | `PreviewAreaPathFunction` |
| `product_para_set_one`              | `{"product_year": "<value>", "product_week": "<value>", "product_code_type": "<value>", "material_batch": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ProductParaSetOneFunction` |
| `product_para_set_two`              | `{"rand_key": "<value>", "product_code_msg": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ProductParaSetTwoFunction` |
| `push_rod_cmd`                      | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `PushRodCmdFunction` |
| `push_rod_target`                   | `{"push_rod_target": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `PushRodTargetFunction` |
| `range_threshold`                   | `{"bucket_max_teeth": "<value>", "steer_max_range": "<value>", "rod_max_range": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `RangeThresholdFunction` |
| `read_all_area_params`              | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllAreaParamsFunction` |
| `read_all_blower_area_params`       | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllBlowerAreaParamsFunction` |
| `read_all_blower_pathway_params`    | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllBlowerPathwayParamsFunction` |
| `read_all_charging_point`           | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllChargingPointFunction` |
| `read_all_clean_area`               | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllCleanAreaFunction` |
| `read_all_deadend`                  | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllDeadendFunction` |
| `read_all_deadend_params`           | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllDeadendParamsFunction` |
| `read_all_elec_fence`               | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllElecFenceFunction` |
| `read_all_mower_area_params`        | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllMowerAreaParamsFunction` |
| `read_all_mower_pathway_params`     | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllMowerPathwayParamsFunction` |
| `read_all_nogozone`                 | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllNoGoZoneFunction` |
| `read_all_novisionzone`             | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllNoVisionZoneFunction` |
| `read_all_pathway`                  | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllPathwayFunction` |
| `read_all_pathway_params`           | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllPathwayParamsFunction` |
| `read_all_plan`                     | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllPlanFunction` |
| `read_all_plan_history`             | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllPlanHistoryFunction` |
| `read_all_ps_area_params`           | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllPSAreaParamsFunction` |
| `read_all_sidewalk`                 | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllSidewalkFunction` |
| `read_all_sidewalk_params`          | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllSidewalkParamsFunction` |
| `read_area_params`                  | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadAreaParamsFunction` |
| `read_blower_area_params`           | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadBlowerAreaParamsFunction` |
| `read_blower_pathway_params`        | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadBlowerPathwayParamsFunction` |
| `read_charging_point`               | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadChargingPointFunction` |
| `read_clean_area`                   | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadCleanAreaFunction` |
| `read_deadend`                      | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadDeadendFunction` |
| `read_deadend_params`               | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadDeadendParamsFunction` |
| `read_elec_fence`                   | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadElecFenceFunction` |
| `read_global_params`                | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadGlobalParamsFunction` |
| `read_gps_ref`                      | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadGpsRefFunction` |
| `read_mower_area_params`            | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadMowerAreaParamsFunction` |
| `read_mower_pathway_params`         | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadMowerPathwayParamsFunction` |
| `read_nogozone`                     | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadNoGoZoneFunction` |
| `read_novisionzone`                 | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadNoVisionZoneFunction` |
| `read_pathway`                      | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadPathwayFunction` |
| `read_pathway_params`               | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadPathwayParamsFunction` |
| `read_plan`                         | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadPlanFunction` |
| `read_ps_area_params`               | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadPSAreaParamsFunction` |
| `read_recharge_point`               | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadRechargePointFunction` |
| `read_schedules`                    | `{}` | snowbot/<sn>/device/data_feedback | - | `ReadAllScheduleFunction` |
| `read_sidewalk`                     | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadSidewalkFunction` |
| `read_sidewalk_params`              | `{"id": 1}` | snowbot/<sn>/device/data_feedback | - | `ReadSidewalkParamsFunction` |
| `record_rtk_msg`                    | `{"action": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `RecordRtkMsgFunction` |
| `reduction_factor`                  | `{"push_rod_hall": "<value>", "snow_bucket": "<value>", "pitch_motor": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ReductionFactorFunction` |
| `restart_container`                 | `{}` | snowbot/<sn>/device/data_feedback | - | `RestartContainerFunction` |
| `resume`                            | `{}` | None | snowbot/<sn>/device/plan_feedback (async updates) | `ResumeFunction` |
| `resume_schedule`                   | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `ResumeScheduleFunction` |
| `roll_motor_speed_threshold`        | `{"motor_max_pwm": "<value>", "motor_min_pwm": "<value>", "lifting_pwm": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `RollMotorSpeedThresholdFunction` |
| `save_area_params`                  | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveAreaParamsFunction` |
| `save_blower_area_params`           | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveBlowerAreaParamsFunction` |
| `save_blower_pathway_params`        | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveBlowerPathwayParamsFunction` |
| `save_charging_point`               | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveChargingPointFunction` |
| `save_clean_area`                   | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveCleanAreaFunction` |
| `save_deadend`                      | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveDeadendFunction` |
| `save_deadend_params`               | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveDeadendParamsFunction` |
| `save_elec_fence`                   | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveElecFenceFunction` |
| `save_global_params`                | `{"plan_roller_stop": "<value>"}` | snowbot/<sn>/device/data_feedback | - | `SaveGlobalParamsFunction` |
| `save_map_backup`                   | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveMapBackupFunction` |
| `save_mower_area_params`            | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveMowerAreaParamsFunction` |
| `save_mower_pathway_params`         | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveMowerPathwayParamsFunction` |
| `save_nogozone`                     | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveNoGoZoneFunction` |
| `save_novisionzone`                 | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveNoVisionZoneFunction` |
| `save_pathway`                      | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SavePathwayFunction` |
| `save_pathway_params`               | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SavePathwayParamsFunction` |
| `save_plan`                         | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SavePlanFunction` |
| `save_ps_area_params`               | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SavePSAreaParamsFunction` |
| `save_schedule`                     | `{"id": 1, "...": "schedule model fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveScheduleFunction` |
| `save_sidewalk`                     | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveSidewalkFunction` |
| `save_sidewalk_params`              | `{"id": 1, "name": "example", "...": "model-specific fields"}` | snowbot/<sn>/device/data_feedback | - | `SaveSidewalkParamsFunction` |
| `set_base_name`                     | `{"data": "Base Name"}` | snowbot/<sn>/device/data_feedback | - | `SetBaseNameIotFunction` |
| `set_combined_odom_path_state`      | `{"state": 1, "type": 1, "pre_path": [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 1.0}]}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SetCombinedOdomPathStateFunction` |
| `set_cut_mode`                      | `{}` | snowbot/<sn>/device/data_feedback | - | `SetCutModeFunction` |
| `set_dc_info`                       | `{"data": "string payload"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SetDCInfoFunction` |
| `set_debug_msg`                     | `{"debug": true}` | snowbot/<sn>/device/data_feedback | - | `SetDebugMSGFunction` |
| `set_greengrass_auto_update_switch` | `{"allow_update": 1}` | snowbot/<sn>/device/data_feedback | - | `SetGreenGrassUpdateSwitchFunction` |
| `set_ipcamera_ota_switch`           | `{"allow_update": 1}` | snowbot/<sn>/device/data_feedback | - | `SetIpcameraOtaSwitchFunction` |
| `set_led_param`                     | `{"en_state_led": 1, "en_warn_led": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SetLedParamFunction` |
| `set_manul_camera_check`            | `{"state": 1}` | snowbot/<sn>/device/data_feedback | - | `SetManulCameraCheckFunction` |
| `set_map_obstacle_switch`           | `{}` | snowbot/<sn>/device/data_feedback | - | `SetMapObstacleDetectFunction` |
| `set_person_detect`                 | `{"state": 1}` | snowbot/<sn>/device/data_feedback | - | `SetPersonDetectFunction` |
| `set_plan_roller`                   | `{"state": 1}` | snowbot/<sn>/device/data_feedback | - | `SetPlanRollerFunction` |
| `set_rtcm_mode`                     | `{"cmd": 1, "address": "<value>"}` | snowbot/<sn>/device/data_feedback | - | `SetRtcmModeFunction` |
| `set_sam_follow_me_switch`          | `{"start_follow_me": 1}` | snowbot/<sn>/device/data_feedback | - | `SetSamFollowMeSwitchFunction` |
| `set_sound_param`                   | `{"enable": 1, "vol": 50, "mode": 1}` | snowbot/<sn>/device/data_feedback | - | `SetSoundParamFunction` |
| `set_start_point`                   | `{"cmd": 1}` | None | snowbot/<sn>/device/recharge_feedback (async updates) | `SetStartPointFunction` |
| `set_visual_state`                  | `{"state": 1}` | snowbot/<sn>/device/data_feedback | - | `SetVisionCtrlFunction` |
| `set_working_state`                 | `{"state": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SetWorkingStateFunction` |
| `shell_cmd`                         | `{"data": "string payload"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). Related to wifi module only. | `ShellCmdFunction` |
| `shutdown`                          | `{}` | snowbot/<sn>/device/data_feedback | - | `ShutdownRobotFunction` |
| `software_update`                   | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SoftwareUpdateFunction` |
| `song_cmd`                          | `{"song_name": "example_song"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SongCmdFunction` |
| `sort_plan`                         | `{"ids": [1, 2, 3]}` | snowbot/<sn>/device/data_feedback | - | `SortPlanFunction` |
| `speed_para`                        | `{"wheel_r": "<value>", "wheel_v": "<value>", "wheel_pid": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `SpeedParaFunction` |
| `start_action`                      | `{"type": 1, "data": {"...": "action payload"}}` | None | snowbot/<sn>/device/plan_feedback (async updates) | `StartActionFunction` |
| `start_draw_cmd`                    | `{}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `StartDrawCmdFunction` |
| `start_plan`                        | `{"id": 1, "percent": 1}` | None | snowbot/<sn>/device/plan_feedback (async updates) | `StartPlanPlanFunction` |
| `start_rect`                        | `{"width": "<value>", "height": "<value>"}` | snowbot/<sn>/device/data_feedback | - | `StartRectFunction` |
| `stop`                              | `{}` | None | snowbot/<sn>/device/plan_feedback (async updates) | `StopFunction` |
| `temp_threshold`                    | `{"motor_temp_threshold": "<value>", "body_fram_temp_threshold": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `TemperaturThresholdFunction` |
| `temperatur_sampling`               | `{"motor_temp_samp": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `TemperaturSamplingFunction` |
| `top_route`                         | `{"data": "string payload"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `TopRouteFunction` |
| `wc_set_param`                      | `{"wheel_dis": "<value>", "rtk_dis": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `WheelCaliSetParamFunction` |
| `wc_start`                          | `{"distance": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `WheelCaliStartFunction` |
| `wheel_angular_speed_threshold`     | `{"motor_max_angular_v": "<value>", "motor_min_angular_v": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `WheelAngularSpeedThresholdFunction` |
| `wheel_linear_speed_threshold`      | `{"max_linear_v": "<value>", "min_linear_v": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `WheelLinearSpeedThresholdFunction` |
| `wheel_para`                        | `{"left_motor_direct": "<value>", "right_motor_direct": "<value>", "left_encoder_direct": "<value>", "right_encoder_direct": "<value>"}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `WheelParaFunction` |
| `wireless_charging_cmd`             | `{"cmd": 1}` | None | Usually no immediate MQTT ack; state is reflected later in device telemetry (most often device/DeviceMSG). | `WirelessChargingCmdFunction` |

## Notes and Inference Rules

- The request examples above are direct when they come from explicit `j.at(...)`, `j.contains(...)`, `j.value(...)`, or equivalent reads from the handler body in `SubFunctions.h`.
- For `save_*` topics, many handlers deserialize the entire incoming JSON into a model class. When the exact model fields are not visible in the handler body, the example payload above is intentionally generic.
- For `read_*` / `del_*` topics, `{"id": <int>}` is the dominant pattern.
- For `del_list_*` and `sort_plan`, `{"ids": [ ... ]}` is the dominant pattern.
- For `read_all_*`, `del_all_*`, and many `get_*` helper topics, `{}` is sufficient unless the handler explicitly checks additional keys.
- Motion/control topics such as `cmd_vel`, `cmd_roller`, `cmd_chute`, `stop`, `pause`, and `resume` usually do not emit an immediate MQTT acknowledgement from the bridge; you observe the effect later through `device/DeviceMSG`, `device/plan_feedback`, or another device stream.
- `plan_feedback`, `recharge_feedback`, and `cloud_points_feedback` are asynchronous device topics. The request topic only triggers the downstream action; the actual result arrives later.
- A few device-topic constants exist in `snowbot_topic_lib/appTopic.h` but are not directly referenced by the installed `mqtt_bridge` headers inspected here. They were not promoted to the confirmed device-topic table above to avoid overstating bridge behavior.
