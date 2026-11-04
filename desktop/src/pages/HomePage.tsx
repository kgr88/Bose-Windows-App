import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { DeviceSnapshot } from "../contracts";
import { LatestWriteQueue } from "../state/latestWrite";
import { Slider } from "../components/Controls";
import {
  group,
  section,
  sectionHeader,
  segment,
  segmentedControl,
} from "../styles/ui";

interface Props {
  snapshot: DeviceSnapshot;
  onSnapshot: (snapshot: DeviceSnapshot) => void;
  onError: (error: unknown) => void;
}

export function HomePage({ snapshot, onSnapshot, onError }: Props) {
  const capability = snapshot.capabilities.noise_control;
  const rawValue = snapshot.values.noise_control?.value ?? 0;
  const deviceValue: number | string =
    typeof rawValue === "boolean" ? Number(rawValue) : rawValue;
  const authoritative =
    capability?.kind === "cnc" &&
    capability.range &&
    typeof deviceValue === "number"
      ? capability.range.minimum + capability.range.maximum - deviceValue
      : deviceValue;
  const authoritativeRef = useRef(authoritative);
  authoritativeRef.current = authoritative;
  const writingRef = useRef(false);
  const [value, setValue] = useState<number | string>(authoritative);
  useEffect(() => {
    if (!writingRef.current) setValue(authoritative);
  }, [authoritative, snapshot.generation]);

  const queue = useMemo(
    () =>
      new LatestWriteQueue<number | string, DeviceSnapshot>(
        (next) =>
          api.setNoiseControl({
            generation: snapshot.generation,
            kind: capability?.kind ?? "cnc",
            value:
              capability?.kind === "cnc" &&
              capability.range &&
              typeof next === "number"
                ? capability.range.minimum + capability.range.maximum - next
                : next,
          }),
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
    [snapshot.generation, capability?.kind, onSnapshot, onError],
  );
  useEffect(() => {
    queue.start();
    return () => queue.dispose();
  }, [queue]);

  if (!capability) {
    return (
      <section className={section}>
        <div className={`${group} px-4 py-6 text-center text-muted`}>
          Noise control isn’t available on these headphones.
        </div>
      </section>
    );
  }
  const range = capability.range;
  return (
    <section className={section} aria-labelledby="noise-title">
      <h2 className={sectionHeader} id="noise-title">
        Noise Control
      </h2>
      {range ? (
        <div className={`${group} px-5 pt-5 pb-4`}>
          <div className="flex items-baseline justify-between">
            <span className="text-[17px] font-semibold">
              Noise Cancellation
            </span>
            <output className="text-[28px] font-semibold tabular-nums text-accent">
              {String(value)}
            </output>
          </div>
          <Slider
            className="mt-3"
            aria-label="Noise cancellation strength"
            min={range.minimum}
            max={range.maximum}
            step={range.step}
            value={Number(value)}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              writingRef.current = true;
              setValue(next);
              queue.enqueue(next);
            }}
            onPointerUp={() => void queue.flush()}
            onKeyUp={() => void queue.flush()}
          />
          <span className="mt-1 flex justify-between text-[13px] text-muted">
            <span>Aware</span>
            <span>Quiet</span>
          </span>
        </div>
      ) : (
        <div
          className={`${segmentedControl} rounded-[12px]`}
          role="group"
          aria-label="Noise control mode"
        >
          {capability.options.map((option) => (
            <button
              className={`${segment(value === option.value)} min-h-10 min-w-20 rounded-[10px]`}
              type="button"
              aria-pressed={value === option.value}
              key={option.value}
              onClick={() => {
                writingRef.current = true;
                setValue(option.value);
                queue.enqueue(option.value);
                void queue.flush();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
