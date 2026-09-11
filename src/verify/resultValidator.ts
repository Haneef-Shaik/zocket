/**
 * Result validation: schema, types, invariants, and the data-quality flags that
 * travel with the answer.
 *
 * PHASE 4 -- see PLAN.md. Contract is fixed; body is not written yet.
 */

import type { Row } from "@/db/duckdb";
import type { VerifiedResult } from "@/agent/types";
import type { Flag } from "@/verify/flags";

export interface Validated {
  readonly result: VerifiedResult;
  readonly flags: readonly Flag[];
}

export function validateResult(
  _rows: readonly Row[],
  _flagRows: readonly Row[],
  _columns: readonly string[],
  _range: readonly [string, string] | null,
): Validated {
  throw new Error("NotImplemented: PLAN.md phase 4");
}

/**
 * DuckDB returns BIGINT as JavaScript BigInt, which JSON.stringify throws on.
 * Every value crossing the API boundary goes through here.
 */
export function coerce(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // DuckDB DATE columns arrive as DuckDBDateValue, whose toString() is already
  // an ISO date. Everything else is stringified rather than leaked as an object.
  return String(value);
}
