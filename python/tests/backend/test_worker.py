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

    def idle_timeout(self):
        return 0.01

    def idle(self):
        self.stdin.closed.set()

    def drain_events(self):
        return [("connection_changed", {"state": "error"})]


def test_quiet_worker_runs_idle_work_when_the_service_asks_for_it():
    stdin, stdout = BlockedInput(), io.StringIO()

    worker.run(stdin, stdout, io.StringIO(), IdleService(stdin))

    assert '"event":"connection_changed"' in stdout.getvalue().replace(" ", "")
