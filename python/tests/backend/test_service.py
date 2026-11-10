from collections import namedtuple

import pytest

from pybmap.backend.protocol import ProtocolError
from pybmap.backend.service import BackendService
from pybmap.discovery import _device_from_name
from pybmap.errors import BmapConnectionError
from pybmap.types import BatteryLevels

EqBand = namedtuple("EqBand", ["name", "min_val", "max_val", "current"])
Audio = namedtuple(
    "Audio", ["cnc_level", "auto_cnc", "spatial", "wind_block", "anc_toggle"]
)
Mode = namedtuple(
    "Mode",
    [
        "mode_idx",
        "name",
        "editable",
        "configured",
        "cnc_level",
        "auto_cnc",
        "spatial",
        "wind_block",
        "anc_toggle",
    ],
)


class FakeConnection:
    device_info = {"name": "Bose QuietComfort 35", "product_id": 0x4020}

    def __init__(self):
        self.closed = False
        self.rfcomm_channel = 8
        self.anr_value = "high"
        self.sidetone_value = "medium"

    def has_feature(self, name):
        return name in {
            "battery",
            "firmware",
            "product_name",
            "anr",
            "sidetone",
            "pairing",
        }

    def battery_levels(self):
        return BatteryLevels(72, None, None, None)

    def firmware(self):
        return "4.8.1"

    def name(self):
        return "My QC35"

    def anr(self):
        return self.anr_value

    def set_anr(self, value):
        self.anr_value = value

    def sidetone(self):
        return self.sidetone_value

    def set_sidetone(self, value):
        self.sidetone_value = value

    def pair(self):
        pass

    def close(self):
        self.closed = True


class FakeUltraConnection:
    device_info = {"name": "Bose QC Ultra Headphones 2", "product_id": 0x4082}
    editable_profile_slots = tuple(range(4, 11))
    preset_modes = {
        "quiet": {"idx": 0},
        "aware": {"idx": 1},
        "immersion": {"idx": 2},
        "cinema": {"idx": 3},
    }

    def __init__(self):
        self.current_mode = 2
        self.saved_profile = None
        self.selected_mode = None

    def has_feature(self, name):
        return name in {
            "battery",
            "firmware",
            "product_name",
            "cnc",
            "eq",
            "audio_settings",
            "get_all_modes",
            "current_mode",
            "pairing",
            "power",
        }

    def battery_levels(self):
        return BatteryLevels(60, 80, 60, 20)

    def firmware(self):
        return "8.2.20"

    def name(self):
        return "Ultra"

    def cnc(self):
        return (7, 10)

    def eq(self):
        return [
            EqBand("Bass", -10, 10, 3),
            EqBand("Mid", -10, 10, 0),
            EqBand("Treble", -10, 10, -2),
        ]

    def audio_settings(self):
        return Audio(7, False, 2, True, True)

    def mode_idx(self):
        return self.current_mode

    def save_profile(self, profile_id, **values):
        self.saved_profile = (profile_id, values)
        return int(profile_id) if profile_id is not None else 4

    def set_mode(self, name):
        self.selected_mode = name

    def profiles(self):
        return [
            Mode(0, "Quiet", True, True, 0, False, 0, False, True),
            Mode(1, "None", True, True, 10, False, 0, False, True),
            Mode(2, "Immersion", True, True, 0, False, 2, False, True),
            Mode(3, "Cinema", True, True, 0, False, 1, False, True),
            Mode(4, "Commute", True, True, 5, False, 0, True, True),
            Mode(5, "None", True, False, 0, False, 0, False, False),
        ]

    def close(self):
        pass


def connector(connection):
    def connect(mac, device_type):
        assert mac == "AA:BB:CC:DD:EE:FF"
        assert device_type == "qc35"
        return connection

    return connect


def test_manual_connect_returns_capability_driven_qc35_snapshot():
    connection = FakeConnection()
    service = BackendService(connector=connector(connection), discoverer=lambda: [])
    snapshot = service.handle(
        "connect",
        {
            "target": {
                "kind": "manual",
                "address": "AA:BB:CC:DD:EE:FF",
                "device_type": "qc35",
            }
        },
    )
    assert snapshot["connection"]["state"] == "connected"
    assert snapshot["battery"] == {
        "percent": 72,
        "charging": None,
        "left_percent": None,
        "right_percent": None,
        "case_percent": None,
    }
    assert snapshot["capabilities"]["noise_control"]["kind"] == "anr"
    assert snapshot["capabilities"]["equalizer"] == []
    assert snapshot["values"]["noise_control"] == {"kind": "anr", "value": "high"}
    assert snapshot["connection"]["rfcomm_channel"] == 8


def test_mutation_checks_generation_and_returns_authoritative_value():
    connection = FakeConnection()
    service = BackendService(connector=connector(connection), discoverer=lambda: [])
    connected = service.handle(
        "connect",
        {
            "target": {
                "kind": "manual",
                "address": "AA:BB:CC:DD:EE:FF",
                "device_type": "qc35",
            }
        },
    )
    updated = service.handle(
        "set_noise_control",
        {"generation": connected["generation"], "kind": "anr", "value": "low"},
    )
    assert updated["values"]["noise_control"]["value"] == "low"
    with pytest.raises(ProtocolError) as caught:
        service.handle(
            "set_noise_control", {"generation": 0, "kind": "anr", "value": "high"}
        )
    assert caught.value.code == "STALE_GENERATION"


def test_disconnect_closes_the_only_owned_connection():
    connection = FakeConnection()
    service = BackendService(connector=connector(connection), discoverer=lambda: [])
    service.handle(
        "connect",
        {
            "target": {
                "kind": "manual",
                "address": "AA:BB:CC:DD:EE:FF",
                "device_type": "qc35",
            }
        },
    )
    assert service.handle("disconnect", {}) == {"ok": True}
    assert connection.closed
    with pytest.raises(ProtocolError) as caught:
        service.handle("get_snapshot", {})
    assert caught.value.code == "NOT_CONNECTED"


def test_selective_poll_reads_only_requested_live_values():
    connection = FakeConnection()
    service = BackendService(connector=connector(connection), discoverer=lambda: [])
    snapshot = service.handle(
        "connect",
        {
            "target": {
                "kind": "manual",
                "address": "AA:BB:CC:DD:EE:FF",
                "device_type": "qc35",
            }
        },
    )
    connection.anr_value = "wind"

    polled = service.handle(
        "poll_snapshot",
        {
            "generation": snapshot["generation"],
            "fields": ["noise_control"],
        },
    )

    assert polled["values"]["noise_control"]["value"] == "wind"
    assert polled["battery"] == snapshot["battery"]


def test_typed_channel_rejection_reaches_the_protocol_boundary():
    def rejected(**_kwargs):
        raise BmapConnectionError("rejected", code="SERVICE_NOT_FOUND", channel=7)

    service = BackendService(connector=rejected, discoverer=lambda: [])
    with pytest.raises(ProtocolError) as caught:
        service.handle(
            "connect",
            {
                "target": {
                    "kind": "manual",
                    "address": "AA:BB:CC:DD:EE:FF",
                    "device_type": "qc35",
                }
            },
        )

    assert caught.value.code == "SERVICE_NOT_FOUND"
    assert caught.value.details == {"rfcomm_channel": 7}


def test_unknown_discovery_never_defaults_to_ultra():
    assert _device_from_name("QuietComfort Ultra Headphones") == (None, None)
    assert _device_from_name("QuietComfort Ultra Headphones 2nd Gen")[1] == "qc_ultra2"


def test_ultra_snapshot_reports_eq_profiles_and_audio_settings_from_features():
    service = BackendService(
        connector=lambda mac, device_type: FakeUltraConnection(), discoverer=lambda: []
    )
    snapshot = service.handle(
        "connect",
        {
            "target": {
                "kind": "manual",
                "address": "AA:BB:CC:DD:EE:FF",
                "device_type": "qc_ultra2",
            }
        },
    )
    assert snapshot["battery"] == {
        "percent": 60,
        "charging": None,
        "left_percent": 80,
        "right_percent": 60,
        "case_percent": 20,
    }
    assert snapshot["capabilities"]["noise_control"]["kind"] == "cnc"
    assert [band["id"] for band in snapshot["capabilities"]["equalizer"]] == [
        "bass",
        "mid",
        "treble",
    ]
    assert snapshot["capabilities"]["profiles"]["maximum"] == 7
    assert snapshot["values"]["settings"]["spatial_audio"] == "motion"


def test_profile_list_never_marks_built_in_slots_editable():
    service = BackendService(
        connector=lambda mac, device_type: FakeUltraConnection(), discoverer=lambda: []
    )
    snapshot = service.handle(
        "connect",
        {
            "target": {
                "kind": "manual",
                "address": "AA:BB:CC:DD:EE:FF",
                "device_type": "qc_ultra2",
            }
        },
    )

    result = service.handle("get_profiles", {"generation": snapshot["generation"]})

    assert [profile["name"] for profile in result["profiles"]] == [
        "Quiet",
        "Aware",
        "Immersion",
        "Cinema",
        "Commute",
    ]
    assert [profile["editable"] for profile in result["profiles"]] == [
        False,
        False,
        False,
        False,
        True,
    ]


def test_saving_active_custom_profile_reselects_it_to_apply_audio_settings():
    connection = FakeUltraConnection()
    connection.current_mode = 4
    service = BackendService(
        connector=lambda mac, device_type: connection, discoverer=lambda: []
    )
    snapshot = service.handle(
        "connect",
        {
            "target": {
                "kind": "manual",
                "address": "AA:BB:CC:DD:EE:FF",
                "device_type": "qc_ultra2",
            }
        },
    )

    service.handle(
        "set_profile",
        {
            "generation": snapshot["generation"],
            "profile": {
                "profile_id": "4",
                "name": "Commute",
                "cnc_level": 2,
                "auto_cnc": False,
                "spatial": "off",
                "wind_block": False,
                "anc_toggle": True,
            },
        },
    )

    assert connection.saved_profile[0] == "4"
    assert connection.saved_profile[1]["cnc_level"] == 2
    assert connection.selected_mode == "Commute"
