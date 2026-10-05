"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "@delegolabs/ui";
import { formatXlm } from "../../lib/orders";

/** A single category's monthly cap and how much of it has been spent. */
export interface CategoryBudgetAllocation {
  category: string;
  monthlyLimitStroops: bigint;
  currentSpentStroops: bigint;
}

export interface CategoryBudgetAllocationCardProps {
  allocations: CategoryBudgetAllocation[];
  onSave: (allocations: CategoryBudgetAllocation[]) => Promise<void> | void;
  /** Optional locale passed through to `formatXlm` (FE-039 convention). */
  locale?: string;
}

/** Fraction of the cap at or above which a category is flagged as over. */
const OVER_CAP = 100;

function toneFor(percent: number): string {
  if (percent >= OVER_CAP) return "#dc2626";
  if (percent >= 80) return "#b45309";
  return "#2563eb";
}

/**
 * Settings section for per-category monthly spending caps. Edits are held
 * locally until Save, so navigating away never persists a half-finished
 * change.
 */
export function CategoryBudgetAllocationCard({
  allocations,
  onSave,
  locale,
}: CategoryBudgetAllocationCardProps) {
  const [draft, setDraft] = useState<CategoryBudgetAllocation[]>(allocations);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(allocations);
  }, [allocations]);

  const isDirty = useMemo(
    () =>
      draft.length !== allocations.length ||
      draft.some(
        (entry, index) =>
          entry.category !== allocations[index]?.category ||
          entry.monthlyLimitStroops !== allocations[index]?.monthlyLimitStroops,
      ),
    [draft, allocations],
  );

  const handleChange = (index: number, nextXlm: string) => {
    const stroops = BigInt(Math.round(Number(nextXlm || "0") * 10_000_000));
    setDraft((prev) =>
      prev.map((entry, i) =>
        i === index
          ? { ...entry, monthlyLimitStroops: stroops < 0n ? 0n : stroops }
          : entry
      )
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(draft);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card title="Category budgets" ariaLabel="Category budgets">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {draft.map((entry, index) => {
          const percent =
            entry.monthlyLimitStroops > 0n
              ? Number(
                  (entry.currentSpentStroops * 100n) / entry.monthlyLimitStroops
                )
              : 0;
          const inputId = `category-budget-${index}`;

          return (
            <div key={entry.category}>
              <label
                htmlFor={inputId}
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontWeight: 500,
                }}
              >
                {entry.category}
              </label>
              <input
                id={inputId}
                type="number"
                min="0"
                step="0.01"
                value={Number(entry.monthlyLimitStroops) / 10_000_000}
                onChange={(e) => handleChange(index, e.target.value)}
                style={{ width: "10rem", padding: "0.5rem" }}
              />
              <div
                style={{
                  marginTop: "0.25rem",
                  height: "0.5rem",
                  borderRadius: "9999px",
                  background: "#e5e7eb",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(percent, 100)}%`,
                    background: toneFor(percent),
                  }}
                />
              </div>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
                {formatXlm(entry.currentSpentStroops, locale)} of{" "}
                {formatXlm(entry.monthlyLimitStroops, locale)} XLM used (
                {percent}%)
              </p>
            </div>
          );
        })}

        <div>
          <Button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? "Saving…" : "Save category budgets"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default CategoryBudgetAllocationCard;