"use client";

import { useTranslations } from "next-intl";
import { formatPendingApprovalBadgeCount } from "../../lib/multiSigApprovals";
import { usePendingApprovalBadge } from "./PendingApprovalBadgeProvider";

/**
 * Pending-signature badge for the approvals nav link (#780).
 *
 * Renders nothing when the queue is empty, so the nav looks unchanged for
 * everyone without a multi-sig request outstanding. The visible number is
 * `aria-hidden` because the adjacent screen-reader text already carries the
 * full phrase — and because it sits inside the nav link, that phrase is
 * announced as part of the link's accessible name ("Approvals, 3 pending
 * signatures") rather than as a stray fragment.
 */
export function PendingApprovalNavBadge() {
  const t = useTranslations("nav");
  const { count } = usePendingApprovalBadge();

  const label = formatPendingApprovalBadgeCount(count);
  if (label === null) return null;

  return (
    <span className="nav-badge" data-testid="pending-approval-badge">
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {t("pendingApprovalBadgeLabel", { count })}
      </span>
    </span>
  );
}