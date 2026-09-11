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

export function chooseChart(plan: Plan, columns: readonly string[]): ChartSpec | null {
  const measures = columns.filter((c) => !["label", "date", "dimension"].includes(c));

  switch (plan.plan_type) {
    case "single_value":
      return { kind: "stat", x: null, y: measures, title: plan.interpretation };
    case "breakdown":
      return { kind: "bar", x: "label", y: measures, title: plan.interpretation };
    case "ranking":
    case "turn_off_candidate":
    case "budget_pacing":
      return { kind: "hbar", x: "label", y: measures, title: plan.interpretation };
    case "time_series":
    case "diagnose_drop":
      return { kind: "line", x: "date", y: measures, title: plan.interpretation };
    case "compare_periods":
      return { kind: "grouped_bar", x: "label", y: measures, title: plan.interpretation };
    case "unanswerable":
      return null;
  }
}
