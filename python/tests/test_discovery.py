import uuid

from pybmap.catalog import BMAP_UUID
from pybmap.discovery import (
    _device_from_name,
    _format_bluetooth_address,
    _guid_bytes_to_text,
)


def test_windows_address_and_guid_wire_formats_match_platform_contract():
    assert _format_bluetooth_address(0xAABBCCDDEEFF) == "AA:BB:CC:DD:EE:FF"
    assert _guid_bytes_to_text(uuid.UUID(BMAP_UUID).bytes_le) == BMAP_UUID


def test_windows_qc_ultra_2_headphones_alias_is_unambiguous():
    assert _device_from_name("Bose QC Ultra 2 HP") == (0x4082, "qc_ultra2")


def test_windows_qc_ultra_2_earbuds_name_selects_earbuds_product():
    assert _device_from_name("Bose QC Ultra 2 Earbuds") == (0x4062, "qc_ultra2")
