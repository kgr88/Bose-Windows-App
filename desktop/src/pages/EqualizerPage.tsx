import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { DeviceSnapshot } from "../contracts";
import { LatestWriteQueue } from "../state/latestWrite";
import { Slider } from "../components/Controls";
import {
  group,
  section,
  sectionHeaderRow,
  sectionTitle,
  textButton,
} from "../styles/ui";

interface Props {
  snapshot: DeviceSnapshot;
  onSnapshot: (value: DeviceSnapshot) => void;
  onError: (error: unknown) => void;
}
type EqValue = { bass: number; mid: number; treble: number };

function readEq(snapshot: DeviceSnapshot): EqValue {
  return {
    bass: snapshot.values.eq.bass ?? 0,
    mid: snapshot.values.eq.mid ?? 0,
    treble: snapshot.values.eq.treble ?? 0,
  };
}

export function EqualizerPage({ snapshot, onSnapshot, onError }: Props) {
  const authoritative = readEq(snapshot);
  const authoritativeRef = useRef(authoritative);
  authoritativeRef.current = authoritative;
  const writingRef = useRef(false);
  const [value, setValue] = useState(authoritative);
  useEffect(() => {
    if (!writingRef.current) setValue(authoritative);
  }, [snapshot.generation, snapshot.revision]);
  const queue = useMemo(
    () =>
      new LatestWriteQueue<EqValue, DeviceSnapshot>(
        (next) => api.setEq({ generation: snapshot.generation, ...next }),
        (next) => {
          writingRef.current = false;
          onSnapshot(next);
        },
        (error) => {
          writingRef.current = false;
          setValue(authoritativeRef.current);
          onError(error);
        },
        300,
      ),
    [snapshot.generation, onSnapshot, onError],
  );
  useEffect(() => {
    queue.start();
    return () => queue.dispose();
  }, [queue]);

  const reset = () => {
    const flat = { bass: 0, mid: 0, treble: 0 };
    writingRef.current = true;
    setValue(flat);
    queue.enqueue(flat);
    void queue.flush();
  };

  return (
    <section className={section} aria-labelledby="eq-title">
      <div className={sectionHeaderRow}>
        <h2 className={sectionTitle} id="eq-title">
          Equalizer
        </h2>
        <button className={textButton} type="button" onClick={reset}>
          Reset
        </button>
      </div>
      <div className={`${group} flex justify-around px-4 py-6`}>
        {snapshot.capabilities.equalizer.map((band) => {
          const current = value[band.id as keyof EqValue] ?? 0;
          return (
            <label className="flex flex-col items-center gap-3" key={band.id}>
              <output className="text-[17px] font-semibold tabular-nums">
                {current > 0 ? `+${current}` : current}
              </output>
              <Slider
                vertical
                aria-label={`${band.label} equalizer`}
                min={band.minimum}
                max={band.maximum}
                step={band.step}
                value={current}
                onChange={(event) => {
                  const next = {
                    ...value,
                    [band.id]: Number(event.currentTarget.value),
                  } as EqValue;
                  writingRef.current = true;
                  setValue(next);
                  queue.enqueue(next);
                }}
                onPointerUp={() => void queue.flush()}
                onKeyUp={() => void queue.flush()}
              />
              <span className="text-[13px] text-muted">{band.label}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
