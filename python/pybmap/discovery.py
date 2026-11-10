"""Platform discovery for paired BMAP devices.

The backend uses the documented Windows Bluetooth desktop API through
``ctypes``, so it has no optional runtime dependency.  Discovery never guesses an
unknown device configuration.
"""

import ctypes
import re
import socket
import sys
import uuid
from collections import namedtuple
from ctypes import wintypes

from .catalog import BMAP_UUID

DiscoveredDevice = namedtuple(
    "DiscoveredDevice",
    [
        "address",
        "name",
        "service_uuid",
        "rfcomm_channel",
        "product_id",
        "device_type",
        "paired",
        "connected",
    ],
)


class BluetoothDiscoveryError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def discover_devices(platform=None):
    """Return all paired BMAP candidates as platform-neutral records."""
    platform = platform or sys.platform
    if platform == "win32":
        return _scan_windows_devices()
    return []


def find_bmap_device():
    """Compatibility API returning the preferred ``(address, config)`` tuple."""
    candidates = discover_devices()
    for device in candidates:
        if device.connected and device.device_type:
            return (device.address, device.device_type)
    for device in candidates:
        if device.device_type:
            return (device.address, device.device_type)
    return (None, None)


def _device_from_name(name):
    """Resolve only model names that unambiguously select a supported config."""
    normalized = " ".join(name.lower().split())
    if "quietcomfort 35" in normalized or re.search(r"\bqc35(?: ii)?\b", normalized):
        product_id = (
            0x4020 if (" ii" in normalized or "qc35 ii" in normalized) else 0x400C
        )
        return product_id, "qc35"
    if re.search(r"\bqc ultra 2(?: hp| headphones)?\b", normalized):
        return (0x4062 if "earbud" in normalized else 0x4082), "qc_ultra2"
    if ("quietcomfort ultra" in normalized or "qc ultra" in normalized) and (
        "2nd gen" in normalized
        or "second gen" in normalized
        or normalized.endswith(" 2")
    ):
        return (0x4062 if "earbud" in normalized else 0x4082), "qc_ultra2"
    return None, None


def _channel_for_type(device_type):
    return {"qc_ultra2": 2, "qc35": 8}.get(device_type)


def _format_bluetooth_address(value):
    return ":".join("%02X" % ((value >> shift) & 0xFF) for shift in range(40, -1, -8))


def _scan_windows_devices():
    """Enumerate paired Windows radios/devices and retain BMAP services.

    ``BluetoothEnumerateInstalledServices`` reports the installed SDP service
    GUIDs.  The desktop API does not expose the RFCOMM channel, so it is selected
    only after an unambiguous supported model resolution.
    """
    if sys.platform != "win32":
        return []

    class SYSTEMTIME(ctypes.Structure):
        _fields_ = [
            (name, wintypes.WORD)
            for name in (
                "year",
                "month",
                "day_of_week",
                "day",
                "hour",
                "minute",
                "second",
                "milliseconds",
            )
        ]

    class BLUETOOTH_DEVICE_INFO(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("Address", ctypes.c_ulonglong),
            ("ulClassofDevice", wintypes.ULONG),
            ("fConnected", wintypes.BOOL),
            ("fRemembered", wintypes.BOOL),
            ("fAuthenticated", wintypes.BOOL),
            ("stLastSeen", SYSTEMTIME),
            ("stLastUsed", SYSTEMTIME),
            ("szName", wintypes.WCHAR * 248),
        ]

    class BLUETOOTH_DEVICE_SEARCH_PARAMS(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("fReturnAuthenticated", wintypes.BOOL),
            ("fReturnRemembered", wintypes.BOOL),
            ("fReturnUnknown", wintypes.BOOL),
            ("fReturnConnected", wintypes.BOOL),
            ("fIssueInquiry", wintypes.BOOL),
            ("cTimeoutMultiplier", ctypes.c_ubyte),
            ("hRadio", wintypes.HANDLE),
        ]

    class BLUETOOTH_FIND_RADIO_PARAMS(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD)]

    bth = ctypes.WinDLL("bthprops.cpl", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    # ctypes assumes unannotated parameters are 32-bit C ``int`` values.  The
    # Bluetooth enumeration tokens and radio handles are pointer-sized, so that
    # default truncates 64-bit Windows handles (or raises OverflowError before
    # the API is called).
    bth.BluetoothFindFirstRadio.argtypes = [
        ctypes.POINTER(BLUETOOTH_FIND_RADIO_PARAMS),
        ctypes.POINTER(wintypes.HANDLE),
    ]
    bth.BluetoothFindFirstRadio.restype = wintypes.HANDLE
    bth.BluetoothFindNextRadio.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    bth.BluetoothFindNextRadio.restype = wintypes.BOOL
    bth.BluetoothFindFirstDevice.argtypes = [
        ctypes.POINTER(BLUETOOTH_DEVICE_SEARCH_PARAMS),
        ctypes.POINTER(BLUETOOTH_DEVICE_INFO),
    ]
    bth.BluetoothFindFirstDevice.restype = wintypes.HANDLE
    bth.BluetoothFindNextDevice.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(BLUETOOTH_DEVICE_INFO),
    ]
    bth.BluetoothFindNextDevice.restype = wintypes.BOOL
    bth.BluetoothFindRadioClose.argtypes = [wintypes.HANDLE]
    bth.BluetoothFindRadioClose.restype = wintypes.BOOL
    bth.BluetoothFindDeviceClose.argtypes = [wintypes.HANDLE]
    bth.BluetoothFindDeviceClose.restype = wintypes.BOOL
    bth.BluetoothEnumerateInstalledServices.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(BLUETOOTH_DEVICE_INFO),
        ctypes.POINTER(wintypes.DWORD),
        ctypes.c_void_p,
    ]
    bth.BluetoothEnumerateInstalledServices.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    radio_params = BLUETOOTH_FIND_RADIO_PARAMS(
        ctypes.sizeof(BLUETOOTH_FIND_RADIO_PARAMS)
    )
    radio = wintypes.HANDLE()
    radio_find = bth.BluetoothFindFirstRadio(
        ctypes.byref(radio_params), ctypes.byref(radio)
    )
    if not radio_find:
        raise BluetoothDiscoveryError(
            "BLUETOOTH_UNAVAILABLE", "No enabled Windows Bluetooth radio is available"
        )

    records = {}
    try:
        while True:
            search = BLUETOOTH_DEVICE_SEARCH_PARAMS(
                ctypes.sizeof(BLUETOOTH_DEVICE_SEARCH_PARAMS),
                True,
                True,
                False,
                True,
                False,
                1,
                radio,
            )
            info = BLUETOOTH_DEVICE_INFO()
            info.dwSize = ctypes.sizeof(info)
            device_find = bth.BluetoothFindFirstDevice(
                ctypes.byref(search), ctypes.byref(info)
            )
            if device_find:
                try:
                    while True:
                        if info.fAuthenticated or info.fRemembered:
                            services = _windows_service_guids(bth, radio, info)
                            if BMAP_UUID.lower() in services:
                                address = _format_bluetooth_address(info.Address)
                                product_id, device_type = _device_from_name(info.szName)
                                channels = resolve_rfcomm_channels(address)
                                records[address] = DiscoveredDevice(
                                    address,
                                    info.szName or "Bose device",
                                    BMAP_UUID,
                                    channels[0]
                                    if channels
                                    else _channel_for_type(device_type),
                                    product_id,
                                    device_type,
                                    True,
                                    bool(info.fConnected),
                                )
                        info = BLUETOOTH_DEVICE_INFO()
                        info.dwSize = ctypes.sizeof(info)
                        if not bth.BluetoothFindNextDevice(
                            device_find, ctypes.byref(info)
                        ):
                            break
                finally:
                    bth.BluetoothFindDeviceClose(device_find)
            next_radio = wintypes.HANDLE()
            if not bth.BluetoothFindNextRadio(radio_find, ctypes.byref(next_radio)):
                break
            kernel32.CloseHandle(radio)
            radio = next_radio
    finally:
        kernel32.CloseHandle(radio)
        bth.BluetoothFindRadioClose(radio_find)
    return list(records.values())


def _windows_service_guids(bth, radio, device_info):
    """Return installed service GUID strings for a Windows device."""
    count = wintypes.DWORD(0)
    bth.BluetoothEnumerateInstalledServices(
        radio, ctypes.byref(device_info), ctypes.byref(count), None
    )
    if not count.value:
        return set()
    guid_array = (ctypes.c_byte * (16 * count.value))()
    result = bth.BluetoothEnumerateInstalledServices(
        radio, ctypes.byref(device_info), ctypes.byref(count), ctypes.byref(guid_array)
    )
    if result != 0:
        if result == 5:
            raise BluetoothDiscoveryError(
                "ACCESS_DENIED", "Windows denied Bluetooth service discovery"
            )
        return set()
    raw = bytes(guid_array)
    return {
        _guid_bytes_to_text(raw[i : i + 16]) for i in range(0, count.value * 16, 16)
    }


def _guid_bytes_to_text(raw):
    data1 = int.from_bytes(raw[0:4], "little")
    data2 = int.from_bytes(raw[4:6], "little")
    data3 = int.from_bytes(raw[6:8], "little")
    data4 = raw[8:]
    return "%08x-%04x-%04x-%s-%s" % (
        data1,
        data2,
        data3,
        data4[:2].hex(),
        data4[2:].hex(),
    )


def resolve_rfcomm_channels(address, service_uuid=BMAP_UUID, flush_cache=True):
    """Resolve connectable RFCOMM ports from a Windows Bluetooth SDP record.

    Windows' installed-service enumeration only confirms that the BMAP UUID is
    present. A Winsock service lookup returns the complete ``SOCKADDR_BTH``,
    including the current RFCOMM port advertised by the headset. Failures are
    deliberately non-fatal here so callers can try ordered catalog fallbacks.
    """
    if sys.platform != "win32":
        return []

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    class SOCKADDR(ctypes.Structure):
        _fields_ = [("sa_family", wintypes.USHORT), ("sa_data", ctypes.c_char * 14)]

    class SOCKADDR_BTH(ctypes.Structure):
        _fields_ = [
            ("address_family", wintypes.USHORT),
            ("bt_addr", ctypes.c_ulonglong),
            ("service_class_id", GUID),
            ("port", wintypes.ULONG),
        ]

    class SOCKET_ADDRESS(ctypes.Structure):
        _fields_ = [("lp_sockaddr", ctypes.POINTER(SOCKADDR)), ("length", ctypes.c_int)]

    class CSADDR_INFO(ctypes.Structure):
        _fields_ = [
            ("local_addr", SOCKET_ADDRESS),
            ("remote_addr", SOCKET_ADDRESS),
            ("socket_type", ctypes.c_int),
            ("protocol", ctypes.c_int),
        ]

    class WSAQUERYSET(ctypes.Structure):
        _fields_ = [
            ("size", wintypes.DWORD),
            ("service_instance_name", wintypes.LPWSTR),
            ("service_class_id", ctypes.POINTER(GUID)),
            ("version", ctypes.c_void_p),
            ("comment", wintypes.LPWSTR),
            ("namespace", wintypes.DWORD),
            ("namespace_provider_id", ctypes.c_void_p),
            ("context", wintypes.LPWSTR),
            ("protocol_count", wintypes.DWORD),
            ("protocols", ctypes.c_void_p),
            ("query_string", wintypes.LPWSTR),
            ("address_count", wintypes.DWORD),
            ("addresses", ctypes.POINTER(CSADDR_INFO)),
            ("output_flags", wintypes.DWORD),
            ("blob", ctypes.c_void_p),
        ]

    ws2 = ctypes.WinDLL("ws2_32", use_last_error=True)
    ws2.WSAAddressToStringW.argtypes = [
        ctypes.POINTER(SOCKADDR),
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    ws2.WSAAddressToStringW.restype = ctypes.c_int
    ws2.WSALookupServiceBeginW.argtypes = [
        ctypes.POINTER(WSAQUERYSET),
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    ws2.WSALookupServiceBeginW.restype = ctypes.c_int
    ws2.WSALookupServiceNextW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.c_void_p,
    ]
    ws2.WSALookupServiceNextW.restype = ctypes.c_int
    ws2.WSALookupServiceEnd.argtypes = [wintypes.HANDLE]
    ws2.WSALookupServiceEnd.restype = ctypes.c_int
    ws2.WSAGetLastError.restype = ctypes.c_int

    sockaddr = SOCKADDR_BTH()
    sockaddr.address_family = socket.AF_BLUETOOTH
    sockaddr.bt_addr = int(address.replace(":", ""), 16)
    context_buffer = ctypes.create_unicode_buffer(128)
    context_length = wintypes.DWORD(len(context_buffer))
    if (
        ws2.WSAAddressToStringW(
            ctypes.cast(ctypes.byref(sockaddr), ctypes.POINTER(SOCKADDR)),
            ctypes.sizeof(sockaddr),
            None,
            context_buffer,
            ctypes.byref(context_length),
        )
        != 0
    ):
        return []

    uuid_value = uuid.UUID(service_uuid)
    uuid_bytes = uuid_value.bytes_le
    service_guid = GUID(
        int.from_bytes(uuid_bytes[0:4], "little"),
        int.from_bytes(uuid_bytes[4:6], "little"),
        int.from_bytes(uuid_bytes[6:8], "little"),
        (ctypes.c_ubyte * 8)(*uuid_bytes[8:]),
    )
    query = WSAQUERYSET()
    query.size = ctypes.sizeof(query)
    query.service_class_id = ctypes.pointer(service_guid)
    query.namespace = 16  # NS_BTH
    query.context = ctypes.cast(context_buffer, wintypes.LPWSTR)

    lookup = wintypes.HANDLE()
    lup_return_addr = 0x0100
    control_flags = lup_return_addr | (0x1000 if flush_cache else 0)  # LUP_FLUSHCACHE
    if (
        ws2.WSALookupServiceBeginW(
            ctypes.byref(query), control_flags, ctypes.byref(lookup)
        )
        != 0
    ):
        return []

    channels = []
    try:
        buffer_size = 4096
        while True:
            result_buffer = ctypes.create_string_buffer(buffer_size)
            result_size = wintypes.DWORD(buffer_size)
            result = ws2.WSALookupServiceNextW(
                lookup,
                lup_return_addr,
                ctypes.byref(result_size),
                result_buffer,
            )
            if result != 0:
                error = ws2.WSAGetLastError()
                if (
                    error == 10014 and result_size.value > buffer_size
                ):  # WSAEFAULT: grow buffer
                    buffer_size = result_size.value
                    continue
                break
            result_query = ctypes.cast(
                result_buffer, ctypes.POINTER(WSAQUERYSET)
            ).contents
            for index in range(result_query.address_count):
                info = result_query.addresses[index]
                for socket_address in (info.local_addr, info.remote_addr):
                    if (
                        not socket_address.lp_sockaddr
                        or socket_address.length < ctypes.sizeof(SOCKADDR_BTH)
                    ):
                        continue
                    endpoint = ctypes.cast(
                        socket_address.lp_sockaddr, ctypes.POINTER(SOCKADDR_BTH)
                    ).contents
                    if 1 <= endpoint.port <= 30 and endpoint.port not in channels:
                        channels.append(endpoint.port)
    finally:
        ws2.WSALookupServiceEnd(lookup)
    return channels
