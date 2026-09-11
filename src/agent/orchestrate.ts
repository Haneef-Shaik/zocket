/**
 * The loop, written by hand rather than borrowed from a framework.
 *
 * It is a dozen lines of control flow and the trust boundary *is* the product --
 * hiding it inside someone else's abstraction would make it harder to see and
 * harder to test. Read top to bottom, the two model calls are the first and
 * last things that happen, and everything that decides a number sits between
 * them in ordinary code.
 */

import type { Answer } from "@/agent/types";
import type { ResolvedLlmConfig } from "@/llm/config";
import { getCoverage } from "@/db/duckdb";
import { plan as planQuestion } from "@/agent/planner";
import { narrate } from "@/agent/narrator";
import { execute } from "@/agent/execute";
import { interpretation, refusal, templateFinding } from "@/agent/compose";
import { newTrace } from "@/trace/trace";

export async function ask(
  question: string,
  config: ResolvedLlmConfig,
  tenantId = "demo",
): Promise<Answer> {
  const started = Date.now();
  const coverage = await getCoverage();
  const stamp = newTrace(
    question,
    config.model.id,
    config.mode,
    `${coverage.firstDate}..${coverage.lastDate} (${coverage.rowCount} rows)`,
  );

  // 1 -- LLM: question to typed plan.
  const planStart = Date.now();
  const plan = await planQuestion(question, coverage, config);
  const planMs = Date.now() - planStart;

  // 2 -- deterministic: validate, compile, execute, verify, choose a chart.
  const queryStart = Date.now();
  const run = await execute(plan, coverage, tenantId);
  const queryMs = Date.now() - queryStart;

  const trace = (narrateMs: number) => ({
    ...stamp,
    latencyMs: {
      plan: planMs,
      query: queryMs,
      narrate: narrateMs,
      total: Date.now() - started,
    },
  });

  // 3 -- a refusal is composed, never generated. The one question where a model
  // filling the silence would be most convincing is the one where it would be
  // most wrong.
  if (!run.verdict.ok) {
    return {
      status: "refused",
      interpretation: plan.interpretation,
      finding: refusal(run.verdict, coverage),
      plan,
      sql: null,
      result: null,
      chart: null,
      flags: [],
      trace: trace(0),
    };
  }

  const { verdict, compiled, result, flags, chart } = run;
  const line = interpretation(verdict.plan, verdict.range, verdict.comparison);

  if (!result || result.rows.length === 0) {
    return {
      status: "answered",
      interpretation: line,
      finding:
        `Nothing in the data matches that. The window resolved and was queried, so this is an ` +
        `empty result rather than a missing one — the filters excluded every row.`,
      plan: verdict.plan,
      sql: compiled?.sql ?? null,
      result,
      chart,
      flags,
      trace: trace(0),
    };
  }

  // 4 -- LLM: verified numbers to prose, then the guard. If the narrator is
  // unavailable or invents a figure twice, the answer degrades to a template
  // over the same numbers rather than failing: the figures were never the
  // model's to produce, so losing it costs style and nothing else.
  const narrateStart = Date.now();
  let finding: string;
  try {
    finding = await narrate(verdict.plan, result, flags, config);
  } catch {
    finding = templateFinding(verdict.plan, result, flags);
  }
  const narrateMs = Date.now() - narrateStart;

  return {
    status: "answered",
    interpretation: line,
    finding,
    plan: verdict.plan,
    sql: compiled?.sql ?? null,
    result,
    chart,
    flags,
    trace: trace(narrateMs),
  };
}
