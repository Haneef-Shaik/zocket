/**
 * Layer 1 of the automated check: deterministic, no LLM, no API key, no flake.
 *
 * Each case's expected plan goes through validator -> compiler -> DuckDB ->
 * result validator, and the numbers and flags are asserted. This is the layer
 * that catches the regressions which actually corrupt answers: a changed dedup
 * rule, a dropped FX join, a broken coverage clip. It is free, so it runs on
 * every `npm test` and there is no excuse to skip it.
 *
 * Layer 2 -- does the *model* still choose the right plan -- is in
 * tests/goldenLlm.test.ts and is opt-in, because it costs money and can flake.
 */

import { describe, expect, it } from "vitest";
import { getCoverage } from "@/db/duckdb";
import { execute } from "@/agent/execute";
import {
  assertClose,
  assertEquals,
  loadGolden,
  LOCATORS,
  planFor,
  topLabel,
} from "./golden";

const CASES = loadGolden();

describe("golden set (deterministic layer)", () => {
  it("loads all twelve cases", () => {
    expect(CASES).toHaveLength(12);
  });

  for (const c of CASES) {
    const expected = c.expect;
    const expectsRefusal = expected.plan.plan_type === "unanswerable";

    it(`${c.id}: ${c.question}`, async () => {
      const coverage = await getCoverage();
      const run = await execute(planFor(c), coverage, "demo");

      if (expectsRefusal) {
        if (run.verdict.ok) {
          throw new Error(
            `${c.id} was answered, but it must be refused.\n` +
              (expected.guard ? `  this is the case that prevents: ${expected.guard}\n` : ""),
          );
        }
        assertEquals(
          run.verdict.reason,
          String(expected.plan.reason),
          `${c.id}: refusal reason`,
          expected.guard,
        );
        return;
      }

      if (!run.verdict.ok) {
        throw new Error(`${c.id} was refused (${run.verdict.reason}) but should have answered.`);
      }

      const { verdict, result } = run;
      expect(result).not.toBeNull();
      if (!result) return;

      // -- the window ------------------------------------------------------
      const wanted = expected.plan.range_resolved as [string, string] | undefined;
      if (wanted) {
        assertEquals(
          `${verdict.range?.resolved[0]}..${verdict.range?.resolved[1]}`,
          `${wanted[0]}..${wanted[1]}`,
          `${c.id}: resolved window`,
          expected.guard,
        );
      }
      if (expected.plan.range_clipped === true) {
        expect(verdict.range?.clipped, `${c.id}: the window should be clipped`).toBe(true);
      }

      // -- the numbers -----------------------------------------------------
      const locate = LOCATORS[c.id];
      if (locate && expected.values) {
        const actual = locate(result);
        for (const [key, value] of Object.entries(expected.values)) {
          assertClose(
            actual[key] ?? Number.NaN,
            value,
            expected.tolerance_pct ?? 1,
            `${c.id}: ${key}`,
            expected.guard,
          );
        }
      }

      if (expected.top_1) {
        assertEquals(topLabel(result), expected.top_1, `${c.id}: top row`, expected.guard);
      }

      // -- the flags -------------------------------------------------------
      for (const code of expected.must_flag ?? []) {
        const raised = run.flags.map((f) => f.code);
        if (!raised.includes(code as never)) {
          throw new Error(
            `${c.id}: expected flag "${code}", got [${raised.join(", ")}]\n` +
              (expected.guard ? `  this is the case that prevents: ${expected.guard}\n` : ""),
          );
        }
      }
    });
  }
});

describe("a clean window raises no warnings", () => {
  it("June has no partial day, no clipping, and no currency mismatch", async () => {
    const coverage = await getCoverage();
    const run = await execute(
      {
        plan_type: "single_value",
        interpretation: "spend in a clean window",
        filters: [],
        metrics: ["spend_usd"],
        time_range: { type: "absolute", start: "2026-06-10", end: "2026-06-20" },
      },
      coverage,
      "demo",
    );

    expect(run.verdict.ok).toBe(true);
    const codes = run.flags.filter((f) => f.severity === "warn").map((f) => f.code);
    expect(codes).not.toContain("partial_day");
    expect(codes).not.toContain("coverage_clipped");
  });
});
