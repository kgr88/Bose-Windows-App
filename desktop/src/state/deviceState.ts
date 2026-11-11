import type {
  ApiError,
  ConnectionState,
  DeviceEvent,
  DeviceSnapshot,
} from "../contracts";

export interface DeviceState {
  snapshot: DeviceSnapshot | null;
  error: ApiError | null;
  connection: ConnectionState;
}

export const initialDeviceState: DeviceState = {
  snapshot: null,
  error: null,
  connection: "disconnected",
};

const deviceLost: ApiError = {
  code: "DEVICE_LOST",
  message: "The headset connection was lost.",
  retryable: true,
};

export type DeviceStateEvent = DeviceEvent | { event: "session_reset" };

export function isNewer(
  current: DeviceSnapshot | null,
  next: DeviceSnapshot,
): boolean {
  return (
    current === null ||
    next.generation > current.generation ||
    (next.generation === current.generation &&
      next.revision >= current.revision)
  );
}

export function reduceDeviceEvent(
  state: DeviceState,
  event: DeviceStateEvent,
): DeviceState {
  if (event.event === "session_reset") return initialDeviceState;
  if (event.event === "backend_error")
    return {
      ...state,
      error: event.data,
      connection: ["BACKEND_CRASHED", "DEVICE_LOST", "DEVICE_TIMEOUT"].includes(
        event.data.code,
      )
        ? "error"
        : state.connection,
    };
  if (event.event === "connection_changed") {
    if (
      state.snapshot &&
      (event.data.generation < state.snapshot.generation ||
        (event.data.generation === state.snapshot.generation &&
          event.data.revision < state.snapshot.revision))
    )
      return state;
    // The sidecar reports a headset loss it found by itself, and a reconnect
    // of its own that failed, only by this event. Give the window an error
    // to show.
    const error =
      event.data.state === "error" &&
      (event.data.reason === "device_lost" ||
        event.data.reason === "connection_failed")
        ? deviceLost
        : event.data.state === "reconnecting" ||
            event.data.state === "connected"
          ? null
          : state.error;
    return { ...state, connection: event.data.state, error };
  }
  if (!isNewer(state.snapshot, event.data)) return state;
  return {
    snapshot: event.data,
    connection: event.data.connection.state,
    error: null,
  };
}
