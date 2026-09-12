/**
 * `npm run sql -- "SELECT channel, SUM(spend_usd) FROM fact GROUP BY 1"`
 *
 * A read-eval loop over the canonical model -- the same `fact` view every
 * answer is computed from, with every policy already applied.
 *
 * Two reasons it exists. The brief says "we will be checking your numbers", and
 * checking them should not require writing a script. And re-baselining the
 * golden set against a different extract (see the README) is a handful of
 * queries, so they should be a handful of commands.
 *
 * It takes no plan and no model. Anything typed here is hand-written SQL and is
 * therefore *not* the request path: the agent cannot reach this file.
 */

import "./env";

import { getCoverage, run } from "@/db/duckdb";

const sql = process.argv.slice(2).join(" ").trim();
if (!sql) {
  console.error('usage: npm run sql -- "SELECT * FROM coverage"');
  console.error("       views: fact, coverage, campaigns, creatives, fx_spine, perf_typed");
  process.exit(1);
}

function display(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && v !== null) return String(v);
  return v;
}

const coverage = await getCoverage();
console.error(
  `-- ${coverage.rowCount} rows, ${coverage.firstDate} to ${coverage.lastDate} (as_of = ${coverage.lastDate})`,
);

const rows = await run(sql);
if (rows.length === 0) {
  console.log("(no rows)");
} else {
  // Two renderings console.table gets wrong on its own: BigInt (from COUNT and
  // SUM over integers) prints as "10n", and a DATE arrives as a wrapper object
  // that dumps as `DuckDBDateValue { days: 20605 }`. Both have a sensible
  // string or number form; use it.
  console.table(rows.map((r) => Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, display(v)]),
  )));
}
