/**
 * LLM #2 of 2: verified numbers -> prose.
 *
 * It receives the result table and the flags. It cannot query, cannot
 * recompute, and every figure it writes must already appear in the table --
 * which the narrator guard checks before the answer is returned.
 *
 * The model is doing the one thing it is genuinely better at than code, and
 * nothing else. The numbers were never its to produce, which is why losing this
 * call degrades the prose and not the answer (see `templateFinding`).
 */

import { z } from "zod";
import type { VerifiedResult } from "@/agent/types";
import type { Flag } from "@/verify/flags";
import type { Plan } from "@/plan/schema";
import type { ResolvedLlmConfig } from "@/llm/config";
import { structured } from "@/llm/client";
import { narratorSystemPrompt } from "@/agent/prompts/render";
import { checkNarration, NarratorGuardError } from "@/verify/narratorGuard";

const FindingSchema = z.object({
  finding: z.string().min(1),
});

/** The table, flattened to something a model reads reliably. */
function renderResult(result: VerifiedResult, flags: readonly Flag[]): string {
  const header = result.columns.join(" | ");
  const divider = result.columns.map(() => "---").join(" | ");
  const body = result.rows
    .slice(0, 60)
    .map((row) =>
      result.columns
        .map((c) => {
          const cell = row[c];
          return typeof cell === "number" ? round(cell) : (cell ?? "");
        })
        .join(" | "),
    )
    .join("\n");

  const window = result.range ? `Window: ${result.range[0]} to ${result.range[1]}` : "Window: all data";
  const flagLines = flags.length
    ? flags.map((f) => `- [${f.severity}] ${f.code} (${f.count}): ${f.message}`).join("\n")
    : "- none";

  return `${window}

${header}
${divider}
${body}

Data-quality flags on exactly these rows:
${flagLines}`;
}

/** Enough precision to be honest, few enough digits to be quotable. */
function round(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export async function narrate(
  plan: Plan,
  result: VerifiedResult,
  flags: readonly Flag[],
  config: ResolvedLlmConfig,
): Promise<string> {
  const table = renderResult(result, flags);
  const base = `Question as interpreted: ${plan.interpretation}
Plan type: ${plan.plan_type}

${table}`;

  const first = await structured({
    config,
    system: narratorSystemPrompt(),
    user: base,
    schema: FindingSchema,
    schemaName: "finding",
    maxTokens: 3000,
  });

  const verdict = checkNarration(first.finding, result, flags);
  if (verdict.ok) return first.finding.trim();

  // One correction pass. A model that used a figure it should not have will
  // usually drop it when told which one; a model that does it twice is not
  // going to be argued out of it, and the caller falls back to the template.
  const retry = await structured({
    config,
    system: narratorSystemPrompt(),
    user: `${base}

Your previous answer was rejected. These figures do not appear in the table
above: ${verdict.unsupported.join(", ")}.

Write it again using only figures from the table. If you cannot support a
comparison with the numbers given, leave it out.`,
    schema: FindingSchema,
    schemaName: "finding",
    maxTokens: 3000,
  });

  const second = checkNarration(retry.finding, result, flags);
  if (second.ok) return retry.finding.trim();

  throw new NarratorGuardError(second.unsupported);
}
