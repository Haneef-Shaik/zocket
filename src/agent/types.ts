/**
 * The response contract. Every answer carries all of it; the UI abbreviates,
 * never omits. "Show its work" is a type, not a convention.
 */

import type { Plan } from "@/plan/schema";
import type { ChartSpec } from "@/chart/spec";
import type { Flag } from "@/verify/flags";
import type { Trace } from "@/trace/trace";

export type ResultRow = Record<string, string | number | null>;

export interface VerifiedResult {
  readonly columns: readonly string[];
  readonly rows: readonly ResultRow[];
  /** Concrete dates actually queried, after resolution and clipping. */
  readonly range: readonly [string, string] | null;
}

export interface Answer {
  readonly status: "answered" | "refused";
  /** One line, first, stating what was computed and over what dates. */
  readonly interpretation: string;
  /** At most three sentences. Every figure in it appears in `result.rows`. */
  readonly finding: string;
  readonly plan: Plan;
  readonly sql: string | null;
  readonly result: VerifiedResult | null;
  readonly chart: ChartSpec | null;
  readonly flags: readonly Flag[];
  readonly trace: Trace;
}
