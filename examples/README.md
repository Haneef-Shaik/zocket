# Example conversations

Worked examples of what the agent should say, and — just as important — what it
should refuse to say. Every number in these files was computed from the CSVs in
[`data/`](../data/) under the policies below, so they double as expected output:
if the agent disagrees with a transcript, one of the two is wrong and it is worth
finding out which.

| file | what it covers |
|---|---|
| [01-core-questions.md](01-core-questions.md) | the five questions from the brief, answered in full |
| [02-phrasing-variants.md](02-phrasing-variants.md) | the same intents asked in the words people actually use |
| [03-traps.md](03-traps.md) | questions engineered to produce a confident wrong answer |
| [04-refusals-and-failures.md](04-refusals-and-failures.md) | unanswerable, out-of-coverage, and the agent's own failure modes |
| [golden.jsonl](golden.jsonl) | the machine-readable subset the automated check runs |

## Legend

| | meaning |
|---|---|
| ✅ | answered, no caveat needed |
| ⚠️ | answered, but the answer is only correct *because* it states a caveat |
| ⛔ | correctly refused — the data cannot support an answer |
| 💥 | v1 gets this wrong or degrades; recorded on purpose (see [DESIGN.md §8](../DESIGN.md)) |

## The response contract

Every answer carries the same six things. Transcripts below abbreviate, never omit.

1. **Interpretation** — one line, first, stating what was actually computed and over
   what dates. This is the safety net for the assume-and-state policy.
2. **Finding** — at most three sentences. Every figure in it exists in the result table.
3. **Chart** — chosen by rule from the plan shape, not by the model.
4. **Plan** — the JSON the planner emitted, post-validation.
5. **SQL + result table** — the query that produced the number, and the number.
6. **Flags** — data-quality annotations touching the rows this query read, plus a `trace_id`.

## Resolution rules these transcripts assume

- **`as_of` is 2026-09-04**, the latest date in the data — never the wall clock.
  Every relative range ("last week", "this quarter") resolves against it.
- **Reporting currency is USD.** `spend` and `revenue` are converted at the row's
  own date; where the FX feed has a gap the last rate is carried forward and flagged.
- **`campaigns.csv` decides the currency, not the fact row.** Where a row's
  `currency` contradicts its campaign's, the campaign wins and the row is flagged.
  Trusting the column instead adds **$63.6k of phantom spend (+9.4%)** to this
  extract and reorders the channel ranking — see
  [01-core-questions.md](01-core-questions.md).
- **Exact duplicate rows are collapsed** (14 in this extract). Rows that repeat a
  `(date, campaign, creative)` key with *different* numbers are restatements: the
  last one in file order wins, and the answer says so (9 keys).
- **Orphan ids are kept and reported separately**, never silently dropped and never
  silently folded into a named campaign.
- **Nulls are null, not zero.** They are excluded from averages and counted in flags.

## Terminology the agent is expected to resolve

Users do not speak the schema. These all map to the same metric or dimension:

| they say | they mean |
|---|---|
| spend, cost, burn, budget spent, invested, "how much did we blow" | `spend_usd` |
| ROAS, return, ROI, "revenue per dollar", efficiency, "are we making money" | `roas` |
| CPA, CAC, cost per lead, cost per acquisition, "what's a conversion costing" | `cpa` |
| conversions, purchases, orders, sales, signups, leads | `conversions` |
| channel, platform, network, source, "where we're advertising" | `channel` |
| creative, ad, asset, variant, "the video one" | `creative` |
| campaign, line item, "the summer thing" | `campaign` |

Where a word is genuinely ambiguous in this schema — "performance", "best", "top",
"doing well", "sales" — the agent picks the most common reading, states it in the
interpretation line, and does not ask. See [03-traps.md](03-traps.md#t1).
