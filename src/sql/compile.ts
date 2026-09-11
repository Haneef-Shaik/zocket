/**
 * Plan -> SQL. The compiler owns joins, FX, dedup, grouping, limits, and the
 * tenant predicate. The model never sees this file's output before it runs, and
 * never writes a character of it.
 *
 * Three rules hold across every emitter:
 *
 *   1. Metric SQL comes from the catalogue, never from here. A ratio aggregates
 *      numerator and denominator separately and divides after -- SUM(a)/SUM(b),
 *      never AVG(a/b), which is a different and usually wrong number.
 *   2. Values are bound, never interpolated. Identifiers come from fixed maps,
 *      so the only free-form values that reach SQL are parameters.
 *   3. The SQL emitted here is the SQL that runs and the SQL the user is shown.
 *      There is no second "explanation" query that could drift from the real one.
 */

import type { Plan, Filter } from "@/plan/schema";
import { addDays, toDate, toIso, type ResolvedRange } from "@/plan/resolve";
import type { Param } from "@/db/duckdb";
import { DIMENSIONS, METRICS } from "@/semantic/catalogue";
import { TURN_OFF_POLICY } from "@/semantic/policies";

export interface CompiledQuery {
  /** The SQL shown to the user verbatim. */
  readonly sql: string;
  readonly columns: readonly string[];
  /** The numeric columns: what a chart may plot, and what the narrator guard checks. */
  readonly measures: readonly string[];
  /** Extra queries that produce the flags for this window. */
  readonly flagSql: string;
  readonly params: Readonly<Record<string, Param>>;
  readonly flagParams: Readonly<Record<string, Param>>;
}

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

/* ------------------------------------------------------------------ binding */

/**
 * Collects bound values while an emitter builds a statement.
 *
 * This is the one place in the codebase that accumulates rather than returning
 * a new value each time. Threading a parameter list through every emitter would
 * bury the SQL in plumbing, and the mutation cannot escape: the bag is created
 * per compile() call and only ever leaves as a frozen copy.
 */
class Bindings {
  private readonly values: Record<string, Param> = {};
  private seq = 0;

  bind(value: Param, hint = "v"): string {
    const name = `${hint}${this.seq++}`;
    this.values[name] = value;
    return `$${name}`;
  }

  /** A name bound once and referenced many times, e.g. the window bounds. */
  fixed(name: string, value: Param): string {
    this.values[name] = value;
    return `$${name}`;
  }

  all(): Readonly<Record<string, Param>> {
    return Object.freeze({ ...this.values });
  }
}

/* ------------------------------------------------------- identifiers & ops */

/** Row-level filters become WHERE; measure filters become HAVING. */
const ROW_FILTER_COLUMNS: Readonly<Record<string, string>> = {
  channel: "channel",
  campaign: "campaign_name",
  creative: "creative_name",
  objective: "objective",
  format: "format",
  currency: "currency",
};

const MEASURE_FILTER_SQL: Readonly<Record<string, string>> = {
  spend_usd: "SUM(spend_usd)",
};

const OPERATORS: Readonly<Record<Filter["op"], string>> = {
  eq: "=",
  neq: "<>",
  in: "IN",
  gte: ">=",
  lte: "<=",
  gt: ">",
  lt: "<",
};

function metricSql(id: string): string {
  const metric = METRICS[id];
  if (!metric) throw new CompileError(`Unknown metric "${id}".`);
  return metric.sql;
}

function dimensionSql(id: string): string {
  const dimension = DIMENSIONS[id];
  if (!dimension) throw new CompileError(`Unknown dimension "${id}".`);
  return dimension.sql;
}

/**
 * A ratio drags its components along. See MetricDef.components: a ratio on its
 * own is an assertion, a ratio with its numerator and denominator is checkable.
 */
function expandMetrics(ids: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
    for (const component of METRICS[id]?.components ?? []) {
      if (!out.includes(component)) out.push(component);
    }
  }
  return out;
}

function selectMetrics(ids: readonly string[]): string {
  return ids.map((id) => `${metricSql(id)} AS ${id}`).join(",\n       ");
}

/* ------------------------------------------------------------- predicates */

function filterSql(filter: Filter, bind: Bindings): string {
  const measure = MEASURE_FILTER_SQL[filter.field];
  const column = measure ?? ROW_FILTER_COLUMNS[filter.field];
  if (!column) throw new CompileError(`Field "${filter.field}" is not filterable.`);

  if (filter.op === "in") {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (values.length === 0) throw new CompileError(`Empty IN list on "${filter.field}".`);
    const bound = values.map((v) => bind.bind(v, "f")).join(", ");
    return `${column} IN (${bound})`;
  }

  const value = Array.isArray(filter.value) ? filter.value[0] : filter.value;
  if (value === undefined) throw new CompileError(`Missing value on "${filter.field}".`);
  return `${column} ${OPERATORS[filter.op]} ${bind.bind(value, "f")}`;
}

interface Predicates {
  readonly where: string;
  readonly having: string;
}

function predicates(
  filters: readonly Filter[],
  range: ResolvedRange | null,
  tenantId: string,
  bind: Bindings,
  extraWhere: readonly string[] = [],
): Predicates {
  const where: string[] = [`tenant_id = ${bind.fixed("tenant", tenantId)}`];
  if (range) {
    where.push(
      `date BETWEEN ${bind.fixed("from", range.resolved[0])} AND ${bind.fixed("to", range.resolved[1])}`,
    );
  }
  where.push(...extraWhere);

  const having: string[] = [];
  for (const filter of filters) {
    (MEASURE_FILTER_SQL[filter.field] ? having : where).push(filterSql(filter, bind));
  }

  return {
    where: `WHERE ${where.join("\n  AND ")}`,
    having: having.length ? `HAVING ${having.join("\n   AND ")}` : "",
  };
}

/** Drop the blank lines an omitted clause leaves behind. */
function tidy(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/* ------------------------------------------------------------------- flags */

/**
 * One query for every defect marker touching this window.
 *
 * The row-level markers already exist on `fact`; duplicates and restatements
 * are counted by differencing the ingest stages, because by the time a row
 * reaches `fact` the duplicate is gone and that is the point.
 */
function compileFlags(
  from: string,
  to: string,
  tenantId: string,
): { sql: string; params: Readonly<Record<string, Param>> } {
  const bind = new Bindings();
  const tenant = bind.fixed("tenant", tenantId);
  const lo = bind.fixed("from", from);
  const hi = bind.fixed("to", to);
  const marker = (column: string, alias: string) =>
    `COALESCE(SUM(CASE WHEN ${column} THEN 1 END), 0) AS ${alias}`;

  const sql = `SELECT
       COUNT(*) AS rows_scanned,
       ${marker("is_currency_mismatch", "currency_mismatch")},
       ${marker("is_unmapped_campaign", "unmapped_campaign_id")},
       ${marker("is_unmapped_creative", "unmapped_creative_id")},
       ${marker("rate_carried_forward", "fx_carried_forward")},
       ${marker("is_funnel_violation", "funnel_violation")},
       ${marker("is_negative_spend", "negative_spend")},
       ${marker("is_revenue_without_spend", "revenue_without_spend")},
       ${marker("has_null_measure", "null_measures")},
       ${marker("is_after_campaign_end", "after_campaign_end")},
       ${marker("date = (SELECT last_date FROM coverage)", "partial_day")},
       (SELECT COUNT(*) FROM perf_typed WHERE date BETWEEN ${lo} AND ${hi})
         - (SELECT COUNT(*) FROM perf_exact_dedup WHERE date BETWEEN ${lo} AND ${hi})
           AS duplicates_collapsed,
       (SELECT COUNT(*) FROM perf_exact_dedup WHERE date BETWEEN ${lo} AND ${hi})
         - (SELECT COUNT(*) FROM perf_resolved WHERE date BETWEEN ${lo} AND ${hi})
           AS restatement_applied,
       (SELECT COUNT(*) FROM (
            SELECT channel, date FROM fact
            WHERE tenant_id = ${tenant} AND date BETWEEN ${lo} AND ${hi}
            GROUP BY 1, 2
            HAVING COALESCE(SUM(impressions), 0) = 0 AND COALESCE(SUM(spend), 0) = 0
        )) AS channel_outage
FROM fact
WHERE tenant_id = ${tenant} AND date BETWEEN ${lo} AND ${hi}`;

  return { sql, params: bind.all() };
}

/* ---------------------------------------------------------------- emitters */

export function compile(
  plan: Plan,
  range: ResolvedRange | null,
  tenantId: string,
  comparison: ResolvedRange | null = null,
): CompiledQuery {
  if (!tenantId) throw new CompileError("A tenant id is required to compile SQL.");
  if (plan.plan_type === "unanswerable") {
    throw new CompileError("An unanswerable plan has no SQL. Refuse instead.");
  }
  if (!range) throw new CompileError(`Plan "${plan.plan_type}" needs a resolved window.`);

  const bind = new Bindings();
  const built = emit(plan, range, comparison, tenantId, bind);

  // Flags cover every row the answer touched, which for a comparison is both
  // windows -- a defect in the baseline invalidates the delta just as surely.
  const flagFrom = comparison
    ? min(range.resolved[0], comparison.resolved[0])
    : range.resolved[0];
  const flagTo = comparison ? max(range.resolved[1], comparison.resolved[1]) : range.resolved[1];
  const flags = compileFlags(flagFrom, flagTo, tenantId);

  return {
    sql: tidy(built.sql),
    columns: built.columns,
    measures: built.measures,
    flagSql: flags.sql,
    params: bind.all(),
    flagParams: flags.params,
  };
}

interface Emitted {
  readonly sql: string;
  readonly columns: readonly string[];
  readonly measures: readonly string[];
}

function emit(
  plan: Exclude<Plan, { plan_type: "unanswerable" }>,
  range: ResolvedRange,
  comparison: ResolvedRange | null,
  tenantId: string,
  bind: Bindings,
): Emitted {
  switch (plan.plan_type) {
    case "single_value":
      return emitSingleValue(plan, range, tenantId, bind);
    case "breakdown":
      return emitBreakdown(plan, range, tenantId, bind);
    case "ranking":
      return emitRanking(plan, range, tenantId, bind);
    case "time_series":
      return emitTimeSeries(plan, range, tenantId, bind);
    case "compare_periods":
      return emitComparePeriods(plan, range, comparison, tenantId, bind);
    case "diagnose_drop":
      return emitDiagnoseDrop(plan, range, tenantId, bind);
    case "turn_off_candidate":
      return emitTurnOff(range, tenantId, bind);
    case "budget_pacing":
      return emitBudgetPacing(range, tenantId, bind);
  }
}

function emitSingleValue(
  plan: Extract<Plan, { plan_type: "single_value" }>,
  range: ResolvedRange,
  tenantId: string,
  bind: Bindings,
): Emitted {
  const metrics = expandMetrics(plan.metrics);
  const { where, having } = predicates(plan.filters, range, tenantId, bind);
  return {
    sql: `SELECT ${selectMetrics(metrics)}
FROM fact
${where}
${having}`,
    columns: metrics,
    measures: metrics,
  };
}

function emitBreakdown(
  plan: Extract<Plan, { plan_type: "breakdown" }>,
  range: ResolvedRange,
  tenantId: string,
  bind: Bindings,
): Emitted {
  const metrics = expandMetrics(plan.metrics);
  const labels = plan.dimensions.map((d, i) => (i === 0 ? "label" : `label_${i + 1}`));
  const select = plan.dimensions
    .map((d, i) => `${dimensionSql(d)} AS ${labels[i]}`)
    .join(",\n       ");
  const { where, having } = predicates(plan.filters, range, tenantId, bind);
  const group = plan.dimensions.map((_, i) => i + 1).join(", ");
  const first = metrics[0];

  return {
    sql: `SELECT ${select},
       ${selectMetrics(metrics)}
FROM fact
${where}
GROUP BY ${group}
${having}
ORDER BY ${first} DESC NULLS LAST`,
    columns: [...labels, ...metrics],
    measures: metrics,
  };
}

function emitRanking(
  plan: Extract<Plan, { plan_type: "ranking" }>,
  range: ResolvedRange,
  tenantId: string,
  bind: Bindings,
): Emitted {
  // The ordering metric is always selected: ranking by something the user
  // cannot see in the table is how a ranking becomes unfalsifiable.
  const metrics = expandMetrics([...plan.metrics, plan.order_by]);
  const dimension = plan.dimensions[0];
  if (!dimension) throw new CompileError("A ranking needs one dimension.");
  const { where, having } = predicates(plan.filters, range, tenantId, bind);
  const direction = plan.direction === "asc" ? "ASC" : "DESC";

  return {
    sql: `SELECT ${dimensionSql(dimension)} AS label,
       ${selectMetrics(metrics)}
FROM fact
${where}
GROUP BY 1
${having}
ORDER BY ${plan.order_by} ${direction} NULLS LAST
LIMIT ${Math.trunc(plan.limit)}`,
    columns: ["label", ...metrics],
    measures: metrics,
  };
}

function emitTimeSeries(
  plan: Extract<Plan, { plan_type: "time_series" }>,
  range: ResolvedRange,
  tenantId: string,
  bind: Bindings,
): Emitted {
  const metrics = expandMetrics(plan.metrics);
  const grain = plan.grain;
  const dimension = plan.dimensions[0];
  const { where, having } = predicates(plan.filters, range, tenantId, bind);

  const label = dimension ? `,\n       ${dimensionSql(dimension)} AS label` : "";
  const group = dimension ? "1, 2" : "1";

  return {
    sql: `SELECT date_trunc('${grain}', date)::DATE AS date${label},
       ${selectMetrics(metrics)}
FROM fact
${where}
GROUP BY ${group}
${having}
ORDER BY 1`,
    columns: ["date", ...(dimension ? ["label"] : []), ...metrics],
    measures: metrics,
  };
}

function emitComparePeriods(
  plan: Extract<Plan, { plan_type: "compare_periods" }>,
  range: ResolvedRange,
  comparison: ResolvedRange | null,
  tenantId: string,
  bind: Bindings,
): Emitted {
  if (!comparison) throw new CompileError("compare_periods needs a comparison window.");
  const metrics = expandMetrics(plan.metrics);
  const dimension = plan.dimensions[0];

  const side = (label: string, window: ResolvedRange, suffix: string) => {
    const where: string[] = [
      `tenant_id = ${bind.fixed("tenant", tenantId)}`,
      `date BETWEEN ${bind.fixed(`from_${suffix}`, window.resolved[0])} AND ${bind.fixed(`to_${suffix}`, window.resolved[1])}`,
    ];
    const having: string[] = [];
    for (const filter of plan.filters) {
      (MEASURE_FILTER_SQL[filter.field] ? having : where).push(filterSql(filter, bind));
    }
    const dim = dimension ? `,\n       ${dimensionSql(dimension)} AS label_2` : "";
    const group = dimension ? "GROUP BY 1, 2" : "GROUP BY 1";
    return `SELECT '${label}' AS label${dim},
       ${selectMetrics(metrics)}
FROM fact
WHERE ${where.join("\n  AND ")}
${group}
${having.length ? `HAVING ${having.join("\n   AND ")}` : ""}`;
  };

  return {
    sql: `${side("current", range, "cur")}
UNION ALL
${side("prior", comparison, "prior")}
ORDER BY label DESC`,
    columns: ["label", ...(dimension ? ["label_2"] : []), ...metrics],
    measures: metrics,
  };
}

/**
 * The drop diagnosis. A fixed template, not something the model composes.
 *
 * It always returns spend and row counts next to the metric that dropped,
 * whether or not the user asked for them, because the thing that separates
 * "performance collapsed" from "the load was incomplete" is structural: rows
 * that are not there, and spend that fell in lockstep. An agent that only
 * queries the metric cannot see it, and cannot be trusted to remember to ask.
 */
function emitDiagnoseDrop(
  plan: Extract<Plan, { plan_type: "diagnose_drop" }>,
  range: ResolvedRange,
  tenantId: string,
  bind: Bindings,
): Emitted {
  const target = range.resolved[1];
  const baselineStart = range.resolved[0];
  const baselineEnd = toIso(addDays(toDate(target), -1));
  const metric = plan.metric;
  const expression = metricSql(metric);

  const tenant = bind.fixed("tenant", tenantId);
  const bStart = bind.fixed("baseline_from", baselineStart);
  const bEnd = bind.fixed("baseline_to", baselineEnd);
  const targetDay = bind.fixed("target_day", target);
  const days = Math.max(1, Math.round((toDate(baselineEnd).getTime() - toDate(baselineStart).getTime()) / 86_400_000) + 1);

  const sql = `WITH baseline AS (
    SELECT channel AS label,
           ${expression} / ${days}.0 AS baseline_per_day,
           SUM(spend_usd) / ${days}.0 AS baseline_spend_per_day,
           COUNT(*) / ${days}.0     AS baseline_rows_per_day
    FROM fact
    WHERE tenant_id = ${tenant} AND date BETWEEN ${bStart} AND ${bEnd}
    GROUP BY 1
),
target AS (
    SELECT channel AS label,
           ${expression}    AS target_value,
           SUM(spend_usd)   AS target_spend,
           COUNT(*)         AS target_rows
    FROM fact
    WHERE tenant_id = ${tenant} AND date = ${targetDay}
    GROUP BY 1
)
SELECT COALESCE(b.label, t.label)                  AS label,
       COALESCE(b.baseline_per_day, 0)             AS baseline_per_day,
       COALESCE(t.target_value, 0)                 AS target_value,
       COALESCE(t.target_value, 0) - COALESCE(b.baseline_per_day, 0) AS delta,
       COALESCE(b.baseline_spend_per_day, 0)       AS baseline_spend_per_day,
       COALESCE(t.target_spend, 0)                 AS target_spend,
       COALESCE(b.baseline_rows_per_day, 0)        AS baseline_rows_per_day,
       COALESCE(t.target_rows, 0)                  AS target_rows
FROM baseline b
FULL OUTER JOIN target t ON t.label = b.label
ORDER BY delta ASC`;

  return {
    sql,
    columns: [
      "label",
      "baseline_per_day",
      "target_value",
      "delta",
      "baseline_spend_per_day",
      "target_spend",
      "baseline_rows_per_day",
      "target_rows",
    ],
    measures: [
      "baseline_per_day",
      "target_value",
      "delta",
      "baseline_spend_per_day",
      "target_spend",
      "baseline_rows_per_day",
      "target_rows",
    ],
  };
}

/**
 * The turn-off candidate. The criteria are TURN_OFF_POLICY, not the model's.
 *
 * Unconstrained, this question is confidently wrong: ranking every campaign by
 * ROAS surfaces an awareness campaign that was never bought for revenue, and
 * ranking by CPA surfaces one of the most profitable. The filters below are the
 * answer, and they are stated back to the user with it.
 */
function emitTurnOff(range: ResolvedRange, tenantId: string, bind: Bindings): Emitted {
  const metrics = ["roas", "cpa", "spend_usd", "revenue_usd", "conversions"];
  const tenant = bind.fixed("tenant", tenantId);
  const from = bind.fixed("from", range.resolved[0]);
  const to = bind.fixed("to", range.resolved[1]);
  const objectives = TURN_OFF_POLICY.objectives.map((o) => bind.bind(o, "obj")).join(", ");
  const minSpend = bind.bind(TURN_OFF_POLICY.minSpendUsd, "min_spend");

  return {
    sql: `SELECT campaign_name AS label,
       ${selectMetrics(metrics)}
FROM fact
WHERE tenant_id = ${tenant}
  AND date BETWEEN ${from} AND ${to}
  AND objective IN (${objectives})
GROUP BY 1
HAVING SUM(spend_usd) >= ${minSpend}
ORDER BY ${TURN_OFF_POLICY.rankBy} ${TURN_OFF_POLICY.direction === "asc" ? "ASC" : "DESC"} NULLS LAST`,
    columns: ["label", ...metrics],
    measures: metrics,
  };
}

/**
 * Budget pacing, in campaign-native currency.
 *
 * Budgets are *set* in INR and USD. Converting them to USD to compare against a
 * cap would compare a converted number against an unconverted one, which is the
 * same class of error as not converting at all.
 */
function emitBudgetPacing(range: ResolvedRange, tenantId: string, bind: Bindings): Emitted {
  const tenant = bind.fixed("tenant", tenantId);
  const from = bind.fixed("from", range.resolved[0]);
  const to = bind.fixed("to", range.resolved[1]);

  return {
    sql: `SELECT campaign_name                                   AS label,
       ANY_VALUE(currency)                              AS label_currency,
       SUM(spend) / NULLIF(COUNT(DISTINCT date), 0)     AS spend_per_day,
       ANY_VALUE(daily_budget)                          AS daily_budget,
       100.0 * (SUM(spend) / NULLIF(COUNT(DISTINCT date), 0))
             / NULLIF(ANY_VALUE(daily_budget), 0)       AS pacing_pct
FROM fact
WHERE tenant_id = ${tenant}
  AND date BETWEEN ${from} AND ${to}
  AND daily_budget IS NOT NULL
GROUP BY 1
ORDER BY pacing_pct DESC NULLS LAST`,
    columns: ["label", "label_currency", "spend_per_day", "daily_budget", "pacing_pct"],
    measures: ["spend_per_day", "daily_budget", "pacing_pct"],
  };
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);
