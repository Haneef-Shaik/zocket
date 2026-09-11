/**
 * Prompt assembly.
 *
 * The catalogue section is generated from `src/semantic/catalogue.ts` rather
 * than written out in the markdown, so a metric added in code cannot go missing
 * from the prompt. A prompt that has drifted from the semantic layer is how a
 * model ends up confidently choosing a metric that no longer exists.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { DIMENSIONS, FILTERABLE, METRICS } from "@/semantic/catalogue";
import { TURN_OFF_POLICY } from "@/semantic/policies";
import type { Coverage } from "@/db/duckdb";

const PROMPT_DIR = path.join(process.cwd(), "src", "agent", "prompts");

/** Read once per process: these are files on disk, not user input. */
const cache = new Map<string, string>();

function load(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(path.join(PROMPT_DIR, name), "utf8");
    cache.set(name, text);
  }
  return text;
}

function catalogueSection(): string {
  const metrics = Object.values(METRICS)
    .map((m) => `| \`${m.id}\` | ${m.label} | ${m.unit} | ${m.synonyms.join(", ")} |`)
    .join("\n");

  const dimensions = Object.values(DIMENSIONS)
    .map((d) => `| \`${d.id}\` | ${d.label} | ${d.synonyms.join(", ")} |`)
    .join("\n");

  return `**Metrics** — the only ones that exist. Use the id exactly.

| id | means | unit | users also say |
|---|---|---|---|
${metrics}

**Dimensions** — the only splits that exist.

| id | means | users also say |
|---|---|---|
${dimensions}

Ratio metrics are aggregated correctly for you (\`SUM(a)/SUM(b)\`), and their
components are added to the result automatically — ask for \`roas\`, not for
revenue and spend separately.

The turn-off policy, applied by code: trailing ${TURN_OFF_POLICY.lookbackDays} days, objective
\`${TURN_OFF_POLICY.objectives.join(", ")}\` only, at least $${TURN_OFF_POLICY.minSpendUsd.toLocaleString("en-US")} of spend,
ranked by ${TURN_OFF_POLICY.rankBy} ${TURN_OFF_POLICY.direction === "asc" ? "ascending" : "descending"}.`;
}

export function plannerSystemPrompt(coverage: Coverage): string {
  return load("planner.md")
    .replaceAll("{{CATALOGUE}}", catalogueSection())
    .replaceAll("{{FIRST_DATE}}", coverage.firstDate)
    .replaceAll("{{LAST_DATE}}", coverage.lastDate)
    .replaceAll("{{FILTERABLE}}", FILTERABLE.map((f) => `\`${f}\``).join(", "));
}

export function narratorSystemPrompt(): string {
  return load("narrator.md");
}
