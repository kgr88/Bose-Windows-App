import { useEffect, useState } from "react";
import { api } from "../api";
import type {
  DeviceSnapshot,
  Profile,
  ProfileInput,
  ProfileList,
} from "../contracts";
import {
  ConfirmAlert,
  Select,
  Sheet,
  Slider,
  Toggle,
} from "../components/Controls";
import {
  dangerTextButton,
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

const spatialLabels: Record<ProfileInput["spatial"], string> = {
  off: "Off",
  room: "Room",
  motion: "Motion",
};

interface Props {
  snapshot: DeviceSnapshot;
  onSnapshot: (value: DeviceSnapshot) => void;
  onError: (error: unknown) => void;
}

const ANC_MAXIMUM = 10;
const newProfile: ProfileInput = {
  name: "Custom",
  cnc_level: 0,
  auto_cnc: false,
  spatial: "off",
  wind_block: false,
  anc_toggle: true,
};

export function profileAncStrength(cncLevel: number) {
  return ANC_MAXIMUM - Math.max(0, Math.min(ANC_MAXIMUM, cncLevel));
}

export function deviceCncLevel(ancStrength: number) {
  return ANC_MAXIMUM - Math.max(0, Math.min(ANC_MAXIMUM, ancStrength));
}

export function ProfilesPage({ snapshot, onSnapshot, onError }: Props) {
  const [list, setList] = useState<ProfileList | null>(null);
  const [draft, setDraft] = useState<ProfileInput | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setDraft(null);
    setBusy(true);
    void api
      .getProfiles(snapshot.generation)
      .then((value) => active && setList(value))
      .catch(onError)
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, [snapshot.generation, onError]);

  function edit(profile: Profile) {
    if (!profile.editable) return;
    setDraft({
      profile_id: profile.profile_id,
      name: profile.name,
      cnc_level: profile.cnc_level,
      auto_cnc: profile.auto_cnc,
      spatial: profile.spatial,
      wind_block: profile.wind_block,
      anc_toggle: profile.anc_toggle,
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      setList(await api.setProfile(snapshot.generation, draft));
      setDraft(null);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (!busy) setDraft(null);
  }

  async function remove(profile: Profile) {
    setPendingDelete(null);
    setBusy(true);
    try {
      setList(await api.deleteProfile(snapshot.generation, profile.profile_id));
      if (draft?.profile_id === profile.profile_id) setDraft(null);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function activate(profile: Profile) {
    setDraft(null);
    setBusy(true);
    try {
      onSnapshot(
        await api.setNoiseControl({
          generation: snapshot.generation,
          kind: "mode",
          value: profile.name,
        }),
      );
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  const customCount =
    list?.profiles.filter((profile) => profile.editable).length ?? 0;
  const maximum = snapshot.capabilities.profiles?.maximum ?? 0;
  const canCreate = list !== null && customCount < maximum;

  return (
    <>
      <section className={section} aria-labelledby="profiles-title">
        <div className={sectionHeaderRow}>
          <h2 className={sectionTitle} id="profiles-title">
            Modes
          </h2>
          <span className="flex items-baseline gap-3">
            {busy && (
              <span className="text-[13px] text-muted" role="status">
                Working…
              </span>
            )}
            <button
              className={textButton}
              type="button"
              disabled={busy || !canCreate}
              onClick={() => setDraft({ ...newProfile })}
            >
              New Mode
            </button>
          </span>
        </div>
        {!list || list.profiles.length === 0 ? (
          <div className={`${group} px-4 py-6 text-center text-muted`}>
            {list ? "No modes yet." : "Loading…"}
          </div>
        ) : (
          <ul className={groupList}>
            {list.profiles.map((profile) => {
              const details = [
                profile.anc_toggle
                  ? `Noise cancelling ${profileAncStrength(profile.cnc_level)}`
                  : "Noise cancelling off",
                profile.spatial !== "off" &&
                  `Spatial audio: ${spatialLabels[profile.spatial]}`,
              ]
                .filter(Boolean)
                .join(" · ");
              const active = snapshot.values.profile_id === profile.profile_id;
              return (
                <li key={profile.profile_id} className={`${row} py-1.5`}>
                  <button
                    className="flex flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent py-1 text-left text-ink disabled:cursor-default"
                    type="button"
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => void activate(profile)}
                  >
                    <span className="flex-1">
                      {profile.name}
                      <small className={rowDetail}>{details}</small>
                    </span>
                    {active && (
                      <span className="font-semibold text-accent">✓</span>
                    )}
                  </button>
                  {profile.editable && (
                    <span className="flex gap-4 pl-2">
                      <button
                        className={textButton}
                        aria-label={`Edit ${profile.name}`}
                        type="button"
                        disabled={busy}
                        onClick={() => edit(profile)}
                      >
                        Edit
                      </button>
                      <button
                        className={dangerTextButton}
                        aria-label={`Delete ${profile.name}`}
                        type="button"
                        disabled={busy}
                        onClick={() => setPendingDelete(profile)}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className={sectionFooter}>Select a mode to use it.</p>
      </section>

      {pendingDelete && (
        <ConfirmAlert
          title={`Delete “${pendingDelete.name}”?`}
          message="You can’t undo this."
          confirmLabel="Delete"
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {draft && (
        <Sheet aria-labelledby="profile-editor-title" onClose={close}>
          <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-separator px-4 py-3">
            <button
              className={`${textButton} justify-self-start`}
              type="button"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <h2
              className="m-0 text-[17px] font-semibold"
              id="profile-editor-title"
            >
              {draft.profile_id ? "Edit Mode" : "New Mode"}
            </h2>
            <button
              className={`${textButton} justify-self-end font-semibold`}
              type="button"
              disabled={busy || !draft.name.trim()}
              onClick={() => void save()}
            >
              {draft.profile_id ? "Save" : "Create"}
            </button>
          </header>
          <div className="overflow-y-auto px-4 pt-5 pb-6">
            <div className={`${group} divide-y divide-separator`}>
              <label className={row}>
                <span>Name</span>
                <input
                  className={`${input} w-[min(240px,60%)] text-right`}
                  maxLength={64}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.currentTarget.value })
                  }
                />
              </label>
              <label className={row}>
                <span>Noise cancelling</span>
                <Toggle
                  checked={draft.anc_toggle}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      anc_toggle: event.currentTarget.checked,
                    })
                  }
                />
              </label>
              <label className="block px-4 py-3">
                <span className="flex justify-between">
                  <span>Strength</span>
                  <output className="text-muted tabular-nums">
                    {profileAncStrength(draft.cnc_level)}
                  </output>
                </span>
                <Slider
                  aria-label="Noise cancelling strength"
                  min={0}
                  max={10}
                  value={profileAncStrength(draft.cnc_level)}
                  disabled={!draft.anc_toggle}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      cnc_level: deviceCncLevel(
                        Number(event.currentTarget.value),
                      ),
                    })
                  }
                />
                <span className="flex justify-between text-[13px] text-muted">
                  <span>Aware</span>
                  <span>Quiet</span>
                </span>
              </label>
              <label className={row}>
                <span>Adjust automatically</span>
                <Toggle
                  checked={draft.auto_cnc}
                  disabled={!draft.anc_toggle}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      auto_cnc: event.currentTarget.checked,
                    })
                  }
                />
              </label>
              <label className={row}>
                <span>Spatial audio</span>
                <Select
                  value={draft.spatial}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      spatial: event.currentTarget
                        .value as ProfileInput["spatial"],
                    })
                  }
                >
                  {Object.entries(spatialLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className={row}>
                <span>Wind block</span>
                <Toggle
                  checked={draft.wind_block}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      wind_block: event.currentTarget.checked,
                    })
                  }
                />
              </label>
            </div>
            <p className={sectionFooter}>
              Wind block reduces wind noise. It can make strength changes harder
              to hear.
            </p>
          </div>
        </Sheet>
      )}
    </>
  );
}
