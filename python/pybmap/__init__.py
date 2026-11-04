"""pybmap — Control Bluetooth audio devices over the BMAP protocol.

Usage:
    import pybmap

    with pybmap.connect() as dev:
        print(dev.battery())
        dev.set_cnc(8)
        dev.set_eq(3, 0, -2)
        dev.set_mode("quiet")

    # Explicit MAC and device type:
    with pybmap.connect(mac="68:F2:1F:XX:XX:XX", device_type="qc_ultra2") as dev:
        ...
"""

from .catalog import (
    BMAP_UUID,
    BOSE_USB_VID,
    CATALOG,
    BoseDevice,
    is_supported,
    known_devices,
    lookup_device,
    supported_devices,
    usb_ids,
)
from .connection import BmapConnection
from .constants import OP_ERROR, OP_GET, OP_STATUS
from .devices import DEVICES, get_device
from .discovery import find_bmap_device, resolve_rfcomm_channels
from .errors import (
    BmapAuthError,
    BmapConnectionError,
    BmapDeviceError,
    BmapError,
    BmapNotFoundError,
    BmapTimeoutError,
)
from .protocol import bmap_packet, parse_all_responses, parse_response
from .transport import RfcommTransport
from .types import BmapResponse, ButtonMapping, DeviceStatus, EqBand, ModeConfig

__version__ = "0.4.0"


def connect(mac=None, device_type=None, transport_factory=None, channel_resolver=None):
    """Connect to a BMAP device.

    Args:
        mac: Bluetooth MAC address. Auto-detected if None.
        device_type: Device type string (e.g. "qc_ultra2", "qc35").
                     Defaults to "qc_ultra2" if not specified.

    Returns:
        BmapConnection context manager.

    Raises:
        BmapNotFoundError: If no device is found.
        BmapConnectionError: If the connection fails.
    """
    if mac is None:
        detected_mac, detected_type = find_bmap_device()
        if detected_mac is None:
            raise BmapNotFoundError(
                "No connected BMAP device found. Pair and connect "
                "in Windows Bluetooth settings, or pass mac= explicitly."
            )
        mac = detected_mac
        if device_type is None:
            device_type = detected_type

    if device_type is None:
        raise BmapNotFoundError(
            "Device type could not be identified; "
            "pass device_type='qc_ultra2' or 'qc35'"
        )

    device = get_device(device_type)
    channel_resolver = channel_resolver or resolve_rfcomm_channels
    resolved_channels = channel_resolver(mac)
    channels = _ordered_rfcomm_channels(device, resolved_channels)
    transport_factory = transport_factory or RfcommTransport
    last_error = None
    for channel in channels:
        transport = transport_factory(mac, channel=channel)
        try:
            transport.connect()
            # Some devices require an init packet before responding.
            init = getattr(device, "INIT_PACKET", None)
            if init:
                fblock, func = init
                transport.send_recv(bmap_packet(fblock, func, OP_GET))
            _validate_bmap_endpoint(transport, device)
            return BmapConnection(transport, device)
        except BmapAuthError:
            transport.close()
            raise
        except (BmapConnectionError, BmapTimeoutError) as exc:
            last_error = exc
            transport.close()
    raise last_error


def _ordered_rfcomm_channels(device, resolved_channels=()):
    """Put live SDP results before unique catalog compatibility fallbacks."""
    catalog_channels = getattr(
        device, "RFCOMM_CHANNELS", (getattr(device, "RFCOMM_CHANNEL", 2),)
    )
    ordered = []
    for channel in tuple(resolved_channels) + tuple(catalog_channels):
        if isinstance(channel, int) and 1 <= channel <= 30 and channel not in ordered:
            ordered.append(channel)
    return tuple(ordered)


def _validate_bmap_endpoint(transport, device):
    """Require a matching, well-formed read response before accepting a port."""
    feature = device.FEATURES.get("battery")
    if feature is None:
        raise BmapConnectionError(
            "Device definition has no safe endpoint validation read",
            code="UNSUPPORTED_DEVICE",
            channel=transport.channel,
        )
    fblock, func = feature["addr"]
    response = parse_response(transport.send_recv(bmap_packet(fblock, func, OP_GET)))
    if response is None or response.fblock != fblock or response.func != func:
        raise BmapConnectionError(
            "RFCOMM channel %s did not return a BMAP response" % transport.channel,
            code="SERVICE_NOT_FOUND",
            channel=transport.channel,
        )
    if response.op == OP_ERROR and response.payload and response.payload[0] == 5:
        raise BmapAuthError("The BMAP service requires device authentication")
    if response.op != OP_STATUS or not response.payload:
        raise BmapConnectionError(
            "RFCOMM channel %s did not validate as the BMAP service"
            % transport.channel,
            code="SERVICE_NOT_FOUND",
            channel=transport.channel,
        )
