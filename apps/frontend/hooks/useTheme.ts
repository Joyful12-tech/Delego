"use client";

/**
 * useTheme — manages light/dark/system/scheduled theme modes.
 *
 * Five modes:
 *   "light"     — always light
 *   "dark"      — always dark
 *   "high-contrast" — always the high-contrast palette
 *   "system"    — follows prefers-color-scheme
 *   "scheduled" — dark between scheduleStart (hh:mm) and scheduleEnd (hh:mm)
 *                 (defaults 19:00–07:00). Evaluated on a 30-second interval
 *                 and re-evaluated on visibilitychange (wake-from-sleep).
 *
 * Bootstrap: a tiny inline <script> in the document <head> reads
 * `delego-theme-mode` from localStorage and applies `data-theme` before React
 * hydrates, preventing a flash of the wrong theme. See the exported
 * `themeBootstrapScript` string.
 *
 * Transitions: theme switches honour prefers-reduced-motion. When motion is
 * allowed a subtle crossfade is applied via a CSS class on <html>; when motion
 * is reduced the switch is instant.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type ThemeMode =
  | "light"
  | "dark"
  | "high-contrast"
  | "system"
  | "scheduled";
export type ResolvedTheme = "light" | "dark" | "high-contrast";

export interface ScheduleConfig {
  /** HH:MM (24-hour) when dark mode starts. Default: "19:00" */
  start: string;
  /** HH:MM (24-hour) when dark mode ends. Default: "07:00" */
  end: string;
}

const STORAGE_KEY_MODE = "delego-theme-mode";
const STORAGE_KEY_SCHEDULE = "delego-theme-schedule";
const CHECK_INTERVAL_MS = 30_000;

const DEFAULT_SCHEDULE: ScheduleConfig = { start: "19:00", end: "07:00" };

/** Parse "HH:MM" → minutes since midnight */
function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Returns true if the current local time falls within [startHHMM, endHHMM) range.
 *  Correctly handles overnight spans (e.g. 19:00–07:00). */
function isWithinSchedule(schedule: ScheduleConfig): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = parseTime(schedule.start);
  const end = parseTime(schedule.end);

  if (start < end) {
    // e.g. 08:00–18:00 (daytime dark)
    return currentMinutes >= start && currentMinutes < end;
  }
  // Overnight span: e.g. 19:00–07:00
  return currentMinutes >= start || currentMinutes < end;
}

function resolveTheme(
  mode: ThemeMode,
  schedule: ScheduleConfig
): ResolvedTheme {
  switch (mode) {
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "high-contrast":
      return "high-contrast";
    case "system":
      return typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    case "scheduled":
      return isWithinSchedule(schedule) ? "dark" : "light";
  }
}

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MODE);
    if (
      raw === "light" ||
      raw === "dark" ||
      raw === "high-contrast" ||
      raw === "system" ||
      raw === "scheduled"
    ) {
      return raw;
    }
  } catch {
    // localStorage unavailable (SSR / private-mode restrictions)
  }
  return "system";
}

function readStoredSchedule(): ScheduleConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCHEDULE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ScheduleConfig>;
      const start = parsed.start ?? DEFAULT_SCHEDULE.start;
      const end = parsed.end ?? DEFAULT_SCHEDULE.end;
      if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) {
        return { start, end };
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SCHEDULE;
}

function applyTheme(resolved: ResolvedTheme, withTransition: boolean): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;

  if (withTransition) {
    html.classList.add("theme-transitioning");
    // Remove transition class after the CSS transition completes
    const onEnd = () => {
      html.classList.remove("theme-transitioning");
      html.removeEventListener("transitionend", onEnd);
    };
    html.addEventListener("transitionend", onEnd, { once: true });
  }

  html.dataset.theme = resolved;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface UseThemeReturn {
  /** Currently active resolved theme. */
  resolved: ResolvedTheme;
  /** Alias of {@link resolved}, matching the ThemeProvider vocabulary. */
  resolvedTheme: ResolvedTheme;
  /** The user's selected mode. */
  mode: ThemeMode;
  /** Alias of {@link mode}, matching the ThemeProvider vocabulary. */
  theme: ThemeMode;
  /** Update the theme mode. */
  setMode: (mode: ThemeMode) => void;
  /** Alias of {@link setMode}, matching the ThemeProvider vocabulary. */
  setTheme: (mode: ThemeMode) => void;
  /** Current schedule config (only relevant when mode === "scheduled"). */
  schedule: ScheduleConfig;
  /** Update the schedule. Times must be "HH:MM" 24-hour format. */
  setSchedule: (schedule: ScheduleConfig) => void;
}

export function useTheme(): UseThemeReturn {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [schedule, setScheduleState] =
    useState<ScheduleConfig>(DEFAULT_SCHEDULE);
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined
  );

  // Initialise from localStorage on mount (client-only)
  useEffect(() => {
    const storedMode = readStoredMode();
    const storedSchedule = readStoredSchedule();
    setModeState(storedMode);
    setScheduleState(storedSchedule);
    const initial = resolveTheme(storedMode, storedSchedule);
    setResolved(initial);
    applyTheme(initial, false);
  }, []);

  // Re-evaluate whenever mode or schedule changes
  const evaluate = useCallback(
    (
      currentMode: ThemeMode,
      currentSchedule: ScheduleConfig,
      animate: boolean
    ) => {
      const next = resolveTheme(currentMode, currentSchedule);
      setResolved((prev) => {
        if (prev !== next) {
          applyTheme(next, animate && !prefersReducedMotion());
        }
        return next;
      });
    },
    []
  );

  // Interval-based re-evaluation for scheduled mode
  useEffect(() => {
    clearInterval(intervalRef.current);

    if (mode === "scheduled") {
      intervalRef.current = setInterval(() => {
        evaluate(mode, schedule, true);
      }, CHECK_INTERVAL_MS);
    }

    return () => clearInterval(intervalRef.current);
  }, [mode, schedule, evaluate]);

  // visibilitychange — re-check on wake from sleep
  useEffect(() => {
    if (mode !== "scheduled") return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        evaluate(mode, schedule, true);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [mode, schedule, evaluate]);

  // system mode: react to OS-level changes
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => evaluate(mode, schedule, true);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, schedule, evaluate]);

  const setMode = useCallback(
    (nextMode: ThemeMode) => {
      setModeState(nextMode);
      try {
        localStorage.setItem(STORAGE_KEY_MODE, nextMode);
      } catch {
        /* ignore */
      }
      evaluate(nextMode, schedule, !prefersReducedMotion());
    },
    [schedule, evaluate]
  );

  const setSchedule = useCallback(
    (nextSchedule: ScheduleConfig) => {
      setScheduleState(nextSchedule);
      try {
        localStorage.setItem(
          STORAGE_KEY_SCHEDULE,
          JSON.stringify(nextSchedule)
        );
      } catch {
        /* ignore */
      }
      if (mode === "scheduled") {
        evaluate(mode, nextSchedule, !prefersReducedMotion());
      }
    },
    [mode, evaluate]
  );

  return {
    resolved,
    resolvedTheme: resolved,
    mode,
    theme: mode,
    setMode,
    setTheme: setMode,
    schedule,
    setSchedule,
  };
}

/**
 * Inline bootstrap script — embed in <head> before any CSS to prevent FOUC.
 *
 * Reads `delego-theme-mode` from localStorage and applies `data-theme` to
 * <html> synchronously. Falls back to `system` (prefers-color-scheme) when no
 * preference is stored, and to `light` when outside a browser context.
 *
 * Usage (Next.js root layout):
 *   <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
 */
export const themeBootstrapScript = /* js */ `
(function(){
  try {
    var mode = localStorage.getItem('delego-theme-mode') || 'system';
    var resolved = 'light';
    if (mode === 'dark') {
      resolved = 'dark';
    } else if (mode === 'light') {
      resolved = 'light';
    } else if (mode === 'high-contrast') {
      resolved = 'high-contrast';
    } else if (mode === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else if (mode === 'scheduled') {
      try {
        var sched = JSON.parse(localStorage.getItem('delego-theme-schedule') || '{}');
        var start = sched.start || '19:00';
        var end = sched.end || '07:00';
        function parseT(t){ var p=t.split(':'); return (+p[0])*60+(+p[1]); }
        var now = new Date();
        var cur = now.getHours()*60+now.getMinutes();
        var s = parseT(start), e = parseT(end);
        var inRange = s < e ? (cur >= s && cur < e) : (cur >= s || cur < e);
        resolved = inRange ? 'dark' : 'light';
      } catch(e2) { resolved = 'light'; }
    }
    document.documentElement.dataset.theme = resolved;
  } catch(e) {}
})();
`.trim();
