import { useEffect, useState } from "react";
import { api } from "../api";
import type {
  DeviceSnapshot,
  SettingCapability,
  SettingValue,
} from "../contracts";
import { Select, Slider, Toggle } from "../components/Controls";
import { group, groupList, input, row, rowDetail, section } from "../styles/ui";

interface Props {
  snapshot: DeviceSnapshot;
  onSnapshot: (value: DeviceSnapshot) => void;
  onError: (error: unknown) => void;
}

function SettingInput({
  capability,
  value,
  busy,
  onChange,
}: {
  capability: SettingCapability;
  value: SettingValue | undefined;
  busy: boolean;
  onChange: (value: SettingValue) => void;
}) {
  if (capability.kind === "toggle")
    return (
      <Toggle
        checked={Boolean(value)}
        disabled={busy || !capability.writable}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    );
  if (capability.kind === "choice")
    return (
      <Select
        value={String(value ?? "")}
        disabled={busy || !capability.writable}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {capability.options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  if (capability.kind === "range")
    return (
      <Slider
        className="max-w-[50%]"
        value={Number(value ?? capability.minimum ?? 0)}
        min={capability.minimum ?? 0}
        max={capability.maximum ?? 100}
        step={capability.step ?? undefined}
        disabled={busy || !capability.writable}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    );
  return (
    <input
      className={`${input} w-[min(260px,48%)] text-right`}
      key={String(value ?? "")}
      type="text"
      defaultValue={String(value ?? "")}
      readOnly={!capability.writable}
      disabled={busy}
      onBlur={(e) =>
        capability.writable &&
        e.currentTarget.value !== String(value ?? "") &&
        onChange(e.currentTarget.value)
      }
    />
  );
}

export function SettingsPage({ snapshot, onSnapshot, onError }: Props) {
  const [draft, setDraft] = useState(snapshot.values.settings);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(
    () => setDraft(snapshot.values.settings),
    [snapshot.generation, snapshot.revision],
  );
  async function update(capability: SettingCapability, value: SettingValue) {
    const previous = draft[capability.key];
    setDraft((current) => ({ ...current, [capability.key]: value }));
    setBusy(capability.key);
    try {
      onSnapshot(
        await api.setSetting({
          generation: snapshot.generation,
          key: capability.key,
          value,
        }),
      );
    } catch (error) {
      setDraft((current) => ({ ...current, [capability.key]: previous }));
      onError(error);
    } finally {
      setBusy(null);
    }
  }
  const settings = snapshot.capabilities.settings;
  return (
    <section className={section} aria-label="Settings">
      {settings.length === 0 ? (
        <div className={`${group} px-4 py-6 text-center text-muted`}>
          There are no settings for these headphones.
        </div>
      ) : (
        <ul className={groupList}>
          {settings.map((capability) => (
            <li key={capability.key}>
              <label className={row}>
                <span className="flex-1">
                  {capability.label}
                  {!capability.writable && (
                    <small className={rowDetail}>Can’t be changed</small>
                  )}
                </span>
                <SettingInput
                  capability={capability}
                  value={draft[capability.key]}
                  busy={busy === capability.key}
                  onChange={(value) => void update(capability, value)}
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
