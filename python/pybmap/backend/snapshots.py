"""Immutable values exposed by the backend instead of live Python objects."""

from collections import namedtuple
from enum import Enum, StrEnum


class ConnectionState(StrEnum):
    DISCONNECTED = "disconnected"
    DISCOVERING = "discovering"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    DISCONNECTING = "disconnecting"
    ERROR = "error"


class NoiseControlKind(StrEnum):
    CNC = "cnc"
    ANR = "anr"
    MODE = "mode"


DeviceIdentity = namedtuple(
    "DeviceIdentity",
    ["device_id", "name", "model", "product_id", "device_type", "address"],
)
BatteryStatus = namedtuple(
    "BatteryStatus",
    ["percent", "charging", "left_percent", "right_percent", "case_percent"],
)
FirmwareInfo = namedtuple("FirmwareInfo", ["version"])
ConnectionStatus = namedtuple("ConnectionStatus", ["state", "reason", "rfcomm_channel"])
Choice = namedtuple("Choice", ["value", "label"])
RangeCapability = namedtuple("RangeCapability", ["minimum", "maximum", "step"])
NoiseControlCapability = namedtuple(
    "NoiseControlCapability", ["kind", "range", "options"]
)
EqBandCapability = namedtuple(
    "EqBandCapability", ["id", "label", "minimum", "maximum", "step"]
)
SettingCapability = namedtuple(
    "SettingCapability",
    ["key", "label", "kind", "writable", "options", "minimum", "maximum", "step"],
)
ProfileCapability = namedtuple("ProfileCapability", ["maximum", "supports_delete"])
DeviceCapabilities = namedtuple(
    "DeviceCapabilities",
    ["noise_control", "equalizer", "settings", "profiles"],
)
DeviceValues = namedtuple(
    "DeviceValues", ["noise_control", "eq", "settings", "profile_id"]
)
DeviceSnapshot = namedtuple(
    "DeviceSnapshot",
    [
        "identity",
        "battery",
        "firmware",
        "connection",
        "capabilities",
        "values",
        "generation",
        "revision",
    ],
)
DiscoveredDevice = namedtuple(
    "DiscoveredDevice",
    [
        "device_id",
        "address",
        "name",
        "product_id",
        "device_type",
        "rfcomm_channel",
        "paired",
        "supported",
    ],
)
Profile = namedtuple(
    "Profile",
    [
        "profile_id",
        "name",
        "editable",
        "cnc_level",
        "auto_cnc",
        "spatial",
        "wind_block",
        "anc_toggle",
    ],
)


def to_wire(value):
    """Convert snapshot values to JSON-compatible primitives."""
    if isinstance(value, Enum):
        return value.value
    if hasattr(value, "_asdict"):
        return {key: to_wire(item) for key, item in value._asdict().items()}
    if isinstance(value, dict):
        return {key: to_wire(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [to_wire(item) for item in value]
    return value
