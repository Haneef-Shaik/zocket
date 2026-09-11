/**
 * Stages 3-7: everything between the two model calls.
 *
 * Kept separate from `ask()` for one reason that matters more than tidiness:
 * the golden runner drives *this* function with each case's expected plan, no
 * API key and no network. That means the check which guards the numbers runs
 * over exactly the code the API runs, rather than a reimplementation of it that
 * can quietly agree with itself while both are wrong.
 */

import type { Plan } from "@/plan/schema";
import type { Coverage } from "@/db/duckdb";
import { run } from "@/db/duckdb";
import { validatePlan, type Verdict } from "@/plan/validate";
import { compile, type CompiledQuery } from "@/sql/compile";
import { validateResult } from "@/verify/resultValidator";
import { chooseChart, type ChartSpec } from "@/chart/spec";
import type { VerifiedResult } from "@/agent/types";
import type { Flag } from "@/verify/flags";

export interface Executed {
  readonly verdict: Verdict;
  readonly compiled: CompiledQuery | null;
  readonly result: VerifiedResult | null;
  readonly flags: readonly Flag[];
  readonly chart: ChartSpec | null;
}

export async function execute(
  plan: Plan,
  coverage: Coverage,
  tenantId: string,
): Promise<Executed> {
  const verdict = validatePlan(plan, coverage);
  if (!verdict.ok) {
    return { verdict, compiled: null, result: null, flags: [], chart: null };
  }

  const compiled = compile(verdict.plan, verdict.range, tenantId, verdict.comparison);

  // Two reads, no writes. The flag query is separate on purpose: it counts
  // defects over the rows the answer touched, which is a different grain from
  // the answer itself and would otherwise have to be smuggled into the GROUP BY.
  const [rows, flagRows] = await Promise.all([
    run(compiled.sql, compiled.params),
    run(compiled.flagSql, compiled.flagParams),
  ]);

  const { result, flags } = validateResult(rows, flagRows, compiled.columns, verdict.range);

  return {
    verdict,
    compiled,
    result,
    flags,
    chart: chooseChart(verdict.plan, compiled.measures),
  };
}
