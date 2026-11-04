# pybmap

Python library for the Bose BMAP protocol over Bluetooth RFCOMM. It controls
noise cancellation, EQ, spatial audio, button mapping, profiles, and device
settings on paired Bose headphones. The Bose Windows App uses it as its
backend.

> **This is not an exploit.** The library uses the BMAP protocol's standard
> SETGET operator, which the headphones accept without authentication. No keys
> are extracted, no encryption is broken, no traffic is replayed.

## Install

From this directory:

```bash
python -m pip install -e .
python -m pip install -r requirements-dev.txt
```

The backend finds paired Bose devices by their BMAP service UUID. You do not
need to configure a MAC address, even for renamed headphones.

## Library

```python
import pybmap

with pybmap.connect() as dev:
    print(dev.battery())  # 80
    print(dev.name())  # "Obsidian Countess"
    dev.set_anr("high")  # QC35: full noise cancellation
    dev.set_cnc(8)  # QC Ultra 2: CNC level 0-10
    dev.set_eq(3, 0, -2)  # Bass +3, mid flat, treble -2
    dev.set_buttons(0x10, 4, 2)  # Remap Action button to ANC
```

## Device catalog

```python
import pybmap

# Look up any known Bose device by product ID
dev = pybmap.lookup_device(0x4082)
print(dev.name)  # "QuietComfort Ultra Headphones (2nd Gen)"
print(dev.codename)  # "wolverine"

# USB identification
pybmap.usb_ids(0x4082)  # (0x05A7, 0x4082)

# Check support status
pybmap.is_supported(0x4082)  # True — has tested config
pybmap.is_supported(0x4039)  # False — QC45, recognized but untested
pybmap.supported_devices()  # [wolfcastle, baywolf, edith, wolverine]
pybmap.known_devices()  # full catalog
```

### Supported devices

| Device | NC Control | EQ | Spatial | Profiles | Buttons | Status |
|--------|-----------|-----|---------|----------|---------|--------|
| **QC Ultra Headphones 2** | CNC 0-10 slider | 3-band | room/head | 7 custom slots | Shortcut remap | Verified |
| **QuietComfort 35 / 35 II** | ANR off/high/wind/low | — | — | — | Action remap (VPA/ANC) | Verified |

QuietComfort Ultra Earbuds (2nd Gen) (`edith`, `0x4062`) uses the QC Ultra
Headphones 2 config. It is supported but not tested.

### Known devices without a tested config

| Device | Codename | Category | PID |
|--------|----------|----------|-----|
| Noise Cancelling Headphones 700 | goodyear | Headphones | `0x4024` |
| QuietComfort 45 | duran | Headphones | `0x4039` |
| QuietComfort Headphones | prince | Headphones | `0x4075` |
| QuietComfort Ultra Headphones | lonestarr | Headphones | `0x4066` |
| QuietComfort Earbuds II | smalls | Earbuds | `0x4064` |
| QuietComfort Ultra Earbuds | scotty | Earbuds | `0x4072` |
| Ultra Open Earbuds | serena | Earbuds | `0x4068` |
| SoundLink Flex | phelps | Speaker | `0xBC59` |
| SoundLink Flex 2 | mathers | Speaker | `0xBC61` |

Adding a new device is a configuration entry. See
[Adding a New Device](../docs/architecture.md#adding-a-new-device).

## Architecture

```
Application → BmapConnection → Device Config → Transport → Protocol → Bluetooth RFCOMM
```

- **Protocol** — binary BMAP packet codec
- **Transport** — RFCOMM socket with drain mode for async responses
- **Device Config** — data-only description of each headphone model (addresses, parsers, quirks)
- **BmapConnection** — typed API that dispatches to the right address/parser per device
- **Catalog** — all known Bose BMAP devices with product IDs, codenames, and USB identifiers

Device differences (RFCOMM channel, init packets, feature availability) are
config data, not code branches. Full documentation:
[docs/architecture.md](../docs/architecture.md).

## How it works

Bose headphones speak **BMAP** (Bose Messaging and Protocol) over Bluetooth
RFCOMM. The protocol groups features into function blocks and uses operators
for read, write, and action.

Bose gates SET (operator 0) behind cloud-mediated ECDH authentication. But
**SETGET** (operator 2) and **START** (operator 5) are unauthenticated on the
Settings and AudioModes blocks. This gives control over every user-facing
setting.

The protocol was mapped in these steps:

1. Connect over RFCOMM and probe all channels. QC Ultra 2 firmware responds on
   channel 2. QC35 responds on channel 8.
2. Capture Bluetooth HCI traffic while toggling settings in the Bose app.
3. DNS-hijack the cloud API. Mode switching still works, because the app uses
   START, not SET.
4. Test every operator on every function block to map the auth boundary.

Full protocol reference: [docs/protocol-notes.md](../docs/protocol-notes.md).

## Backend sidecar

The desktop app runs this package as a long-lived sidecar process:

```bash
python -m pybmap.backend
```

The message format is in
[docs/windows-gui-protocol.md](../docs/windows-gui-protocol.md).

## Tests

```bash
python -m ruff check
python -m ruff format --check
python -m pytest
```

Tests marked `integration` need a paired Bluetooth device.
