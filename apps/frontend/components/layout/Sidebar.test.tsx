import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { Sidebar } from "./Sidebar";
import enMessages from "../../messages/en.json";
import deMessages from "../../messages/de.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
vi.mock("../tour/TourProvider", () => ({
  useTour: () => ({ start: vi.fn(), active: false, stepIndex: 0 }),
}));

const mockUsePendingApprovalBadge = vi.fn();
vi.mock("../approvals/PendingApprovalBadgeProvider", () => ({
  usePendingApprovalBadge: () => mockUsePendingApprovalBadge(),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    mockUsePendingApprovalBadge.mockReturnValue({ count: 0, items: [], loading: false, refresh: () => {} });
  });

  it("renders nav labels from the en message catalog", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Sidebar />
      </NextIntlClientProvider>
    );

    expect(
      screen.getByRole("link", { name: /dashboard/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Primary navigation" })
    ).toBeInTheDocument();
  });

  it("renders translated nav labels for a locale with full nav coverage", () => {
    render(
      <NextIntlClientProvider locale="de" messages={deMessages}>
        <Sidebar />
      </NextIntlClientProvider>
    );

    expect(
      screen.getByRole("link", { name: /Übersicht/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Hauptnavigation" })
    ).toBeInTheDocument();
  });

  it("shows no pending-approval badge when the multi-sig queue is empty (#780)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Sidebar />
      </NextIntlClientProvider>
    );

    expect(screen.queryByTestId("pending-approval-badge")).not.toBeInTheDocument();
  });

  it("badges the approvals nav link with the pending signature count (#780)", () => {
    mockUsePendingApprovalBadge.mockReturnValue({
      count: 4,
      items: [],
      loading: false,
      refresh: () => {},
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Sidebar />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("pending-approval-badge")).toHaveTextContent("4");
    // The count is part of the link's accessible name, not a stray fragment.
    expect(
      screen.getByRole("link", { name: "Approvals 4 pending signatures" })
    ).toBeInTheDocument();
  });
});
