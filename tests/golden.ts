/**
 * The golden set: loading, locating, and asserting.
 *
 * Shared by both layers of the check -- the deterministic one that runs on
 * every `npm test`, and the opt-in LLM one that runs the planner for real.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PlanSchema, type Plan } from "@/plan/schema";
import type { VerifiedResult, ResultRow } from "@/agent/types";

export interface GoldenCase {
  readonly id: string;
  readonly question: string;
  readonly tags: readonly string[];
  readonly agent_plan: unknown;
  readonly expect: {
    readonly plan: Record<string, unknown>;
    readonly values?: Record<string, number>;
    readonly top_1?: string;
    readonly tolerance_pct?: number;
    readonly must_flag?: readonly string[];
    /** The wrong answer this case exists to prevent. Quoted in every failure. */
    readonly guard?: string;
  };
}

export function loadGolden(): readonly GoldenCase[] {
  const file = path.join(process.cwd(), "examples", "golden.jsonl");
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as GoldenCase);
}

export function planFor(c: GoldenCase): Plan {
  return PlanSchema.parse(c.agent_plan);
}

/* ----------------------------------------------------------------- locating */

const cell = (row: ResultRow | undefined, key: string): number =>
  typeof row?.[key] === "number" ? (row[key] as number) : Number.NaN;

const byLabel = (r: VerifiedResult, name: string): ResultRow | undefined =>
  r.rows.find((row) => row.label === name);

const total = (r: VerifiedResult, key: string): number =>
  r.rows.reduce((sum, row) => sum + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);

/**
 * Where each case's expected values live in the result.
 *
 * The *numbers* stay in golden.jsonl -- that file is the oracle and was derived
 * independently of this code. This map only says where to look for them, which
 * is a property of the result shape rather than of the answer.
 */
export const LOCATORS: Readonly<
  Record<string, (r: VerifiedResult) => Record<string, number>>
> = {
  q1_spend_by_channel: (r) => ({
    meta: cell(byLabel(r, "meta"), "spend_usd"),
    youtube: cell(byLabel(r, "youtube"), "spend_usd"),
    google_search: cell(byLabel(r, "google_search"), "spend_usd"),
    linkedin: cell(byLabel(r, "linkedin"), "spend_usd"),
    unmapped: cell(byLabel(r, "unmapped"), "spend_usd"),
    total: total(r, "spend_usd"),
  }),

  q2_top_revenue_this_quarter: (r) => ({
    meta_prospecting_us: cell(byLabel(r, "meta_prospecting_us"), "revenue_usd"),
    summer_sale_meta: cell(byLabel(r, "summer_sale_meta"), "revenue_usd"),
  }),

  q3_conversions_cliff: (r) => ({
    baseline_per_day: total(r, "baseline_per_day"),
    target_day: total(r, "target_value"),
    meta_delta: cell(byLabel(r, "meta"), "delta"),
    youtube_delta: cell(byLabel(r, "youtube"), "delta"),
    rows_target_day: total(r, "target_rows"),
    rows_typical_day: total(r, "baseline_rows_per_day"),
  }),

  q4_which_to_turn_off: (r) => ({
    meta_prospecting_in_roas: cell(byLabel(r, "meta_prospecting_in"), "roas"),
    meta_prospecting_in_spend: cell(byLabel(r, "meta_prospecting_in"), "spend_usd"),
  }),

  t1_week_over_week: (r) => {
    const current = cell(byLabel(r, "current"), "conversions");
    const prior = cell(byLabel(r, "prior"), "conversions");
    return {
      conversions_current: current,
      conversions_prior: prior,
      pct_change: ((current - prior) / prior) * 100,
    };
  },

  t4_last_quarter_clipped: (r) => ({
    roas: cell(r.rows[0], "roas"),
    spend_usd: cell(r.rows[0], "spend_usd"),
    revenue_usd: cell(r.rows[0], "revenue_usd"),
  }),

  t6_august_conversions_dedup: (r) => ({ conversions: cell(r.rows[0], "conversions") }),

  t7_best_day: (r) => ({
    revenue_usd: cell(r.rows[0], "revenue_usd"),
    conversions: cell(r.rows[0], "conversions"),
  }),

  n13_budget_pacing_is_answerable: (r) => ({
    youtube_prospecting_us: cell(byLabel(r, "youtube_prospecting_us"), "pacing_pct"),
    brand_search_us: cell(byLabel(r, "brand_search_us"), "pacing_pct"),
    nonbrand_search_us: cell(byLabel(r, "nonbrand_search_us"), "pacing_pct"),
  }),
};

/** The row a `top_1` expectation refers to. */
export function topLabel(r: VerifiedResult): string {
  return String(r.rows[0]?.label ?? "");
}

/* ---------------------------------------------------------------- asserting */

/**
 * A failing golden case names the wrong answer it caught, not just the delta.
 *
 * "expected 5584, got 5650" tells you a number moved. "inflated by 66 re-sent
 * duplicate rows" tells you which policy you broke, which is the difference
 * between a failing test and a diagnosis.
 */
/**
 * Half the place value of the last digit the expectation was written to.
 *
 * The golden numbers are rounded renderings of exact quantities -- 178.3, 2.91,
 * 0.2. A relative tolerance alone is the wrong model for those: 1% of 0.2 is
 * 0.002, which demands four digits of agreement from a figure that was only
 * ever written to one. The floor says "agrees at the precision it was stated
 * to", which is what the expectation actually claims.
 */
function writtenPrecision(expected: number): number {
  const decimals = (String(expected).split(".")[1] ?? "").length;
  return Math.pow(10, -decimals) / 2;
}

export function assertClose(
  actual: number,
  expected: number,
  tolerancePct: number,
  context: string,
  guard?: string,
): void {
  const tolerance = Math.max(
    Math.abs(expected) * (tolerancePct / 100),
    writtenPrecision(expected),
    1e-9,
  );
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance) return;

  throw new Error(
    `${context}\n` +
      `  expected ${expected} (±${tolerancePct}%), got ${Number.isFinite(actual) ? actual : "nothing"}\n` +
      (guard ? `  this is the case that prevents: ${guard}\n` : ""),
  );
}

export function assertEquals(actual: string, expected: string, context: string, guard?: string): void {
  if (actual === expected) return;
  throw new Error(
    `${context}\n  expected "${expected}", got "${actual}"\n` +
      (guard ? `  this is the case that prevents: ${guard}\n` : ""),
  );
}
