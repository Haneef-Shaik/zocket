/**
 * Data-quality flags.
 *
 * A flag is not decoration: it is the difference between a number and a number
 * someone can defend. Each one names a defect that touches the rows THIS query
 * read, so an answer over clean rows carries none.
 */

export type FlagCode =
  | "partial_day"
  | "duplicates_collapsed"
  | "restatement_applied"
  | "currency_mismatch"
  | "unmapped_campaign_id"
  | "unmapped_creative_id"
  | "fx_carried_forward"
  | "funnel_violation"
  | "negative_spend"
  | "revenue_without_spend"
  | "null_measures"
  | "after_campaign_end"
  | "coverage_clipped"
  | "channel_outage";

export type Severity = "info" | "warn" | "critical";

export interface Flag {
  readonly code: FlagCode;
  readonly severity: Severity;
  /** Rows affected within the queried window. */
  readonly count: number;
  /** Plain-language sentence the narrator may quote verbatim. */
  readonly message: string;
}
