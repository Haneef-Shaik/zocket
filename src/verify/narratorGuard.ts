/**
 * The narrator guard.
 *
 * Extract every numeric token from the prose and assert each one is supported
 * by the result table. A narrator that invents a figure fails rather than
 * shipping it.
 *
 * This is the cheapest real defence against the single failure the whole design
 * exists to prevent, and -- the point -- it is deterministic. It does not ask a
 * model whether a model hallucinated.
 *
 * What counts as supported:
 *
 *   * a value in the result table, or a column total;
 *   * a flag count (flags are part of the answer and carry their own numbers);
 *   * a percentage change or share between two supported values, because
 *     "revenue rose 12%" is a legitimate reading of two numbers that are both
 *     on the table;
 *   * a small integer no larger than the row count, which is how prose counts
 *     things ("three channels", "the top 5"), and the length of the window.
 *
 * Everything else fails. The bar is deliberately about *magnitudes*: an
 * invented dollar figure or an invented ROAS is the failure that matters, and
 * neither can survive this.
 */

import type { VerifiedResult } from "@/agent/types";
import type { Flag } from "@/verify/flags";
import { TURN_OFF_POLICY } from "@/semantic/policies";

export interface GuardResult {
  readonly ok: boolean;
  /** The tokens as written, so a retry can name them back to the model. */
  readonly unsupported: readonly string[];
  /** How many numeric tokens were checked at all. */
  readonly checked: number;
}

export class NarratorGuardError extends Error {
  constructor(readonly unsupported: readonly string[]) {
    super(
      `The narrator used ${unsupported.length} figure(s) that do not appear in the ` +
        `result: ${unsupported.join(", ")}.`,
    );
    this.name = "NarratorGuardError";
  }
}

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

/**
 * Dates are not claims about magnitude, and they are already fixed by the
 * resolver rather than chosen by the narrator, so they are removed before
 * anything is checked.
 */
function stripDates(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(new RegExp(`\\b\\d{1,2}\\s*(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*\\.?`, "gi"), " ")
    .replace(new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");
}

const SCALES: Readonly<Record<string, number>> = { k: 1e3, m: 1e6, bn: 1e9, b: 1e9 };

interface Token {
  readonly raw: string;
  readonly value: number;
  /** Half the last written digit's place value: the most it could have been rounded by. */
  readonly tolerance: number;
  readonly isPercent: boolean;
}

function tokenize(text: string): readonly Token[] {
  // A magnitude suffix must be *attached* to the number and must not run
  // into a word: without the adjacency and the lookahead, the "b" of
  // "between" reads as billions, and "2 keys" reads as 2,000. The first
  // rejects a correct figure; the second would accept a wrong one.
  const pattern =
    /([-+\u2212])?\s*\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:(bn|b|k|m)(?![A-Za-z])|(\s*%))?/gi;
  const tokens: Token[] = [];

  for (const match of text.matchAll(pattern)) {
    const [raw, sign, whole = "", fraction = "", letter = "", percent = ""] = match;
    const isPercent = percent !== "";
    const scale = isPercent ? 1 : (SCALES[letter.toLowerCase()] ?? 1);

    const digits = Number(`${whole.replaceAll(",", "")}${fraction}`);
    if (!Number.isFinite(digits)) continue;

    const decimals = fraction ? fraction.length - 1 : 0;
    const magnitude = digits * scale * (sign === "-" || sign === "−" ? -1 : 1);
    const place = Math.pow(10, -decimals) * scale;

    tokens.push({
      raw: raw.trim(),
      value: magnitude,
      tolerance: place / 2 + Math.abs(magnitude) * 1e-9 + 1e-9,
      isPercent,
    });
  }

  return tokens;
}

/** Every magnitude the prose is allowed to assert, before derivations. */
function supportedValues(result: VerifiedResult, flags: readonly Flag[]): readonly number[] {
  const values: number[] = [];
  const totals = new Map<string, number>();

  for (const row of result.rows) {
    for (const column of result.columns) {
      const cell = row[column];
      if (typeof cell === "number" && Number.isFinite(cell)) {
        values.push(cell);
        totals.set(column, (totals.get(column) ?? 0) + cell);
      }
    }
  }

  values.push(...totals.values());
  for (const flag of flags) values.push(flag.count);

  // Prose counts things: "three channels", "the top 5", "11 rows".
  for (let i = 0; i <= result.rows.length; i++) values.push(i);

  // Policy constants. A turn-off answer is *required* to state the criteria
  // that produced it, and those are fixed in this repository -- the model
  // cannot fabricate them, so allowing them costs the guard nothing.
  values.push(TURN_OFF_POLICY.minSpendUsd, TURN_OFF_POLICY.lookbackDays);

  if (result.range) {
    const days =
      Math.round(
        (Date.parse(`${result.range[1]}T00:00:00Z`) - Date.parse(`${result.range[0]}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    values.push(days, Math.round(days / 7));
  }

  return values;
}

/**
 * Changes and shares between two supported values.
 *
 * Capped because this is O(n^2): a result wide enough to blow past the cap is
 * one where a model-written percentage is not worth the check anyway, and the
 * direct values are still enforced.
 */
function derivedPercentages(values: readonly number[]): readonly number[] {
  const out: number[] = [];
  const capped = values.slice(0, 160);

  for (const a of capped) {
    for (const b of capped) {
      if (b === 0) continue;
      out.push(((a - b) / Math.abs(b)) * 100);
      out.push((a / b) * 100);
    }
  }

  return out;
}

export function checkNarration(
  prose: string,
  result: VerifiedResult,
  flags: readonly Flag[],
): GuardResult {
  const tokens = tokenize(stripDates(prose));
  const direct = supportedValues(result, flags);
  const percentages = derivedPercentages(direct);

  const unsupported: string[] = [];

  for (const token of tokens) {
    const matches = (candidates: readonly number[], scale = 1) =>
      candidates.some((c) => Math.abs(token.value - c * scale) <= token.tolerance);

    // A percentage may be written against a value held as a fraction (CTR of
    // 0.024 read aloud as "2.4%"), so both scalings are allowed for % tokens.
    const ok = token.isPercent
      ? matches(direct) || matches(direct, 100) || matches(percentages)
      : matches(direct) || matches(percentages);

    if (!ok) unsupported.push(token.raw);
  }

  return { ok: unsupported.length === 0, unsupported, checked: tokens.length };
}
