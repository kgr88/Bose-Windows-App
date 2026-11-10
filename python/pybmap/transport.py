"""RFCOMM Bluetooth socket transport for BMAP devices."""

import errno
import socket

from .errors import BmapConnectionError, BmapTimeoutError

RFCOMM_CHANNEL = 2  # Compatibility default; SDP discovery may select another channel.


class RfcommTransport:
    """Raw RFCOMM Bluetooth socket transport.

    Manages the Bluetooth socket lifecycle and provides send/receive
    with optional multi-packet draining for async responses.

    Usage:
        with RfcommTransport("68:F2:1F:XX:XX:XX") as transport:
            resp = transport.send_recv(packet_bytes)
    """

    def __init__(
        self,
        mac,
        channel=RFCOMM_CHANNEL,
        timeout=3.0,
        connect_timeout=None,
        response_timeout=None,
        drain_timeout=0.5,
        socket_factory=None,
    ):
        self.mac = mac
        self.channel = channel
        self.connect_timeout = timeout if connect_timeout is None else connect_timeout
        self.timeout = timeout if response_timeout is None else response_timeout
        self.drain_timeout = drain_timeout
        self._socket_factory = socket_factory or socket.socket
        self._sock = None
        self._buffer = bytearray()

    def connect(self):
        """Open the RFCOMM socket to the device."""
        try:
            self._sock = self._socket_factory(
                socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM
            )
            self._sock.settimeout(self.connect_timeout)
            self._sock.connect((self.mac, self.channel))
            self._sock.settimeout(self.timeout)
        except OSError as e:
            if self._sock is not None:
                try:
                    self._sock.close()
                except OSError:
                    pass
            self._sock = None
            raise _translate_socket_error(
                e, "connect to %s" % self.mac, channel=self.channel
            ) from e

    def close(self):
        """Close the socket."""
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
            self._buffer.clear()

    def _recv_into_buffer(self):
        chunk = self._sock.recv(4096)
        if not chunk:
            raise BmapConnectionError("Device closed the RFCOMM connection")
        self._buffer.extend(chunk)

    def _recv_frame(self):
        """Read exactly one BMAP frame, preserving extra stream bytes."""
        while len(self._buffer) < 4:
            self._recv_into_buffer()
        frame_length = 4 + self._buffer[3]
        while len(self._buffer) < frame_length:
            self._recv_into_buffer()
        frame = bytes(self._buffer[:frame_length])
        del self._buffer[:frame_length]
        return frame

    def send_recv(self, packet, drain=False):
        """Send a BMAP packet and receive the response.

        Args:
            packet: Raw bytes to send.
            drain: If True, keep reading until the socket times out.
                   Needed for commands that return multiple STATUS
                   messages (e.g., GetAll).

        Returns:
            Raw response bytes (may contain multiple concatenated packets
            if drain=True).

        Raises:
            BmapTimeoutError: If no response is received.
        """
        if not self._sock:
            raise BmapConnectionError("Not connected")
        try:
            self._sock.sendall(packet)
            data = self._recv_frame()
            # The device also sends frames nobody asked for, such as a mode
            # change made with a headset button. Taking one as the response
            # would shift every later response by one frame. A drain keeps
            # every frame because its callers filter by address themselves.
            while not drain and data[:2] != packet[:2]:
                data = self._recv_frame()
        except TimeoutError as e:
            if self._buffer:
                self._buffer.clear()
                raise BmapConnectionError(
                    "Device returned a truncated BMAP frame"
                ) from e
            raise BmapTimeoutError("No response from device") from e
        except OSError as e:
            raise _translate_socket_error(e, "communicate with device") from e

        if drain:
            previous_timeout = self._sock.gettimeout()
            self._sock.settimeout(self.drain_timeout)
            try:
                while True:
                    data += self._recv_frame()
            except (TimeoutError, BlockingIOError) as e:
                if self._buffer:
                    self._buffer.clear()
                    raise BmapConnectionError(
                        "Device returned a truncated BMAP frame"
                    ) from e
            except OSError as e:
                raise _translate_socket_error(e, "drain device responses") from e
            finally:
                self._sock.settimeout(previous_timeout)

        return data

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *exc):
        self.close()


def _translate_socket_error(error, action, channel=None):
    """Translate platform socket failures without leaking unstable errno text."""
    code = getattr(error, "winerror", None) or getattr(error, "errno", None)
    timed_out = {errno.ETIMEDOUT, 10060}
    denied = {errno.EACCES, errno.EPERM, 10013}
    unavailable = {errno.EAFNOSUPPORT, errno.EPROTONOSUPPORT, 10047, 10043}
    disabled = {
        getattr(errno, "ENETDOWN", -1),
        getattr(errno, "ENETUNREACH", -1),
        10050,
        10051,
    }
    rejected = {errno.ECONNREFUSED, 10061}
    not_found = {
        getattr(errno, "EHOSTDOWN", -1),
        getattr(errno, "EHOSTUNREACH", -1),
        10064,
        10065,
    }
    lost = {errno.ECONNRESET, errno.ENOTCONN, errno.ECONNABORTED, 10053, 10054, 10057}
    if code in timed_out:
        return BmapTimeoutError("Timed out while attempting to %s" % action)
    if code in denied:
        return BmapConnectionError(
            "Bluetooth access was denied while attempting to %s" % action,
            code="ACCESS_DENIED",
            channel=channel,
        )
    if code in unavailable:
        return BmapConnectionError(
            "Bluetooth RFCOMM is unavailable",
            code="BLUETOOTH_UNAVAILABLE",
            channel=channel,
        )
    if code in disabled:
        return BmapConnectionError(
            "The Bluetooth radio is disabled",
            code="BLUETOOTH_DISABLED",
            channel=channel,
        )
    if code in rejected:
        return BmapConnectionError(
            "The device rejected RFCOMM channel %s" % channel,
            code="SERVICE_NOT_FOUND",
            channel=channel,
        )
    if code in not_found:
        return BmapConnectionError(
            "The Bluetooth device is unavailable",
            code="DEVICE_NOT_FOUND",
            channel=channel,
        )
    if code in lost:
        return BmapConnectionError(
            "The Bluetooth device connection was lost",
            code="DEVICE_LOST",
            channel=channel,
        )
    return BmapConnectionError("Failed to %s" % action, channel=channel)
