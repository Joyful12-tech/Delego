"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Amount, Button, Card } from "@delegolabs/ui";
import { useOrders } from "../../../hooks/useOrders";
import { useAnnounce } from "../../../hooks/useAnnounce";
import { useCurrency } from "../../../hooks/useCurrency";
import { useNow } from "../../../hooks/useNow";
import { useWallet } from "../../../hooks/useWallet";
import { useDelegations } from "../../../hooks/useDelegations";
import { useQueryParamState } from "../../../hooks/useQueryParamState";
import { MultiSigApprovalQueue } from "../../../components/approvals/MultiSigApprovalQueue";
import { usePendingApprovalBadge } from "../../../components/approvals/PendingApprovalBadgeProvider";
import {
  derivePendingApprovalItems,
  sortPendingApprovals,
  sumPendingApprovalAmounts,
  type PendingApprovalOptions,
} from "../../../lib/multiSigApprovals";
import { submitApproval } from "../../../services/approvals";

const POLL_INTERVAL_MS = 15_000;

/**
 * Multi-sig dual-control approval dashboard (#780).
 *
 * The enterprise-manager counterpart to /approvals: one queue of every
 * transaction still waiting on a secondary signature, each clearable in a
 * click. Signing goes through `submitApproval`, the same dual-control-aware
 * endpoint the per-order approval card uses, so the server stays the source of
 * truth for whether a signature counts as the first or the second one.
 *
 * The queue itself is derived from the order list (see lib/multiSigApprovals.ts)
 * rather than fetched from a dedicated multi-sig endpoint.
 */
export default function MultiSigApprovalsPage() {
  const { orders, loading, error, pendingIds, refresh } = useOrders({
    pollIntervalMs: POLL_INTERVAL_MS,
  });
  const { delegations } = useDelegations();
  const { announce } = useAnnounce();
  const { currencyId, rate } = useCurrency();
  const { address: walletAddress } = useWallet();
  const { refresh: refreshBadge } = usePendingApprovalBadge();
  const now = useNow();

  const [oldestFirst, setOldestFirst] = useQueryParamState<boolean>({
    key: "oldestFirst",
    defaultValue: false,
  });
  const [signingId, setSigningId] = useState<string | null>(null);

  // Label each row with the requesting agent rather than a raw delegation id.
  const agentLabelByDelegationId = useMemo(() => {
    const labels = new Map<string, string>();
    for (const delegation of delegations) {
      if (delegation.agentId) {
        labels.set(delegation.id, delegation.label ?? delegation.agentId);
      }
    }
    return labels;
  }, [delegations]);

  const options: PendingApprovalOptions = useMemo(
    () => ({ agentLabelByDelegationId }),
    [agentLabelByDelegationId]
  );

  const items = useMemo(
    () =>
      sortPendingApprovals(
        derivePendingApprovalItems(orders, options),
        oldestFirst ? "desc" : "asc"
      ),
    [orders, options, oldestFirst]
  );

  const ordersById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders]
  );

  const pendingValue = useMemo(() => sumPendingApprovalAmounts(items), [items]);

  const handleApproveAndSign = useCallback(
    async (item: { orderId: string }) => {
      setSigningId(item.orderId);
      try {
        const res = await submitApproval(item.orderId, walletAddress ?? "");
        if (res.error) {
          announce(`Failed to sign request ${item.orderId}.`, "assertive");
          return;
        }
        announce(
          res.data?.dualControl?.status === "completed"
            ? `Request ${item.orderId} fully approved.`
            : `Signature recorded for request ${item.orderId} — waiting for a countersignature.`,
          "polite"
        );
        await refresh();
        // Keep the nav badge in step with the row we just cleared (#780).
        refreshBadge();
      } finally {
        setSigningId(null);
      }
    },
    [walletAddress, announce, refresh, refreshBadge]
  );

  return (
    <div className="settings-page">
      <header className="header">
        <div className="header-row">
          <div>
            <h1>Multi-sig approvals</h1>
            <p>
              Transactions that need a second signature before they can
              execute. Every one of them needs two distinct approvers.
            </p>
          </div>
          <Link href="/approvals" className="focus-visible-ring">
            All approvals
          </Link>
        </div>
      </header>

      {error && (
        <div className="settings-status error" role="alert">
          {error}
        </div>
      )}

      <div className="grid">
        <Card title="Awaiting a signature">
          <p className="stat-value stat-neutral">{items.length}</p>
          <p className="stat-label">Transactions</p>
        </Card>
        <Card title="Value on hold">
          <p className="stat-value">
            <Amount
              stroops={pendingValue}
              currency={currencyId}
              xlmUsdRate={rate?.xlmUsdRate}
            />
          </p>
          <p className="stat-label">Across the queue</p>
        </Card>
      </div>

      <div className="form-actions">
        <Button
          variant="ghost"
          onClick={() => setOldestFirst(!oldestFirst)}
          ariaLabel="Toggle sort order"
        >
          Sort: {oldestFirst ? "Oldest first" : "Expiring first"}
        </Button>
      </div>

      {loading && orders.length === 0 ? (
        <div className="card skeleton">
          <div className="skeleton-title" />
          <div className="skeleton-text" />
          <div className="skeleton-text" />
          <div className="skeleton-button" />
        </div>
      ) : (
        <MultiSigApprovalQueue
          items={items}
          ordersById={ordersById}
          signerId={walletAddress}
          now={now}
          pendingIds={
            signingId
              ? new Set([...pendingIds, signingId])
              : pendingIds
          }
          onApproveAndSign={handleApproveAndSign}
          currency={currencyId}
          xlmUsdRate={rate?.xlmUsdRate}
        />
      )}
    </div>
  );
}