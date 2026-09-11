/**
 * Layer 2 of the automated check: does the *model* still choose the right plan?
 *
 * It asserts the emitted plan's shape -- type, metrics, dimensions, resolved
 * window -- and never the prose. Prose is not a regression surface; a plan is.
 * This is the layer that answers "we changed a prompt on Friday and answers got
 * worse on Monday": prompt v7 scored 12/12, v8 scores 10/12, v8 is rejected.
 *
 * Opt-in via `GOLDEN_LLM=1 npm run test:llm`, because it costs money per run
 * and can flake on a provider hiccup. Keeping it out of the default run is what
 * lets `npm test` stay free, offline, and deterministic -- and therefore what
 * lets it actually run on every change.
 */

import { describe, expect, it } from "vitest";
import { getCoverage } from "@/db/duckdb";
import { plan as planQuestion } from "@/agent/planner";
import { validatePlan } from "@/plan/validate";
import { resolveLlmConfig } from "@/llm/config";
import { loadGolden } from "./golden";

const ENABLED = process.env.GOLDEN_LLM === "1";

/**
 * Plan types that are equally right for a case.
 *
 * `turn_off_candidate` and the ranking it expands to are the same answer; so
 * are `budget_pacing` and a ranking over the same columns. The check is whether
 * the model understood the question, not whether it picked our favourite label.
 */
const ALSO_ACCEPTABLE: Readonly<Record<string, readonly string[]>> = {
  turn_off_candidate: ["ranking"],
  budget_pacing: ["ranking"],
  ranking: ["turn_off_candidate", "budget_pacing", "breakdown"],
  breakdown: ["ranking"],
};

describe.skipIf(!ENABLED)("golden set (LLM planning layer)", () => {
  const cases = loadGolden();
  const scores: { id: string; ok: boolean; note: string }[] = [];

  for (const c of cases) {
    const wanted = String((c.agent_plan as { plan_type: string }).plan_type);
    const alsoWanted = String(c.expect.plan.plan_type);

    it(`${c.id}: ${c.question}`, async () => {
      const coverage = await getCoverage();
      const config = resolveLlmConfig({});
      const emitted = await planQuestion(c.question, coverage, config);

      const accepted = new Set([wanted, alsoWanted, ...(ALSO_ACCEPTABLE[wanted] ?? [])]);
      const typeOk = accepted.has(emitted.plan_type);
      scores.push({
        id: c.id,
        ok: typeOk,
        note: `${emitted.plan_type} (wanted ${[...accepted].join("|")})`,
      });

      expect(
        typeOk,
        `${c.id}: emitted "${emitted.plan_type}", expected one of ${[...accepted].join(", ")}\n` +
          `  interpretation: ${emitted.interpretation}`,
      ).toBe(true);

      // A refusal case is about the reason, not the window.
      if (emitted.plan_type === "unanswerable") {
        if (alsoWanted === "unanswerable") {
          expect(emitted.reason, `${c.id}: refusal reason`).toBe(String(c.expect.plan.reason));
        }
        return;
      }

      // The window is the other thing that silently changes an answer.
      const expectedRange = c.expect.plan.range_resolved as [string, string] | undefined;
      if (expectedRange) {
        const verdict = validatePlan(emitted, coverage);
        if (verdict.ok && verdict.range) {
          expect(
            [verdict.range.resolved[0], verdict.range.resolved[1]],
            `${c.id}: resolved window\n  interpretation: ${emitted.interpretation}`,
          ).toEqual(expectedRange);
        }
      }

      // Where the case names the metrics, the model has to have found them.
      const expectedMetrics = c.expect.plan.metrics as string[] | undefined;
      if (expectedMetrics && "metrics" in emitted) {
        const got = new Set(emitted.metrics);
        const known = expectedMetrics.filter((m) => m !== "spend_per_day" && m !== "pacing_pct" && m !== "daily_budget");
        for (const metric of known) {
          expect(got.has(metric), `${c.id}: missing metric "${metric}" in [${[...got].join(", ")}]`).toBe(true);
        }
      }
    });
  }

  it("reports the score", () => {
    const passed = scores.filter((s) => s.ok).length;
    // eslint-disable-next-line no-console
    console.log(`\nplanner golden score: ${passed}/${scores.length}`);
    for (const s of scores.filter((x) => !x.ok)) console.log(`  miss ${s.id}: ${s.note}`);
  });
});

describe.skipIf(ENABLED)("golden LLM layer", () => {
  it("is opt-in, so the default run stays free and deterministic", () => {
    expect(ENABLED).toBe(false);
  });
});
