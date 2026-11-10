import io
import threading

from pybmap.backend import worker


class BlockedInput:
    def __init__(self):
        self.closed = threading.Event()

    def readline(self, _limit):
        self.closed.wait()
        return ""


class IdleService:
    stopping = False

    def __init__(self, stdin):
        self.stdin = stdin

    def idle(self):
        self.stdin.closed.set()

    def drain_events(self):
        return [("connection_changed", {"state": "error"})]


def test_quiet_worker_runs_the_idle_check_and_writes_its_events(monkeypatch):
    monkeypatch.setattr(worker, "IDLE_CHECK_SECONDS", 0.01)
    stdin, stdout = BlockedInput(), io.StringIO()

    worker.run(stdin, stdout, io.StringIO(), IdleService(stdin))

    assert '"event":"connection_changed"' in stdout.getvalue().replace(" ", "")
