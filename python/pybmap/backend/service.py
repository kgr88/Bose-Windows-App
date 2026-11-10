"""Serialized native device service used by the JSON-lines worker."""

import platform
from collections import OrderedDict

import pybmap
from pybmap import __version__
from pybmap.discovery import BluetoothDiscoveryError, discover_devices
from pybmap.errors import (
    BmapAuthError,
    BmapConnectionError,
    BmapError,
    BmapNotFoundError,
    BmapTimeoutError,
)

from .protocol import METHODS, PROTOCOL_VERSION, ProtocolError
from .snapshots import (
    BatteryStatus,
    Choice,
    ConnectionState,
    ConnectionStatus,
    DeviceCapabilities,
    DeviceIdentity,
    DeviceSnapshot,
    DeviceValues,
    DiscoveredDevice,
    EqBandCapability,
    FirmwareInfo,
    NoiseControlCapability,
    NoiseControlKind,
    Profile,
    ProfileCapability,
    RangeCapability,
    SettingCapability,
    to_wire,
)

SPATIAL_TO_WIRE = {0: "off", 1: "room", 2: "motion"}
SPATIAL_FROM_WIRE = {value: key for key, value in SPATIAL_TO_WIRE.items()}


class BackendService:
    """Own exactly one connection; all methods are called by one worker thread."""

    def __init__(self, connector=None, discoverer=None):
        self.connector = connector or pybmap.connect
        self.discoverer = discoverer or discover_devices
        self.connection = None
        self.stopping = False
        self.generation = 0
        self.revision = 0
        self._snapshot = self._empty_snapshot()
        self._discovered = {}
        self._events = []
        self._address = None
        self._device_type = None
        self._product_id = None

    def _empty_capabilities(self):
        return DeviceCapabilities(None, [], [], None)

    def _empty_snapshot(self, state=ConnectionState.DISCONNECTED, reason=None):
        return DeviceSnapshot(
            None,
            None,
            None,
            ConnectionStatus(state, reason, None),
            self._empty_capabilities(),
            DeviceValues(None, {}, {}, None),
            self.generation,
            self.revision,
        )

    def _bump(self, snapshot):
        self.revision += 1
        self._snapshot = snapshot._replace(
            generation=self.generation, revision=self.revision
        )
        self._events.append(("snapshot_changed", to_wire(self._snapshot)))
        return self._snapshot

    def _connection_state(self, state, reason=None):
        self._snapshot = self._empty_snapshot(state, reason)
        self.revision += 1
        self._snapshot = self._snapshot._replace(revision=self.revision)
        self._events.append(
            (
                "connection_changed",
                {
                    "state": state.value,
                    "generation": self.generation,
                    "revision": self.revision,
                    "reason": reason,
                },
            )
        )

    def drain_events(self):
        events, self._events = self._events, []
        return events

    def handle(self, method, params):
        if method not in METHODS:
            raise ProtocolError("UNKNOWN_METHOD", "unknown method")
        if self.stopping and method != "shutdown":
            raise ProtocolError("SHUTTING_DOWN", "backend is shutting down")
        try:
            handler = getattr(self, "_handle_%s" % method)
            return to_wire(handler(params))
        except ProtocolError:
            raise
        except Exception as exc:
            translated = self._translate_error(exc)
            if translated is not None:
                raise translated from exc
            raise

    def _handle_hello(self, params):
        return {
            "backend_version": __version__,
            "python_version": platform.python_version(),
            "protocol_version": PROTOCOL_VERSION,
            "operations": list(METHODS),
        }

    def _handle_discover(self, params):
        self._connection_state(ConnectionState.DISCOVERING)
        found = self.discoverer()
        self._discovered = {}
        devices = []
        for item in found:
            device_id = item.address.upper()
            record = DiscoveredDevice(
                device_id,
                item.address,
                item.name,
                item.product_id,
                item.device_type,
                item.rfcomm_channel,
                bool(item.paired),
                bool(item.device_type),
            )
            self._discovered[device_id] = item
            devices.append(record)
        if self.connection is None:
            self._connection_state(ConnectionState.DISCONNECTED)
        return {"devices": devices}

    def _handle_connect(self, params):
        if self.connection is not None:
            self._close_connection()
        target = params["target"]
        if target["kind"] == "discovered":
            discovered = self._discovered.get(target["device_id"])
            if discovered is None:
                raise ProtocolError(
                    "DEVICE_NOT_FOUND",
                    "Discovered device is no longer available",
                    retryable=True,
                )
            if not discovered.device_type:
                raise ProtocolError(
                    "UNSUPPORTED_DEVICE", "Choose a model manually for this device"
                )
            address, device_type = discovered.address, discovered.device_type
            product_id = discovered.product_id
        else:
            address, device_type = target["address"], target["device_type"]
            product_id = None
        self.generation += 1
        self.revision = 0
        self._connection_state(ConnectionState.CONNECTING)
        try:
            self.connection = self.connector(mac=address, device_type=device_type)
            self._address, self._device_type = address, device_type
            self._product_id = product_id
            return self._refresh_snapshot()
        except Exception:
            self._close_connection()
            self._connection_state(ConnectionState.ERROR, "connection_failed")
            raise

    def _handle_disconnect(self, params):
        self._connection_state(ConnectionState.DISCONNECTING)
        self._close_connection()
        self._connection_state(ConnectionState.DISCONNECTED)
        return {"ok": True}

    def _handle_get_snapshot(self, params):
        self._require_connection()
        return self._refresh_snapshot()

    def _handle_poll_snapshot(self, params):
        connection = self._require_generation(params["generation"])
        snapshot = self._snapshot
        battery = snapshot.battery
        values = snapshot.values
        try:
            if "battery" in params["fields"]:
                battery = _battery_status(connection)
            if "noise_control" in params["fields"]:
                capability = snapshot.capabilities.noise_control
                noise_value = values.noise_control
                if capability is not None and capability.kind == NoiseControlKind.CNC:
                    current, _ = connection.cnc()
                    noise_value = {"kind": "cnc", "value": current}
                elif capability is not None and capability.kind == NoiseControlKind.ANR:
                    noise_value = {"kind": "anr", "value": connection.anr()}
                profile_id = values.profile_id
                if snapshot.capabilities.profiles is not None:
                    profile_id = str(connection.mode_idx())
                values = values._replace(
                    noise_control=noise_value, profile_id=profile_id
                )
            return self._bump(snapshot._replace(battery=battery, values=values))
        except (BmapConnectionError, BmapTimeoutError):
            self._close_connection()
            self._connection_state(ConnectionState.ERROR, "device_lost")
            raise

    def _handle_set_noise_control(self, params):
        connection = self._require_generation(params["generation"])
        kind, value = params["kind"], params["value"]
        if kind == "cnc":
            connection.set_cnc(value)
        elif kind == "anr":
            connection.set_anr(value)
        else:
            connection.set_mode(value)
        return self._refresh_snapshot()

    def _handle_set_eq(self, params):
        connection = self._require_generation(params["generation"])
        connection.set_eq(params["bass"], params["mid"], params["treble"])
        return self._refresh_snapshot()

    def _handle_set_setting(self, params):
        connection = self._require_generation(params["generation"])
        key, value = params["key"], params["value"]
        setters = {
            "sidetone": connection.set_sidetone,
            "auto_pause": connection.set_auto_pause,
            "spatial_audio": lambda item: connection.set_spatial(
                "head" if item == "motion" else item
            ),
            "wind_block": connection.set_wind,
            "anc_toggle": connection.set_anc,
        }
        setter = setters.get(key)
        if setter is None:
            raise ProtocolError(
                "UNSUPPORTED_OPERATION", "Setting is read-only or unsupported"
            )
        setter(value)
        return self._refresh_snapshot()

    def _handle_get_profiles(self, params):
        self._require_generation(params["generation"])
        return self._profile_list()

    def _handle_set_profile(self, params):
        connection = self._require_generation(params["generation"])
        profile = params["profile"]
        current_profile_id = str(connection.mode_idx())
        saved_slot = connection.save_profile(
            profile.get("profile_id"),
            name=profile["name"],
            cnc_level=profile["cnc_level"],
            auto_cnc=profile["auto_cnc"],
            spatial=SPATIAL_FROM_WIRE[profile["spatial"]],
            wind_block=profile["wind_block"],
            anc_toggle=profile["anc_toggle"],
        )
        if str(saved_slot) == current_profile_id:
            connection.set_mode(profile["name"])
        return self._profile_list()

    def _handle_delete_profile(self, params):
        connection = self._require_generation(params["generation"])
        connection.delete_profile_by_id(params["profile_id"])
        return self._profile_list()

    def _handle_shutdown(self, params):
        self.stopping = True
        self._close_connection()
        return {"ok": True}

    def _require_connection(self):
        if self.connection is None:
            raise ProtocolError(
                "NOT_CONNECTED", "No headset is connected", retryable=True
            )
        return self.connection

    def _require_generation(self, generation):
        connection = self._require_connection()
        if generation != self.generation:
            raise ProtocolError(
                "STALE_GENERATION", "Request belongs to an older connection"
            )
        return connection

    def _close_connection(self):
        connection, self.connection = self.connection, None
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
        self._address = self._device_type = self._product_id = None

    def _read(self, feature, method, default=None):
        if not self.connection.has_feature(feature):
            return default
        return method()

    def _refresh_snapshot(self):
        connection = self._require_connection()
        try:
            battery = _battery_status(connection)
            name = self._read(
                "product_name", connection.name, connection.device_info["name"]
            )
            firmware = self._read("firmware", connection.firmware, "")
            capabilities, values = self._capabilities_and_values(connection)
            identity = DeviceIdentity(
                self._address.upper(),
                name or connection.device_info["name"],
                connection.device_info["name"],
                self._product_id or connection.device_info.get("product_id"),
                self._device_type,
                self._address,
            )
            snapshot = DeviceSnapshot(
                identity,
                battery,
                FirmwareInfo(firmware or ""),
                ConnectionStatus(
                    ConnectionState.CONNECTED,
                    None,
                    getattr(connection, "rfcomm_channel", None),
                ),
                capabilities,
                values,
                self.generation,
                self.revision,
            )
            return self._bump(snapshot)
        except (BmapConnectionError, BmapTimeoutError):
            self._close_connection()
            self._connection_state(ConnectionState.ERROR, "device_lost")
            raise

    def _capabilities_and_values(self, connection):
        settings_caps, settings = [], OrderedDict()
        if connection.has_feature("sidetone"):
            settings_caps.append(
                _choice_setting(
                    "sidetone", "Sidetone", ("off", "low", "medium", "high")
                )
            )
            settings["sidetone"] = connection.sidetone()
        for feature, key, label, reader_name in (
            ("auto_pause", "auto_pause", "Auto play/pause", "auto_pause"),
        ):
            if connection.has_feature(feature):
                settings_caps.append(_toggle_setting(key, label))
                settings[key] = getattr(connection, reader_name)()

        noise = None
        noise_value = None
        profile_id = None
        if connection.has_feature("cnc"):
            current, maximum = connection.cnc()
            noise = NoiseControlCapability(
                NoiseControlKind.CNC, RangeCapability(0, maximum, 1), []
            )
            noise_value = {"kind": "cnc", "value": current}
        elif connection.has_feature("anr"):
            options = [
                Choice(value, value.title()) for value in ("off", "low", "wind", "high")
            ]
            noise = NoiseControlCapability(NoiseControlKind.ANR, None, options)
            noise_value = {"kind": "anr", "value": connection.anr()}

        if connection.has_feature("audio_settings"):
            audio = connection.audio_settings()
            settings_caps.extend(
                [
                    _choice_setting(
                        "spatial_audio", "Spatial audio", ("off", "room", "motion")
                    ),
                    _toggle_setting("wind_block", "Wind block"),
                    _toggle_setting("anc_toggle", "Active noise cancellation"),
                ]
            )
            settings.update(
                {
                    "spatial_audio": SPATIAL_TO_WIRE.get(audio.spatial, "off"),
                    "wind_block": audio.wind_block,
                    "anc_toggle": audio.anc_toggle,
                }
            )
        eq_caps, eq_values = [], {}
        if connection.has_feature("eq"):
            for band in connection.eq():
                band_id = band.name.lower()
                eq_caps.append(
                    EqBandCapability(band_id, band.name, band.min_val, band.max_val, 1)
                )
                eq_values[band_id] = band.current
        profiles = None
        if connection.has_feature("get_all_modes"):
            profiles = ProfileCapability(len(connection.editable_profile_slots), True)
            profile_id = str(connection.mode_idx())
        return (
            DeviceCapabilities(noise, eq_caps, settings_caps, profiles),
            DeviceValues(noise_value, eq_values, settings, profile_id),
        )

    def _profile_list(self):
        profiles = []
        editable_slots = set(self.connection.editable_profile_slots)
        preset_names = {
            details["idx"]: name.replace("_", " ").title()
            for name, details in self.connection.preset_modes.items()
        }
        for mode in sorted(self.connection.profiles(), key=lambda item: item.mode_idx):
            editable = mode.mode_idx in editable_slots and mode.editable
            if editable and (
                not mode.configured
                or not mode.name.strip()
                or mode.name.strip().lower() == "none"
            ):
                continue
            name = preset_names.get(mode.mode_idx, mode.name)
            profiles.append(
                Profile(
                    str(mode.mode_idx),
                    name,
                    editable,
                    mode.cnc_level,
                    mode.auto_cnc,
                    SPATIAL_TO_WIRE.get(mode.spatial, "off"),
                    mode.wind_block,
                    mode.anc_toggle,
                )
            )
        self.revision += 1
        return {
            "generation": self.generation,
            "revision": self.revision,
            "profiles": profiles,
        }

    def _translate_error(self, exc):
        if isinstance(exc, BmapAuthError):
            return ProtocolError(
                "DEVICE_NOT_PAIRED",
                "The headset rejected BMAP authentication; remove and pair it again",
                retryable=True,
            )
        if isinstance(exc, BmapTimeoutError):
            return ProtocolError(
                "DEVICE_TIMEOUT", "The headset did not respond", retryable=True
            )
        if isinstance(exc, BmapNotFoundError):
            return ProtocolError(
                "DEVICE_NOT_FOUND",
                "No supported paired headset was found",
                retryable=True,
            )
        if isinstance(exc, BmapConnectionError):
            code = getattr(exc, "code", "CONNECTION_FAILED")
            messages = {
                "ACCESS_DENIED": "Bluetooth access was denied",
                "BLUETOOTH_UNAVAILABLE": "Bluetooth RFCOMM is unavailable",
                "BLUETOOTH_DISABLED": (
                    "Turn on the Windows Bluetooth radio and try again"
                ),
                "DEVICE_NOT_FOUND": "The paired headset is powered off or out of range",
                "SERVICE_NOT_FOUND": (
                    "The headset rejected every discovered BMAP RFCOMM channel"
                ),
                "DEVICE_LOST": "The headset connection was lost",
                "UNSUPPORTED_DEVICE": (
                    "The selected device cannot be validated as BMAP-compatible"
                ),
            }
            if code not in messages:
                code = "CONNECTION_FAILED"
            return ProtocolError(
                code,
                messages.get(code, "Could not connect to the headset"),
                retryable=code != "ACCESS_DENIED",
                details={"rfcomm_channel": exc.channel}
                if exc.channel is not None
                else None,
            )
        if isinstance(exc, BluetoothDiscoveryError):
            return ProtocolError(
                exc.code, str(exc), retryable=exc.code != "ACCESS_DENIED"
            )
        if isinstance(exc, ValueError):
            return ProtocolError("INVALID_PARAMS", str(exc))
        if isinstance(exc, BmapError):
            return ProtocolError("UNSUPPORTED_OPERATION", str(exc))
        return None


def _battery_status(connection):
    levels = connection.battery_levels()
    return BatteryStatus(
        max(0, min(100, int(levels.percent))),
        None,
        levels.left,
        levels.right,
        levels.case,
    )


def _choices(values):
    return [Choice(value, value.replace("_", " ").title()) for value in values]


def _toggle_setting(key, label):
    return SettingCapability(key, label, "toggle", True, [], None, None, None)


def _choice_setting(key, label, values):
    return SettingCapability(
        key, label, "choice", True, _choices(values), None, None, None
    )
