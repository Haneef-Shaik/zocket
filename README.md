# Dashboard Agent

Ask a question about advertising performance in English; get back a number you
can defend. Every answer carries the plan it ran, the SQL it ran, the rows that
came back, and what was wrong with the underlying data.

The dataset is deliberately dirty — 13 named defect classes, including one that
makes the most commonly asked question in any dashboard ("how did last week
compare to the week before?") off by 12 points in the direction people are
primed to believe. Most of this repository exists to get that one right.

```bash
npm install
cp .env.example .env      # add your Azure OpenAI key + endpoint
npm test                  # 108 tests, no API key, no network
npm run dev               # http://localhost:3000
npm run ask -- "which campaign should we turn off?"
```

---

## What it does

Eight stages. **The LLM appears exactly twice, at the two ends.** Everything in
between — where correctness and money live — is deterministic code.

| # | Stage | LLM? | File |
|---|---|---|---|
| 1 | API, tenant context, input validation | no | [route.ts](app/api/ask/route.ts) |
| 2 | **Planner** — question → typed JSON plan | **yes** | [planner.ts](src/agent/planner.ts) |
| 3 | Validator — answerable? window in coverage? | no | [validate.ts](src/plan/validate.ts) |
| 4 | Compiler — plan → SQL | no | [compile.ts](src/sql/compile.ts) |
| 5 | Execution | no | [duckdb.ts](src/db/duckdb.ts) |
| 6 | Result validator → flags | no | [resultValidator.ts](src/verify/resultValidator.ts) |
| 7 | Chart spec, by rule from the plan shape | no | [spec.ts](src/chart/spec.ts) |
| 8 | **Narrator** + numeric guard | **yes** | [narrator.ts](src/agent/narrator.ts) |

The rule for what the model is allowed to decide: *a step is model-decided if a
wrong choice is visible and recoverable; hard-coded if a wrong choice is
invisible and silently corrupts the answer.* A user notices immediately if the
agent answered about the wrong metric. **Nobody notices that FX was applied at
the wrong date.**

So the model picks the *shape* of the question and writes the prose. It never
picks a join, a currency, a dedup rule, a date boundary, or a number.

## The parts that matter

**Every policy is implemented once**, in [`views.sql`](src/sql/views.sql).
Nothing downstream re-derives a join, an FX conversion, or a dedup rule.

**The compiler binds values, never interpolates them.** Identifiers come from
fixed maps and the only free-form values reaching SQL are parameters, so
`'; DROP TABLE fact; --` as a campaign name is not a question anyone has to
think about. There is a test for exactly that.

**Ratios divide after aggregating** — `SUM(a)/SUM(b)`, never `AVG(a/b)` — and a
ratio drags its numerator and denominator onto the result table, because "ROAS
0.78" is an assertion and "$22.9k spent to return $17.9k, a ROAS of 0.78" is a
number someone can check.

**An empty window is a refusal, not a zero.** A `SUM` over no rows returns 0,
which reads as *"we spent nothing"* rather than *"there is no data for May"*.
That is the single most dangerous silent failure in the system, and the
validator forces it to a refusal before it can become one.

**The narrator guard** ([narratorGuard.ts](src/verify/narratorGuard.ts))
extracts every numeric token from the generated prose and asserts each is
supported by the result table, a column total, a flag count, a percentage
between two of those, or a stated policy constant. A narrator that invents a
figure is rejected, re-prompted once, and then replaced by a deterministic
template over the same verified numbers. **Losing the narrator costs prose and
not numbers**, because the numbers were never the model's to produce.

**Refusals never reach a model.** The one question where a confident invented
answer would be most convincing ("how do we compare to competitors?") is the one
question where no model is consulted at all — the refusal is composed from the
validator's verdict.

## Date resolution, which is where the money is

`as_of` is the last date in the data (2026-09-04), never the wall clock. The
final day is an **incomplete load**, and the `calendar` flag on a time range
decides whether it is in or out:

| the user says | window | partial day |
|---|---|---|
| "the last eight weeks" | 2026-07-11 → 2026-09-04 | included, flagged |
| "last week" | 2026-08-28 → 2026-09-03 | excluded |
| "this quarter" | 2026-07-01 → 2026-09-04 | included, clipped, flagged |
| "last quarter" | 2026-04-01 → 2026-06-30, clipped to 2026-06-08 | n/a |

Days and weeks resolve as trailing blocks aligned to the last complete day
rather than to a Monday — the convention the golden set encodes, and the one
that keeps week-over-week stable as each day lands. Months and quarters keep
true calendar boundaries, where the named unit is unambiguous.

Get this wrong on "how did last week compare to the week before?" and you report
**−12.3%** (1,092 vs 1,245) instead of **+0.2%** (1,248 vs 1,246). Nothing about
the output looks broken.

## The interface

One question box, one answer. The answer is ordered as an argument — what it
understood, what it found, the picture, what was wrong with the data, then the
query and the rows — so the work is there to check without six panels open at
once.

A few decisions worth naming:

* **Numbers are formatted by what they are**, from the unit the semantic layer
  already knows: `162489.73221169008` is what the warehouse said and what the
  API returns, but `$162,490` is what a person reads. Budgets stay in the
  currency each campaign buys in and are never given a dollar sign they did not
  earn — the same error the currency policy exists to prevent.
* **Columns are named from the plan.** The compiler groups by a generic `label`;
  the header says "Channel", because the plan knows which dimension that was.
* **Flags are ranked by whether they change the answer.** Warnings are open,
  notes are folded behind a count. Twelve long sentences on every answer trains
  the reader to skip the one that matters.
* **Charts follow the rules in the dataviz method**: the form comes from the
  plan shape, one series gets one colour and no legend, two always get a legend,
  a single row is a stat tile rather than a one-bar bar chart, marks are capped
  at 24px with 4px ends, and grid and axes stay recessive. The categorical
  palette is the validated reference instance and passes all six checks —
  lightness band, chroma floor, CVD separation, normal-vision floor and contrast
  — against both the light and dark surfaces.
* **Dark mode is selected, not inverted**: its own steps for the dark surface,
  applied before first paint so there is no flash.

All six chart forms and both themes were rendered and inspected, not assumed.

## The automated check

Two layers, because the two things that break are different things.

**Layer 1 — deterministic. `npm test`. No API key, no network, no flake.**
Each golden case's plan runs through validator → compiler → DuckDB → result
validator, and the numbers and flags are asserted. This catches the regressions
that actually corrupt answers: a changed dedup rule, a dropped FX join, a broken
coverage clip. It is free, so there is no excuse to skip it.

**Layer 2 — the planner. `GOLDEN_LLM=1 npm run test:llm`.**
Feeds the *question* and asserts the emitted plan's shape — type, metrics,
window — never the prose. This is the layer that answers *"we changed a prompt
on Friday and answers got worse on Monday"*: prompt v7 scored 12/12, v8 scores
10/12, v8 is rejected. Kept out of the default run so Layer 1 stays free.

Every case in [`golden.jsonl`](examples/golden.jsonl) carries a **guard clause**
naming the wrong answer it prevents, and failures quote it. When `t6` fails it
does not say `expected 5584, got 5650` — it says *inflated by 66 re-sent
duplicate rows*. That is the difference between a failing test and a diagnosis.

```
108 deterministic tests across 11 files, plus 13 in the opt-in LLM layer:
  golden.test.ts        the 12 golden cases, end to end, deterministic
  resolve.test.ts       every window in the golden set
  compile.test.ts       every plan type + binding, ratios, HAVING, refusals
  narratorGuard.test.ts fabrication rejected; the fallback survives its own guard
  orchestrate.test.ts   the loop with the model stubbed
  ingest.test.ts        _ord still means file order (restatements invert if not)
  validate.test.ts      empty windows forced to refusals
  canonical.test.ts     the policies, as numbers
  llmConfig / quota     credentials and the trial allowance
```

## Verified against the live model

All five questions from the brief, plus the two traps that matter most, run end
to end against a real Azure OpenAI deployment (`gpt-5.6-luna`, chat completions,
strict structured outputs):

| question | result |
|---|---|
| Q1 spend by channel, last 8 weeks | Meta $162,489.73 → matches golden; `partial_day`, `currency_mismatch`, `unmapped_campaign_id` all raised |
| Q2 top campaign this quarter | `meta_prospecting_us` $255,726.67, window clipped and stated |
| Q3 conversions cliff | **"an incomplete final-day load"** — Meta 104.9 → 0 as its rows go 11 → 0. No campaign blamed. |
| Q4 which to turn off | `meta_prospecting_in`, ROAS 0.78 on $22,907, criteria stated, awareness excluded, *"not a recommendation"* |
| Q5 competitors | refused, no invented figure — and **one model call, not two**: the narrator is never reached |
| T1 last week vs the week before | 28 Aug–3 Sep vs 21–27 Aug, partial day excluded *and said so*; ROAS 2.16 → 2.04 |
| N13 budget caps | answered, not over-refused; 95.8% and 28.1% in campaign-native currency |

**Layer 2 scores 12/12** — the planner picks an acceptable plan for every case
in the golden set.

Measured latency is **~4s to plan, ~5s to narrate, 40ms to query**. The shape
predicted in the design holds exactly: DuckDB rounds to nothing and model
latency is ~99% of wall clock, so prompt caching on the system prompt is the
first optimisation and it is free.

Three things only live testing found, all now fixed:

* **Module-scope `process.env` reads.** The deployment name and API version were
  read at module-evaluation time, which happens *before* a `.env` file is
  loaded, so the CLI silently fell back to a deployment that did not exist and
  failed with a 404 against a name nobody configured. Both now resolve when
  asked.
* **`max_tokens` is rejected by newer models**, which want
  `max_completion_tokens`. Azure deployment names are tenant-chosen so there is
  no way to know which a deployment wants — the client now tries the current
  standard, flips on that specific 400, and remembers per deployment. At most
  one wasted call per deployment per process, and no configuration for anyone
  bringing their own key.
* **Unstated conventions became model guesses.** The drop baseline came back as
  28 days one run and 7 another, and budget pacing defaulted to all-time when it
  is a question about current state. Both are now stated in the prompt: a
  convention the model re-decides each time makes two runs of the same question
  disagree.

## Known gaps, honestly

In the order I would fix them:

1. **No conversation memory.** "What about Meta?" as a follow-up is not resolved
   against the previous question. It is the most common real interaction and it
   is simply not built.
2. **`diagnose_drop` decomposes by channel only.** The transcript also
   decomposes by campaign; the query returns channel rows plus the row counts
   and spend that carry the actual finding. Campaign-level decomposition is a
   second CTE, not a redesign.
3. **A failed request still spends a trial allowance.** Quota is charged before
   the model call, which is right for abuse but wrong when the call never
   reached the provider — every firewall rejection during this build burned one.
4. **Ambiguity resolution is unmeasured.** "How did last week compare?" plans
   spend/revenue/ROAS; the worked transcript leads with conversions. Both are
   defensible and the interpretation line states which was chosen, but Layer 2
   asserts plan *shape* and would not catch a drift in metric choice.
5. **Trial counts live in memory**, so they reset on restart and a second
   instance grants a fresh allowance. `UsageStore` is an interface; Redis is a
   one-file swap.
6. **`channel_outage` is coarse** — a channel-day with zero impressions and zero
   spend. It does not distinguish an outage from a channel that was not running.

## Deliberately out of scope

Auth, deployment, CI, real multi-tenancy, free-form SQL, and an agent
framework. The brief scores none of it.

`tenant_id` is nonetheless threaded through the compiler from day one as a
required argument, and is a real column on `fact`. There is one tenant and no
auth, so the predicate is a no-op — but a tenant filter retrofitted later is a
filter someone forgets on one query path. The parameter exists so the compiler
*cannot* produce SQL without it.

**No agent framework.** The loop is a dozen lines of control flow in
[orchestrate.ts](src/agent/orchestrate.ts). The trust boundary *is* the product,
and hiding it inside someone else's abstraction would make it harder to see and
harder to test.

## Cost and latency

Two model calls per question: roughly **2,300 input / 350 output tokens**, with
the planner dominating input because it carries the whole catalogue. So
**prompt caching on the system prompt is the first optimisation**, and it is
free. DuckDB is in-process over 2,341 rows — query time is single-digit
milliseconds and rounds to nothing, so **model latency is ~100% of wall clock**.
The trace records per-stage timings from day one so that optimisation can be
measurable rather than speculative.

I have not priced this in dollars, because I cannot verify a rate for the
deployment behind this endpoint. The token profile above is the part that is
ours; multiply it by your Azure rate.

## Further reading

| | |
|---|---|
| [Design.md](Design.md) | the production design — trust, isolation, change safety |
| [HLD.md](HLD.md) | the same thing for people who do not read code |
| [PLAN.md](PLAN.md) | how this MVP was scoped and built |
| [examples/](examples/) | worked transcripts, traps, refusals, and the golden set |
