import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Order } from "@delegolabs/types";
import MultiSigApprovalsPage from "./page";

const NOW = new Date("2026-09-24T12:00:00.000Z");

const mockApproveOrder = vi.fn();
const mockRefresh = vi.fn();
const mockAnnounce = vi.fn();
const mockSubmitApproval = vi.fn();
const mockRefreshBadge = vi.fn();

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "ord_1",
    delegationId: "del_1",
    merchantId: "merch_1",
    status: "awaiting_countersign",
    totalStroops: 5_000_000_000n,
    createdAt: new Date("2026-09-24T06:00:00.000Z"),
    dualControl: {
      required: true,
      status: "awaiting_countersign",
      firstApproval: { approverId: "GALICE", timestamp: "2026-09-24T11:00:00.000Z" },
    },
    ...overrides,
  };
}

// The page renders a next/link and uses useQueryParamState (which reads
// next/navigation); neither has a router in jsdom.
vi.mock("next/navigation", () => ({
  usePathname: () => "/approvals/multi-sig",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../../../hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [makeOrder()],
    loading: false,
    error: null,
    pendingIds: new Set<string>(),
    pendingOfflineIds: new Set<string>(),
    conflictMutations: [],
    approveOrder: mockApproveOrder,
    rejectOrder: vi.fn(),
    refresh: mockRefresh,
  }),
}));

vi.mock("../../../hooks/useDelegations", () => ({
  useDelegations: () => ({
    delegations: [{ id: "del_1", agentId: "agent_9", label: "Weekly shopper" }],
    loading: false,
    error: null,
    stale: false,
    cachedAt: null,
    ttlMs: 0,
    pendingIds: new Set<string>(),
    pendingOfflineIds: new Set<string>(),
    conflictMutations: [],
    refresh: vi.fn(),
    createDelegation: vi.fn(),
    updateDelegation: vi.fn(),
    revokeDelegation: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useAnnounce", () => ({
  useAnnounce: () => ({ announce: mockAnnounce }),
}));

vi.mock("../../../hooks/useCurrency", () => ({
  useCurrency: () => ({ currencyId: "XLM", rate: null }),
}));

vi.mock("../../../hooks/useNow", () => ({ useNow: () => NOW }));

vi.mock("../../../hooks/useWallet", () => ({
  useWallet: () => ({ address: "GBOB" }),
}));

vi.mock("../../../components/approvals/PendingApprovalBadgeProvider", () => ({
  usePendingApprovalBadge: () => ({
    count: 1,
    items: [],
    loading: false,
    refresh: mockRefreshBadge,
  }),
}));

vi.mock("../../../services/approvals", () => ({
  submitApproval: (...args: unknown[]) => mockSubmitApproval(...args),
}));

describe("MultiSigApprovalsPage", () => {
  beforeEach(() => {
    mockSubmitApproval.mockReset();
    mockRefresh.mockReset();
    mockAnnounce.mockReset();
    mockRefreshBadge.mockReset();
  });

  it("renders the queue row with the resolved agent label and pending value", () => {
    render(<MultiSigApprovalsPage />);

    expect(screen.getByRole("heading", { name: "Multi-sig approvals" })).toBeInTheDocument();
    // requestedBy comes from the delegation's label, not the raw delegation id.
    expect(screen.getByText("Weekly shopper")).toBeInTheDocument();
    // Once in the "Value on hold" summary card, once in the queue row.
    expect(screen.getAllByText("500.00 XLM")).toHaveLength(2);
    // createdAt 06:00 + the 24h default TTL, against the mocked 12:00 clock.
    expect(screen.getByText("Expires in 18h")).toBeInTheDocument();
  });

  it("submits the signature as the connected wallet and refreshes the queue and badge", async () => {
    const user = userEvent.setup();
    mockSubmitApproval.mockResolvedValue({
      data: {
        id: "ord_1",
        delegationId: "del_1",
        status: "approved",
        createdAt: NOW.toISOString(),
        dualControl: { required: true, status: "completed" },
      },
      error: null,
    });

    render(<MultiSigApprovalsPage />);
    await user.click(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    );

    await waitFor(() => {
      expect(mockSubmitApproval).toHaveBeenCalledWith("ord_1", "GBOB");
    });
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(mockRefreshBadge).toHaveBeenCalled();
    expect(mockAnnounce).toHaveBeenCalledWith(
      "Request ord_1 fully approved.",
      "polite"
    );
  });

  it("announces the wait-for-countersignature case and surfaces API errors", async () => {
    const user = userEvent.setup();
    mockSubmitApproval.mockResolvedValue({
      data: {
        id: "ord_1",
        delegationId: "del_1",
        status: "awaiting_countersign",
        createdAt: NOW.toISOString(),
        dualControl: {
          required: true,
          status: "awaiting_countersign",
          firstApproval: { approverId: "GBOB", timestamp: NOW.toISOString() },
        },
      },
      error: null,
    });

    const { unmount } = render(<MultiSigApprovalsPage />);
    await user.click(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    );
    await waitFor(() => {
      expect(mockAnnounce).toHaveBeenCalledWith(
        "Signature recorded for request ord_1 — waiting for a countersignature.",
        "polite"
      );
    });
    unmount();

    mockRefreshBadge.mockClear();
    mockSubmitApproval.mockResolvedValue({
      data: null,
      error: { code: "403", message: "Not authorized" },
    });
    render(<MultiSigApprovalsPage />);
    await user.click(
      screen.getByRole("button", { name: "Approve and sign request ord_1" })
    );
    await waitFor(() => {
      expect(mockAnnounce).toHaveBeenCalledWith(
        "Failed to sign request ord_1.",
        "assertive"
      );
    });
    expect(mockRefreshBadge).not.toHaveBeenCalled();
  });
});