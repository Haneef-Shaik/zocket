/**
 * The compiler is where a wrong decision is invisible. Nobody notices that FX
 * was applied at the wrong date, or that a ratio was averaged instead of
 * divided -- the answer just quietly stops being true. These assert the
 * properties that hold across every emitter.
 */

import { describe, expect, it } from "vitest";
import { compile, CompileError } from "@/sql/compile";
import { PlanSchema, type Plan } from "@/plan/schema";
import { validatePlan } from "@/plan/validate";
import { getCoverage } from "@/db/duckdb";
import { run } from "@/db/duckdb";

const COVERAGE = { firstDate: "2026-06-08", lastDate: "2026-09-04", rowCount: 2341 };

const WINDOW = { type: "absolute", start: "2026-08-01", end: "2026-08-31" } as const;

const PLANS: Readonly<Record<string, unknown>> = {
  single_value: {
    plan_type: "single_value", interpretation: "x", filters: [],
    metrics: ["spend_usd"], time_range: WINDOW,
  },
  breakdown: {
    plan_type: "breakdown", interpretation: "x", filters: [],
    metrics: ["spend_usd"], dimensions: ["channel"], time_range: WINDOW,
  },
  ranking: {
    plan_type: "ranking", interpretation: "x", filters: [],
    metrics: ["revenue_usd"], dimensions: ["campaign"], time_range: WINDOW,
    order_by: "revenue_usd", direction: "desc", limit: 5,
  },
  time_series: {
    plan_type: "time_series", interpretation: "x", filters: [],
    metrics: ["conversions"], dimensions: [], grain: "day", time_range: WINDOW,
  },
  compare_periods: {
    plan_type: "compare_periods", interpretation: "x", filters: [], dimensions: [],
    metrics: ["conversions"], time_range: WINDOW,
    comparison: { type: "absolute", start: "2026-07-01", end: "2026-07-31" },
  },
  diagnose_drop: {
    plan_type: "diagnose_drop", interpretation: "x", filters: [],
    metric: "conversions", target_date: "latest", baseline_days: 7,
  },
  turn_off_candidate: { plan_type: "turn_off_candidate", interpretation: "x", filters: [] },
  budget_pacing: { plan_type: "budget_pacing", interpretation: "x", filters: [], time_range: WINDOW },
};

function compilePlan(raw: unknown) {
  const plan = PlanSchema.parse(raw);
  const verdict = validatePlan(plan, COVERAGE);
  if (!verdict.ok) throw new Error(`unexpected refusal: ${verdict.reason}`);
  return compile(verdict.plan, verdict.range, "demo", verdict.comparison);
}

describe("every plan type compiles and runs", () => {
  for (const [name, raw] of Object.entries(PLANS)) {
    it(`${name}`, async () => {
      const compiled = compilePlan(raw);
      expect(compiled.sql.length).toBeGreaterThan(0);
      expect(compiled.columns.length).toBeGreaterThan(0);

      // Every emitter carries the tenant predicate. This is the point of
      // threading tenant_id from day one: a filter added later is a filter
      // someone forgets on one query path.
      expect(compiled.sql).toContain("tenant_id =");
      expect(compiled.params.tenant).toBe("demo");

      // It has to be SQL DuckDB actually accepts, not SQL that looks right.
      await expect(run(compiled.sql, compiled.params)).resolves.toBeDefined();
      await expect(run(compiled.flagSql, compiled.flagParams)).resolves.toBeDefined();
    });
  }
});

describe("values are bound, never interpolated", () => {
  it("keeps a hostile filter value out of the SQL text entirely", () => {
    const hostile = "'; DROP TABLE fact; --";
    const compiled = compilePlan({
      plan_type: "breakdown", interpretation: "x",
      filters: [{ field: "campaign", op: "eq", value: hostile }],
      metrics: ["spend_usd"], dimensions: ["channel"], time_range: WINDOW,
    });

    expect(compiled.sql).not.toContain("DROP");
    expect(compiled.sql).not.toContain(hostile);
    expect(Object.values(compiled.params)).toContain(hostile);
  });

  it("binds each element of an IN list separately", () => {
    const compiled = compilePlan({
      plan_type: "breakdown", interpretation: "x",
      filters: [{ field: "channel", op: "in", value: ["meta", "youtube"] }],
      metrics: ["spend_usd"], dimensions: ["channel"], time_range: WINDOW,
    });
    expect(compiled.sql).toContain("channel IN (");
    expect(compiled.sql).not.toContain("meta");
    expect(Object.values(compiled.params)).toEqual(expect.arrayContaining(["meta", "youtube"]));
  });

  it("binds the window rather than splicing dates in", () => {
    const compiled = compilePlan(PLANS.single_value);
    expect(compiled.sql).not.toContain("2026-08-01");
    expect(compiled.params.from).toBe("2026-08-01");
    expect(compiled.params.to).toBe("2026-08-31");
  });
});

describe("ratios divide after aggregating", () => {
  it("emits SUM(a)/SUM(b), never AVG of a row-level ratio", () => {
    const compiled = compilePlan({
      plan_type: "single_value", interpretation: "x", filters: [],
      metrics: ["roas"], time_range: WINDOW,
    });
    expect(compiled.sql).toContain("SUM(revenue_usd) / NULLIF(SUM(spend_usd), 0)");
    expect(compiled.sql).not.toContain("AVG(");
  });

  it("brings the ratio's components onto the table so the number is checkable", () => {
    const compiled = compilePlan({
      plan_type: "single_value", interpretation: "x", filters: [],
      metrics: ["roas"], time_range: WINDOW,
    });
    expect(compiled.columns).toEqual(["roas", "revenue_usd", "spend_usd"]);
  });
});

describe("a measure filter becomes HAVING, not WHERE", () => {
  it("filters on total spend after grouping", () => {
    const compiled = compilePlan({
      plan_type: "ranking", interpretation: "x",
      filters: [{ field: "spend_usd", op: "gte", value: 5000 }],
      metrics: ["roas"], dimensions: ["campaign"], time_range: WINDOW,
      order_by: "roas", direction: "asc", limit: 10,
    });
    // A row-level `spend_usd >= 5000` would silently answer a different
    // question: campaigns with one big day, not campaigns with real volume.
    expect(compiled.sql).toContain("HAVING SUM(spend_usd) >=");
  });
});

describe("the compiler refuses rather than improvises", () => {
  it("will not compile an unanswerable plan", () => {
    const plan = PlanSchema.parse({
      plan_type: "unanswerable", interpretation: "x", filters: [],
      reason: "no_such_entity", missing: "competitors",
    }) as Plan;
    expect(() => compile(plan, null, "demo")).toThrow(CompileError);
  });

  it("will not compile without a tenant", () => {
    const plan = PlanSchema.parse(PLANS.single_value);
    const verdict = validatePlan(plan, COVERAGE);
    if (!verdict.ok) throw new Error("unexpected refusal");
    expect(() => compile(verdict.plan, verdict.range, "")).toThrow(CompileError);
  });
});

describe("the turn-off template applies the policy, not the model", () => {
  it("restricts to conversion campaigns above the spend floor", async () => {
    const coverage = await getCoverage();
    const plan = PlanSchema.parse(PLANS.turn_off_candidate);
    const verdict = validatePlan(plan, coverage);
    if (!verdict.ok) throw new Error("unexpected refusal");
    const compiled = compile(verdict.plan, verdict.range, "demo");

    expect(compiled.sql).toContain("objective IN (");
    expect(compiled.sql).toContain("HAVING SUM(spend_usd) >=");
    expect(Object.values(compiled.params)).toContain("conversions");
    expect(Object.values(compiled.params)).toContain(5000);
    // The lookback is policy, not the user's.
    expect(verdict.range?.resolved).toEqual(["2026-08-08", "2026-09-04"]);
  });
});

describe("budget pacing stays in campaign-native currency", () => {
  it("sums raw spend against the budget, never the converted figure", () => {
    const compiled = compilePlan(PLANS.budget_pacing);
    expect(compiled.sql).toContain("SUM(spend)");
    expect(compiled.sql).not.toContain("SUM(spend_usd)");
  });
});
