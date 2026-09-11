/**
 * Plan -> SQL. The compiler owns joins, FX, dedup, grouping, limits, and the
 * tenant predicate. The model never sees this file's output before it runs, and
 * never writes a character of it.
 *
 * PHASE 3 -- see PLAN.md. Contract is fixed; body is not written yet.
 */

import type { Plan } from "@/plan/schema";
import type { ResolvedRange } from "@/plan/resolve";

export interface CompiledQuery {
  /** The SQL shown to the user verbatim. */
  readonly sql: string;
  readonly columns: readonly string[];
  /** Extra queries that produce the flags for this window. */
  readonly flagSql: string;
}

export function compile(
  _plan: Plan,
  _range: ResolvedRange | null,
  _tenantId: string,
): CompiledQuery {
  throw new Error("NotImplemented: PLAN.md phase 3");
}
