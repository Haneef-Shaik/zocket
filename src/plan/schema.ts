/**
 * The typed analytical plan.
 *
 * This is the entire surface the planner LLM controls. It never writes SQL, and
 * anything not expressible here is refused rather than improvised.
 */

import { z } from "zod";
import { DIMENSION_IDS, FILTERABLE, METRIC_IDS } from "@/semantic/catalogue";

const MetricId = z.enum(METRIC_IDS as [string, ...string[]]);
const DimensionId = z.enum(DIMENSION_IDS as [string, ...string[]]);

/**
 * A date range as the *user expressed it*. Resolution to concrete dates, and
 * clipping to the coverage window, happen in deterministic code -- not here.
 */
export const TimeRangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("relative"),
    /** e.g. 8 weeks, 28 days, 1 quarter */
    n: z.number().int().positive(),
    unit: z.enum(["day", "week", "month", "quarter"]),
    /** Whole calendar units ("last week") vs. a rolling window ("last 8 weeks"). */
    calendar: z.boolean().default(false),
    /** Offset in units back from now: 0 = current, 1 = previous. */
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    type: z.literal("absolute"),
    start: z.iso.date(),
    end: z.iso.date(),
  }),
  z.object({ type: z.literal("all_time") }),
]);

export const FilterSchema = z.object({
  field: z.enum(FILTERABLE as unknown as [string, ...string[]]),
  op: z.enum(["eq", "neq", "in", "gte", "lte", "gt", "lt"]),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
});

const base = {
  /** One line, echoed to the user, stating what is actually being computed. */
  interpretation: z.string().min(1),
  filters: z.array(FilterSchema).default([]),
};

export const PlanSchema = z.discriminatedUnion("plan_type", [
  /** A single number. "What was our ROAS last quarter?" */
  z.object({
    ...base,
    plan_type: z.literal("single_value"),
    metrics: z.array(MetricId).min(1),
    time_range: TimeRangeSchema,
  }),
  /** Metric split across a dimension. "Spend by channel." */
  z.object({
    ...base,
    plan_type: z.literal("breakdown"),
    metrics: z.array(MetricId).min(1),
    dimensions: z.array(DimensionId).min(1).max(2),
    time_range: TimeRangeSchema,
  }),
  /** Ordered, limited breakdown. "Which campaign made the most revenue?" */
  z.object({
    ...base,
    plan_type: z.literal("ranking"),
    metrics: z.array(MetricId).min(1),
    dimensions: z.array(DimensionId).min(1).max(1),
    time_range: TimeRangeSchema,
    order_by: MetricId,
    direction: z.enum(["asc", "desc"]).default("desc"),
    limit: z.number().int().positive().max(50).default(10),
  }),
  /** Metric over time. "Show me daily conversions." */
  z.object({
    ...base,
    plan_type: z.literal("time_series"),
    metrics: z.array(MetricId).min(1),
    time_range: TimeRangeSchema,
    grain: z.enum(["day", "week", "month"]).default("day"),
    dimensions: z.array(DimensionId).max(1).default([]),
  }),
  /** Two windows side by side. "How did last week compare to the week before?" */
  z.object({
    ...base,
    plan_type: z.literal("compare_periods"),
    metrics: z.array(MetricId).min(1),
    time_range: TimeRangeSchema,
    comparison: TimeRangeSchema,
    dimensions: z.array(DimensionId).max(1).default([]),
  }),
  /**
   * "Conversions fell off a cliff -- what happened?"
   *
   * A fixed template, not a model-composed query: it always compares the target
   * day against a trailing baseline, decomposes the delta by channel and
   * campaign, AND counts rows on both sides. The row count is what separates
   * "performance dropped" from "the load was incomplete", and the model is not
   * trusted to remember to ask for it.
   */
  z.object({
    ...base,
    plan_type: z.literal("diagnose_drop"),
    metric: MetricId,
    target_date: z.union([z.iso.date(), z.literal("latest")]),
    baseline_days: z.number().int().positive().max(90).default(7),
  }),
  /**
   * "Which campaign should we turn off?" -- applies TURN_OFF_POLICY.
   * Model-selected shape, policy-supplied criteria.
   */
  z.object({
    ...base,
    plan_type: z.literal("turn_off_candidate"),
  }),
  /** Budget pacing. Answered in campaign-native currency: budgets are set in it. */
  z.object({
    ...base,
    plan_type: z.literal("budget_pacing"),
    time_range: TimeRangeSchema,
  }),
  /**
   * The model's own refusal. The validator can also *force* this state -- the
   * model saying "answerable" is a proposal, not a verdict.
   */
  z.object({
    ...base,
    plan_type: z.literal("unanswerable"),
    reason: z.enum([
      "no_such_entity",
      "no_such_dimension",
      "no_such_metric",
      "outside_coverage",
      "not_analytical",
    ]),
    /** What the user would need, in their words. */
    missing: z.string(),
  }),
]);

export type Plan = z.infer<typeof PlanSchema>;
export type TimeRange = z.infer<typeof TimeRangeSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type PlanType = Plan["plan_type"];

/** Bumped when the grammar changes. Rides in the trace. */
export const PLAN_GRAMMAR_VERSION = "v1";
