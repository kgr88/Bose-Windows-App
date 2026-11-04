import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "./api";
import {
  isApiError,
  type ApiError,
  type ConnectionTarget,
  type DeviceSnapshot,
  type DiscoveredDevice,
} from "./contracts";
import { StatusPill } from "./components/StatusPill";
import { ConnectionPage } from "./pages/ConnectionPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { EqualizerPage } from "./pages/EqualizerPage";
import { HomePage } from "./pages/HomePage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { initialDeviceState, reduceDeviceEvent } from "./state/deviceState";
import { durableConnectionTarget } from "./state/connectionTarget";
import { friendlyError } from "./errorMessages";
import { segment, segmentedControl, textButton } from "./styles/ui";

type Page = "home" | "equalizer" | "profiles" | "settings" | "diagnostics";

function asApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

type Theme = "system" | "light" | "dark";

function parseTheme(value: string | null): Theme {
  return value === "light" ? "light" : value === "dark" ? "dark" : "system";
}

// Flip what is shown. Going back to the system look returns to "system", so
// every click makes a visible change.
function toggledTheme(theme: Theme): Theme {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shownDark = theme === "dark" || (theme === "system" && systemDark);
  return shownDark === !systemDark ? "system" : shownDark ? "light" : "dark";
}

export default function App() {
  const [state, dispatch] = useReducer(reduceDeviceEvent, initialDeviceState);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<ApiError | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [theme, setTheme] = useState<Theme>(() =>
    parseTheme(localStorage.getItem("bose-windows-app-theme")),
  );
  const refreshing = useRef(false);
  const lastTarget = useRef<ConnectionTarget | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectScheduled = useRef(false);

  const reportError = useCallback(
    (error: unknown) => setLocalError(asApiError(error)),
    [],
  );
  const acceptSnapshot = useCallback(
    (snapshot: DeviceSnapshot) =>
      dispatch({ event: "snapshot_changed", data: snapshot }),
    [],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (theme === "system") localStorage.removeItem("bose-windows-app-theme");
    else localStorage.setItem("bose-windows-app-theme", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void api
      .subscribe(dispatch)
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: unknown) => {
        if (active) reportError(error);
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [reportError]);

  useEffect(() => {
    let active = true;
    void api
      .currentSnapshot()
      .then((restored) => {
        if (!active || !restored) return;
        const identity = restored.identity;
        if (identity?.address) {
          lastTarget.current = {
            kind: "manual",
            address: identity.address,
            device_type: identity.device_type,
          };
        }
        acceptSnapshot(restored);
      })
      .catch((error: unknown) => {
        if (active) reportError(error);
      });
    return () => {
      active = false;
    };
  }, [acceptSnapshot, reportError]);

  const refresh = useCallback(
    async (visibleBusy = true) => {
      if (refreshing.current) return;
      refreshing.current = true;
      if (visibleBusy) setBusy(true);
      try {
        acceptSnapshot(await api.refresh());
        setLocalError(null);
      } catch (error) {
        reportError(error);
      } finally {
        refreshing.current = false;
        if (visibleBusy) setBusy(false);
      }
    },
    [acceptSnapshot, reportError],
  );

  const generation = state.snapshot?.generation;
  useEffect(() => {
    if (state.connection !== "connected" || generation === undefined) return;
    let pollCount = 0;
    const poll = async (includeBattery = false) => {
      if (document.visibilityState !== "visible" || refreshing.current) return;
      refreshing.current = true;
      try {
        acceptSnapshot(
          await api.poll(
            generation,
            includeBattery ? ["noise_control", "battery"] : ["noise_control"],
          ),
        );
        setLocalError(null);
      } catch (error) {
        reportError(error);
      } finally {
        refreshing.current = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      pollCount += 1;
      void poll(pollCount % 6 === 0);
    }, 8_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [state.connection, generation, acceptSnapshot, reportError]);

  useEffect(() => {
    const error = localError ?? state.error;
    if (
      state.connection !== "error" ||
      !error?.retryable ||
      !lastTarget.current ||
      reconnectAttempts.current >= 3 ||
      reconnectScheduled.current
    )
      return;
    reconnectScheduled.current = true;
    const delay = 1_000 * 2 ** reconnectAttempts.current;
    const timer = window.setTimeout(() => {
      reconnectScheduled.current = false;
      reconnectAttempts.current += 1;
      const target = lastTarget.current;
      if (!target) return;
      dispatch({ event: "session_reset" });
      dispatch({
        event: "connection_changed",
        data: {
          state: "reconnecting",
          generation: 0,
          revision: 0,
          reason: "retrying",
        },
      });
      void api
        .connect(target)
        .then((next) => {
          reconnectAttempts.current = 0;
          setLocalError(null);
          acceptSnapshot(next);
        })
        .catch((failure) => {
          reportError(failure);
          dispatch({
            event: "connection_changed",
            data: {
              state: "error",
              generation: state.snapshot?.generation ?? 0,
              revision: (state.snapshot?.revision ?? 0) + 2,
              reason: "reconnect_failed",
            },
          });
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      reconnectScheduled.current = false;
    };
  }, [
    state.connection,
    state.error,
    localError,
    state.snapshot,
    acceptSnapshot,
    reportError,
  ]);

  async function discover() {
    setBusy(true);
    setLocalError(null);
    try {
      setDevices(await api.discover());
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }
  async function connect(target: ConnectionTarget) {
    const durableTarget = durableConnectionTarget(target, devices);
    if (durableTarget.kind === "manual") lastTarget.current = durableTarget;
    reconnectAttempts.current = 0;
    dispatch({ event: "session_reset" });
    setBusy(true);
    setLocalError(null);
    try {
      acceptSnapshot(await api.connect(durableTarget));
      setPage("home");
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    lastTarget.current = null;
    reconnectAttempts.current = 0;
    try {
      await api.disconnect();
      dispatch({ event: "session_reset" });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }
  const snapshot = state.snapshot;
  const connected =
    state.connection === "connected" &&
    snapshot?.connection.state === "connected";
  const error = localError ?? state.error;
  const pages: { id: Page; label: string; show: boolean }[] = [
    { id: "home", label: "Home", show: true },
    {
      id: "equalizer",
      label: "Sound",
      show: Boolean(snapshot?.capabilities.equalizer.length),
    },
    {
      id: "profiles",
      label: "Modes",
      show: Boolean(snapshot?.capabilities.profiles),
    },
    { id: "settings", label: "Settings", show: true },
    { id: "diagnostics", label: "About", show: true },
  ];
  const visiblePages = pages.filter((item) => item.show);
  const themeLabels: Record<Theme, string> = {
    system: "Automatic",
    light: "Light",
    dark: "Dark",
  };

  return (
    <main className="mx-auto w-full max-w-[760px] px-7 pt-8 pb-10 max-[600px]:px-4 max-[600px]:pt-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[32px] leading-tight font-bold tracking-[-0.02em]">
            {connected || state.connection === "reconnecting"
              ? (snapshot?.identity?.name ?? "Headphones")
              : "Welcome"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusPill state={state.connection} />
            {connected &&
              snapshot.battery &&
              snapshot.battery.left_percent == null &&
              snapshot.battery.right_percent == null && (
                <Battery
                  percent={snapshot.battery.percent}
                  charging={snapshot.battery.charging}
                />
              )}
            {connected && snapshot.battery?.left_percent != null && (
              <Battery
                label="Left"
                percent={snapshot.battery.left_percent}
                charging={null}
              />
            )}
            {connected && snapshot.battery?.right_percent != null && (
              <Battery
                label="Right"
                percent={snapshot.battery.right_percent}
                charging={null}
              />
            )}
            {connected && snapshot.battery?.case_percent != null && (
              <Battery
                label="Case"
                percent={snapshot.battery.case_percent}
                charging={null}
              />
            )}
          </div>
        </div>
        <button
          type="button"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-fill text-ink hover:opacity-80"
          aria-label={`Appearance: ${themeLabels[theme]}`}
          title={`Appearance: ${themeLabels[theme]}`}
          onClick={() => setTheme(toggledTheme(theme))}
        >
          <ThemeIcon theme={theme} />
        </button>
      </header>
      {error && (
        <div
          className="mt-6 flex items-start gap-3 rounded-[14px] bg-surface px-4 py-3 shadow-card"
          role="alert"
        >
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full bg-danger text-[13px] font-bold text-white"
          >
            !
          </span>
          <span className="min-w-0 flex-1">
            {friendlyError(error)}
            <details className="mt-1 text-[13px] text-muted">
              <summary className="w-fit cursor-pointer">Details</summary>
              <span className="mt-1 block [overflow-wrap:anywhere]">
                {error.code}: {error.message}
              </span>
            </details>
          </span>
          <button
            type="button"
            className={textButton}
            aria-label="Dismiss message"
            onClick={() => setLocalError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {!connected ? (
        <ConnectionPage
          devices={devices}
          busy={busy}
          state={state.connection}
          onDiscover={() => void discover()}
          onConnect={(device) =>
            void connect({ kind: "discovered", device_id: device.device_id })
          }
          onManualConnect={(target) => void connect(target)}
        />
      ) : (
        <>
          <nav
            className={`${segmentedControl} mt-6 overflow-x-auto rounded-[10px] forced-colors:border forced-colors:border-[CanvasText]`}
            aria-label="Sections"
          >
            {visiblePages.map((item) => (
              <button
                type="button"
                className={`${segment(page === item.id)} min-h-8 rounded-[8px] py-1 text-[13px]`}
                aria-current={page === item.id ? "page" : undefined}
                key={item.id}
                onClick={() => setPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          {page === "home" && (
            <HomePage
              snapshot={snapshot}
              onSnapshot={acceptSnapshot}
              onError={reportError}
            />
          )}
          {page === "equalizer" &&
            snapshot.capabilities.equalizer.length > 0 && (
              <EqualizerPage
                snapshot={snapshot}
                onSnapshot={acceptSnapshot}
                onError={reportError}
              />
            )}
          {page === "profiles" && snapshot.capabilities.profiles && (
            <ProfilesPage
              snapshot={snapshot}
              onSnapshot={acceptSnapshot}
              onError={reportError}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              snapshot={snapshot}
              onSnapshot={acceptSnapshot}
              onError={reportError}
            />
          )}
          {page === "diagnostics" && (
            <DiagnosticsPage
              snapshot={snapshot}
              busy={busy}
              onRefresh={() => void refresh()}
              onDisconnect={() => void disconnect()}
            />
          )}
        </>
      )}
    </main>
  );
}

function Battery({
  label,
  percent,
  charging,
}: {
  label?: string;
  percent: number;
  charging: boolean | null;
}) {
  const color = charging
    ? "bg-success"
    : percent <= 20
      ? "bg-danger"
      : "bg-ink";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[13px] text-muted"
      aria-label={`${label ? `${label} battery` : "Battery"} ${percent} percent${charging ? ", charging" : ""}`}
    >
      {label}
      <span
        aria-hidden="true"
        className="relative flex h-[11px] w-[22px] rounded-[3px] border border-muted p-px after:absolute after:top-[3px] after:-right-[3px] after:h-[3px] after:w-[1.5px] after:rounded-r-sm after:bg-muted"
      >
        <span
          className={`rounded-[1.5px] ${color}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      {percent}%{charging && " · Charging"}
    </span>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    "aria-hidden": true,
  };
  if (theme === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </svg>
  );
}
