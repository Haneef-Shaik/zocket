/**
 * The model saying "answerable" is a proposal, not a verdict.
 *
 * The case that matters most is the quiet one: a well-formed plan over a window
 * with no data. Left alone it becomes SUM() over zero rows, which is 0, which
 * reads as "we spent nothing" rather than "there is no data for May".
 */

import { describe, expect, it } from "vitest";
import { PlanSchema } from "@/plan/schema";
import { validatePlan } from "@/plan/validate";
import { DIMENSION_IDS } from "@/semantic/catalogue";

const COVERAGE = { firstDate: "2026-06-08", lastDate: "2026-09-04", rowCount: 2341 };

const verdictFor = (raw: unknown) => validatePlan(PlanSchema.parse(raw), COVERAGE);

describe("an empty window is forced to a refusal", () => {
  it("n5: May is outside coverage and must not return $0", () => {
    const verdict = verdictFor({
      plan_type: "breakdown", interpretation: "May spend by channel", filters: [],
      metrics: ["spend_usd"], dimensions: ["channel"],
      time_range: { type: "absolute", start: "2026-05-01", end: "2026-05-31" },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("outside_coverage");
    expect(verdict.available.join(" ")).toContain("2026-06-08");
    expect(verdict.available.join(" ")).toContain("2026-09-04");
  });

  it("refuses when only the comparison window is empty", () => {
    const verdict = verdictFor({
      plan_type: "compare_periods", interpretation: "x", filters: [], dimensions: [],
      metrics: ["conversions"],
      time_range: { type: "absolute", start: "2026-08-01", end: "2026-08-31" },
      comparison: { type: "absolute", start: "2026-01-01", end: "2026-01-31" },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("outside_coverage");
  });

  it("a partly-covered window clips rather than refusing", () => {
    const verdict = verdictFor({
      plan_type: "single_value", interpretation: "x", filters: [], metrics: ["roas"],
      time_range: { type: "absolute", start: "2026-04-01", end: "2026-06-30" },
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.range?.clipped).toBe(true);
    expect(verdict.range?.resolved).toEqual(["2026-06-08", "2026-06-30"]);
  });
});

describe("a refusal says what does exist", () => {
  it("n2: no device dimension, and the answer lists the ones there are", () => {
    const verdict = verdictFor({
      plan_type: "unanswerable", interpretation: "no device data", filters: [],
      reason: "no_such_dimension", missing: "a device column on the performance export",
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("no_such_dimension");
    expect(verdict.available).toEqual(DIMENSION_IDS);
    expect(verdict.available).toContain("channel");
    expect(verdict.available).not.toContain("device");
  });

  it("q5: competitors are absent, and the refusal carries the alternatives", () => {
    const verdict = verdictFor({
      plan_type: "unanswerable", interpretation: "no competitor data", filters: [],
      reason: "no_such_entity", missing: "a competitor spend feed",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("no_such_entity");
      expect(verdict.available.length).toBeGreaterThan(0);
    }
  });
});

describe("answerable plans pass", () => {
  it("n13: budget pacing is answerable and must not be refused", () => {
    const verdict = verdictFor({
      plan_type: "budget_pacing", interpretation: "budget caps", filters: [],
      time_range: { type: "relative", n: 1, unit: "week", calendar: true, offset: 0 },
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.range?.resolved).toEqual(["2026-08-28", "2026-09-03"]);
  });

  it("resolves the policy window for a turn-off candidate", () => {
    const verdict = verdictFor({
      plan_type: "turn_off_candidate", interpretation: "x", filters: [],
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.range?.resolved).toEqual(["2026-08-08", "2026-09-04"]);
  });

  it("spans baseline and target day for a drop diagnosis", () => {
    const verdict = verdictFor({
      plan_type: "diagnose_drop", interpretation: "x", filters: [],
      metric: "conversions", target_date: "latest", baseline_days: 7,
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.range?.resolved).toEqual(["2026-08-28", "2026-09-04"]);
  });
});
