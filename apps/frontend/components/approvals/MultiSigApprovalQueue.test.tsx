import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Order, PendingApprovalItem } from "@delegolabs/types";
import { MultiSigApprovalQueue } from "./MultiSigApprovalQueue";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const ALICE = "GALICE";
const BOB = "GBOB";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "ord_1",
    delegationId: "del_1",
    merchantId: "merch_1",
    status: "awaiting_countersign",
    totalStroops: 5_000_000_000n,
    createdAt: new Date("2026-09-24T06:00:00.000Z"),
    // Alice has already signed, so the default fixture is a row genuinely
    // waiting on a *countersignature*.
    dualControl: {
      required: true,
      status: "awaiting_countersign",
      firstApproval: { approverId: ALICE, timestamp: "2026-09-24T11:00:00.000Z" },
    },
    ...overrides,
  };
}

function item(overrides: Partial<PendingApprovalItem> = {}): PendingApprovalItem {
  return {
    orderId: "ord_1",
    requestedBy: "Weekly shopper",
    amountStroops: 5_000_000_000n,
    recipient: "merch_1",
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    ...overrides,
  };
}

function renderQueue(props: Partial<React.ComponentProps<typeof MultiSigApprovalQueue>> = {}) {
  const onApproveAndSign = vi.fn();
  const merged: React.ComponentProps<typeof MultiSigApprovalQueue> = {
    items: [item()],
    ordersById: new Map([["ord_1", order()]]),
    signerId: BOB,
    now: NOW,
    onApproveAndSign,
    ...props,
  };
  render(<MultiSigApprovalQueue {...merged} />);
  return { onApproveAndSign };
}

describe("MultiSigApprovalQueue", () => {
  it("renders one row per pending request with its requester, recipient, and amount", () => {
    renderQueue();

    expect(screen.getByText("Request #ord_1")).toBeInTheDocument();
    expect(screen.getByText("Weekly shopper")).toBeInTheDocument();
    expect(screen.getByText("merch_1")).toBeInTheDocument();
    expect(screen.getByText("500.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("Expires in 1h")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is awaiting a signature", () => {
    renderQueue({ items: [] });

    expect(
      screen.getByText("No transactions are waiting on a secondary signature.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve and sign/i })
    ).not.toBeInTheDocument();
  });

  it("labels each row by which signature it still needs", () => {
    renderQueue();

    expect(screen.getByText("Countersignature needed")).toBeInTheDocument();
  });

  it("marks a row that has no first approval yet as needing a first signature", () => {
    renderQueue({
      ordersById: new Map([
        [
          "ord_1",
          order({
            status: "pending_approval",
            dualControl: { required: true, status: "awaiting_countersign" },
          }),
        ],
      ]),
    });

    expect(screen.getByText("First signature needed")).toBeInTheDocument();
  });

  it("approves and signs in one click", async () => {
    const user = userEvent.setup();
    const { onApproveAndSign } = renderQueue();

    await user.click(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    );

    expect(onApproveAndSign).toHaveBeenCalledTimes(1);
    expect(onApproveAndSign).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "ord_1" })
    );
  });

  it("disables and explains the action when the viewer already signed", () => {
    renderQueue({
      signerId: ALICE,
      ordersById: new Map([
        [
          "ord_1",
          order({
            dualControl: {
              required: true,
              status: "awaiting_countersign",
              firstApproval: { approverId: ALICE, timestamp: NOW.toISOString() },
            },
          }),
        ],
      ]),
    });

    const button = screen.getByRole("button", {
      name: "Approve and sign request ord_1",
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/another approver must countersign/i)
    ).toBeInTheDocument();
  });

  it("disables and explains the action when no wallet is connected", () => {
    renderQueue({ signerId: null });

    expect(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    ).toBeDisabled();
    expect(screen.getByText(/connect your wallet to sign/i)).toBeInTheDocument();
  });

  it("disables and explains the action for a signer who is not authorized", () => {
    renderQueue({
      ordersById: new Map([
        [
          "ord_1",
          order({
            dualControl: {
              required: true,
              status: "awaiting_countersign",
              delegationOwners: [ALICE],
            },
          }),
        ],
      ]),
    });

    expect(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    ).toBeDisabled();
    expect(
      screen.getByText(/not an authorized approver/i)
    ).toBeInTheDocument();
  });

  it("marks an expired request as expired and refuses to sign it", () => {
    renderQueue({ items: [item({ expiresAt: NOW })] });

    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    ).toBeDisabled();
  });

  it("disables the row while its mutation is in flight", () => {
    renderQueue({ pendingIds: new Set(["ord_1"]) });

    const button = screen.getByRole("button", {
      name: "Approve and sign request ord_1",
    });
    expect(button).toBeDisabled();
    expect(screen.getByText("Signing…")).toBeInTheDocument();
  });

  it("renders an un-signable row rather than throwing when its order is gone", () => {
    renderQueue({ ordersById: new Map() });

    expect(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    ).toBeDisabled();
    expect(
      screen.getByText(/no longer awaiting a signature/i)
    ).toBeInTheDocument();
  });
});