/** `npm run ask -- "which campaign should we turn off?"` */
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

console.log(`\n${answer.interpretation}\n`);
console.log(answer.finding);
console.log(`\n--- SQL ---\n${answer.sql ?? "(none)"}`);
console.table(answer.result?.rows ?? []);
for (const f of answer.flags) console.log(`[${f.severity}] ${f.code}: ${f.message}`);
console.log(`\ntrace ${answer.trace.traceId}`);
