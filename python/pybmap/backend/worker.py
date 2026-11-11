"""Serialized JSON-lines worker with newest-value write coalescing."""

import sys
import threading
from collections import deque
from queue import Empty, Queue

from .protocol import (
    MAX_LINE_BYTES,
    ProtocolError,
    encode_message,
    error_response,
    event_message,
    parse_request_line,
    success_response,
)
from .service import BackendService

COALESCE_SECONDS = 0.025
_EOF = object()


def _reader(stdin, incoming):
    while True:
        line = stdin.readline(MAX_LINE_BYTES + 1)
        if not line:
            break
        if len(line) >= MAX_LINE_BYTES + 1 and not line.endswith("\n"):
            while True:
                remainder = stdin.readline(MAX_LINE_BYTES + 1)
                if not remainder or remainder.endswith("\n"):
                    break
        incoming.put(line)
    incoming.put(_EOF)


def _coalesce_key(request):
    if request.method == "set_eq":
        return (request.method, request.params["generation"], "")
    if request.method == "set_noise_control" and request.params["kind"] == "cnc":
        return (request.method, request.params["generation"], "cnc")
    return None


def _parse_work(line):
    try:
        return (parse_request_line(line), None)
    except ProtocolError as exc:
        return (None, exc)


def _write(stdout, service, messages=()):
    for message in messages:
        stdout.write(encode_message(message))
    for event, data in service.drain_events():
        stdout.write(encode_message(event_message(event, data)))
    stdout.flush()


def run(stdin=None, stdout=None, stderr=None, service=None):
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    service = service or BackendService()
    incoming = Queue()
    backlog = deque()
    threading.Thread(target=_reader, args=(stdin, incoming), daemon=True).start()

    while True:
        try:
            item = (
                backlog.popleft()
                if backlog
                else incoming.get(timeout=service.idle_timeout())
            )
        except Empty:
            try:
                service.idle()
            except Exception as exc:  # The service already recorded the new state.
                print("backend idle check failed: %s" % type(exc).__name__, file=stderr)
            _write(stdout, service)
            continue
        if item is _EOF:
            break
        request, parse_error = item if isinstance(item, tuple) else _parse_work(item)
        group = [request] if request is not None else []
        key = _coalesce_key(request) if request is not None else None
        if key is not None:
            while True:
                try:
                    next_item = incoming.get(timeout=COALESCE_SECONDS)
                except Empty:
                    break
                if next_item is _EOF:
                    backlog.append(_EOF)
                    break
                next_work = _parse_work(next_item)
                next_request, _ = next_work
                if next_request is not None and _coalesce_key(next_request) == key:
                    group.append(next_request)
                else:
                    backlog.append(next_work)
                    break

        if parse_error is not None:
            message = error_response(
                parse_error.request_id,
                parse_error.code,
                parse_error.message,
                parse_error.retryable,
                parse_error.details,
            )
            stdout.write(encode_message(message))
            stdout.flush()
            continue

        latest = group[-1]
        try:
            result = service.handle(latest.method, latest.params)
            messages = [success_response(item.request_id, result) for item in group]
        except ProtocolError as exc:
            messages = [
                error_response(
                    item.request_id, exc.code, exc.message, exc.retryable, exc.details
                )
                for item in group
            ]
        except (
            Exception
        ) as exc:  # Never log request data, addresses, packets, or traces.
            print("backend internal error: %s" % type(exc).__name__, file=stderr)
            messages = [
                error_response(item.request_id, "INTERNAL", "internal backend error")
                for item in group
            ]

        _write(stdout, service, messages)
        if service.stopping:
            break
    return 0
