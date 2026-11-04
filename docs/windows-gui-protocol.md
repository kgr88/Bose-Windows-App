# Windows GUI protocol v3

This document is the Stage 1 contract shared by the Python sidecar, Tauri host,
and React renderer. The small language-specific definitions are intentionally
maintained by hand in:

- `python/pybmap/backend/protocol.py` and `snapshots.py`
- `desktop/src-tauri/src/contracts.rs`
- `desktop/src/contracts.ts`

Changing a field, operation, event, or error code requires updating all three
definitions and their focused tests. Additive changes remain protocol v3;
incompatible changes require a new version and handshake support.

## Framing and envelopes

The sidecar reads and writes newline-delimited UTF-8 JSON on stdin/stdout. Each
line, including its newline, is at most 65,536 bytes. Diagnostics go to stderr;
stdout contains protocol messages only.

Every request has exactly these fields:

```json
{"v":3,"id":"42","method":"get_snapshot","params":{}}
```

`id` is an opaque non-empty string of at most 128 characters. A response has
exactly one of `result` or `error`:

```json
{"v":3,"id":"42","result":{"ok":true}}
{"v":3,"id":"42","error":{"code":"DEVICE_TIMEOUT","message":"The headset did not respond","retryable":true}}
```

Unsolicited events do not have an ID:

```json
{"v":3,"event":"connection_changed","data":{"state":"disconnected","generation":4,"revision":0,"reason":"device_lost"}}
```

The Tauri host emits sanitized events to the renderer as `bose://device-event`.

## Operations

| Sidecar method | Parameters | Result | Renderer command |
| --- | --- | --- | --- |
| `hello` | `{}` | `BackendInfo` | `get_backend_info` |
| `discover` | `{}` | `{devices: DiscoveredDevice[]}` | `discover_devices` |
| `connect` | `{target: ConnectionTarget}` | `DeviceSnapshot` | `connect_device` |
| `disconnect` | `{}` | `{ok: true}` | `disconnect_device` |
| `get_snapshot` | `{}` | `DeviceSnapshot` | `get_device_snapshot` |
| `poll_snapshot` | `{generation, fields}` | `DeviceSnapshot` | `poll_device_snapshot` |
| `set_noise_control` | `{generation, kind, value}` | `DeviceSnapshot` | `set_noise_control` |
| `set_eq` | `{generation, bass, mid, treble}` | `DeviceSnapshot` | `set_equalizer` |
| `set_setting` | `{generation, key, value}` | `DeviceSnapshot` | `set_device_setting` |
| `get_profiles` | `{generation}` | `ProfileList` | `get_profiles` |
| `set_profile` | `{generation, profile}` | `ProfileList` | `set_profile` |
| `delete_profile` | `{generation, profile_id}` | `ProfileList` | `delete_profile` |
| `enter_pairing` | `{generation}` | `DeviceSnapshot` | `enter_pairing` |
| `power_off` | `{generation}` | `DeviceSnapshot` | `power_off` |
| `shutdown` | `{}` | `{ok: true}` | host lifecycle only |

`ConnectionTarget` is either
`{"kind":"discovered","device_id":"opaque-id"}` or
`{"kind":"manual","address":"AA:BB:CC:DD:EE:FF","device_type":"qc35"}`.
The only initial manual device types are `qc35` and `qc_ultra2`.

`poll_snapshot.fields` is a non-empty unique subset of `battery` and
`noise_control`. It exists for visible-window status polling and must not become
a generic feature-read escape hatch.

All device-mutating operations and profile reads carry the last observed
connection `generation`. The backend rejects obsolete work with
`STALE_GENERATION`. Each successful connection increments `generation`; every
published change within that connection increments `revision`. Consumers order
snapshots by `(generation, revision)` and ignore older pairs.

## Snapshot and capabilities

`DeviceSnapshot` contains:

- nullable identity, battery, and firmware (battery carries nullable
  `left_percent`, `right_percent`, and `case_percent` for earbuds; for earbuds
  `percent` is the lower earbud level);
- connection state, nullable reason, and the validated RFCOMM channel;
- capability descriptions for noise control, EQ bands, settings, profiles, and
  pairing/power actions;
- current noise-control, EQ, setting, and profile values; and
- non-negative `generation` and `revision` integers.

Connected identity also carries the resolved `device_type`, allowing a recreated
WebView to retain a reconnect target without inferring behavior from product text.

Connection states are `disconnected`, `discovering`, `connecting`, `connected`,
`reconnecting`, `disconnecting`, and `error`.

Noise-control capability kind is `cnc`, `anr`, or `mode`. The renderer chooses a
range or option control from that reported kind and never from identity/model
text. EQ and settings are likewise rendered only from their capability arrays.

Setting keys in v3 are `sidetone`, `auto_pause`, `spatial_audio`, `wind_block`,
and `anc_toggle`. Their values are scalar booleans or strings and must also
satisfy the matching capability at runtime. Voice prompts, prompt language,
multipoint, auto-answer calls, button mapping, audio source, and Bluetooth audio
routing are deliberately absent and rejected at the protocol boundary.

## Events and stable errors

Events are `snapshot_changed`, `connection_changed`, and `backend_error`.

Stable v3 error codes are:

```text
INVALID_REQUEST REQUEST_TOO_LARGE UNSUPPORTED_PROTOCOL UNKNOWN_METHOD
INVALID_PARAMS BACKEND_UNAVAILABLE BACKEND_CRASHED BACKEND_TIMEOUT
BLUETOOTH_UNAVAILABLE BLUETOOTH_DISABLED DEVICE_NOT_FOUND DEVICE_NOT_PAIRED
SERVICE_NOT_FOUND ACCESS_DENIED CONNECTION_FAILED NOT_CONNECTED DEVICE_TIMEOUT
DEVICE_LOST UNSUPPORTED_DEVICE UNSUPPORTED_OPERATION STALE_GENERATION CONFLICT
SHUTTING_DOWN INTERNAL
```

Messages are safe for display but are not stable identifiers. `retryable` tells
the UI whether offering the same operation again is meaningful. Implementation
exception names, raw packets, and unredacted diagnostics never cross into the
renderer.
