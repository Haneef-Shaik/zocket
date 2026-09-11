/**
 * Result validation: types, invariants, and the data-quality flags that travel
 * with the answer.
 *
 * A flag here is not decoration. Each one names a defect that touched the rows
 * *this* query read, which is why they are counted over the queried window
 * rather than reported once for the whole extract: a caveat that appears on
 * every answer is a caveat nobody reads.
 */

import type { Row } from "@/db/duckdb";
import type { ResultRow, VerifiedResult } from "@/agent/types";
import type { Flag, FlagCode, Severity } from "@/verify/flags";
import type { ResolvedRange } from "@/plan/resolve";

export interface Validated {
  readonly result: VerifiedResult;
  readonly flags: readonly Flag[];
}

/**
 * Every marker the flag query counts, with how loudly to say it.
 *
 * `warn` means the number would be different, or read differently, without the
 * caveat. `info` means the defect was handled and the user should know it
 * existed. Nothing here is `critical`, because a defect we understood well
 * enough to name is a defect we handled -- critical is reserved for an
 * invariant breaking, below.
 */
const MARKERS: ReadonlyArray<{
  readonly key: string;
  readonly code: FlagCode;
  readonly severity: Severity;
  readonly message: (n: number) => string;
}> = [
  {
    key: "currency_mismatch",
    code: "currency_mismatch",
    severity: "warn",
    message: (n) =>
      `${n} row${n === 1 ? "" : "s"} were stamped with a currency their campaign never used. ` +
      `The campaign's own currency was applied; trusting the row would have added phantom spend.`,
  },
  {
    key: "unmapped_campaign_id",
    code: "unmapped_campaign_id",
    severity: "warn",
    message: (n) =>
      `${n} row${n === 1 ? "" : "s"} reference a campaign id that is not in the campaign list. ` +
      `They are reported under "unmapped" rather than dropped or folded into a named campaign.`,
  },
  {
    key: "unmapped_creative_id",
    code: "unmapped_creative_id",
    severity: "info",
    message: (n) => `${n} row${n === 1 ? "" : "s"} reference a creative id that is not in the creative list.`,
  },
  {
    key: "fx_carried_forward",
    code: "fx_carried_forward",
    severity: "info",
    message: (n) =>
      `${n} row${n === 1 ? "" : "s"} were converted at the last published FX rate because the feed ` +
      `had no rate for that date.`,
  },
  {
    key: "funnel_violation",
    code: "funnel_violation",
    severity: "warn",
    message: (n) =>
      `${n} row${n === 1 ? "" : "s"} report more clicks than impressions, or more conversions than ` +
      `clicks. They are kept but cannot be taken at face value.`,
  },
  {
    key: "negative_spend",
    code: "negative_spend",
    severity: "info",
    message: (n) => `${n} row${n === 1 ? "" : "s"} carry negative spend. These are credits, and they are real.`,
  },
  {
    key: "revenue_without_spend",
    code: "revenue_without_spend",
    severity: "info",
    message: (n) => `${n} row${n === 1 ? "" : "s"} report revenue against zero spend; ratio metrics guard against the division.`,
  },
  {
    key: "null_measures",
    code: "null_measures",
    severity: "info",
    message: (n) => `${n} row${n === 1 ? "" : "s"} have at least one missing measure. Nulls stay null and are excluded, never read as zero.`,
  },
  {
    key: "after_campaign_end",
    code: "after_campaign_end",
    severity: "info",
    message: (n) => `${n} row${n === 1 ? "" : "s"} are dated after their campaign's end date. This is normal platform behaviour and they are kept.`,
  },
  {
    key: "duplicates_collapsed",
    code: "duplicates_collapsed",
    severity: "info",
    message: (n) =>
      `${n} exact duplicate row${n === 1 ? " was" : "s were"} collapsed before aggregation. ` +
      `Counting them would have inflated every total in this window.`,
  },
  {
    key: "restatement_applied",
    code: "restatement_applied",
    severity: "info",
    message: (n) =>
      `${n} key${n === 1 ? " was" : "s were"} restated. The last version in file order was used.`,
  },
  {
    key: "channel_outage",
    code: "channel_outage",
    severity: "warn",
    message: (n) => `${n} channel-day${n === 1 ? "" : "s"} reported zero impressions and zero spend. That is a real outage, not missing data.`,
  },
];

export function validateResult(
  rows: readonly Row[],
  flagRows: readonly Row[],
  columns: readonly string[],
  range: ResolvedRange | null,
): Validated {
  const counts = flagRows[0] ?? {};
  const count = (key: string): number => {
    const raw = counts[key];
    const value = typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const flags: Flag[] = [];

  // -- window flags: these come from the resolver, not from the data ---------
  if (range?.includesPartialDay) {
    flags.push({
      code: "partial_day",
      severity: "warn",
      count: count("partial_day"),
      message:
        `This window includes the final day of the extract, which is an incomplete load ` +
        `(${count("partial_day")} rows against a typical full day). Totals and any comparison ` +
        `ending on it are understated.`,
    });
  }

  if (range?.clipped) {
    flags.push({
      code: "coverage_clipped",
      severity: "warn",
      count: 1,
      message:
        `The window asked for ${range.requested[0]} to ${range.requested[1]}, but the data only ` +
        `covers part of it. Answered over ${range.resolved[0]} to ${range.resolved[1]}.`,
    });
  }

  // -- data flags: counted over exactly the rows this query read -------------
  for (const marker of MARKERS) {
    const n = count(marker.key);
    if (n > 0) {
      flags.push({ code: marker.code, severity: marker.severity, count: n, message: marker.message(n) });
    }
  }

  // -- the result itself -----------------------------------------------------
  const shaped: ResultRow[] = rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const column of columns) out[column] = coerce(row[column]);
    return out;
  });

  return {
    result: {
      columns,
      rows: shaped,
      range: range ? [range.resolved[0], range.resolved[1]] : null,
    },
    flags,
  };
}

/**
 * DuckDB returns BIGINT as JavaScript BigInt, which JSON.stringify throws on.
 * Every value crossing the API boundary goes through here.
 */
export function coerce(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // DuckDB DATE columns arrive as DuckDBDateValue, whose toString() is already
  // an ISO date. Everything else is stringified rather than leaked as an object.
  return String(value);
}
