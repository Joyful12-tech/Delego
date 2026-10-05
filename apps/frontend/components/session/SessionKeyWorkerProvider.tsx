"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initSessionKeyWorker } from "../../lib/sessionKeys";
import { setSessionKeyWorker } from "../../lib/session/sessionKeyClient";

const SessionKeyWorkerContext = createContext<Worker | null>(null);

/**
 * Owns the app-wide ephemeral session-signing worker (#514).
 *
 * The worker keeps the raw signing key in its own isolated memory so it is
 * never reachable from the page's JavaScript. It is torn down — key wiped,
 * worker terminated — when the provider unmounts, which is what happens on a
 * full page teardown or navigation away from the app shell.
 */
export function SessionKeyWorkerProvider({ children }: { children: ReactNode }) {
  const [worker, setWorker] = useState<Worker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Worker" in window)) return;

    const instance = initSessionKeyWorker();
    setWorker(instance);
    setSessionKeyWorker(instance);

    return () => {
      setSessionKeyWorker(null);
      instance.terminate();
      setWorker(null);
    };
  }, []);

  return (
    <SessionKeyWorkerContext.Provider value={worker}>
      {children}
    </SessionKeyWorkerContext.Provider>
  );
}

/** The app-wide session-signing worker, or `null` before it has started. */
export function useSessionKeyWorker(): Worker | null {
  return useContext(SessionKeyWorkerContext);
}

export default SessionKeyWorkerProvider;