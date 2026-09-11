/**
 * Answerability. The model proposing a plan is a proposal, not a verdict.
 *
 * Two jobs, and the second is the one that matters. The first is cheap defence
 * in depth: structured output already constrains metric and dimension names to
 * the catalogue, so a mismatch here means the schema and the catalogue have
 * drifted apart -- a bug, caught loudly rather than compiled into SQL.
 *
 * The second is the one no schema can do: a plan can be perfectly well-formed
 * and still unanswerable, because the window it asks for contains no data. That
 * case has to become a refusal here, because downstream it becomes `SUM(...)`
 * over zero rows, which returns 0, which reads as "we spent nothing" rather
 * than "there is no data for May".
 */

import type { Plan } from "@/plan/schema";
import { fixedRange, lastCompleteDay, resolveRange, toDate, toIso, addDays, type ResolvedRange } from "@/plan/resolve";
import type { Coverage } from "@/db/duckdb";
import { DIMENSION_IDS, FILTERABLE, METRIC_IDS } from "@/semantic/catalogue";
import { TURN_OFF_POLICY } from "@/semantic/policies";

/** The four shapes of "I don't know", plus the non-question case. */
export type RefusalReason =
  | "no_such_entity"
  | "no_such_dimension"
  | "no_such_metric"
  | "outside_coverage"
  | "not_analytical";

export type Verdict =
  | {
      readonly ok: true;
      readonly plan: Plan;
      readonly range: ResolvedRange | null;
      /** Second window for `compare_periods`; null for every other plan type. */
      readonly comparison: ResolvedRange | null;
    }
  | {
      readonly ok: false;
      readonly reason: RefusalReason;
      readonly missing: string;
      readonly available: readonly string[];
    };

/** What a refusal of each kind should offer instead. */
function availableFor(reason: RefusalReason, coverage: Coverage): readonly string[] {
  switch (reason) {
    case "no_such_dimension":
      return DIMENSION_IDS;
    case "no_such_metric":
      return METRIC_IDS;
    case "outside_coverage":
      return [`${coverage.firstDate} to ${coverage.lastDate}`];
    case "no_such_entity":
      // Nothing to substitute, but the user can still be told what the data
      // does describe rather than only what it does not.
      return DIMENSION_IDS;
    default:
      return [];
  }
}

/** The window a drop diagnosis covers: the trailing baseline plus the target day. */
export function diagnoseWindow(
  plan: Extract<Plan, { plan_type: "diagnose_drop" }>,
  coverage: Coverage,
): { target: string; baseline: readonly [string, string] } {
  const target = plan.target_date === "latest" ? coverage.lastDate : plan.target_date;
  const targetDate = toDate(target);
  const baselineEnd = addDays(targetDate, -1);
  const baselineStart = addDays(targetDate, -plan.baseline_days);
  return { target, baseline: [toIso(baselineStart), toIso(baselineEnd)] };
}

export function validatePlan(plan: Plan, coverage: Coverage): Verdict {
  // The model's own refusal, passed through with something useful attached.
  if (plan.plan_type === "unanswerable") {
    return {
      ok: false,
      reason: plan.reason,
      missing: plan.missing,
      available: availableFor(plan.reason, coverage),
    };
  }

  // -- defence in depth: the catalogue is the authority, not the prompt -------
  const metrics = "metrics" in plan ? plan.metrics : "metric" in plan ? [plan.metric] : [];
  for (const m of metrics) {
    if (!METRIC_IDS.includes(m)) {
      return { ok: false, reason: "no_such_metric", missing: m, available: METRIC_IDS };
    }
  }

  const dimensions = "dimensions" in plan ? plan.dimensions : [];
  for (const d of dimensions) {
    if (!DIMENSION_IDS.includes(d)) {
      return {
        ok: false,
        reason: "no_such_dimension",
        missing: d,
        available: DIMENSION_IDS,
      };
    }
  }

  for (const f of plan.filters) {
    if (!(FILTERABLE as readonly string[]).includes(f.field)) {
      return {
        ok: false,
        reason: "no_such_dimension",
        missing: f.field,
        available: FILTERABLE,
      };
    }
  }

  if (plan.plan_type === "ranking" && (plan.limit < 1 || plan.limit > 50)) {
    return {
      ok: false,
      reason: "not_analytical",
      missing: `a limit of ${plan.limit}`,
      available: ["1 to 50"],
    };
  }

  // -- the window ------------------------------------------------------------
  const { range, comparison } = windowsFor(plan, coverage);

  // An empty window is the dangerous one. It is not a zero; it is an absence,
  // and it has to leave this function as a refusal.
  if (range?.empty) {
    return {
      ok: false,
      reason: "outside_coverage",
      missing: `${range.requested[0]} to ${range.requested[1]}`,
      available: availableFor("outside_coverage", coverage),
    };
  }
  if (comparison?.empty) {
    return {
      ok: false,
      reason: "outside_coverage",
      missing: `the comparison window ${comparison.requested[0]} to ${comparison.requested[1]}`,
      available: availableFor("outside_coverage", coverage),
    };
  }

  return { ok: true, plan, range, comparison };
}

/**
 * Every plan type's windows in one place.
 *
 * Two of them are not the user's to choose: the turn-off lookback and the drop
 * baseline are policy, so they are resolved here from the policy constants
 * rather than read off the plan.
 */
function windowsFor(
  plan: Exclude<Plan, { plan_type: "unanswerable" }>,
  coverage: Coverage,
): { range: ResolvedRange | null; comparison: ResolvedRange | null } {
  switch (plan.plan_type) {
    case "turn_off_candidate":
      return {
        range: resolveRange(
          {
            type: "relative",
            n: TURN_OFF_POLICY.lookbackDays,
            unit: "day",
            calendar: false,
            offset: 0,
          },
          coverage,
        ),
        comparison: null,
      };

    case "diagnose_drop": {
      const { target, baseline } = diagnoseWindow(plan, coverage);
      return { range: fixedRange(baseline[0], target, coverage), comparison: null };
    }

    case "compare_periods":
      return {
        range: resolveRange(plan.time_range, coverage),
        comparison: resolveRange(plan.comparison, coverage),
      };

    default:
      return { range: resolveRange(plan.time_range, coverage), comparison: null };
  }
}

/** The last day treated as fully loaded. Re-exported so callers need one import. */
export { lastCompleteDay };
