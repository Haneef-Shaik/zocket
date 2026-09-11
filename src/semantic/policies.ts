/**
 * Business and data policies. Hard-coded on purpose.
 *
 * Every value here changes a number the user sees. None of it is reachable by
 * the model: a policy change is a diff, a review, and a golden-set run.
 */

/**
 * "Today" for every relative date expression.
 *
 * The extract ends 2026-09-04. Resolving "last week" against the wall clock
 * silently returns an empty range, which SUMs to zero and reads as "we spent
 * nothing". Coverage is read from the data at boot; this is the fallback.
 */
export const AS_OF_FALLBACK = "2026-09-04";

/** Everything cross-campaign is compared in one currency. */
export const REPORTING_CURRENCY = "USD";

export const POLICIES = {
  /**
   * campaigns.csv decides the currency, not the fact row. Some rows are stamped
   * with a currency their campaign never used; trusting the row column adds
   * ~$63k of phantom spend to this extract and reorders the channel ranking.
   */
  currencySource: "campaign" as const,

  /** Exact duplicate rows are re-sends. Collapse them. */
  collapseExactDuplicates: true,

  /**
   * Same (date, campaign, creative) key with *different* numbers is a
   * restatement, not a duplicate. Last row in file order wins, and the answer
   * says how many keys were restated.
   */
  restatement: "last_write_wins" as const,

  /**
   * The FX feed has gaps. Carry the last known rate forward rather than
   * dropping the row (which loses spend) or defaulting to 1.0 (which turns
   * INR into USD at 90x).
   */
  fxGapPolicy: "carry_forward" as const,

  /**
   * Rows whose campaign_id resolves to nothing are kept and reported under a
   * separate `unmapped` bucket -- never silently dropped, never folded into a
   * named campaign.
   */
  orphanPolicy: "report_separately" as const,

  /** Nulls are null. Excluded from averages, counted in flags, never coerced to 0. */
  nullPolicy: "preserve" as const,

  /**
   * The final day of the extract is a partial load. Relative ranges expressed
   * in whole calendar units ("last week", "last month") resolve to the last
   * *complete* unit and therefore exclude it. Ranges the user anchored
   * explicitly ("the last eight weeks") include it and carry a partial_day flag.
   */
  partialFinalDay: true,
} as const;

/**
 * The turn-off candidate policy.
 *
 * This is a fixed template, not something the planner composes, because the
 * unconstrained version is confidently wrong: ranking every campaign by ROAS
 * surfaces an *awareness* campaign that was never meant to produce tracked
 * revenue, and ranking by CPA surfaces one of the most profitable campaigns.
 * The criteria below are stated back to the user with the answer.
 */
export const TURN_OFF_POLICY = {
  lookbackDays: 28,
  /** Awareness and traffic campaigns are not judged on revenue metrics. */
  objectives: ["conversions"] as const,
  /** Below this, the sample is too thin to act on. */
  minSpendUsd: 5000,
  rankBy: "roas" as const,
  direction: "asc" as const,
} as const;

/** Bumped when any policy above changes. Rides in the trace. */
export const POLICY_VERSION = "v1";
