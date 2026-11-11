import io
import json

import pytest

from pybmap.backend.protocol import (
    METHODS,
    PROTOCOL_VERSION,
    ProtocolError,
    encode_message,
    parse_request_line,
)
from pybmap.backend.worker import run


def request(method, params=None, request_id="42"):
    return json.dumps(
        {
            "v": PROTOCOL_VERSION,
            "id": request_id,
            "method": method,
            "params": params or {},
        }
    )


@pytest.mark.parametrize(
    "method", ("hello", "discover", "disconnect", "get_snapshot", "shutdown")
)
def test_parameterless_operations_parse(method):
    parsed = parse_request_line(request(method))
    assert parsed.method == method
    assert parsed.request_id == "42"


@pytest.mark.parametrize(
    "method,params",
    [
        (
            "connect",
            {
                "target": {
                    "kind": "manual",
                    "address": "AA:BB:CC:DD:EE:FF",
                    "device_type": "qc35",
                }
            },
        ),
        ("set_noise_control", {"generation": 3, "kind": "cnc", "value": 7}),
        ("set_eq", {"generation": 3, "bass": -2, "mid": 0, "treble": 4}),
        ("set_setting", {"generation": 3, "key": "sidetone", "value": "medium"}),
        ("get_profiles", {"generation": 3}),
        ("poll_snapshot", {"generation": 3, "fields": ["noise_control", "battery"]}),
        ("delete_profile", {"generation": 3, "profile_id": "8"}),
    ],
)
def test_operation_contracts_parse(method, params):
    assert parse_request_line(request(method, params)).params == params


@pytest.mark.parametrize(
    "payload,code",
    [
        ("not json", "INVALID_REQUEST"),
        (
            '{"v":2,"id":"1","method":"set_setting","params":{"generation":1,"key":"sidetone","value":NaN}}',
            "INVALID_REQUEST",
        ),
        (
            json.dumps({"v": 1, "id": "1", "method": "hello", "params": {}}),
            "UNSUPPORTED_PROTOCOL",
        ),
        (request("missing"), "UNKNOWN_METHOD"),
        (
            request("set_eq", {"generation": 1, "bass": 11, "mid": 0, "treble": 0}),
            "INVALID_PARAMS",
        ),
        (request("hello", {"unexpected": True}), "INVALID_PARAMS"),
    ],
)
def test_invalid_requests_have_stable_codes(payload, code):
    with pytest.raises(ProtocolError) as caught:
        parse_request_line(payload)
    assert caught.value.code == code


@pytest.mark.parametrize("fields", ([], ["battery", "battery"], ["firmware"]))
def test_poll_rejects_empty_duplicate_and_broad_fields(fields):
    with pytest.raises(ProtocolError) as caught:
        parse_request_line(
            request("poll_snapshot", {"generation": 1, "fields": fields})
        )
    assert caught.value.code == "INVALID_PARAMS"


def test_worker_handshake_and_shutdown_use_stdout_only_for_protocol():
    stdin = io.StringIO(
        request("hello") + "\n" + request("shutdown", request_id="43") + "\n"
    )
    stdout = io.StringIO()
    stderr = io.StringIO()

    assert run(stdin=stdin, stdout=stdout, stderr=stderr) == 0

    messages = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert messages[0]["result"]["protocol_version"] == PROTOCOL_VERSION
    assert messages[0]["result"]["operations"] == list(METHODS)
    assert messages[1] == {"v": PROTOCOL_VERSION, "id": "43", "result": {"ok": True}}
    assert stderr.getvalue() == ""


def test_encoder_emits_exactly_one_compact_line():
    encoded = encode_message({"v": PROTOCOL_VERSION, "id": "x", "result": {"ok": True}})
    assert encoded == '{"v":%d,"id":"x","result":{"ok":true}}\n' % PROTOCOL_VERSION


def test_worker_coalesces_rapid_equalizer_writes_and_answers_every_request():
    class Service:
        stopping = False
        calls = []

        def handle(self, method, params):
            self.calls.append((method, params))
            return {"revision": len(self.calls), "bass": params["bass"]}

        def idle_timeout(self):
            return 30

        def drain_events(self):
            return []

    lines = "".join(
        request(
            "set_eq",
            {
                "generation": 1,
                "bass": value,
                "mid": 0,
                "treble": 0,
            },
            request_id=str(value),
        )
        + "\n"
        for value in (1, 2, 3)
    )
    service = Service()
    stdout = io.StringIO()
    run(stdin=io.StringIO(lines), stdout=stdout, stderr=io.StringIO(), service=service)
    responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert len(service.calls) == 1
    assert service.calls[0][1]["bass"] == 3
    assert [response["id"] for response in responses] == ["1", "2", "3"]
    assert all(response["result"]["bass"] == 3 for response in responses)


def test_worker_internal_error_log_never_includes_exception_data():
    class Service:
        stopping = False

        def handle(self, method, params):
            raise RuntimeError("device AA:BB:CC:DD:EE:FF packet deadbeef")

        def idle_timeout(self):
            return 30

        def drain_events(self):
            return []

    stderr = io.StringIO()
    stdout = io.StringIO()
    run(
        stdin=io.StringIO(request("hello") + "\n"),
        stdout=stdout,
        stderr=stderr,
        service=Service(),
    )

    assert stderr.getvalue() == "backend internal error: RuntimeError\n"
    assert "AA:BB:CC:DD:EE:FF" not in stderr.getvalue()
    assert "deadbeef" not in stderr.getvalue()
