import { describe, expect, it } from "vitest";
import type { ConnectionState, DeviceSnapshot } from "../contracts";
import { initialDeviceState, isNewer, reduceDeviceEvent } from "./deviceState";

function version(generation: number, revision: number): DeviceSnapshot {
  return { generation, revision } as DeviceSnapshot;
}

describe("snapshot ordering", () => {
  it("ignores revisions from an older connection generation", () => {
    expect(isNewer(version(2, 1), version(1, 999))).toBe(false);
  });
  it("accepts a newer generation even when its revision restarts", () => {
    expect(isNewer(version(2, 999), version(3, 0))).toBe(true);
  });

  it("clears snapshot ordering when the sidecar session ends", () => {
    const connected = {
      snapshot: version(4, 20),
      error: null,
      connection: "connected" as const,
    };
    expect(reduceDeviceEvent(connected, { event: "session_reset" })).toEqual(
      initialDeviceState,
    );
  });
});

describe("connection changes", () => {
  const connected = {
    snapshot: version(4, 20),
    error: null,
    connection: "connected" as const,
  };
  function change(state: ConnectionState, reason: string | null) {
    return {
      event: "connection_changed" as const,
      data: { state, generation: 4, revision: 21, reason },
    };
  }

  it.each(["device_lost", "connection_failed"])(
    "shows a lost headset that the sidecar reports as %s",
    (reason) => {
      const lost = reduceDeviceEvent(connected, change("error", reason));
      expect(lost.connection).toBe("error");
      expect(lost.error).toMatchObject({
        code: "DEVICE_LOST",
        retryable: true,
      });
    },
  );

  it.each(["reconnecting", "connected"] as const)(
    "clears the lost headset error when the state becomes %s",
    (next) => {
      const lost = reduceDeviceEvent(connected, change("error", "device_lost"));
      expect(reduceDeviceEvent(lost, change(next, null)).error).toBeNull();
    },
  );

  it("ignores a lost headset from an older connection", () => {
    const old = {
      event: "connection_changed" as const,
      data: {
        state: "error" as const,
        generation: 3,
        revision: 99,
        reason: "device_lost",
      },
    };
    expect(reduceDeviceEvent(connected, old)).toBe(connected);
  });
});
