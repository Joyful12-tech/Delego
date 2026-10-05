/**
 * Main-thread handle on the dedicated session-signing worker.
 *
 * The ephemeral signing key itself never leaves the worker's isolated memory;
 * all this module can do is ask the worker to wipe it, which is what happens
 * when the session ends or the page is being torn down.
 */
import type { SessionKeyWorkerMessage } from "../sessionKeys";

/** The worker owned by `SessionKeyWorkerProvider`, when one is running. */
let activeWorker: Worker | null = null;

/** Registers the app-wide worker so it can be wiped on session end. */
export function setSessionKeyWorker(worker: Worker | null): void {
  activeWorker = worker;
}

/**
 * Wipes the ephemeral signing key. Safe to call when no worker is running —
 * a missing worker simply means there is nothing left to wipe.
 */
export function clearSessionKey(): void {
  const worker = activeWorker;
  if (!worker) return;

  const message: SessionKeyWorkerMessage = { type: "CLEAR_KEY" };
  worker.postMessage(message);
  worker.terminate();
  setSessionKeyWorker(null);
}