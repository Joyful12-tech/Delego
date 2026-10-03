import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PendingApprovalNavBadge } from "./PendingApprovalNavBadge";
import messages from "../../messages/en.json";

const mockUsePendingApprovalBadge = vi.fn();

vi.mock("./PendingApprovalBadgeProvider", () => ({
  usePendingApprovalBadge: () => mockUsePendingApprovalBadge(),
}));

function stubBadge(count: number) {
  mockUsePendingApprovalBadge.mockReturnValue({
    count,
    items: [],
    loading: false,
    refresh: () => {},
  });
}

function renderBadge(count: number) {
  stubBadge(count);
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PendingApprovalNavBadge />
    </NextIntlClientProvider>
  );
}

describe("PendingApprovalNavBadge", () => {
  beforeEach(() => {
    mockUsePendingApprovalBadge.mockReset();
  });

  it("renders nothing when no signature is pending", () => {
    renderBadge(0);

    expect(screen.queryByTestId("pending-approval-badge")).not.toBeInTheDocument();
  });

  it("shows the pending count", () => {
    renderBadge(3);

    const badge = screen.getByTestId("pending-approval-badge");
    expect(badge).toHaveTextContent("3");
  });

  it("caps a large queue at 99+", () => {
    renderBadge(250);

    expect(screen.getByTestId("pending-approval-badge")).toHaveTextContent(
      "99+"
    );
  });

  it("exposes the count to assistive tech as part of the nav link name", () => {
    stubBadge(3);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <a href="/approvals">
          Approvals
          <PendingApprovalNavBadge />
        </a>
      </NextIntlClientProvider>
    );

    expect(
      screen.getByRole("link", { name: "Approvals 3 pending signatures" })
    ).toBeInTheDocument();
  });
});