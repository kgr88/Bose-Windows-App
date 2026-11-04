export const PROTOCOL_VERSION = 3 as const;

export type ConnectionState =
  | "disconnected"
  | "discovering"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

export type NoiseControlKind = "cnc" | "anr" | "mode";

export type SettingKey =
  "sidetone" | "auto_pause" | "spatial_audio" | "wind_block" | "anc_toggle";

const SETTING_KEYS: SettingKey[] = [
  "sidetone",
  "auto_pause",
  "spatial_audio",
  "wind_block",
  "anc_toggle",
];

export type ErrorCode =
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "UNSUPPORTED_PROTOCOL"
  | "UNKNOWN_METHOD"
  | "INVALID_PARAMS"
  | "BACKEND_UNAVAILABLE"
  | "BACKEND_CRASHED"
  | "BACKEND_TIMEOUT"
  | "BLUETOOTH_UNAVAILABLE"
  | "BLUETOOTH_DISABLED"
  | "DEVICE_NOT_FOUND"
  | "DEVICE_NOT_PAIRED"
  | "SERVICE_NOT_FOUND"
  | "ACCESS_DENIED"
  | "CONNECTION_FAILED"
  | "NOT_CONNECTED"
  | "DEVICE_TIMEOUT"
  | "DEVICE_LOST"
  | "UNSUPPORTED_DEVICE"
  | "UNSUPPORTED_OPERATION"
  | "STALE_GENERATION"
  | "CONFLICT"
  | "SHUTTING_DOWN"
  | "INTERNAL";

export interface ApiError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface BackendInfo {
  backend_version: string;
  python_version: string;
  protocol_version: number;
  operations: string[];
}

export interface DeviceIdentity {
  device_id: string;
  name: string;
  model: string;
  product_id: number | null;
  device_type: "qc_ultra2" | "qc35";
  address: string | null;
}

export interface BatteryStatus {
  percent: number;
  charging: boolean | null;
  left_percent: number | null;
  right_percent: number | null;
  case_percent: number | null;
}

export interface FirmwareInfo {
  version: string;
}

export interface ConnectionStatus {
  state: ConnectionState;
  reason: string | null;
  rfcomm_channel: number | null;
}

export type PollField = "battery" | "noise_control";

export interface Choice {
  value: string;
  label: string;
}

export interface RangeCapability {
  minimum: number;
  maximum: number;
  step: number;
}

export interface NoiseControlCapability {
  kind: NoiseControlKind;
  range: RangeCapability | null;
  options: Choice[];
}

export interface EqBandCapability extends RangeCapability {
  id: string;
  label: string;
}

export type SettingControlKind = "toggle" | "choice" | "range" | "text";

export interface SettingCapability {
  key: SettingKey;
  label: string;
  kind: SettingControlKind;
  writable: boolean;
  options: Choice[];
  minimum: number | null;
  maximum: number | null;
  step: number | null;
}

export interface ProfileCapability {
  maximum: number;
  supports_delete: boolean;
}

export interface DeviceCapabilities {
  noise_control: NoiseControlCapability | null;
  equalizer: EqBandCapability[];
  settings: SettingCapability[];
  profiles: ProfileCapability | null;
}

export type SettingValue = boolean | string | number;

export interface DeviceValues {
  noise_control: { kind: NoiseControlKind; value: SettingValue } | null;
  eq: Record<string, number>;
  settings: Partial<Record<SettingKey, SettingValue>>;
  profile_id: string | null;
}

export interface DeviceSnapshot {
  identity: DeviceIdentity | null;
  battery: BatteryStatus | null;
  firmware: FirmwareInfo | null;
  connection: ConnectionStatus;
  capabilities: DeviceCapabilities;
  values: DeviceValues;
  generation: number;
  revision: number;
}

export interface DiscoveredDevice {
  device_id: string;
  address: string | null;
  name: string;
  product_id: number | null;
  device_type: string | null;
  rfcomm_channel: number | null;
  paired: boolean;
  supported: boolean;
}

export type ConnectionTarget =
  | { kind: "discovered"; device_id: string }
  | { kind: "manual"; address: string; device_type: "qc_ultra2" | "qc35" };

export interface SetNoiseControlRequest {
  generation: number;
  kind: NoiseControlKind;
  value: number | string;
}

export interface SetEqRequest {
  generation: number;
  bass: number;
  mid: number;
  treble: number;
}

export interface SetSettingRequest {
  generation: number;
  key: SettingKey;
  value: SettingValue;
}

export interface ProfileInput {
  profile_id?: string | null;
  name: string;
  cnc_level: number;
  auto_cnc: boolean;
  spatial: "off" | "room" | "motion";
  wind_block: boolean;
  anc_toggle: boolean;
}

export interface Profile extends Omit<ProfileInput, "profile_id"> {
  profile_id: string;
  editable: boolean;
}

export interface ProfileList {
  generation: number;
  revision: number;
  profiles: Profile[];
}

export type DeviceEvent =
  | { event: "snapshot_changed"; data: DeviceSnapshot }
  | {
      event: "connection_changed";
      data: {
        state: ConnectionState;
        generation: number;
        revision: number;
        reason: string | null;
      };
    }
  | { event: "backend_error"; data: ApiError };

const CONNECTION_STATES: readonly string[] = [
  "disconnected",
  "discovering",
  "connecting",
  "connected",
  "reconnecting",
  "disconnecting",
  "error",
];
const NOISE_KINDS: readonly string[] = ["cnc", "anr", "mode"];
const ERROR_CODES: readonly string[] = [
  "INVALID_REQUEST",
  "REQUEST_TOO_LARGE",
  "UNSUPPORTED_PROTOCOL",
  "UNKNOWN_METHOD",
  "INVALID_PARAMS",
  "BACKEND_UNAVAILABLE",
  "BACKEND_CRASHED",
  "BACKEND_TIMEOUT",
  "BLUETOOTH_UNAVAILABLE",
  "BLUETOOTH_DISABLED",
  "DEVICE_NOT_FOUND",
  "DEVICE_NOT_PAIRED",
  "SERVICE_NOT_FOUND",
  "ACCESS_DENIED",
  "CONNECTION_FAILED",
  "NOT_CONNECTED",
  "DEVICE_TIMEOUT",
  "DEVICE_LOST",
  "UNSUPPORTED_DEVICE",
  "UNSUPPORTED_OPERATION",
  "STALE_GENERATION",
  "CONFLICT",
  "SHUTTING_DOWN",
  "INTERNAL",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullablePercent(value: unknown): value is number | null {
  return value === null || (isNonNegativeInteger(value) && value <= 100);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isScalar(value: unknown): value is SettingValue {
  return (
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function hasOnlyScalarValues(
  value: unknown,
): value is Record<string, SettingValue> {
  return isObject(value) && Object.values(value).every(isScalar);
}

function hasOnlySettingValues(
  value: unknown,
): value is Partial<Record<SettingKey, SettingValue>> {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        SETTING_KEYS.includes(key as SettingKey) && isScalar(item),
    )
  );
}

function isChoice(value: unknown): value is Choice {
  return (
    isObject(value) &&
    typeof value.value === "string" &&
    typeof value.label === "string"
  );
}

function isSettingCapability(value: unknown): value is SettingCapability {
  return (
    isObject(value) &&
    SETTING_KEYS.includes(String(value.key) as SettingKey) &&
    ["toggle", "choice", "range", "text"].includes(String(value.kind)) &&
    typeof value.label === "string" &&
    typeof value.writable === "boolean" &&
    Array.isArray(value.options) &&
    value.options.every(isChoice) &&
    (value.minimum === null || Number.isFinite(value.minimum)) &&
    (value.maximum === null || Number.isFinite(value.maximum)) &&
    (value.step === null ||
      (Number.isFinite(value.step) && (value.step as number) > 0))
  );
}

function isRange(value: unknown): value is RangeCapability {
  return (
    isObject(value) &&
    Number.isFinite(value.minimum) &&
    Number.isFinite(value.maximum) &&
    Number.isFinite(value.step) &&
    (value.step as number) > 0
  );
}

export function isApiError(value: unknown): value is ApiError {
  return (
    isObject(value) &&
    ERROR_CODES.includes(String(value.code)) &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

export function isBackendInfo(value: unknown): value is BackendInfo {
  return (
    isObject(value) &&
    typeof value.backend_version === "string" &&
    typeof value.python_version === "string" &&
    value.protocol_version === PROTOCOL_VERSION &&
    Array.isArray(value.operations) &&
    value.operations.every((item) => typeof item === "string")
  );
}

export function isDeviceSnapshot(value: unknown): value is DeviceSnapshot {
  if (
    !isObject(value) ||
    !isNonNegativeInteger(value.generation) ||
    !isNonNegativeInteger(value.revision)
  ) {
    return false;
  }
  if (
    !isObject(value.connection) ||
    !CONNECTION_STATES.includes(String(value.connection.state)) ||
    !isNullableString(value.connection.reason) ||
    !(
      value.connection.rfcomm_channel === null ||
      (isNonNegativeInteger(value.connection.rfcomm_channel) &&
        value.connection.rfcomm_channel >= 1 &&
        value.connection.rfcomm_channel <= 30)
    )
  ) {
    return false;
  }
  if (
    value.identity !== null &&
    (!isObject(value.identity) ||
      typeof value.identity.device_id !== "string" ||
      typeof value.identity.name !== "string" ||
      typeof value.identity.model !== "string" ||
      !["qc_ultra2", "qc35"].includes(String(value.identity.device_type)) ||
      !isNullableString(value.identity.address))
  )
    return false;
  if (
    value.battery !== null &&
    (!isObject(value.battery) ||
      !isNonNegativeInteger(value.battery.percent) ||
      (value.battery.percent as number) > 100 ||
      !(
        value.battery.charging === null ||
        typeof value.battery.charging === "boolean"
      ) ||
      !isNullablePercent(value.battery.left_percent) ||
      !isNullablePercent(value.battery.right_percent) ||
      !isNullablePercent(value.battery.case_percent))
  )
    return false;
  if (
    value.firmware !== null &&
    (!isObject(value.firmware) || typeof value.firmware.version !== "string")
  )
    return false;
  if (
    !isObject(value.capabilities) ||
    !Array.isArray(value.capabilities.equalizer) ||
    !Array.isArray(value.capabilities.settings)
  ) {
    return false;
  }
  const noiseCapability = value.capabilities.noise_control;
  if (
    noiseCapability !== null &&
    (!isObject(noiseCapability) ||
      !NOISE_KINDS.includes(String(noiseCapability.kind)) ||
      !(noiseCapability.range === null || isRange(noiseCapability.range)) ||
      !Array.isArray(noiseCapability.options) ||
      !noiseCapability.options.every(isChoice))
  )
    return false;
  if (
    !value.capabilities.equalizer.every(
      (band) =>
        isObject(band) &&
        isRange(band) &&
        typeof band.id === "string" &&
        typeof band.label === "string",
    )
  )
    return false;
  if (!value.capabilities.settings.every(isSettingCapability)) return false;
  if (
    !isObject(value.values) ||
    !hasOnlyScalarValues(value.values.eq) ||
    !hasOnlySettingValues(value.values.settings) ||
    !isNullableString(value.values.profile_id)
  ) {
    return false;
  }
  const noiseValue = value.values.noise_control;
  if (
    noiseValue !== null &&
    (!isObject(noiseValue) ||
      !NOISE_KINDS.includes(String(noiseValue.kind)) ||
      !isScalar(noiseValue.value))
  )
    return false;
  return true;
}

export function isDiscoveredDevice(value: unknown): value is DiscoveredDevice {
  return (
    isObject(value) &&
    typeof value.device_id === "string" &&
    value.device_id.length > 0 &&
    typeof value.name === "string" &&
    isNullableString(value.address) &&
    (value.product_id === null || isNonNegativeInteger(value.product_id)) &&
    isNullableString(value.device_type) &&
    (value.rfcomm_channel === null ||
      (isNonNegativeInteger(value.rfcomm_channel) &&
        value.rfcomm_channel >= 1 &&
        value.rfcomm_channel <= 30)) &&
    typeof value.paired === "boolean" &&
    typeof value.supported === "boolean"
  );
}

export function isProfileList(value: unknown): value is ProfileList {
  return (
    isObject(value) &&
    isNonNegativeInteger(value.generation) &&
    isNonNegativeInteger(value.revision) &&
    Array.isArray(value.profiles) &&
    value.profiles.every(
      (profile) =>
        isObject(profile) &&
        typeof profile.profile_id === "string" &&
        typeof profile.name === "string" &&
        typeof profile.editable === "boolean" &&
        isNonNegativeInteger(profile.cnc_level) &&
        (profile.cnc_level as number) <= 10 &&
        typeof profile.auto_cnc === "boolean" &&
        ["off", "room", "motion"].includes(String(profile.spatial)) &&
        typeof profile.wind_block === "boolean" &&
        typeof profile.anc_toggle === "boolean",
    )
  );
}

export function isDeviceEvent(value: unknown): value is DeviceEvent {
  if (!isObject(value) || typeof value.event !== "string" || !("data" in value))
    return false;
  if (value.event === "snapshot_changed") return isDeviceSnapshot(value.data);
  if (value.event === "backend_error") return isApiError(value.data);
  if (value.event !== "connection_changed" || !isObject(value.data))
    return false;
  return (
    CONNECTION_STATES.includes(String(value.data.state)) &&
    isNonNegativeInteger(value.data.generation) &&
    isNonNegativeInteger(value.data.revision) &&
    isNullableString(value.data.reason)
  );
}
