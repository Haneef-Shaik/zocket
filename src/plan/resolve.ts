/**
 * Date resolution and coverage clipping.
 *
 * Deliberately deterministic. The planner says "last quarter"; this file decides
 * what dates that means, and -- more importantly -- what to do when the answer
 * runs off the end of the data. Getting this wrong is invisible: a range outside
 * coverage SUMs to $0, which reads as "we spent nothing" rather than "we have
 * no data for that".
 */

import type { TimeRange } from "@/plan/schema";
import { POLICIES } from "@/semantic/policies";

export interface ResolvedRange {
  /** What the user asked for, before clipping. */
  readonly requested: readonly [string, string];
  /** What we can actually answer over. */
  readonly resolved: readonly [string, string];
  /** True when coverage forced the range to shrink -- must be stated in the answer. */
  readonly clipped: boolean;
  /** True when the range is entirely outside coverage -- forces a refusal. */
  readonly empty: boolean;
  /** True when the range includes the partial final day of the extract. */
  readonly includesPartialDay: boolean;
}

const DAY_MS = 86_400_000;

const toDate = (s: string): Date => new Date(`${s}T00:00:00Z`);
const toIso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);

/** Monday-start week containing `d`. */
function startOfWeek(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfQuarter(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
}

function addUnits(d: Date, n: number, unit: "day" | "week" | "month" | "quarter"): Date {
  switch (unit) {
    case "day":
      return addDays(d, n);
    case "week":
      return addDays(d, n * 7);
    case "month":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
    case "quarter":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n * 3, d.getUTCDate()));
  }
}

function startOfUnit(d: Date, unit: "day" | "week" | "month" | "quarter"): Date {
  switch (unit) {
    case "day":
      return d;
    case "week":
      return startOfWeek(d);
    case "month":
      return startOfMonth(d);
    case "quarter":
      return startOfQuarter(d);
  }
}

/**
 * Turn a plan's time range into concrete dates.
 *
 * `asOf` is the last date in the data, never the wall clock. `lastCompleteDay`
 * is the last date we consider fully loaded -- the extract's final day is a
 * partial load, so whole-calendar-unit ranges stop before it.
 */
export function resolveRange(
  range: TimeRange,
  coverage: { firstDate: string; lastDate: string },
): ResolvedRange {
  const asOf = toDate(coverage.lastDate);
  const covLo = toDate(coverage.firstDate);
  const covHi = asOf;

  let reqLo: Date;
  let reqHi: Date;

  if (range.type === "all_time") {
    reqLo = covLo;
    reqHi = covHi;
  } else if (range.type === "absolute") {
    reqLo = toDate(range.start);
    reqHi = toDate(range.end);
  } else if (range.calendar) {
    // "last week" / "this quarter" -- whole calendar units. `offset` counts
    // back from the current unit, so offset=1 is the last COMPLETE unit and
    // naturally excludes the partial final day.
    const anchor = startOfUnit(asOf, range.unit);
    const lo = startOfUnit(addUnits(anchor, -range.offset, range.unit), range.unit);
    const hi = addDays(startOfUnit(addUnits(lo, range.n, range.unit), range.unit), -1);
    reqLo = lo;
    reqHi = hi;
  } else {
    // "the last 8 weeks" -- a rolling window ending at as_of. Includes the
    // partial final day, and says so.
    reqHi = asOf;
    reqLo = addDays(addUnits(asOf, -range.n, range.unit), 1);
  }

  const resLo = reqLo < covLo ? covLo : reqLo;
  const resHi = reqHi > covHi ? covHi : reqHi;
  const empty = resLo > resHi;

  return {
    requested: [toIso(reqLo), toIso(reqHi)],
    resolved: [toIso(resLo), toIso(resHi)],
    clipped: !empty && (toIso(resLo) !== toIso(reqLo) || toIso(resHi) !== toIso(reqHi)),
    empty,
    includesPartialDay:
      POLICIES.partialFinalDay && !empty && toIso(resHi) === coverage.lastDate,
  };
}
