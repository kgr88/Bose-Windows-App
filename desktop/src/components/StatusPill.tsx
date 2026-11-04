import type { ConnectionState } from "../contracts";

const labels: Record<ConnectionState, string> = {
  disconnected: "Not connected",
  discovering: "Searching…",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnecting: "Disconnecting…",
  error: "Connection lost",
};

export function StatusPill({ state }: { state: ConnectionState }) {
  const dot =
    state === "connected"
      ? "bg-success"
      : state === "error"
        ? "bg-danger"
        : "bg-muted";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted">
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      {labels[state]}
    </span>
  );
}
