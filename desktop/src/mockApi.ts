import type { BoseApi } from "./api";
import type {
  ConnectionTarget,
  DeviceEvent,
  DeviceSnapshot,
  Profile,
  ProfileInput,
  ProfileList,
} from "./contracts";

const ultraProfiles: Profile[] = [
  {
    profile_id: "0",
    name: "Quiet",
    editable: false,
    cnc_level: 0,
    auto_cnc: false,
    spatial: "off",
    wind_block: false,
    anc_toggle: true,
  },
  {
    profile_id: "1",
    name: "Aware",
    editable: false,
    cnc_level: 10,
    auto_cnc: false,
    spatial: "off",
    wind_block: false,
    anc_toggle: true,
  },
  {
    profile_id: "4",
    name: "Commute",
    editable: true,
    cnc_level: 2,
    auto_cnc: false,
    spatial: "room",
    wind_block: true,
    anc_toggle: true,
  },
];

function disconnected(): DeviceSnapshot {
  return {
    identity: null,
    battery: null,
    firmware: null,
    connection: { state: "disconnected", reason: null, rfcomm_channel: null },
    capabilities: {
      noise_control: null,
      equalizer: [],
      settings: [],
      profiles: null,
    },
    values: { noise_control: null, eq: {}, settings: {}, profile_id: null },
    generation: 0,
    revision: 0,
  };
}

type MockDevice = "qc_ultra2" | "qc_ultra2_earbuds" | "qc35";
const earbudsAddress = "AA:BB:CC:02:00:02";

function connected(kind: MockDevice, generation: number): DeviceSnapshot {
  if (kind === "qc_ultra2_earbuds") {
    const headphones = connected("qc_ultra2", generation);
    return {
      ...headphones,
      identity: {
        device_id: earbudsAddress,
        name: "QC Ultra Earbuds",
        model: "Bose QC Ultra Earbuds (2nd Gen)",
        product_id: 0x4062,
        device_type: "qc_ultra2",
        address: earbudsAddress,
      },
      battery: {
        percent: 60,
        charging: null,
        left_percent: 80,
        right_percent: 60,
        case_percent: 20,
      },
    };
  }
  if (kind === "qc35")
    return {
      identity: {
        device_id: "AA:BB:CC:35:00:01",
        name: "QuietComfort 35 II",
        model: "Bose QuietComfort 35",
        product_id: 0x4020,
        device_type: "qc35",
        address: "AA:BB:CC:35:00:01",
      },
      battery: {
        percent: 72,
        charging: null,
        left_percent: null,
        right_percent: null,
        case_percent: null,
      },
      firmware: { version: "4.8.1" },
      connection: { state: "connected", reason: null, rfcomm_channel: 8 },
      capabilities: {
        noise_control: {
          kind: "anr",
          range: null,
          options: ["off", "low", "wind", "high"].map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          })),
        },
        equalizer: [],
        settings: [
          {
            key: "sidetone",
            label: "Sidetone",
            kind: "choice",
            writable: true,
            options: ["off", "low", "medium", "high"].map((value) => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            })),
            minimum: null,
            maximum: null,
            step: null,
          },
        ],
        profiles: null,
      },
      values: {
        noise_control: { kind: "anr", value: "high" },
        eq: {},
        settings: { sidetone: "medium" },
        profile_id: null,
      },
      generation,
      revision: 1,
    };
  const band = (id: string, label: string) => ({
    id,
    label,
    minimum: -10,
    maximum: 10,
    step: 1,
  });
  return {
    identity: {
      device_id: "AA:BB:CC:02:00:01",
      name: "QuietComfort Ultra 2",
      model: "Bose QC Ultra Headphones 2",
      product_id: 0x4082,
      device_type: "qc_ultra2",
      address: "AA:BB:CC:02:00:01",
    },
    battery: {
      percent: 88,
      charging: false,
      left_percent: null,
      right_percent: null,
      case_percent: null,
    },
    firmware: { version: "8.2.20" },
    connection: { state: "connected", reason: null, rfcomm_channel: 2 },
    capabilities: {
      noise_control: {
        kind: "cnc",
        range: { minimum: 0, maximum: 10, step: 1 },
        options: [],
      },
      equalizer: [
        band("bass", "Bass"),
        band("mid", "Mid"),
        band("treble", "Treble"),
      ],
      settings: [
        {
          key: "sidetone",
          label: "Sidetone",
          kind: "choice",
          writable: true,
          options: ["off", "low", "medium", "high"].map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          })),
          minimum: null,
          maximum: null,
          step: null,
        },
        {
          key: "spatial_audio",
          label: "Spatial audio",
          kind: "choice",
          writable: true,
          options: ["off", "room", "motion"].map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          })),
          minimum: null,
          maximum: null,
          step: null,
        },
        {
          key: "wind_block",
          label: "Wind block",
          kind: "toggle",
          writable: true,
          options: [],
          minimum: null,
          maximum: null,
          step: null,
        },
      ],
      profiles: { maximum: 7, supports_delete: true },
    },
    values: {
      noise_control: { kind: "cnc", value: 7 },
      eq: { bass: 3, mid: 0, treble: -2 },
      settings: {
        sidetone: "medium",
        spatial_audio: "motion",
        wind_block: false,
      },
      profile_id: "0",
    },
    generation,
    revision: 1,
  };
}

export function createMockApi(): BoseApi {
  let snapshot = disconnected();
  let profiles = ultraProfiles.map((profile) => ({ ...profile }));
  const listeners = new Set<(event: DeviceEvent) => void>();
  const publish = () =>
    listeners.forEach((listener) =>
      listener({ event: "snapshot_changed", data: snapshot }),
    );
  const update = (change: (current: DeviceSnapshot) => DeviceSnapshot) => {
    snapshot = change({
      ...snapshot,
      values: {
        ...snapshot.values,
        eq: { ...snapshot.values.eq },
        settings: { ...snapshot.values.settings },
      },
    });
    snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    publish();
    return Promise.resolve(snapshot);
  };
  const profileList = (): ProfileList => ({
    generation: snapshot.generation,
    revision: snapshot.revision,
    profiles: profiles.map((profile) => ({ ...profile })),
  });
  // The app turns a discovered device into a manual target with its address.
  const targetType = (target: ConnectionTarget): MockDevice =>
    target.kind === "manual"
      ? target.address === earbudsAddress
        ? "qc_ultra2_earbuds"
        : target.device_type
      : target.device_id.includes("qc35")
        ? "qc35"
        : target.device_id.includes("earbuds")
          ? "qc_ultra2_earbuds"
          : "qc_ultra2";

  return {
    async backendInfo() {
      return {
        backend_version: "development-mock",
        python_version: "development",
        protocol_version: 3,
        operations: [],
      };
    },
    async discover() {
      return [
        {
          device_id: "mock-qc-ultra2",
          address: "AA:BB:CC:02:00:01",
          name: "QuietComfort Ultra 2",
          product_id: 0x4082,
          device_type: "qc_ultra2",
          rfcomm_channel: 2,
          paired: true,
          supported: true,
        },
        {
          device_id: "mock-qc-ultra2-earbuds",
          address: earbudsAddress,
          name: "QC Ultra Earbuds",
          product_id: 0x4062,
          device_type: "qc_ultra2",
          rfcomm_channel: 2,
          paired: true,
          supported: true,
        },
        {
          device_id: "mock-qc35",
          address: "AA:BB:CC:35:00:01",
          name: "QuietComfort 35 II",
          product_id: 0x4020,
          device_type: "qc35",
          rfcomm_channel: 8,
          paired: true,
          supported: true,
        },
      ];
    },
    async connect(target) {
      snapshot = connected(targetType(target), snapshot.generation + 1);
      publish();
      return snapshot;
    },
    async disconnect() {
      snapshot = {
        ...disconnected(),
        generation: snapshot.generation,
        revision: snapshot.revision + 1,
      };
      listeners.forEach((listener) =>
        listener({
          event: "connection_changed",
          data: {
            state: "disconnected",
            generation: snapshot.generation,
            revision: snapshot.revision,
            reason: null,
          },
        }),
      );
    },
    async refresh() {
      return snapshot;
    },
    async currentSnapshot() {
      return snapshot.connection.state === "connected" ? snapshot : null;
    },
    async poll() {
      return update((current) => current);
    },
    setNoiseControl(request) {
      return update((current) => ({
        ...current,
        values: {
          ...current.values,
          noise_control: { kind: request.kind, value: request.value },
          profile_id:
            request.kind === "mode"
              ? (profiles.find((profile) => profile.name === request.value)
                  ?.profile_id ?? current.values.profile_id)
              : current.values.profile_id,
        },
      }));
    },
    setEq(request) {
      return update((current) => ({
        ...current,
        values: {
          ...current.values,
          eq: { bass: request.bass, mid: request.mid, treble: request.treble },
        },
      }));
    },
    setSetting(request) {
      return update((current) => ({
        ...current,
        values: {
          ...current.values,
          settings: {
            ...current.values.settings,
            [request.key]: request.value,
          },
        },
      }));
    },
    async getProfiles() {
      return profileList();
    },
    async setProfile(_generation, profile: ProfileInput) {
      const id =
        profile.profile_id ??
        String(
          Math.max(3, ...profiles.map((item) => Number(item.profile_id))) + 1,
        );
      const next: Profile = { ...profile, profile_id: id, editable: true };
      profiles = [...profiles.filter((item) => item.profile_id !== id), next];
      return profileList();
    },
    async deleteProfile(_generation, profileId) {
      profiles = profiles.filter((profile) => profile.profile_id !== profileId);
      return profileList();
    },
    async subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
