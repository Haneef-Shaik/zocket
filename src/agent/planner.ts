/**
 * LLM #1 of 2: question -> typed plan.
 *
 * Structured output, so the model cannot return a shape the compiler can't
 * read. It sees the metric catalogue and the coverage window -- never a data
 * row.
 *
 * This is the larger of the two places a wrong model decision is *visible*: if
 * it plans the wrong metric the user sees it in the interpretation line and the
 * plan JSON immediately. That visibility is exactly why this step is allowed to
 * be model-decided at all -- see Design.md §5.
 */

import type { Plan } from "@/plan/schema";
import type { Coverage } from "@/db/duckdb";
import type { ResolvedLlmConfig } from "@/llm/config";
import { structured } from "@/llm/client";
import { PlanEnvelopeSchema, unwrapPlan } from "@/plan/wire";
import { plannerSystemPrompt } from "@/agent/prompts/render";

export async function plan(
  question: string,
  coverage: Coverage,
  config: ResolvedLlmConfig,
): Promise<Plan> {
  const envelope = await structured({
    config,
    system: plannerSystemPrompt(coverage),
    user: question,
    schema: PlanEnvelopeSchema,
    schemaName: "plan",
    maxTokens: 6000,
  });

  return unwrapPlan(envelope);
}
