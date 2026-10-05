/**
 * Predictive end-of-month spend forecast (#721).
 *
 * Each point carries either the actual spend to date (`historicalSpentStroops`)
 * or the projected spend from the agent's trajectory plus scheduled
 * subscriptions (`projectedSpentStroops`) — the point where history ends
 * usually carries both so the two series join up on the chart.
 */

export interface SpendForecastPoint {
  date: string;
  historicalSpentStroops?: string;
  projectedSpentStroops?: string;
  /** Upper bound of the projected confidence band, in stroops. */
  confidenceUpperStroops?: string;
  /** Lower bound of the projected confidence band, in stroops. */
  confidenceLowerStroops?: string;
  budgetLimitStroops: string;
}

/** Forecast windows the analytics dashboard offers, in days. */
export type ForecastHorizonDays = 30 | 60 | 90;

export const FORECAST_HORIZONS: readonly ForecastHorizonDays[] = [30, 60, 90];

export const DEFAULT_FORECAST_HORIZON: ForecastHorizonDays = 30;

/** Narrows a URL search param into a ForecastHorizonDays, falling back to the default. */
export function parseForecastHorizon(
  value: string | null | undefined
): ForecastHorizonDays {
  const parsed = Number(value);
  return (
    FORECAST_HORIZONS.find((horizon) => horizon === parsed) ??
    DEFAULT_FORECAST_HORIZON
  );
}

export interface SpendForecastSummary {
  /** Latest actual spend, or null when no historical points exist. */
  spentToDateStroops: bigint | null;
  /** Spend at the last projected point (end of month), or null when there is no projection. */
  projectedEndStroops: bigint | null;
  /** Budget limit at the final point of the series. */
  budgetLimitStroops: bigint;
  /** True when any projected point goes over its budget limit. */
  projectedBreach: boolean;
  /** Date of the first projected point over the limit, if any. */
  firstBreachDate: string | null;
}

const STROOPS_PER_XLM = 10_000_000;

/** Parses a stroops string; returns null for missing or malformed values. */
export function parseStroops(value: string | undefined): bigint | null {
  if (value == null || !/^\d+$/.test(value.trim())) return null;
  return BigInt(value.trim());
}

export function stroopsToXlm(stroops: bigint): number {
  return Number(stroops) / STROOPS_PER_XLM;
}

export function summarizeSpendForecast(
  points: SpendForecastPoint[]
): SpendForecastSummary {
  let spentToDateStroops: bigint | null = null;
  let projectedEndStroops: bigint | null = null;
  let firstBreachDate: string | null = null;

  for (const point of points) {
    const historical = parseStroops(point.historicalSpentStroops);
    if (historical !== null) spentToDateStroops = historical;

    const projected = parseStroops(point.projectedSpentStroops);
    if (projected === null) continue;
    projectedEndStroops = projected;

    const limit = parseStroops(point.budgetLimitStroops);
    if (firstBreachDate === null && limit !== null && projected > limit) {
      firstBreachDate = point.date;
    }
  }

  const last = points[points.length - 1];
  return {
    spentToDateStroops,
    projectedEndStroops,
    budgetLimitStroops: parseStroops(last?.budgetLimitStroops) ?? 0n,
    projectedBreach: firstBreachDate !== null,
    firstBreachDate,
  };
}

export function isEmptyForecast(points: SpendForecastPoint[]): boolean {
  return !points.some(
    (p) =>
      parseStroops(p.historicalSpentStroops) !== null ||
      parseStroops(p.projectedSpentStroops) !== null
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Width of the confidence band around the projection, as a fraction of the projected value. */
const CONFIDENCE_BAND_RATIO = 0.15;

export interface SpendForecastInput {
  /** Daily spend totals keyed by ISO day start, oldest first. */
  dailyTotals: Array<{ dayStart: string; totalStroops: bigint }>;
  /** Monthly spending limit the projection is measured against. */
  budgetLimitStroops: bigint;
  /** Number of days to project forward. */
  horizonDays: ForecastHorizonDays;
  /** Today's date; defaults to the current time. */
  now?: Date;
}

/**
 * Projects daily spend forward from the observed history (#721).
 *
 * The projection is a simple linear trend fitted over the history window,
 * widened over time by the residual spread so the confidence band grows with
 * the horizon. Points before `now` carry actuals only; points after it carry
 * the projection plus its band.
 */
export function buildSpendForecast(
  input: SpendForecastInput
): SpendForecastPoint[] {
  const now = input.now ?? new Date();
  const history = input.dailyTotals;
  if (history.length === 0) return [];

  const n = history.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = history.reduce((sum, d) => sum + Number(d.totalStroops), 0);
  const sumXY = history.reduce(
    (sum, d, i) => sum + i * Number(d.totalStroops),
    0
  );
  const sumXX = history.reduce((sum, _d, i) => sum + i * i, 0);
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const residuals = history.map(
    (d, i) => Number(d.totalStroops) - (intercept + slope * i)
  );
  const residualStdev =
    n > 1
      ? Math.sqrt(
          residuals.reduce((sum, r) => sum + r * r, 0) / (n - 1)
        )
      : 0;

  const budget = input.budgetLimitStroops.toString();
  const lastIndex = history.length - 1;
  const points: SpendForecastPoint[] = history.map((d, i) => {
    const point: SpendForecastPoint = {
      date: d.dayStart,
      historicalSpentStroops: d.totalStroops.toString(),
      budgetLimitStroops: budget,
    };
    // The joining point carries both series so the actual and projected
    // lines meet instead of leaving a gap.
    if (i === lastIndex) {
      point.projectedSpentStroops = d.totalStroops.toString();
    }
    return point;
  });

  const anchor = new Date(`${history[lastIndex].dayStart}T00:00:00.000Z`);
  for (let offset = 1; offset <= input.horizonDays; offset += 1) {
    const projected = Math.max(0, intercept + slope * (lastIndex + offset));
    const spread =
      residualStdev * Math.sqrt(1 + offset / Math.max(1, n)) +
      projected * CONFIDENCE_BAND_RATIO;
    points.push({
      date: new Date(anchor.getTime() + offset * DAY_MS).toISOString(),
      projectedSpentStroops: Math.round(projected).toString(),
      confidenceUpperStroops: Math.round(projected + spread).toString(),
      confidenceLowerStroops: Math.round(Math.max(0, projected - spread)).toString(),
      budgetLimitStroops: budget,
    });
  }

  return points;
}
