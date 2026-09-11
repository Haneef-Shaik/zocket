/**
 * LLM #2 of 2: verified numbers -> prose.
 *
 * It receives the result table and the flags. It cannot query, cannot
 * recompute, and every figure it writes must already appear in the table --
 * which the narrator guard checks before the answer is returned.
 *
 * PHASE 6 -- see PLAN.md.
 */

import type { VerifiedResult } from "@/agent/types";
import type { Flag } from "@/verify/flags";
import type { Plan } from "@/plan/schema";
import type { ResolvedLlmConfig } from "@/llm/config";

export function narrate(
  _plan: Plan,
  _result: VerifiedResult,
  _flags: readonly Flag[],
  _config: ResolvedLlmConfig,
): Promise<string> {
  throw new Error("NotImplemented: PLAN.md phase 6");
}
