/**
 * Provenance. Without it a disputed number is an argument; with it, it is a diff.
 */

import { SEMANTIC_VERSION } from "@/semantic/catalogue";
import { POLICY_VERSION } from "@/semantic/policies";
import { PLAN_GRAMMAR_VERSION } from "@/plan/schema";

export const COMPILER_VERSION = "v1";
export const PLANNER_PROMPT_VERSION = "planner-v1";
export const NARRATOR_PROMPT_VERSION = "narrator-v1";

export interface Trace {
  readonly traceId: string;
  readonly askedAt: string;
  readonly question: string;
  /** Provider and deployment the answer was produced with. Never the key. */
  readonly provider: "azure-openai";
  readonly model: string;
  /** "byok" when the caller supplied their own credentials. */
  readonly credentialMode: "byok" | "shared";
  readonly plannerPromptVersion: string;
  readonly narratorPromptVersion: string;
  readonly semanticVersion: string;
  readonly policyVersion: string;
  readonly planGrammarVersion: string;
  readonly compilerVersion: string;
  /** Coverage window of the data the answer was built from. */
  readonly dataVersion: string;
  readonly latencyMs: { plan: number; query: number; narrate: number; total: number };
}

export function newTrace(
  question: string,
  model: string,
  credentialMode: "byok" | "shared",
  dataVersion: string,
): Omit<Trace, "latencyMs"> {
  return {
    traceId: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    askedAt: new Date().toISOString(),
    question,
    provider: "azure-openai",
    model,
    credentialMode,
    plannerPromptVersion: PLANNER_PROMPT_VERSION,
    narratorPromptVersion: NARRATOR_PROMPT_VERSION,
    semanticVersion: SEMANTIC_VERSION,
    policyVersion: POLICY_VERSION,
    planGrammarVersion: PLAN_GRAMMAR_VERSION,
    compilerVersion: COMPILER_VERSION,
    dataVersion,
  };
}
