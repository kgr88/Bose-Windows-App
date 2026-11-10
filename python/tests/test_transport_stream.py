import pytest

from pybmap.errors import BmapConnectionError
from pybmap.transport import RfcommTransport, _translate_socket_error


class FakeSocket:
    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.timeout = 3.0
        self.sent = []

    def sendall(self, data):
        self.sent.append(data)

    def recv(self, size):
        if not self.chunks:
            raise TimeoutError()
        item = self.chunks.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def settimeout(self, value):
        self.timeout = value

    def gettimeout(self):
        return self.timeout

    def close(self):
        pass


def transport_with(chunks):
    transport = RfcommTransport("AA:BB:CC:DD:EE:FF")
    transport._sock = FakeSocket(chunks)
    return transport


def test_split_frame_is_reassembled_and_complete_write_is_used():
    transport = transport_with([b"\x02\x02", b"\x03\x02\x50", b"\x00"])
    request = b"\x02\x02\x01\x00"
    assert transport.send_recv(request) == b"\x02\x02\x03\x02\x50\x00"
    assert transport._sock.sent == [request]


def test_concatenated_frames_are_buffered_for_the_next_request():
    first = b"\x01\x01\x03\x01A"
    second = b"\x02\x02\x03\x01B"
    transport = transport_with([first + second])
    assert transport.send_recv(b"\x01\x01\x01\x00") == first
    assert transport.send_recv(b"\x02\x02\x01\x00") == second


def test_frame_for_another_address_is_not_taken_as_the_response():
    unsolicited = b"\x1f\x03\x03\x01A"
    response = b"\x02\x02\x03\x01B"
    transport = transport_with([unsolicited + response])
    assert transport.send_recv(b"\x02\x02\x01\x00") == response


def test_drain_collects_frames_and_restores_timeout():
    first = b"\x01\x01\x03\x01A"
    second = b"\x01\x01\x03\x01B"
    transport = transport_with([first + second, TimeoutError()])
    assert transport.send_recv(b"request", drain=True) == first + second
    assert transport._sock.timeout == 3.0


def test_truncated_frame_reports_device_loss():
    transport = transport_with([b"\x01\x01\x03\x04A", b""])
    with pytest.raises(BmapConnectionError, match="closed"):
        transport.send_recv(b"\x01\x01\x01\x00")


@pytest.mark.parametrize(
    "winerror,code",
    [
        (10050, "BLUETOOTH_DISABLED"),
        (10061, "SERVICE_NOT_FOUND"),
        (10065, "DEVICE_NOT_FOUND"),
        (10054, "DEVICE_LOST"),
    ],
)
def test_windows_socket_categories_remain_actionable(winerror, code):
    error = OSError()
    error.winerror = winerror
    translated = _translate_socket_error(error, "connect", channel=7)
    assert translated.code == code
    assert translated.channel == 7
