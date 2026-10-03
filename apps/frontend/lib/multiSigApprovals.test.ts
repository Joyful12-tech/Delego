import { describe, expect, it } from "vitest";
import type { DualControlState, Order, PendingApprovalItem } from "@delegolabs/types";
import {
  CLOSED_SIGNER_MESSAGE,
  DEFAULT_PENDING_APPROVAL_TTL_MS,
  EXPIRED_SIGNER_MESSAGE,
  NO_WALLET_SIGNER_MESSAGE,
  PENDING_APPROVAL_BADGE_MAX,
  SELF_SIGN_MESSAGE,
  UNAUTHORIZED_SIGNER_MESSAGE,
  applyApproveAndSign,
  canApproveAndSign,
  derivePendingApprovalItems,
  formatPendingApprovalBadgeCount,
  formatPendingApprovalExpiry,
  hasSignedRequest,
  isAwaitingSecondarySignature,
  isPendingApprovalExpired,
  isPendingSecondaryApproval,
  pendingApprovalBadgeCount,
  pendingApprovalRemainingMs,
  sortPendingApprovals,
  sumPendingApprovalAmounts,
  toPendingApprovalItem,
} from "./multiSigApprovals";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const CREATED_AT = new Date("2026-09-24T06:00:00.000Z");
const ALICE = "GALICE";
const BOB = "GBOB";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "ord_1",
    delegationId: "del_1",
    merchantId: "merch_1",
    status: "pending_approval",
    totalStroops: 5_000_000_000n,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function dualControl(overrides: Partial<DualControlState> = {}): DualControlState {
  return { required: true, status: "awaiting_countersign", ...overrides };
}

function item(overrides: Partial<PendingApprovalItem> = {}): PendingApprovalItem {
  return {
    orderId: "ord_1",
    requestedBy: "Grocer",
    amountStroops: 5_000_000_000n,
    recipient: "merch_1",
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    ...overrides,
  };
}

describe("isPendingSecondaryApproval", () => {
  it("includes dual-control orders still awaiting a signature", () => {
    expect(isPendingSecondaryApproval(order({ dualControl: dualControl() }))).toBe(true);
    expect(
      isPendingSecondaryApproval(
        order({ status: "awaiting_countersign", dualControl: dualControl() })
      )
    ).toBe(true);
  });

  it("excludes orders outside dual control, completed flows, and closed statuses", () => {
    expect(isPendingSecondaryApproval(order())).toBe(false);
    expect(
      isPendingSecondaryApproval(order({ dualControl: dualControl({ required: false }) }))
    ).toBe(false);
    expect(
      isPendingSecondaryApproval(order({ dualControl: dualControl({ status: "completed" }) }))
    ).toBe(false);
    expect(
      isPendingSecondaryApproval(
        order({ status: "approved", dualControl: dualControl() })
      )
    ).toBe(false);
    expect(
      isPendingSecondaryApproval(
        order({ status: "rejected", dualControl: dualControl() })
      )
    ).toBe(false);
  });
});

describe("toPendingApprovalItem", () => {
  it("flattens an order into the spec shape, deriving expiry from createdAt", () => {
    expect(toPendingApprovalItem(order({ dualControl: dualControl() }))).toEqual({
      orderId: "ord_1",
      requestedBy: "del_1",
      amountStroops: 5_000_000_000n,
      recipient: "merch_1",
      expiresAt: new Date(CREATED_AT.getTime() + DEFAULT_PENDING_APPROVAL_TTL_MS),
    });
  });

  it("prefers the resolved agent label over the raw delegation id", () => {
    const result = toPendingApprovalItem(order({ dualControl: dualControl() }), {
      agentLabelByDelegationId: new Map([["del_1", "Weekly shopper"]]),
    });
    expect(result?.requestedBy).toBe("Weekly shopper");
  });

  it("honours a custom ttl and falls back to the order id when there is no merchant", () => {
    const result = toPendingApprovalItem(
      order({ merchantId: undefined, dualControl: dualControl() }),
      { ttlMs: 60_000 }
    );
    expect(result?.expiresAt).toEqual(new Date(CREATED_AT.getTime() + 60_000));
    expect(result?.recipient).toBe("ord_1");
  });

  it("returns null for an order that needs no signature", () => {
    expect(toPendingApprovalItem(order())).toBeNull();
  });
});

describe("derivePendingApprovalItems", () => {
  it("keeps only signable orders and sorts them by soonest expiry", () => {
    const orders = [
      order({
        id: "ord_late",
        createdAt: new Date("2026-09-24T08:00:00.000Z"),
        dualControl: dualControl(),
      }),
      order({ id: "ord_soon", createdAt: new Date("2026-09-23T06:00:00.000Z"), dualControl: dualControl() }),
      order({ id: "ord_plain" }),
      order({ id: "ord_done", status: "approved", dualControl: dualControl() }),
    ];

    const items = derivePendingApprovalItems(orders);

    expect(items.map((i) => i.orderId)).toEqual(["ord_soon", "ord_late"]);
  });

  it("orders equal deadlines deterministically by order id", () => {
    const shared = new Date("2026-09-24T10:00:00.000Z");
    const first = item({ orderId: "ord_a", expiresAt: shared });
    const second = item({ orderId: "ord_b", expiresAt: shared });

    expect(sortPendingApprovals([second, first]).map((i) => i.orderId)).toEqual([
      "ord_a",
      "ord_b",
    ]);
    expect(sortPendingApprovals([second, first], "desc").map((i) => i.orderId)).toEqual([
      "ord_b",
      "ord_a",
    ]);
  });
});

describe("expiry helpers", () => {
  it("treats the exact deadline as expired", () => {
    expect(isPendingApprovalExpired(item({ expiresAt: NOW }), NOW)).toBe(true);
    expect(
      isPendingApprovalExpired(item({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)
    ).toBe(false);
  });

  it("floors the remaining time at zero", () => {
    expect(pendingApprovalRemainingMs(item({ expiresAt: NOW }), NOW)).toBe(0);
    expect(
      pendingApprovalRemainingMs(
        item({ expiresAt: new Date(NOW.getTime() + 90_000) }),
        NOW
      )
    ).toBe(90_000);
  });

  it("formats a countdown that steps down through minutes, hours, and days", () => {
    const at = (ms: number) =>
      formatPendingApprovalExpiry(item({ expiresAt: new Date(NOW.getTime() + ms) }), NOW);

    expect(at(-1)).toBe("Expired");
    expect(at(30_000)).toBe("Expires in under a minute");
    expect(at(45 * 60_000)).toBe("Expires in 45m");
    expect(at(5 * 3_600_000)).toBe("Expires in 5h");
    expect(at(50 * 3_600_000)).toBe("Expires in 2d");
  });
});

describe("badge counter", () => {
  it("counts only requests that can still be signed", () => {
    const items = [
      item({ orderId: "ord_1" }),
      item({ orderId: "ord_2", expiresAt: new Date(NOW.getTime() + 60_000) }),
      item({ orderId: "ord_3", expiresAt: NOW }),
    ];

    expect(pendingApprovalBadgeCount(items, NOW)).toBe(2);
  });

  it("caps the rendered count and hides the badge when there is nothing pending", () => {
    expect(formatPendingApprovalBadgeCount(0)).toBeNull();
    expect(formatPendingApprovalBadgeCount(-3)).toBeNull();
    expect(formatPendingApprovalBadgeCount(Number.NaN)).toBeNull();
    expect(formatPendingApprovalBadgeCount(3)).toBe("3");
    expect(formatPendingApprovalBadgeCount(PENDING_APPROVAL_BADGE_MAX)).toBe("99");
    expect(formatPendingApprovalBadgeCount(120)).toBe("99+");
  });
});

describe("sumPendingApprovalAmounts", () => {
  it("adds stroop amounts without losing bigint precision", () => {
    expect(
      sumPendingApprovalAmounts([
        item({ amountStroops: 9_007_199_254_740_993n }),
        item({ amountStroops: 1n }),
      ])
    ).toBe(9_007_199_254_740_994n);
  });

  it("is zero for an empty queue", () => {
    expect(sumPendingApprovalAmounts([])).toBe(0n);
  });
});

describe("hasSignedRequest", () => {
  it("matches either recorded signature", () => {
    const signed = order({
      dualControl: dualControl({
        firstApproval: { approverId: ALICE, timestamp: CREATED_AT.toISOString() },
      }),
    });
    expect(hasSignedRequest(signed, ALICE)).toBe(true);
    expect(hasSignedRequest(signed, BOB)).toBe(false);
    expect(hasSignedRequest(order(), ALICE)).toBe(false);
  });
});

describe("isAwaitingSecondarySignature", () => {
  it("is true only once a first approval is on record", () => {
    expect(isAwaitingSecondarySignature(order({ dualControl: dualControl() }))).toBe(false);
    expect(
      isAwaitingSecondarySignature(
        order({
          dualControl: dualControl({
            firstApproval: { approverId: ALICE, timestamp: CREATED_AT.toISOString() },
          }),
        })
      )
    ).toBe(true);
  });
});

describe("canApproveAndSign", () => {
  it("allows an authorized signer on a live request", () => {
    const result = canApproveAndSign(
      item(),
      order({ dualControl: dualControl() }),
      BOB,
      NOW
    );
    expect(result).toEqual({ allowed: true });
  });

  it("requires a connected wallet", () => {
    expect(canApproveAndSign(item(), order({ dualControl: dualControl() }), null, NOW)).toEqual({
      allowed: false,
      reason: NO_WALLET_SIGNER_MESSAGE,
    });
  });

  it("refuses an expired request", () => {
    const result = canApproveAndSign(
      item({ expiresAt: NOW }),
      order({ dualControl: dualControl() }),
      BOB,
      NOW
    );
    expect(result).toEqual({ allowed: false, reason: EXPIRED_SIGNER_MESSAGE });
  });

  it("never lets one person supply both signatures", () => {
    const signed = order({
      dualControl: dualControl({
        firstApproval: { approverId: BOB, timestamp: CREATED_AT.toISOString() },
      }),
    });
    expect(canApproveAndSign(item(), signed, BOB, NOW)).toEqual({
      allowed: false,
      reason: SELF_SIGN_MESSAGE,
    });
    expect(canApproveAndSign(item(), signed, ALICE, NOW)).toEqual({ allowed: true });
  });

  it("enforces the delegation's authorized signer list when one exists", () => {
    const restricted = order({
      dualControl: dualControl({ delegationOwners: [ALICE] }),
    });
    expect(canApproveAndSign(item(), restricted, BOB, NOW)).toEqual({
      allowed: false,
      reason: UNAUTHORIZED_SIGNER_MESSAGE,
    });
    expect(canApproveAndSign(item(), restricted, ALICE, NOW)).toEqual({ allowed: true });
  });

  it("refuses when the order is missing or no longer awaiting a signature", () => {
    expect(canApproveAndSign(item(), null, BOB, NOW)).toEqual({
      allowed: false,
      reason: CLOSED_SIGNER_MESSAGE,
    });
    expect(
      canApproveAndSign(item(), order({ status: "approved", dualControl: dualControl() }), BOB, NOW)
    ).toEqual({ allowed: false, reason: CLOSED_SIGNER_MESSAGE });
  });
});

describe("applyApproveAndSign", () => {
  it("records the first approval when no signature exists yet", () => {
    const state = applyApproveAndSign(
      order({ dualControl: dualControl() }),
      ALICE,
      ALICE,
      "2026-09-24T12:00:00.000Z"
    );

    expect(state.status).toBe("awaiting_countersign");
    expect(state.firstApproval?.approverId).toBe(ALICE);
    expect(state.secondApproval).toBeUndefined();
  });

  it("completes the flow when a second, different signer countersigns", () => {
    const firstSigned = order({
      dualControl: dualControl({
        firstApproval: { approverId: ALICE, timestamp: "2026-09-24T12:00:00.000Z" },
      }),
    });
    const state = applyApproveAndSign(
      firstSigned,
      BOB,
      BOB,
      "2026-09-24T13:00:00.000Z"
    );

    expect(state.status).toBe("completed");
    expect(state.secondApproval?.approverId).toBe(BOB);
    expect(state.firstApproval?.approverId).toBe(ALICE);
  });

  it("carries the authorized signer list forward and tolerates a missing dual-control block", () => {
    const restricted = applyApproveAndSign(
      order({ dualControl: dualControl({ delegationOwners: [ALICE, BOB] }) }),
      ALICE,
      ALICE,
      "2026-09-24T12:00:00.000Z"
    );
    expect(restricted.delegationOwners).toEqual([ALICE, BOB]);

    const noState = applyApproveAndSign(order(), ALICE, ALICE, "2026-09-24T12:00:00.000Z");
    expect(noState.required).toBe(true);
    expect(noState.status).toBe("awaiting_countersign");
  });
});