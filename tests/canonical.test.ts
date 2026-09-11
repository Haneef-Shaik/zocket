/**
 * The canonical model is where every policy in src/semantic/policies.ts becomes
 * a number. These assertions are the guard rail: change a policy and the exact
 * case it breaks fails by name.
 */

import { describe, expect, it } from "vitest";
import { run, getCoverage } from "@/db/duckdb";

const num = (v: unknown) => Number(v);

describe("coverage", () => {
  it("reads as_of from the data, not the wall clock", async () => {
    const c = await getCoverage();
    expect(c.firstDate).toBe("2026-06-08");
    expect(c.lastDate).toBe("2026-09-04");
  });
});

describe("currency policy: the campaign decides, not the row", () => {
  it("q1 spend by channel over the last eight weeks", async () => {
    const rows = await run(`
      SELECT channel, SUM(spend_usd) AS spend_usd FROM fact
      WHERE date BETWEEN DATE '2026-07-11' AND DATE '2026-09-04'
      GROUP BY channel ORDER BY spend_usd DESC`);
    const by = Object.fromEntries(rows.map((r) => [r.channel, num(r.spend_usd)]));

    expect(by.meta).toBeCloseTo(162490, -2);
    expect(by.youtube).toBeCloseTo(98384, -2);
    expect(by.google_search).toBeCloseTo(82443, -2);
    expect(by.linkedin).toBeCloseTo(53112, -2);
    // Orphan rows are reported, never folded into a named channel.
    expect(by.unmapped).toBeCloseTo(1834, -2);
  });

  it("guard: trusting the row currency column inflates spend and reorders channels", async () => {
    const rows = await run(`
      SELECT SUM(f.spend * fx.rate_to_usd) AS naive FROM fact f
      JOIN fx_spine fx ON fx.date = f.date AND fx.currency = f.row_currency
      WHERE f.date BETWEEN DATE '2026-07-11' AND DATE '2026-09-04'`);
    // ~9% of phantom spend. If this ever equals the correct total, the policy
    // stopped being applied.
    expect(num(rows[0]?.naive)).toBeGreaterThan(430_000);
  });
});

describe("dedup policy", () => {
  it("t6: August conversions collapse re-sent rows", async () => {
    const [deduped] = await run(
      `SELECT SUM(conversions) AS c FROM fact WHERE date BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'`,
    );
    const [raw] = await run(
      `SELECT SUM(conversions) AS c FROM perf_typed WHERE date BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'`,
    );
    expect(num(deduped?.c)).toBe(5584);
    expect(num(raw?.c)).toBe(5650); // the number a naive query would report
  });
});

describe("FX conversion", () => {
  it("q2: the top campaign this quarter is USD-converted, not raw", async () => {
    const rows = await run(`
      SELECT campaign_name, SUM(revenue_usd) AS revenue_usd FROM fact
      WHERE date BETWEEN DATE '2026-07-01' AND DATE '2026-09-04'
      GROUP BY campaign_name ORDER BY revenue_usd DESC LIMIT 1`);
    expect(rows[0]?.campaign_name).toBe("meta_prospecting_us");
    expect(num(rows[0]?.revenue_usd)).toBeCloseTo(255727, -2);
  });

  it("guard: summing raw revenue picks the INR campaign instead", async () => {
    const rows = await run(`
      SELECT campaign_name, SUM(revenue) AS revenue FROM fact
      WHERE date BETWEEN DATE '2026-07-01' AND DATE '2026-09-04'
      GROUP BY campaign_name ORDER BY revenue DESC LIMIT 1`);
    expect(rows[0]?.campaign_name).toBe("meta_prospecting_in");
  });

  it("carries the last known rate across gaps in the FX feed", async () => {
    const [gaps] = await run(`SELECT COUNT(*) AS n FROM fx_spine WHERE rate_carried_forward`);
    expect(num(gaps?.n)).toBeGreaterThan(0);
    const [nulls] = await run(`SELECT COUNT(*) AS n FROM fx_spine WHERE rate_to_usd IS NULL`);
    expect(num(nulls?.n)).toBe(0); // no row loses its FX rate
  });
});

describe("coverage clipping", () => {
  it("t4: last quarter is two thirds missing and clips to what exists", async () => {
    const [r] = await run(`
      SELECT SUM(revenue_usd)/SUM(spend_usd) AS roas FROM fact
      WHERE date BETWEEN DATE '2026-06-08' AND DATE '2026-06-30'`);
    expect(num(r?.roas)).toBeCloseTo(2.91, 2);
  });
});

describe("the final day is a partial load", () => {
  it("q3: the last day has far fewer rows, not worse performance", async () => {
    const rows = await run(`
      SELECT date, COUNT(*) AS rows FROM fact
      WHERE date >= DATE '2026-08-28' GROUP BY date ORDER BY date`);
    const last = rows.at(-1);
    const typical = rows.slice(0, -1).map((r) => num(r.rows));
    const median = typical.sort((a, b) => a - b)[Math.floor(typical.length / 2)]!;
    expect(num(last?.rows)).toBeLessThan(median / 2);
  });
});
