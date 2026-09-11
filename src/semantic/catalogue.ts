/**
 * The semantic layer: the only metrics and dimensions that exist.
 *
 * The planner LLM selects names from here. It cannot introduce a metric, and it
 * cannot redefine one -- the SQL expression lives in this file, not in a prompt.
 * Adding a metric is a code change with a test, which is the point.
 */

export type Aggregation = "sum" | "ratio" | "avg";

export interface MetricDef {
  /** Stable id the planner emits. */
  readonly id: string;
  /** What a user would call it, used for planner grounding and error messages. */
  readonly label: string;
  readonly unit: "USD" | "ratio" | "count" | "pct" | "USD_per_conversion";
  readonly aggregation: Aggregation;
  /**
   * SQL fragment over the canonical view `fact`. For ratios, numerator and
   * denominator are aggregated separately and divided *after* aggregation --
   * SUM(a)/SUM(b), never AVG(a/b).
   */
  readonly sql: string;
  /** Synonyms users actually type. Grounding only; resolution is the model's job. */
  readonly synonyms: readonly string[];
}

export const METRICS: Readonly<Record<string, MetricDef>> = {
  spend_usd: {
    id: "spend_usd",
    label: "Spend (USD)",
    unit: "USD",
    aggregation: "sum",
    sql: "SUM(spend_usd)",
    synonyms: ["spend", "cost", "burn", "budget spent", "invested"],
  },
  revenue_usd: {
    id: "revenue_usd",
    label: "Revenue (USD)",
    unit: "USD",
    aggregation: "sum",
    sql: "SUM(revenue_usd)",
    synonyms: ["revenue", "sales", "income", "top line"],
  },
  conversions: {
    id: "conversions",
    label: "Conversions",
    unit: "count",
    aggregation: "sum",
    sql: "SUM(conversions)",
    synonyms: ["conversions", "purchases", "orders", "signups", "leads"],
  },
  clicks: {
    id: "clicks",
    label: "Clicks",
    unit: "count",
    aggregation: "sum",
    sql: "SUM(clicks)",
    synonyms: ["clicks"],
  },
  impressions: {
    id: "impressions",
    label: "Impressions",
    unit: "count",
    aggregation: "sum",
    sql: "SUM(impressions)",
    synonyms: ["impressions", "views", "reach"],
  },
  roas: {
    id: "roas",
    label: "ROAS",
    unit: "ratio",
    aggregation: "ratio",
    // NULLIF guards the zero-spend-with-revenue rows the extract contains.
    sql: "SUM(revenue_usd) / NULLIF(SUM(spend_usd), 0)",
    synonyms: ["roas", "roi", "return", "revenue per dollar", "efficiency"],
  },
  cpa: {
    id: "cpa",
    label: "CPA",
    unit: "USD_per_conversion",
    aggregation: "ratio",
    sql: "SUM(spend_usd) / NULLIF(SUM(conversions), 0)",
    synonyms: ["cpa", "cac", "cost per lead", "cost per acquisition"],
  },
  ctr: {
    id: "ctr",
    label: "CTR",
    unit: "pct",
    aggregation: "ratio",
    sql: "SUM(clicks) / NULLIF(SUM(impressions), 0)",
    synonyms: ["ctr", "click through rate"],
  },
  cvr: {
    id: "cvr",
    label: "Conversion rate",
    unit: "pct",
    aggregation: "ratio",
    sql: "SUM(conversions) / NULLIF(SUM(clicks), 0)",
    synonyms: ["cvr", "conversion rate", "close rate"],
  },
} as const;

export interface DimensionDef {
  readonly id: string;
  readonly label: string;
  /** Column on the canonical view. */
  readonly sql: string;
  readonly synonyms: readonly string[];
}

export const DIMENSIONS: Readonly<Record<string, DimensionDef>> = {
  channel: {
    id: "channel",
    label: "Channel",
    sql: "channel",
    synonyms: ["channel", "platform", "network", "source"],
  },
  campaign: {
    id: "campaign",
    label: "Campaign",
    sql: "campaign_name",
    synonyms: ["campaign", "line item"],
  },
  creative: {
    id: "creative",
    label: "Creative",
    sql: "creative_name",
    synonyms: ["creative", "ad", "asset", "variant"],
  },
  objective: {
    id: "objective",
    label: "Objective",
    sql: "objective",
    synonyms: ["objective", "goal"],
  },
  format: {
    id: "format",
    label: "Creative format",
    sql: "format",
    synonyms: ["format", "ad type"],
  },
  date: {
    id: "date",
    label: "Date",
    sql: "date",
    synonyms: ["date", "day", "daily"],
  },
} as const;

/** Filterable fields. Deliberately narrower than the dimension list. */
export const FILTERABLE = [
  "channel",
  "campaign",
  "creative",
  "objective",
  "format",
  "currency",
  "spend_usd",
] as const;

export const METRIC_IDS = Object.keys(METRICS) as readonly string[];
export const DIMENSION_IDS = Object.keys(DIMENSIONS) as readonly string[];

/** Bumped whenever a metric expression or dimension changes. Rides in the trace. */
export const SEMANTIC_VERSION = "v1";
