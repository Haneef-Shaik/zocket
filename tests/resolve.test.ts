/**
 * Window resolution is the single highest-leverage piece of deterministic code
 * in the system: "flat week on week" and "down 12%" are the same query over
 * windows that differ by one incomplete day. Each case below is a golden range.
 */

import { describe, expect, it } from "vitest";
import { resolveRange, lastCompleteDay } from "@/plan/resolve";

const COVERAGE = { firstDate: "2026-06-08", lastDate: "2026-09-04", rowCount: 2341 };

describe("the partial final day", () => {
  it("is excluded from the last complete day", () => {
    expect(lastCompleteDay(COVERAGE)).toBe("2026-09-03");
  });
});

describe("rolling windows the user anchored explicitly", () => {
  it("q1: the last eight weeks ends at as_of and includes the partial day", () => {
    const r = resolveRange(
      { type: "relative", n: 8, unit: "week", calendar: false, offset: 0 },
      COVERAGE,
    );
    expect(r.resolved).toEqual(["2026-07-11", "2026-09-04"]);
    expect(r.includesPartialDay).toBe(true);
    expect(r.clipped).toBe(false);
  });
});

describe("named complete periods", () => {
  it("t1: last week is the last seven COMPLETE days", () => {
    const r = resolveRange(
      { type: "relative", n: 1, unit: "week", calendar: true, offset: 0 },
      COVERAGE,
    );
    expect(r.resolved).toEqual(["2026-08-28", "2026-09-03"]);
    expect(r.includesPartialDay).toBe(false);
    expect(r.excludedPartialDay).toBe(true);
  });

  it("t1: the week before that is the prior seven days", () => {
    const r = resolveRange(
      { type: "relative", n: 1, unit: "week", calendar: true, offset: 1 },
      COVERAGE,
    );
    expect(r.resolved).toEqual(["2026-08-21", "2026-08-27"]);
  });

  it("q2: this quarter runs to as_of and is clipped by the end of the data", () => {
    const r = resolveRange(
      { type: "relative", n: 1, unit: "quarter", calendar: true, offset: 0 },
      COVERAGE,
    );
    expect(r.requested).toEqual(["2026-07-01", "2026-09-30"]);
    expect(r.resolved).toEqual(["2026-07-01", "2026-09-04"]);
    expect(r.clipped).toBe(true);
  });

  it("t4: last quarter is two thirds outside coverage and clips, never empties", () => {
    const r = resolveRange(
      { type: "relative", n: 1, unit: "quarter", calendar: true, offset: 1 },
      COVERAGE,
    );
    expect(r.requested).toEqual(["2026-04-01", "2026-06-30"]);
    expect(r.resolved).toEqual(["2026-06-08", "2026-06-30"]);
    expect(r.clipped).toBe(true);
    expect(r.empty).toBe(false);
  });

  it("t6: August resolves to the whole calendar month", () => {
    const r = resolveRange(
      { type: "relative", n: 1, unit: "month", calendar: true, offset: 1 },
      COVERAGE,
    );
    expect(r.resolved).toEqual(["2026-08-01", "2026-08-31"]);
  });
});

describe("outside coverage", () => {
  it("n5: May is empty, which must refuse rather than SUM to zero", () => {
    const r = resolveRange(
      { type: "absolute", start: "2026-05-01", end: "2026-05-31" },
      COVERAGE,
    );
    expect(r.empty).toBe(true);
  });
});

describe("policy windows", () => {
  it("q4: the turn-off lookback is the trailing 28 days", () => {
    const r = resolveRange(
      { type: "relative", n: 28, unit: "day", calendar: false, offset: 0 },
      COVERAGE,
    );
    expect(r.resolved).toEqual(["2026-08-08", "2026-09-04"]);
  });
});
