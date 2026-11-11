// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api";
import type { DeviceEvent, DeviceSnapshot } from "./contracts";

vi.mock("./api", () => ({
  api: {
    subscribe: vi.fn(),
    currentSnapshot: vi.fn(),
    poll: vi.fn(),
    connect: vi.fn(),
  },
}));

function snapshot(generation: number): DeviceSnapshot {
  return {
    identity: {
      device_id: "AA:BB:CC:DD:EE:FF",
      name: "Test headset",
      model: "Test headset",
      product_id: null,
      device_type: "qc_ultra2",
      address: "AA:BB:CC:DD:EE:FF",
    },
    battery: null,
    firmware: null,
    connection: { state: "connected", reason: null, rfcomm_channel: 2 },
    capabilities: {
      noise_control: null,
      equalizer: [],
      settings: [],
      profiles: null,
    },
    values: { noise_control: null, eq: {}, settings: {}, profile_id: null },
    generation,
    revision: 1,
  };
}

const lost = {
  code: "DEVICE_LOST",
  message: "lost",
  retryable: true,
} as const;

// Start the app with a saved state and return the way to send it events.
async function start(restored: DeviceSnapshot | null) {
  let send: (event: DeviceEvent) => void = () => {};
  vi.mocked(api.subscribe).mockImplementation((listener) => {
    send = listener;
    return Promise.resolve(() => {});
  });
  vi.mocked(api.currentSnapshot).mockResolvedValue(restored);
  render(<App />);
  await act(async () => {});
  return async (event: DeviceEvent) => {
    await act(async () => send(event));
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.poll).mockImplementation((generation) =>
      Promise.resolve(snapshot(generation)),
    );
    vi.mocked(api.connect).mockResolvedValue(snapshot(9));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("polls a restored headset when the window opens", async () => {
    await start(snapshot(1));
    expect(api.poll).toHaveBeenCalledExactlyOnceWith(1, [
      "noise_control",
      "battery",
    ]);
  });

  it("does not poll again after a connection that read every value", async () => {
    const send = await start(null);
    await send({ event: "snapshot_changed", data: snapshot(1) });
    expect(api.poll).not.toHaveBeenCalled();
  });

  it("leaves the reconnect after a lost headset to the sidecar", async () => {
    const send = await start(snapshot(1));
    await send({
      event: "connection_changed",
      data: {
        state: "error",
        generation: 1,
        revision: 2,
        reason: "device_lost",
      },
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("connects again after a backend crash", async () => {
    const send = await start(snapshot(1));
    await send({
      event: "backend_error",
      data: { code: "BACKEND_CRASHED", message: "crashed", retryable: true },
    });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(api.connect).toHaveBeenCalledExactlyOnceWith({
      kind: "manual",
      address: "AA:BB:CC:DD:EE:FF",
      device_type: "qc_ultra2",
    });
  });

  it("removes an old request error when the sidecar connects again", async () => {
    vi.mocked(api.poll).mockRejectedValue(lost);
    const send = await start(snapshot(1));
    expect(screen.getByRole("alert")).toBeTruthy();

    await send({ event: "snapshot_changed", data: snapshot(2) });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
