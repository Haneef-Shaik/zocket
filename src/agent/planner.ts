/**
 * LLM #1 of 2: question -> typed plan.
 *
 * Structured output, so the model cannot return a shape the compiler can't
 * read. It sees the metric catalogue and the coverage window -- never a data
 * row.
 *
 * PHASE 5 -- see PLAN.md.
 */

import type { Plan } from "@/plan/schema";
import type { Coverage } from "@/db/duckdb";
import type { ResolvedLlmConfig } from "@/llm/config";

export function plan(
  _question: string,
  _coverage: Coverage,
  _config: ResolvedLlmConfig,
): Promise<Plan> {
  throw new Error("NotImplemented: PLAN.md phase 5");
}
