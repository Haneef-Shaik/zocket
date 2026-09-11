/**
 * Answerability. The model proposing a plan is a proposal, not a verdict.
 *
 * PHASE 2 -- see PLAN.md. Contract is fixed; body is not written yet.
 */

import type { Plan } from "@/plan/schema";
import type { ResolvedRange } from "@/plan/resolve";
import type { Coverage } from "@/db/duckdb";

export type Verdict =
  | { readonly ok: true; readonly plan: Plan; readonly range: ResolvedRange | null }
  | {
      readonly ok: false;
      readonly reason:
        | "no_such_entity"
        | "no_such_dimension"
        | "no_such_metric"
        | "outside_coverage"
        | "not_analytical";
      readonly missing: string;
      readonly available: readonly string[];
    };

export function validatePlan(_plan: Plan, _coverage: Coverage): Verdict {
  throw new Error("NotImplemented: PLAN.md phase 2");
}
