import { describe, expect, it } from "vitest";
import { diagnosticAddress } from "./DiagnosticsPage";

describe("diagnosticAddress", () => {
  it("retains only the non-identifying suffix of a Bluetooth address", () => {
    expect(diagnosticAddress("AA:BB:CC:DD:EE:FF")).toBe("••:••:••:••:EE:FF");
  });

  it("does not echo malformed address values", () => {
    expect(diagnosticAddress("device-secret")).toBe("Hidden");
    expect(diagnosticAddress(null)).toBe("Unknown");
  });
});
