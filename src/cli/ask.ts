/**
 * `npm run ask -- "which campaign should we turn off?"`
 *
 * The same answer as the browser, from the same code path. Useful for the demo,
 * and useful because a terminal transcript is a thing you can paste into a bug
 * report.
 */

// Must come first: it loads .env, and the imports below read it as they load.
import "./env";

import { ask } from "@/agent/orchestrate";
import { resolveLlmConfig } from "@/llm/config";

const question = process.argv.slice(2).join(" ");
if (!question) {
  console.error('usage: npm run ask -- "your question"');
  process.exit(1);
}

// The CLI always uses the server-side credentials from the environment; the
// per-device trial quota is an HTTP concern and does not apply here.
const answer = await ask(question, resolveLlmConfig({}));

console.log(`\n${answer.status.toUpperCase()}\n`);
console.log(`Interpreted as: ${answer.interpretation}\n`);
console.log(answer.finding);

if (answer.sql) console.log(`\n--- SQL ---\n${answer.sql}`);
if (answer.result?.rows.length) console.table(answer.result.rows.slice(0, 15));

for (const f of answer.flags) console.log(`[${f.severity}] ${f.code} (${f.count}): ${f.message}`);

const t = answer.trace;
console.log(
  `\ntrace ${t.traceId} · ${t.model} · plan ${t.latencyMs.plan}ms · query ${t.latencyMs.query}ms · narrate ${t.latencyMs.narrate}ms · total ${t.latencyMs.total}ms`,
);
