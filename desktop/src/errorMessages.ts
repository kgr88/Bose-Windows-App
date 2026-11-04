import type { ApiError, ErrorCode } from "./contracts";

const SOMETHING_WRONG = "Something went wrong. Try again.";
const APP_PROBLEM = "The app stopped responding. Restart it and try again.";

const messages: Record<ErrorCode, string> = {
  INVALID_REQUEST: SOMETHING_WRONG,
  REQUEST_TOO_LARGE: SOMETHING_WRONG,
  UNSUPPORTED_PROTOCOL: "This version of the app needs an update.",
  UNKNOWN_METHOD: "This version of the app needs an update.",
  INVALID_PARAMS: SOMETHING_WRONG,
  BACKEND_UNAVAILABLE: APP_PROBLEM,
  BACKEND_CRASHED: APP_PROBLEM,
  BACKEND_TIMEOUT: "The headphones took too long to respond. Try again.",
  BLUETOOTH_UNAVAILABLE: "Bluetooth isn't available on this PC.",
  BLUETOOTH_DISABLED:
    "Bluetooth is turned off. Turn it on in Windows Settings.",
  DEVICE_NOT_FOUND:
    "Headphones not found. Make sure they're on and close to your PC.",
  DEVICE_NOT_PAIRED:
    "These headphones aren't paired. Pair them in Windows Settings first.",
  SERVICE_NOT_FOUND:
    "Couldn't talk to the headphones. Turn them off and on, then try again.",
  ACCESS_DENIED: "Windows blocked access to the headphones.",
  CONNECTION_FAILED:
    "Couldn't connect. Make sure the headphones are on and nearby.",
  NOT_CONNECTED: "The headphones aren't connected.",
  DEVICE_TIMEOUT: "The headphones took too long to respond. Try again.",
  DEVICE_LOST: "The connection to your headphones was lost.",
  UNSUPPORTED_DEVICE: "These headphones aren't supported yet.",
  UNSUPPORTED_OPERATION: "Your headphones don't support this.",
  STALE_GENERATION: "The headphones reconnected. Try again.",
  CONFLICT: "The headphones were busy. Try again.",
  SHUTTING_DOWN: "The app is closing.",
  INTERNAL: SOMETHING_WRONG,
};

export function friendlyError(error: ApiError): string {
  return messages[error.code];
}
