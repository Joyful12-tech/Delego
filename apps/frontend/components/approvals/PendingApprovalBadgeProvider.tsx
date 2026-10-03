"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PendingApprovalItem } from "@delegolabs/types";
import {
  adaptOrders,
  type ListOrdersResponse,
} from "@delegolabs/api-generated";
import { api } from "../../lib/api";
import {
  derivePendingApprovalItems,
  pendingApprovalBadgeCount,
} from "../../lib/multiSigApprovals";

/**
 * Shared source for the navigation's pending-approval badge (#780).
 *
 * The badge lives in the app shell, outside any page that fetches orders, so
 * this provider owns the one fetch both nav variants read. Pages that already
 * hold the order list call `refresh()` after acting on a request so the badge
 * drops the item they just cleared without waiting for the next poll.
 *
 * Polling is deliberately slow (a minute) — the badge is a "come look at this"
 * signal, not a live counter — and any failure is non-fatal: the badge simply
 * keeps its last value.
 */

const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** How often the expiry-driven count is recomputed, independent of fetching. */
const RECOUNT_INTERVAL_MS = 60_000;

export interface PendingApprovalBadgeValue {
  /** Requests still open for a signature — what the nav badge shows. */
  count: number;
  items: PendingApprovalItem[];
  loading: boolean;
  /** Re-fetch immediately, e.g. right after the viewer signs something. */
  refresh: () => void;
}

/**
 * Defaults to an empty queue rather than throwing so nav components stay
 * renderable on their own (in tests, Storybook, or before the provider mounts).
 */
const EMPTY_BADGE_VALUE: PendingApprovalBadgeValue = {
  count: 0,
  items: [],
  loading: false,
  refresh: () => {},
};

const PendingApprovalBadgeContext =
  createContext<PendingApprovalBadgeValue>(EMPTY_BADGE_VALUE);

export interface PendingApprovalBadgeProviderProps {
  children: ReactNode;
  /** Order fetch cadence; override in tests to disable real timers. */
  pollIntervalMs?: number;
}

export function PendingApprovalBadgeProvider({
  children,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: PendingApprovalBadgeProviderProps) {
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = (await api.getOrders({ signal })) as ListOrdersResponse;
      if (signal?.aborted) return;
      if (res.error || !Array.isArray(res.data)) return;
      setItems(derivePendingApprovalItems(adaptOrders(res.data)));
    } catch {
      // Non-fatal: the badge keeps its previous value.
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(
      () => load(controller.signal),
      pollIntervalMs
    );
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load, pollIntervalMs]);

  // Re-derive the count on its own tick so rows that lapse while the tab sits
  // open fall out of the badge without waiting on the next fetch.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), RECOUNT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const value = useMemo<PendingApprovalBadgeValue>(
    () => ({
      count: pendingApprovalBadgeCount(items, now),
      items,
      loading,
      refresh,
    }),
    [items, now, loading, refresh]
  );

  return (
    <PendingApprovalBadgeContext.Provider value={value}>
      {children}
    </PendingApprovalBadgeContext.Provider>
  );
}

/** Reads the pending-approval count. Safe to call outside the provider. */
export function usePendingApprovalBadge(): PendingApprovalBadgeValue {
  return useContext(PendingApprovalBadgeContext);
}