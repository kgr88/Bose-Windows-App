import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "./api";
import {
  isApiError,
  PROTOCOL_VERSION,
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
import { iconButton, input, secondaryButton } from "./styles/ui";

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
      label: "Equalizer",
      show: Boolean(snapshot?.capabilities.equalizer.length),
    },
    {
      id: "profiles",
      label: "Profiles",
      show: Boolean(snapshot?.capabilities.profiles),
    },
    { id: "settings", label: "Settings", show: true },
    { id: "diagnostics", label: "Diagnostics", show: true },
  ];

  return (
    <main className="mx-auto w-full max-w-[900px] px-7 pt-6 pb-8 max-[600px]:p-[18px]">
      <header className="flex items-center justify-between gap-3.5 max-[600px]:items-start">
        <div>
          <p className="mb-1 text-[11px] font-bold tracking-[0.09em] text-muted uppercase">
            BMAP device controls
          </p>
          <h1 className="mr-2.5 inline text-[25px] leading-[1.2] font-bold">
            {snapshot?.identity?.name ?? "Bose Windows App"}
          </h1>
          {snapshot?.battery && (
            <span
              className="whitespace-nowrap text-[13px] text-muted"
              aria-label={`Battery ${snapshot.battery.percent} percent`}
            >
              {snapshot.battery.percent}% battery
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3.5 self-start max-[600px]:flex-col max-[600px]:items-end">
          <StatusPill state={state.connection} />
          <label>
            <span className="sr-only">Color theme</span>
            <select
              className={`${input} min-h-[29px] py-[3px] text-xs`}
              aria-label="Color theme"
              value={theme}
              onChange={(event) =>
                setTheme(parseTheme(event.currentTarget.value))
              }
            >
              <option value="system">System theme</option>
              <option value="light">Light theme</option>
              <option value="dark">Dark theme</option>
            </select>
          </label>
        </div>
      </header>
      {error && (
        <div
          className="mt-[18px] flex items-center gap-2.5 border-l-[3px] border-danger bg-danger/9 px-3 py-2.5 text-danger"
          role="alert"
        >
          <strong>{error.code}</strong>
          <span className="flex-1">{error.message}</span>
          <button
            className={`${secondaryButton} ${iconButton}`}
            aria-label="Dismiss error"
            onClick={() => setLocalError(null)}
          >
            ×
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
            className="mt-5 flex gap-[5px] overflow-x-auto rounded-[9px] border border-border bg-surface p-[3px] forced-colors:border-[CanvasText]"
            aria-label="Device controls"
          >
            {pages
              .filter((item) => item.show)
              .map((item) => (
                <button
                  type="button"
                  className={`${page === item.id ? "border-accent bg-accent-soft text-accent" : "border-transparent bg-surface-raised text-ink"} min-h-[34px] flex-1 cursor-pointer rounded-[7px] border px-[13px] py-[7px] whitespace-nowrap disabled:cursor-default disabled:opacity-55`}
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
      <footer className="mt-[18px] text-center text-xs text-muted">
        Protocol v{PROTOCOL_VERSION} · controls are rendered from reported
        capabilities
      </footer>
    </main>
  );
}
