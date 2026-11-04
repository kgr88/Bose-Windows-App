import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeviceSnapshot } from "../contracts";
import {
  deviceCncLevel,
  profileAncStrength,
  ProfilesPage,
} from "./ProfilesPage";

const snapshot: DeviceSnapshot = {
  identity: null,
  battery: null,
  firmware: null,
  connection: { state: "connected", reason: null, rfcomm_channel: 2 },
  capabilities: {
    noise_control: null,
    equalizer: [],
    settings: [],
    profiles: { maximum: 7, supports_delete: true },
  },
  values: { noise_control: null, eq: {}, settings: {}, profile_id: "0" },
  generation: 1,
  revision: 1,
};

describe("profile controls", () => {
  it("maps the inverted device CNC value to user-facing ANC strength", () => {
    expect(profileAncStrength(0)).toBe(10);
    expect(profileAncStrength(10)).toBe(0);
    expect(deviceCncLevel(10)).toBe(0);
    expect(deviceCncLevel(0)).toBe(10);
  });

  it("does not expose a save action before New or Edit is chosen", () => {
    const html = renderToStaticMarkup(
      <ProfilesPage
        snapshot={snapshot}
        onSnapshot={() => undefined}
        onError={() => undefined}
      />,
    );
    expect(html).not.toContain("Edit Mode");
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain(">Create<");
  });
});
