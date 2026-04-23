# TODO

Project backlog and near-term ideas for the Yarbo Home Assistant integration.

## Core features

- Notifications
  - Add user-facing Home Assistant notifications for important Yarbo events and state changes.
- Errors
  - Surface device and integration errors more clearly in entities, UI, and logs.
- Global settings outputs
  - Expose `read_global_params` data in a cleaner Home Assistant-friendly form.


## Mapping and visuals

- Add Ariel overview background with map warping to match the Yarbo plan mapping.

## Home Assistant integration depth

- HA stats monitoring
  - Expose useful HA entities/statistics such as:
    - power usage
    - mileage
- HA events, triggers, and alarm tie-ins
  - Add Home Assistant event support for Yarbo actions and state transitions.
  - Make Yarbo state usable in automations, triggers, and alarm flows.
