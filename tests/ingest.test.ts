/**
 * The restatement policy is "last row in FILE ORDER wins", which only means
 * anything while `_ord` still reflects file order. That holds because ingest
 * runs single-threaded with insertion order preserved.
 *
 * If a DuckDB upgrade changes that default, restatements silently invert and
 * every number built on a restated key is wrong with nothing to show for it.
 * This test is the tripwire.
 */

import { describe, expect, it } from "vitest";
import { run } from "@/db/duckdb";

const num = (v: unknown) => Number(v);

describe("ingest order", () => {
  it("_ord is dense and starts at 1, so it means file order", async () => {
    const [r] = await run(
      `SELECT MIN(_ord) AS lo, MAX(_ord) AS hi, COUNT(*) AS n FROM raw_perf`,
    );
    expect(num(r?.lo)).toBe(1);
    expect(num(r?.hi)).toBe(num(r?.n));
  });

  it("the settings the policy depends on are actually in force", async () => {
    const [threads] = await run(`SELECT current_setting('threads') AS v`);
    const [order] = await run(`SELECT current_setting('preserve_insertion_order') AS v`);
    expect(num(threads?.v)).toBe(1);
    expect(String(order?.v)).toBe("true");
  });
});

describe("restatement: the later row wins", () => {
  it("there are restated keys to get wrong in the first place", async () => {
    const [r] = await run(`
      SELECT COUNT(*) AS n FROM (
        SELECT date, campaign_id, creative_id
        FROM perf_exact_dedup
        GROUP BY 1, 2, 3
        HAVING COUNT(*) > 1
      )`);
    expect(num(r?.n)).toBeGreaterThan(0);
  });

  it("every resolved row is the highest _ord for its key", async () => {
    const [r] = await run(`
      WITH keys AS (
          SELECT date, campaign_id, creative_id, MAX(_ord) AS last_ord
          FROM perf_exact_dedup
          GROUP BY 1, 2, 3
      )
      SELECT COUNT(*) AS wrong
      FROM perf_resolved p
      JOIN keys k
        ON k.date IS NOT DISTINCT FROM p.date
       AND k.campaign_id IS NOT DISTINCT FROM p.campaign_id
       AND k.creative_id IS NOT DISTINCT FROM p.creative_id
      WHERE p._ord <> k.last_ord`);
    expect(num(r?.wrong)).toBe(0);
  });
});

describe("exact duplicates are collapsed, restatements are not", () => {
  it("collapsing removes rows, and resolution removes more", async () => {
    const [typed] = await run(`SELECT COUNT(*) AS n FROM perf_typed`);
    const [deduped] = await run(`SELECT COUNT(*) AS n FROM perf_exact_dedup`);
    const [resolved] = await run(`SELECT COUNT(*) AS n FROM perf_resolved`);

    expect(num(deduped?.n)).toBeLessThan(num(typed?.n));
    expect(num(resolved?.n)).toBeLessThan(num(deduped?.n));
  });
});
