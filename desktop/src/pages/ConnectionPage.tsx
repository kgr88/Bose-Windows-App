import { useState } from "react";
import type { ConnectionTarget, DiscoveredDevice } from "../contracts";
import { Select } from "../components/Controls";
import {
  button,
  group,
  groupList,
  input,
  row,
  rowDetail,
  section,
  sectionFooter,
  sectionHeaderRow,
  sectionTitle,
  textButton,
} from "../styles/ui";

interface Props {
  devices: DiscoveredDevice[];
  busy: boolean;
  state: string;
  onDiscover: () => void;
  onConnect: (device: DiscoveredDevice) => void;
  onManualConnect: (target: ConnectionTarget) => void;
}

function HeadphonesIcon() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4.5" height="7" rx="2" />
      <rect x="16.5" y="14" width="4.5" height="7" rx="2" />
    </svg>
  );
}

export function ConnectionPage({
  devices,
  busy,
  state,
  onDiscover,
  onConnect,
  onManualConnect,
}: Props) {
  const [address, setAddress] = useState("");
  const [deviceType, setDeviceType] = useState<"qc_ultra2" | "qc35">(
    "qc_ultra2",
  );
  const busyLabel = state === "connecting" ? "Connecting…" : "Searching…";
  return (
    <>
      {devices.length === 0 ? (
        <section
          className={`${section} ${group} flex flex-col items-center px-6 py-10 text-center`}
          aria-labelledby="connection-title"
        >
          <span className="text-accent">
            <HeadphonesIcon />
          </span>
          <h2
            className="mt-4 mb-0 text-[20px] font-semibold"
            id="connection-title"
          >
            Connect your headphones
          </h2>
          <p className="mt-2 mb-6 max-w-[340px] leading-6 text-muted">
            Pair your headphones in Windows Bluetooth settings first. Then
            search for them here.
          </p>
          <button
            className={button}
            type="button"
            onClick={onDiscover}
            disabled={busy}
          >
            {busy ? busyLabel : "Search for Headphones"}
          </button>
        </section>
      ) : (
        <section className={section} aria-labelledby="connection-title">
          <div className={sectionHeaderRow}>
            <h2 className={sectionTitle} id="connection-title">
              My Headphones
            </h2>
            <button
              className={textButton}
              type="button"
              onClick={onDiscover}
              disabled={busy}
            >
              {busy ? busyLabel : "Search Again"}
            </button>
          </div>
          <ul className={groupList}>
            {devices.map((device) => (
              <li className={row} key={device.device_id}>
                <span>
                  {device.name}
                  {!device.supported && (
                    <small className={rowDetail}>
                      Not recognized. Use “Can’t find your headphones?” below.
                    </small>
                  )}
                </span>
                <button
                  className={button}
                  type="button"
                  disabled={busy || !device.supported}
                  onClick={() => onConnect(device)}
                >
                  Connect
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <details className={section}>
        <summary className="flex cursor-pointer list-none justify-center text-[15px] text-accent [&::-webkit-details-marker]:hidden">
          Can’t find your headphones?
        </summary>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            onManualConnect({
              kind: "manual",
              address: address.trim(),
              device_type: deviceType,
            });
          }}
        >
          <div className={`${group} divide-y divide-separator`}>
            <label className={row}>
              <span>Model</span>
              <Select
                value={deviceType}
                onChange={(event) =>
                  setDeviceType(event.currentTarget.value as typeof deviceType)
                }
              >
                <option value="qc_ultra2">QuietComfort Ultra 2</option>
                <option value="qc35">QuietComfort 35 / 35 II</option>
              </Select>
            </label>
            <label className={row}>
              <span>Bluetooth address</span>
              <input
                className={`${input} w-[min(220px,55%)] text-right`}
                required
                pattern="[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}"
                placeholder="AA:BB:CC:DD:EE:FF"
                value={address}
                onChange={(event) => setAddress(event.currentTarget.value)}
              />
            </label>
          </div>
          <p className={sectionFooter}>
            Use this if your headphones don’t appear in the search.
          </p>
          <div className="mt-4 flex justify-center">
            <button
              className={button}
              type="submit"
              disabled={busy || !address.trim()}
            >
              Connect
            </button>
          </div>
        </form>
      </details>
    </>
  );
}
