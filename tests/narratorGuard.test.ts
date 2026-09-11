/**
 * The guard is the cheapest real defence against the one failure the whole
 * design exists to prevent, and it is deterministic -- it does not ask a model
 * whether a model hallucinated.
 */

import { describe, expect, it } from "vitest";
import { checkNarration } from "@/verify/narratorGuard";
import { templateFinding } from "@/agent/compose";
import { getCoverage } from "@/db/duckdb";
import { execute } from "@/agent/execute";
import { loadGolden, planFor } from "./golden";
import type { VerifiedResult } from "@/agent/types";
import type { Flag } from "@/verify/flags";

const RESULT: VerifiedResult = {
  columns: ["label", "spend_usd"],
  rows: [
    { label: "meta", spend_usd: 162489.73 },
    { label: "youtube", spend_usd: 98384.17 },
    { label: "google_search", spend_usd: 82443.24 },
  ],
  range: ["2026-07-11", "2026-09-04"],
};

const FLAGS: readonly Flag[] = [
  { code: "partial_day", severity: "warn", count: 11, message: "11 rows on the final day." },
];

describe("a fabricated figure is rejected", () => {
  it("rejects a number that is nowhere in the result", () => {
    const verdict = checkNarration(
      "Meta led on spend at $162.5k, followed by YouTube at $211,400.",
      RESULT,
      FLAGS,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported.join(" ")).toContain("211,400");
  });

  it("rejects an invented ratio even when it is plausible", () => {
    const verdict = checkNarration("Blended ROAS across these channels was 3.42.", RESULT, FLAGS);
    expect(verdict.ok).toBe(false);
  });

  it("rejects a total that was not computed", () => {
    // The real total is 343,317. 400,000 is the kind of round number a model
    // reaches for when it is summarising rather than reading.
    const verdict = checkNarration("Total spend was about $400,000.", RESULT, FLAGS);
    expect(verdict.ok).toBe(false);
  });
});

describe("legitimate prose passes", () => {
  it("accepts figures rounded for readability", () => {
    expect(checkNarration("Meta led at $162.5k, ahead of YouTube at $98.4k.", RESULT, FLAGS).ok).toBe(
      true,
    );
  });

  it("accepts a column total", () => {
    expect(checkNarration("The three channels spent $343,317 between them.", RESULT, FLAGS).ok).toBe(
      true,
    );
  });

  it("accepts a percentage derived from two figures on the table", () => {
    // 162489.73 / 98384.17 - 1 = 65.2%
    expect(checkNarration("Meta spent 65.2% more than YouTube.", RESULT, FLAGS).ok).toBe(true);
  });

  it("accepts a flag count", () => {
    expect(checkNarration("The window includes 11 rows from an incomplete day.", RESULT, FLAGS).ok).toBe(
      true,
    );
  });

  it("does not trip over dates", () => {
    const prose = "Between 11 Jul and 4 Sep 2026, Meta led at $162.5k (window 2026-07-11 to 2026-09-04).";
    expect(checkNarration(prose, RESULT, FLAGS).ok).toBe(true);
  });

  it("checks something rather than passing everything", () => {
    expect(checkNarration("Meta led at $162.5k.", RESULT, FLAGS).checked).toBeGreaterThan(0);
  });
});

/**
 * The fallback narration is built only from values on the table, so it has to
 * satisfy the guard for every case in the golden set. If this fails, the
 * degradation path in orchestrate.ts would produce an answer the guard would
 * itself reject -- a fallback that cannot be fallen back to.
 */
describe("the deterministic fallback survives its own guard", () => {
  for (const c of loadGolden()) {
    if (c.expect.plan.plan_type === "unanswerable") continue;

    it(`${c.id}`, async () => {
      const coverage = await getCoverage();
      const run = await execute(planFor(c), coverage, "demo");
      if (!run.verdict.ok || !run.result) return;

      const finding = templateFinding(run.verdict.plan, run.result, run.flags);
      const verdict = checkNarration(finding, run.result, run.flags);

      expect(
        verdict.ok,
        `${c.id} fallback used unsupported figures ${verdict.unsupported.join(", ")}\n  ${finding}`,
      ).toBe(true);
      expect(finding.length).toBeGreaterThan(20);
    });
  }
});
