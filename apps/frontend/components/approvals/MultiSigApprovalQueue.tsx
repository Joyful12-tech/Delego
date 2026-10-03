"use client";

import { Amount, Badge, Button, Card } from "@delegolabs/ui";
import type { Order, PendingApprovalItem } from "@delegolabs/types";
import {
  canApproveAndSign,
  formatPendingApprovalExpiry,
  isAwaitingSecondarySignature,
  isPendingApprovalExpired,
} from "../../lib/multiSigApprovals";

export interface MultiSigApprovalQueueProps {
  /** Queue rows, already filtered to orders awaiting a signature. */
  items: PendingApprovalItem[];
  /**
   * The underlying orders keyed by id — they carry the dual-control state the
   * signing rules are evaluated against. An id missing from the map renders
   * its row as un-signable rather than throwing.
   */
  ordersById: ReadonlyMap<string, Order>;
  /** Connected wallet address of whoever is reviewing the queue. */
  signerId: string | null;
  /** Clock used for expiry checks. Pass a ticking `useNow()` value to keep countdowns live. */
  now: Date;
  /** Order ids with an in-flight approve/sign mutation. */
  pendingIds?: ReadonlySet<string>;
  /** Fires the 1-click approve-and-sign action for one row. */
  onApproveAndSign: (item: PendingApprovalItem) => void | Promise<unknown>;
  /** Display currency for amounts, matching the app's preference. */
  currency?: "XLM" | "USD" | "USDC_ESTIMATE";
  /** USD value of 1 XLM, used only by the estimate currency modes. */
  xlmUsdRate?: number;
}

/**
 * Pending approval queue for the multi-sig dual-control dashboard (#780).
 *
 * Each row is one transaction still waiting on a signature, with a single
 * "Approve & sign" action. Whether that action is available — and why not when
 * it isn't — comes from `canApproveAndSign`, so the disabled states a manager
 * sees are explained rather than silent. All rules live in
 * lib/multiSigApprovals.ts; this component only renders them.
 */
export function MultiSigApprovalQueue({
  items,
  ordersById,
  signerId,
  now,
  pendingIds,
  onApproveAndSign,
  currency,
  xlmUsdRate,
}: MultiSigApprovalQueueProps) {
  if (items.length === 0) {
    return (
      <Card ariaLabel="Pending approvals">
        <p>No transactions are waiting on a secondary signature.</p>
      </Card>
    );
  }

  return (
    <ul
      className="multi-sig-queue"
      aria-label="Transactions awaiting a signature"
    >
      {items.map((item) => {
        const order = ordersById.get(item.orderId) ?? null;
        const check = canApproveAndSign(item, order, signerId, now);
        const expired = isPendingApprovalExpired(item, now);
        const inFlight = pendingIds?.has(item.orderId) ?? false;
        const disabled = !check.allowed || inFlight;
        const awaitingCountersign = order
          ? isAwaitingSecondarySignature(order)
          : false;

        return (
          <li key={item.orderId} className="multi-sig-queue-item">
            <Card
              title={`Request #${item.orderId}`}
              ariaLabel={`Signature request ${item.orderId}`}
            >
              <div className="approval-card-badges">
                <Badge tone={awaitingCountersign ? "warning" : "info"}>
                  {awaitingCountersign
                    ? "Countersignature needed"
                    : "First signature needed"}
                </Badge>
                <Badge tone={expired ? "error" : "neutral"}>
                  {formatPendingApprovalExpiry(item, now)}
                </Badge>
                {inFlight && <Badge tone="info">Signing…</Badge>}
              </div>

              <dl className="wallet-detail-list">
                <div className="wallet-detail-row">
                  <dt>Requested by</dt>
                  <dd>{item.requestedBy}</dd>
                </div>
                <div className="wallet-detail-row">
                  <dt>Recipient</dt>
                  <dd>{item.recipient}</dd>
                </div>
                <div className="wallet-detail-row">
                  <dt>Amount</dt>
                  <dd>
                    <Amount
                      stroops={item.amountStroops}
                      currency={currency}
                      xlmUsdRate={xlmUsdRate}
                    />
                  </dd>
                </div>
                <div className="wallet-detail-row">
                  <dt>Order</dt>
                  <dd>{item.orderId}</dd>
                </div>
              </dl>

              <div className="multi-sig-queue-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onApproveAndSign(item)}
                  disabled={disabled}
                  loading={inFlight}
                  title={check.reason}
                  ariaLabel={`Approve and sign request ${item.orderId}`}
                >
                  Approve &amp; sign
                </Button>
                {!check.allowed && check.reason && (
                  <span className="stat-label">{check.reason}</span>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}