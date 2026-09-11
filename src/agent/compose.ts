/**
 * Deterministic prose.
 *
 * Two jobs the model is deliberately not given:
 *
 *   * **Refusals.** Q5 asks about competitors. The single worst thing that
 *     could happen is a model filling that silence with a plausible number from
 *     its training data, so the refusal is composed from the validator's
 *     verdict and never goes near an LLM.
 *   * **The fallback finding.** When the narrator is unavailable or its guard
 *     rejects it twice, the answer degrades to a template over the same
 *     verified numbers. Uglier prose, identical figures -- cheap, because the
 *     numbers were never the model's to begin with.
 */

import type { Plan } from "@/plan/schema";
import type { ResolvedRange } from "@/plan/resolve";
import type { VerifiedResult, ResultRow } from "@/agent/types";
import type { Flag } from "@/verify/flags";
import type { Verdict } from "@/plan/validate";
import type { Coverage } from "@/db/duckdb";
import { METRICS, DIMENSIONS } from "@/semantic/catalogue";
import { TURN_OFF_POLICY } from "@/semantic/policies";

/* --------------------------------------------------------------- formatting */

const money = (v: number) =>
  `$${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}`;

export function formatMetric(id: string, value: number | string | null): string {
  if (value === null) return "n/a";
  if (typeof value === "string") return value;

  switch (METRICS[id]?.unit) {
    case "USD":
      return money(value);
    case "USD_per_conversion":
      return `${money(value)}`;
    case "ratio":
      return value.toFixed(2);
    case "pct":
      return `${(value * 100).toFixed(2)}%`;
    case "count":
      return Math.round(value).toLocaleString("en-US");
    default:
      return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(2);
  }
}

const label = (id: string) => METRICS[id]?.label ?? id;

/** "11 Jul – 4 Sep 2026" */
export function formatWindow(range: readonly [string, string] | null): string {
  if (!range) return "all available data";
  const [from, to] = range;
  return from === to ? pretty(from) : `${pretty(from)} – ${pretty(to)}`;
}

// A fixed table rather than toLocaleString: ICU renders September as "Sept",
// which reads as a typo next to "11 Jul" in the same sentence. Dates in an
// answer should also not shift with the host's locale data.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pretty(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ----------------------------------------------------------- interpretation */

/**
 * The line the user reads first.
 *
 * The model wrote the "what"; the dates are appended by code, because the model
 * does not know what its own relative range resolved to -- and the whole safety
 * value of an interpretation line is that it is specific enough to be wrong in
 * a way the user can see.
 */
export function interpretation(
  plan: Plan,
  range: ResolvedRange | null,
  comparison: ResolvedRange | null,
): string {
  if (plan.plan_type === "unanswerable" || !range) return plan.interpretation;

  const parts = [`${plan.interpretation.trim().replace(/[.\s]+$/, "")}.`];
  parts.push(
    `Computed over ${formatWindow([range.resolved[0], range.resolved[1]])}` +
      (comparison
        ? ` against ${formatWindow([comparison.resolved[0], comparison.resolved[1]])}`
        : "") +
      ".",
  );

  if (range.clipped) {
    parts.push(
      `You asked for ${formatWindow([range.requested[0], range.requested[1]])}, but the data ` +
        `does not cover all of it, so this is the part that exists.`,
    );
  }
  if (range.excludedPartialDay) {
    parts.push(`The final day of the extract is excluded because it is an incomplete load.`);
  } else if (range.includesPartialDay) {
    parts.push(`This includes the final day of the extract, which is an incomplete load.`);
  }

  return parts.join(" ");
}

/* -------------------------------------------------------------- refusals */

export function refusal(verdict: Extract<Verdict, { ok: false }>, coverage: Coverage): string {
  const window = `${formatWindow([coverage.firstDate, coverage.lastDate])}`;
  const dimensions = Object.values(DIMENSIONS)
    .map((d) => d.label.toLowerCase())
    .join(", ");
  const metrics = Object.values(METRICS)
    .filter((m) => m.aggregation === "sum")
    .map((m) => m.label.toLowerCase().replace(" (usd)", ""))
    .join(", ");

  switch (verdict.reason) {
    case "no_such_entity":
      return (
        `I can't answer that: ${verdict.missing} is not in this dataset, and I am not going to ` +
        `estimate it. What is here is your own advertising data — ${metrics} and the ratios over ` +
        `them, split by ${dimensions}, covering ${window}. ` +
        `I can tell you how your own spend moved over that period, which channels and campaigns ` +
        `took it, and what came back.`
      );

    case "no_such_dimension":
      return (
        `There is no ${verdict.missing} breakdown in this data — the export does not carry that ` +
        `column, so any split I showed you would be invented. The dimensions that do exist are ` +
        `${verdict.available.join(", ")}. Ask for any of those and I can answer it directly.`
      );

    case "no_such_metric":
      return (
        `${verdict.missing} is not derivable from this data. The metrics that exist are ` +
        `${verdict.available.join(", ")}.`
      );

    case "outside_coverage":
      return (
        `That window (${verdict.missing}) is outside the data, so the honest answer is "I don't ` +
        `know" rather than $0 — a sum over no rows is zero, and that would read as though you ` +
        `had spent nothing. Coverage runs ${window}. Ask for a date inside it and I can answer.`
      );

    case "not_analytical":
      return (
        `That is not something I can answer from this advertising dataset. It covers ${window} ` +
        `and contains ${metrics} by ${dimensions}.`
      );
  }
}

/* ------------------------------------------------- the deterministic finding */

const num = (row: ResultRow | undefined, key: string): number =>
  typeof row?.[key] === "number" ? (row[key] as number) : 0;

const text = (row: ResultRow | undefined, key: string): string => String(row?.[key] ?? "");

function columnTotal(result: VerifiedResult, key: string): number {
  return result.rows.reduce((sum, row) => sum + num(row, key), 0);
}

/**
 * Prose built only from values that are on the table, so it satisfies the
 * narrator guard by construction. `tests/narratorGuard.test.ts` asserts that.
 */
export function templateFinding(
  plan: Plan,
  result: VerifiedResult,
  flags: readonly Flag[],
): string {
  const rows = result.rows;
  const first = rows[0];
  const sentences: string[] = [];

  switch (plan.plan_type) {
    case "unanswerable":
      return plan.interpretation;

    case "single_value": {
      const parts = plan.metrics.map((m) => `${label(m)} ${formatMetric(m, first?.[m] ?? null)}`);
      sentences.push(`${parts.join(", ")} over ${formatWindow(result.range)}.`);
      break;
    }

    case "breakdown": {
      const metric = plan.metrics[0] ?? "";
      const second = rows[1];
      const total = columnTotal(result, metric);
      sentences.push(
        `${text(first, "label")} leads on ${label(metric)} at ` +
          `${formatMetric(metric, num(first, metric))}` +
          (second
            ? `, ahead of ${text(second, "label")} at ${formatMetric(metric, num(second, metric))}`
            : "") +
          `, out of ${formatMetric(metric, total)} across ${rows.length}.`,
      );
      break;
    }

    case "ranking": {
      const metric = plan.order_by;
      const direction = plan.direction === "asc" ? "lowest" : "highest";
      sentences.push(
        `${text(first, "label")} has the ${direction} ${label(metric)} at ` +
          `${formatMetric(metric, num(first, metric))} over ${formatWindow(result.range)}.`,
      );
      break;
    }

    case "time_series": {
      const metric = plan.metrics[0] ?? "";
      const last = rows.at(-1);
      sentences.push(
        `${label(metric)} ran from ${formatMetric(metric, num(first, metric))} to ` +
          `${formatMetric(metric, num(last, metric))} across ${rows.length} ${plan.grain}s.`,
      );
      break;
    }

    case "compare_periods": {
      const metric = plan.metrics[0] ?? "";
      const current = rows.find((r) => r.label === "current");
      const prior = rows.find((r) => r.label === "prior");
      const a = num(current, metric);
      const b = num(prior, metric);
      const change = b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100;
      sentences.push(
        `${label(metric)} was ${formatMetric(metric, a)} against ${formatMetric(metric, b)} in the ` +
          `comparison window, a change of ${change.toFixed(1)}%.`,
      );
      break;
    }

    case "diagnose_drop": {
      const targetTotal = columnTotal(result, "target_value");
      const baselineTotal = columnTotal(result, "baseline_per_day");
      const targetRows = columnTotal(result, "target_rows");
      const baselineRows = columnTotal(result, "baseline_rows_per_day");
      const targetSpend = columnTotal(result, "target_spend");
      const baselineSpend = columnTotal(result, "baseline_spend_per_day");
      const worst = rows[0];

      sentences.push(
        `${label(plan.metric)} came in at ${formatMetric(plan.metric, targetTotal)} against a ` +
          `baseline of ${formatMetric(plan.metric, baselineTotal)} per day.`,
      );

      // The structural evidence, which is the actual finding whenever it holds.
      if (targetRows < baselineRows * 0.75 && targetSpend < baselineSpend * 0.75) {
        sentences.push(
          `That day carries ${Math.round(targetRows)} rows against a typical ` +
            `${Math.round(baselineRows)}, and spend fell with it — ` +
            `${formatMetric("spend_usd", targetSpend)} against ` +
            `${formatMetric("spend_usd", baselineSpend)} per day — so this is an incomplete ` +
            `load rather than a collapse in performance.`,
        );
        sentences.push(`Re-check it once the day has fully loaded before acting on it.`);
      } else if (worst) {
        sentences.push(
          `The largest single contributor was ${text(worst, "label")}, ` +
            `${formatMetric(plan.metric, num(worst, "delta"))} against its baseline.`,
        );
      }
      break;
    }

    case "turn_off_candidate": {
      sentences.push(
        `By the standing criteria — trailing ${TURN_OFF_POLICY.lookbackDays} days, ` +
          `${TURN_OFF_POLICY.objectives.join(" and ")} campaigns only, at least ` +
          `${money(TURN_OFF_POLICY.minSpendUsd)} of spend — ${text(first, "label")} is the ` +
          `weakest at ${formatMetric("roas", num(first, "roas"))} ROAS on ` +
          `${formatMetric("spend_usd", num(first, "spend_usd"))} of spend.`,
      );
      sentences.push(
        `Campaigns bought for awareness are excluded because they are not meant to return ` +
          `tracked revenue. This is an observation against those criteria, not a recommendation.`,
      );
      break;
    }

    case "budget_pacing": {
      sentences.push(
        `${text(first, "label")} is pacing closest to its cap at ` +
          `${num(first, "pacing_pct").toFixed(1)}% of ` +
          `${num(first, "daily_budget").toLocaleString("en-US")} ${text(first, "label_currency")} ` +
          `per day.`,
      );
      sentences.push(`Budgets are compared in the currency each campaign is set in, not converted.`);
      break;
    }
  }

  // One caveat, and only when it changes how the number should be read.
  const material = flags.find((f) => f.severity === "warn");
  if (material && sentences.length < 3) sentences.push(material.message);

  return sentences.join(" ");
}
