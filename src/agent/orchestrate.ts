/**
 * The loop, written by hand rather than borrowed from a framework.
 *
 * It is nine lines of control flow and the trust boundary is the product --
 * hiding it inside someone else's abstraction would make it harder to see and
 * harder to test.
 *
 * PHASE 7 -- see PLAN.md.
 */

import type { Answer } from "@/agent/types";
import type { ResolvedLlmConfig } from "@/llm/config";

export function ask(
  _question: string,
  _config: ResolvedLlmConfig,
  _tenantId = "demo",
): Promise<Answer> {
  throw new Error("NotImplemented: PLAN.md phase 7");
}
