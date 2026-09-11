/**
 * Presentation of verified values.
 *
 * The API returns raw numbers on purpose -- `162489.73221169008` is what the
 * warehouse said, and rounding it server-side would mean the figure shown and
 * the figure computed are different values. Rounding is a display concern, so
 * it happens here, once, driven by the unit the semantic layer already knows.
 *
 * The alternative -- printing raw doubles -- is not neutral. It makes a correct
 * answer look like a debugger and buries the one digit that matters.
 */

import { DIMENSIONS, METRICS } from "@/semantic/catalogue";
import type { Plan } from "@/plan/schema";

export type Unit = "USD" | "ratio" | "count" | "pct" | "pct100" | "native" | "text";

/**
 * What kind of quantity a column holds.
 *
 * Catalogue metrics carry their own unit. The rest are columns the compiler's
 * fixed templates invent, and they are listed explicitly rather than guessed at
 * from the name -- `spend_per_day` is *not* USD, it is whatever currency the
 * campaign buys in, and putting a dollar sign on an INR budget would be the
 * same class of error the whole currency policy exists to prevent.
 */
export function unitFor(column: string, plan?: Plan): Unit {
  const metric = METRICS[column];
  if (metric) return metric.unit === "USD_per_conversion" ? "USD" : (metric.unit as Unit);

  switch (column) {
    case "label":
    case "label_2":
    case "label_currency":
    case "date":
      return "text";
    case "pacing_pct":
      return "pct100";
    case "spend_per_day":
    case "daily_budget":
      return "native";
    case "baseline_spend_per_day":
    case "target_spend":
      return "USD";
    case "baseline_rows_per_day":
    case "target_rows":
      return "count";
    case "baseline_per_day":
    case "target_value":
    case "delta":
      return plan?.plan_type === "diagnose_drop" ? unitFor(plan.metric) : "count";
    default:
      return "count";
  }
}

const grouped = (v: number, digits = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Full precision for a table cell or a stat tile. */
export function formatValue(value: number | string | null, unit: Unit): string {
  if (value === null || value === "") return "—";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";

  const sign = value < 0 ? "-" : "";
  const n = Math.abs(value);

  switch (unit) {
    case "USD":
      return n >= 1000 ? `${sign}$${grouped(Math.round(n))}` : `${sign}$${grouped(n, 2)}`;
    case "ratio":
      return `${sign}${n.toFixed(2)}`;
    case "pct":
      return `${sign}${(n * 100).toFixed(2)}%`;
    case "pct100":
      return `${sign}${n.toFixed(1)}%`;
    case "native":
      return n >= 1000 ? `${sign}${grouped(Math.round(n))}` : `${sign}${grouped(n, 2)}`;
    case "count":
      // Row counts averaged over a baseline are fractional and meaningfully so:
      // "9.8 rows a day" is a real number, not a rounding artefact.
      return Number.isInteger(n) ? `${sign}${grouped(n)}` : `${sign}${grouped(n, 1)}`;
    default:
      return String(value);
  }
}

/** Axis ticks: short enough not to collide, never so short it loses the point. */
export function formatCompact(value: number, unit: Unit): string {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  const n = Math.abs(value);
  const prefix = unit === "USD" ? "$" : "";

  // Decimals are decided per unit, not per value: an axis reading
  // "0, 3.0, 6.0, 9.0, 12" mixes two formats on one scale and looks like a bug.
  if (unit === "pct") return `${sign}${(n * 100).toFixed(0)}%`;
  if (unit === "pct100") return `${sign}${n.toFixed(0)}%`;
  if (unit === "ratio") return `${sign}${n.toFixed(1)}`;
  if (n === 0) return `${prefix}0`;

  if (n >= 1_000_000) return `${sign}${prefix}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${sign}${prefix}${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  if (n >= 1) return `${sign}${prefix}${n.toFixed(0)}`;
  return `${sign}${prefix}${n.toFixed(2)}`;
}

const FIXED_LABELS: Readonly<Record<string, string>> = {
  label_currency: "Currency",
  date: "Date",
  baseline_per_day: "Baseline / day",
  target_value: "On the day",
  delta: "Change",
  baseline_spend_per_day: "Baseline spend / day",
  target_spend: "Spend on the day",
  baseline_rows_per_day: "Baseline rows / day",
  target_rows: "Rows on the day",
  spend_per_day: "Spend / day",
  daily_budget: "Daily budget",
  pacing_pct: "Pacing",
};

/**
 * A human column heading.
 *
 * `label` is the compiler's generic name for whatever the result is grouped by,
 * so the plan is what says which dimension that actually is. A column headed
 * "Channel" tells the reader what they are looking at; one headed "label" makes
 * them work it out.
 */
export function columnLabel(column: string, plan?: Plan): string {
  const metric = METRICS[column];
  if (metric) return metric.label;

  const fixed = FIXED_LABELS[column];
  if (fixed) return fixed;

  if (column === "label" || column === "label_2") {
    const index = column === "label" ? 0 : 1;

    switch (plan?.plan_type) {
      case "breakdown":
      case "ranking":
      case "time_series":
        return DIMENSIONS[plan.dimensions?.[index] ?? ""]?.label ?? "Group";
      case "compare_periods":
        return index === 0
          ? "Period"
          : (DIMENSIONS[plan.dimensions?.[0] ?? ""]?.label ?? "Group");
      case "diagnose_drop":
        return "Channel";
      case "turn_off_candidate":
      case "budget_pacing":
        return "Campaign";
      default:
        return "Group";
    }
  }

  return column.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

/** Compare-period rows read better as words than as the SQL literals. */
export function prettyCell(column: string, value: string | number | null): string | number | null {
  if (column !== "label" || typeof value !== "string") return value;
  if (value === "current") return "This period";
  if (value === "prior") return "Prior period";
  return value;
}
