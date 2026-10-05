import type {
  DualControlState,
  Order,
  PendingApprovalItem,
} from "@delegolabs/types";
import { applyFirstApproval, applySecondApproval } from "./dualControl";

/**
 * Multi-sig dual-control approval dashboard (#780).
 *
 * Enterprise team managers need one place to see every transaction still
 * waiting on a secondary signature and clear it in a click. There is no
 * dedicated multi-sig endpoint — the queue is *derived* from the orders the
 * viewer already has (same principle as deriveApprovalDecisions in
 * lib/approvals.ts), so this module stays side-effect free and unit testable
 * without a network round trip.
 *
 * The server remains the source of truth for what actually executes; these
 * helpers only decide what the dashboard shows and whether a given signer may
 * act, and they reuse the dual-control state machine from lib/dualControl.ts so
 * the two features can't drift apart.
 */

/**
 * How long a secondary-signature request stays actionable. Orders carry no
 * expiry of their own, so the window is derived from `createdAt`; override it
 * per call site via `PendingApprovalOptions.ttlMs` when the API starts issuing
 * a real deadline.
 */
export const DEFAULT_PENDING_APPROVAL_TTL_MS = 24 * 3_600_000;

/** Badge caps at "99+" so the pill stays compact next to the nav label. */
export const PENDING_APPROVAL_BADGE_MAX = 99;

/**
 * Order statuses that can still take a human signature. `pending_approval` is
 * an order waiting on its first signature; `awaiting_countersign` is one
 * waiting specifically on a *secondary* one.
 */
const AWAITING_SIGNATURE_STATUSES: ReadonlySet<string> = new Set([
  "pending_approval",
  "awaiting_countersign",
]);

/** Shown when no wallet is connected — signing is impossible. */
export const NO_WALLET_SIGNER_MESSAGE =
  "Connect your wallet to sign.";

/** Shown once the request's window has closed. */
export const EXPIRED_SIGNER_MESSAGE =
  "This request expired — ask the requester to submit it again.";

/** Shown when the reviewer has already put their own signature down. */
export const SELF_SIGN_MESSAGE =
  "You already signed this request — another approver must countersign.";

/** Shown when the reviewer isn't on the delegation's authorized signer list. */
export const UNAUTHORIZED_SIGNER_MESSAGE =
  "You're not an authorized approver for this request.";

/** Shown when the underlying order moved past the queue between renders. */
export const CLOSED_SIGNER_MESSAGE =
  "This request is no longer awaiting a signature.";

/**
 * Whether `order` still needs a signature on this dashboard: it is flagged for
 * dual control, its dual-control flow isn't complete, and its own status is
 * still open.
 */
export function isPendingSecondaryApproval(order: Order): boolean {
  const dualControl = order.dualControl;
  if (dualControl?.required !== true) return false;
  if (dualControl.status === "completed") return false;
  return AWAITING_SIGNATURE_STATUSES.has(order.status);
}

/**
 * Whether `order` has already collected its *first* signature and is now
 * waiting on the countersignature — i.e. the row's next action is genuinely
 * the secondary one.
 */
export function isAwaitingSecondarySignature(order: Order): boolean {
  const dualControl = order.dualControl;
  return (
    dualControl?.status === "awaiting_countersign" &&
    Boolean(dualControl.firstApproval)
  );
}

export interface PendingApprovalOptions {
  /** Window a request stays signable for, measured from `createdAt`. */
  ttlMs?: number;
  /**
   * delegationId → human label for the requesting agent, e.g. built from
   * `useDelegations()`. Falls back to the raw delegation id when absent.
   */
  agentLabelByDelegationId?: ReadonlyMap<string, string>;
}

/**
 * Flattens an order into a queue row, or returns `null` when the order isn't
 * awaiting a signature.
 */
export function toPendingApprovalItem(
  order: Order,
  options: PendingApprovalOptions = {}
): PendingApprovalItem | null {
  if (!isPendingSecondaryApproval(order)) return null;

  const { ttlMs = DEFAULT_PENDING_APPROVAL_TTL_MS, agentLabelByDelegationId } =
    options;

  return {
    orderId: order.id,
    requestedBy:
      agentLabelByDelegationId?.get(order.delegationId) ?? order.delegationId,
    amountStroops: BigInt(order.totalStroops ?? 0n),
    recipient: order.merchantId ?? order.merchantName ?? order.id,
    expiresAt: new Date(new Date(order.createdAt).getTime() + ttlMs),
  };
}

/**
 * Sorts by deadline, soonest first by default. Ties break on `orderId` so the
 * ordering is stable across re-renders rather than depending on the input
 * array's incidental order.
 */
export function sortPendingApprovals(
  items: PendingApprovalItem[],
  direction: "asc" | "desc" = "asc"
): PendingApprovalItem[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const delta = (a.expiresAt.getTime() - b.expiresAt.getTime()) * factor;
    if (delta !== 0) return delta;
    return a.orderId.localeCompare(b.orderId) * factor;
  });
}

/** Derives the full pending queue from a list of orders, soonest expiry first. */
export function derivePendingApprovalItems(
  orders: Order[],
  options: PendingApprovalOptions = {}
): PendingApprovalItem[] {
  const items = orders
    .map((order) => toPendingApprovalItem(order, options))
    .filter((item): item is PendingApprovalItem => item !== null);
  return sortPendingApprovals(items);
}

/** Whether the request's window has closed. At the exact deadline it has. */
export function isPendingApprovalExpired(
  item: PendingApprovalItem,
  now: Date = new Date()
): boolean {
  return item.expiresAt.getTime() <= now.getTime();
}

/** Milliseconds left before the request expires, floored at zero. */
export function pendingApprovalRemainingMs(
  item: PendingApprovalItem,
  now: Date = new Date()
): number {
  return Math.max(0, item.expiresAt.getTime() - now.getTime());
}

/** Countdown label for a queue row: "Expired", "Expires in 45m", "Expires in 3h". */
export function formatPendingApprovalExpiry(
  item: PendingApprovalItem,
  now: Date = new Date()
): string {
  const remainingMs = item.expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return "Expired";

  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 1) return "Expires in under a minute";
  if (minutes < 60) return `Expires in ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Expires in ${hours}h`;

  return `Expires in ${Math.floor(hours / 24)}d`;
}

/**
 * How many requests the nav badge should show. Expired rows are excluded —
 * they can no longer be signed, so nagging about them would be noise.
 */
export function pendingApprovalBadgeCount(
  items: PendingApprovalItem[],
  now: Date = new Date()
): number {
  return items.filter((item) => !isPendingApprovalExpired(item, now)).length;
}

/**
 * Formats the badge count, capping at "99+". Returns `null` when there is
 * nothing pending so the caller can hide the badge entirely.
 */
export function formatPendingApprovalBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  return whole > PENDING_APPROVAL_BADGE_MAX
    ? `${PENDING_APPROVAL_BADGE_MAX}+`
    : String(whole);
}

/** Total stroops held up across the queue, for the dashboard summary card. */
export function sumPendingApprovalAmounts(
  items: PendingApprovalItem[]
): bigint {
  return items.reduce((sum, item) => sum + item.amountStroops, 0n);
}

export interface ApproveAndSignCheck {
  allowed: boolean;
  reason?: string;
}

/** Whether `signerId` already appears in either recorded signature. */
export function hasSignedRequest(order: Order, signerId: string): boolean {
  const dualControl = order.dualControl;
  if (!dualControl) return false;
  return (
    dualControl.firstApproval?.approverId === signerId ||
    dualControl.secondApproval?.approverId === signerId
  );
}

/**
 * Whether the connected signer may run the 1-click approve-and-sign action on
 * this row right now:
 * - a wallet has to be connected,
 * - the request must not have expired,
 * - the underlying order must still be awaiting a signature,
 * - the signer must not have signed already (dual control means two *distinct*
 *   people, so the first approver can never be the second), and
 * - when the delegation carries an authorized-signer list, the signer must be
 *   on it.
 */
export function canApproveAndSign(
  item: PendingApprovalItem,
  order: Order | null,
  signerId: string | null,
  now: Date = new Date()
): ApproveAndSignCheck {
  if (!signerId) return { allowed: false, reason: NO_WALLET_SIGNER_MESSAGE };
  if (isPendingApprovalExpired(item, now)) {
    return { allowed: false, reason: EXPIRED_SIGNER_MESSAGE };
  }
  if (!order || !isPendingSecondaryApproval(order)) {
    return { allowed: false, reason: CLOSED_SIGNER_MESSAGE };
  }
  if (hasSignedRequest(order, signerId)) {
    return { allowed: false, reason: SELF_SIGN_MESSAGE };
  }

  const owners = order.dualControl?.delegationOwners ?? [];
  if (owners.length > 0 && !owners.includes(signerId)) {
    return { allowed: false, reason: UNAUTHORIZED_SIGNER_MESSAGE };
  }

  return { allowed: true };
}

/**
 * The dual-control state after the signer acts. Delegates to the shared state
 * machine in lib/dualControl.ts: an order with no signature yet records the
 * first approval (still awaiting a countersignature), while one already holding
 * a first approval is completed by the second.
 */
export function applyApproveAndSign(
  order: Order,
  signerId: string,
  signerAddress: string | undefined,
  timestamp: string
): DualControlState {
  const dualControl: DualControlState = order.dualControl ?? {
    required: true,
    status: "single",
  };

  if (isAwaitingSecondarySignature(order)) {
    return applySecondApproval(dualControl, signerId, signerAddress, timestamp);
  }
  return applyFirstApproval(
    signerId,
    signerAddress,
    timestamp,
    dualControl.delegationOwners ?? []
  );
}