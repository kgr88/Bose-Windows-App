import { useEffect, useState } from "react";
import { api } from "../api";
import type { BackendInfo, DeviceSnapshot } from "../contracts";
import {
  dangerTextButton,
  groupList,
  row,
  section,
  sectionFooter,
  sectionHeader,
  textButton,
} from "../styles/ui";

export function diagnosticAddress(address: string | null | undefined): string {
  if (!address) return "Unknown";
  const parts = address.split(":");
  return parts.length === 6 ? `••:••:••:••:${parts[4]}:${parts[5]}` : "Hidden";
}

export function DiagnosticsPage({
  snapshot,
  busy,
  onRefresh,
  onDisconnect,
}: {
  snapshot: DeviceSnapshot;
  busy: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const [backend, setBackend] = useState<BackendInfo | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .backendInfo()
      .then((info) => active && setBackend(info))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const headphones = [
    ["Model", snapshot.identity?.model ?? "Unknown"],
    ["Software version", snapshot.firmware?.version || "Unknown"],
    ["Bluetooth address", diagnosticAddress(snapshot.identity?.address)],
  ];
  const app = [["App version", backend?.backend_version ?? "Loading…"]];
  // Technical details for support requests.
  const support = [
    backend && `Python ${backend.python_version}`,
    backend && `Protocol v${backend.protocol_version}`,
    `Channel ${snapshot.connection.rfcomm_channel ?? "unknown"}`,
    `Session ${snapshot.generation}.${snapshot.revision}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <DetailsSection id="about-title" title="Headphones" items={headphones} />
      <DetailsSection id="app-title" title="App" items={app} footer={support} />
      <section className={section} aria-label="Connection">
        <ul className={groupList}>
          <li>
            <button
              className={`${textButton} ${row} w-full`}
              type="button"
              disabled={busy}
              onClick={onRefresh}
            >
              Refresh
            </button>
          </li>
          <li>
            <button
              className={`${dangerTextButton} ${row} w-full`}
              type="button"
              disabled={busy}
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          </li>
        </ul>
      </section>
    </>
  );
}

function DetailsSection({
  id,
  title,
  items,
  footer,
}: {
  id: string;
  title: string;
  items: string[][];
  footer?: string;
}) {
  return (
    <section className={section} aria-labelledby={id}>
      <h2 className={sectionHeader} id={id}>
        {title}
      </h2>
      <dl className={`${groupList} m-0`}>
        {items.map(([term, value]) => (
          <div className={row} key={term}>
            <dt>{term}</dt>
            <dd className="m-0 text-right text-muted [overflow-wrap:anywhere]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {footer && <p className={sectionFooter}>{footer}</p>}
    </section>
  );
}
