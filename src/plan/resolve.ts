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
import type { Coverage } from "@/db/duckdb";
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
  /**
   * True when the partial final day was deliberately left out. The answer has to
   * say so: "flat week on week" and "down 12%" are the same query over windows
   * that differ by one incomplete day.
   */
  readonly excludedPartialDay: boolean;
}

const DAY_MS = 86_400_000;

export const toDate = (s: string): Date => new Date(`${s}T00:00:00Z`);
export const toIso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);

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

function startOfCalendarUnit(d: Date, unit: "month" | "quarter"): Date {
  return unit === "month" ? startOfMonth(d) : startOfQuarter(d);
}

/**
 * The last day we treat as fully loaded.
 *
 * The extract's final day is a partial load, so any window that means "a
 * complete period" has to stop before it. This single definition is why the
 * partial-day rule is applied by code rather than remembered by a prompt.
 */
export function lastCompleteDay(coverage: Coverage): string {
  const asOf = toDate(coverage.lastDate);
  return POLICIES.partialFinalDay ? toIso(addDays(asOf, -1)) : coverage.lastDate;
}

/**
 * Turn a plan's time range into concrete dates.
 *
 * `asOf` is the last date in the data, never the wall clock.
 *
 * The `calendar` flag carries the whole partial-day rule:
 *
 *   * `calendar: false` -- "the last eight weeks". A rolling window the user
 *     anchored explicitly. It ends at `as_of`, includes the partial final day,
 *     and says so with a flag.
 *   * `calendar: true` -- "last week", "this quarter". A named *complete*
 *     period, which ends at the last complete day.
 *
 * Days and weeks resolve as trailing blocks aligned to the last complete day
 * rather than to a Monday. That is the convention the golden set encodes
 * ("last week" = 28 Aug - 3 Sep against an as_of of 4 Sep) and it is the one
 * that keeps week-over-week stable as each day lands: a Monday-aligned grid
 * would make "last week" mean a different window every day of the week.
 * Months and quarters keep true calendar boundaries, where the named unit is
 * unambiguous.
 */
export function resolveRange(range: TimeRange, coverage: Coverage): ResolvedRange {
  const asOf = toDate(coverage.lastDate);
  const covLo = toDate(coverage.firstDate);
  const covHi = asOf;
  const lastComplete = toDate(lastCompleteDay(coverage));

  let reqLo: Date;
  let reqHi: Date;
  let excluded = false;

  if (range.type === "all_time") {
    reqLo = covLo;
    reqHi = covHi;
  } else if (range.type === "absolute") {
    reqLo = toDate(range.start);
    reqHi = toDate(range.end);
  } else if (range.calendar && (range.unit === "day" || range.unit === "week")) {
    // Complete days/weeks: trailing blocks ending at the last complete day.
    const span = range.unit === "week" ? 7 : 1;
    reqHi = addDays(lastComplete, -range.offset * span);
    reqLo = addDays(reqHi, -(range.n * span) + 1);
    excluded = POLICIES.partialFinalDay && range.offset === 0;
  } else if (range.calendar) {
    // Whole calendar months/quarters. offset=0 is the current unit to date,
    // which coverage clipping then caps at as_of; offset>=1 is a complete unit.
    const unit = range.unit as "month" | "quarter";
    const anchor = startOfCalendarUnit(asOf, unit);
    const lo = startOfCalendarUnit(addUnits(anchor, -range.offset, unit), unit);
    const hi = addDays(startOfCalendarUnit(addUnits(lo, range.n, unit), unit), -1);
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
    excludedPartialDay: excluded && !empty,
  };
}

/** A window the *policy* fixed rather than the user: turn-off lookback, drop baseline. */
export function fixedRange(start: string, end: string, coverage: Coverage): ResolvedRange {
  return resolveRange({ type: "absolute", start, end }, coverage);
}
