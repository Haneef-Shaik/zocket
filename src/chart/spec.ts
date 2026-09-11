/**
 * Chart selection -- by rule, from the plan shape. Never by the model.
 *
 * This costs nothing in quality and removes an entire class of failure where
 * the picture says something the text does not. The model's only influence is
 * the plan it chose, which is already validated.
 */

import type { Plan } from "@/plan/schema";

export type ChartKind = "bar" | "hbar" | "line" | "grouped_bar" | "stat" | "table";

export interface ChartSpec {
  readonly kind: ChartKind;
  readonly x: string | null;
  readonly y: readonly string[];
  readonly title: string;
  /** Rendered as a reference band, e.g. the baseline in a drop diagnosis. */
  readonly annotation?: { readonly label: string; readonly value: number };
}

/**
 * The headline measure: the one the question was actually about.
 *
 * Ratio metrics drag their components onto the result table so the number is
 * checkable, but plotting revenue, spend and ROAS on one axis produces a chart
 * where the bar that matters is invisible. The table carries everything; the
 * chart carries the point.
 */
function primaryMeasure(plan: Plan, measures: readonly string[]): string | null {
  switch (plan.plan_type) {
    case "ranking":
      return plan.order_by;
    case "turn_off_candidate":
      return "roas";
    case "budget_pacing":
      return "pacing_pct";
    default:
      return measures[0] ?? null;
  }
}

export function chooseChart(
  plan: Plan,
  measures: readonly string[],
): ChartSpec | null {
  const primary = primaryMeasure(plan, measures);
  const one = primary ? [primary] : [];

  switch (plan.plan_type) {
    case "single_value":
      return { kind: "stat", x: null, y: measures, title: plan.interpretation };
    case "breakdown":
      return { kind: "bar", x: "label", y: one, title: plan.interpretation };
    case "ranking":
    case "turn_off_candidate":
    case "budget_pacing":
      return { kind: "hbar", x: "label", y: one, title: plan.interpretation };
    case "time_series":
      return { kind: "line", x: "date", y: one, title: plan.interpretation };
    case "compare_periods":
      return { kind: "grouped_bar", x: "label", y: one, title: plan.interpretation };
    case "diagnose_drop":
      // Paired bars, not a line: the comparison is baseline-per-day against one
      // day, by channel. A line over two points implies a trend that is not there.
      return {
        kind: "grouped_bar",
        x: "label",
        y: ["baseline_per_day", "target_value"],
        title: plan.interpretation,
      };
    case "unanswerable":
      return null;
  }
}
