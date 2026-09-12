# Dashboard Agent

Ask a question about advertising performance in English; get back a number you
can defend. Every answer carries the plan it ran, the SQL it ran, the rows that
came back, and what was wrong with the underlying data.

The dataset is deliberately dirty — 13 named defect classes, including one that
makes the most commonly asked question in any dashboard ("how did last week
compare to the week before?") off by 12 points in the direction people are
primed to believe. Most of this repository exists to get that one right.

---

## Run it

**Prerequisites:** Node **20.12+** (developed on 22.23; `process.loadEnvFile`
and Next 16 set the floor) and npm. No database to install — DuckDB is an
in-process native addon and comes down with `npm install`. Python 3 is only
needed if you want to regenerate the dataset.

```bash
npm install
npm test                  # 108 tests. No API key, no network, ~1s.
```

That is the whole verification path and it needs no credentials. To ask
questions you need an Azure OpenAI deployment:

```bash
cp .env.example .env      # then fill in AZURE_OPENAI_API_KEY + _ENDPOINT + _DEPLOYMENT
npm run dev               # http://localhost:3000
npm run ask -- "which campaign should we turn off?"
```

`.env.example` documents every variable. The deployment name is the one **you**
chose in Azure, which is usually not the model name — the most common reason a
first run 404s.

**No key handy?** Start `npm run dev` anyway and paste a key, endpoint and
deployment into the settings panel. Those stay in your browser, are sent with
that one request, and are never stored server-side. Requests on the shared key
in `.env` are metered per device (`TRIAL_REQUEST_LIMIT`, default 5); requests on
your own key are not metered at all.

**Four commands, and what each is for:**

| | |
|---|---|
| `npm test` | the deterministic check — validator → compiler → DuckDB → result validator over the golden set |
| `npm run dev` | the web UI: question box, chart, finding, flags, SQL, rows |
| `npm run ask -- "…"` | the same answer as a terminal transcript, same code path |
| `npm run sql -- "…"` | hand-written SQL against the canonical model, for checking numbers yourself |

That last one exists because the brief says *we will be checking your numbers*,
and checking them should not require writing a script:

```bash
npm run sql -- "SELECT channel, SUM(spend_usd) AS spend_usd FROM fact
                WHERE date BETWEEN DATE '2026-07-11' AND DATE '2026-09-04'
                GROUP BY 1 ORDER BY 2 DESC"
```

```
-- 2341 rows, 2026-06-08 to 2026-09-04 (as_of = 2026-09-04)
┌─────────┬─────────────────┬────────────────────┐
│ (index) │ channel         │ spend_usd          │
├─────────┼─────────────────┼────────────────────┤
│ 0       │ 'meta'          │ 162489.73221169008 │
│ 1       │ 'youtube'       │ 98384.16566403999  │
│ 2       │ 'google_search' │ 82443.23988917997  │
│ 3       │ 'linkedin'      │ 53112.18999999994  │
│ 4       │ 'unmapped'      │ 1834.25            │
└─────────┴─────────────────┴────────────────────┘
```

## What works

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

**The planner scores 12/12** — it picks an acceptable plan for every case in the
golden set.

Measured latency is **~4s to plan, ~5s to narrate, 40ms to query**. The shape
predicted in the design holds exactly: DuckDB rounds to nothing and model
latency is ~99% of wall clock, so prompt caching on the system prompt is the
first optimisation and it is free.

## What does not

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
   defensible and the interpretation line states which was chosen, but the LLM
   layer asserts plan *shape* and would not catch a drift in metric choice.
5. **Trial counts live in memory**, so they reset on restart and a second
   instance grants a fresh allowance. `UsageStore` is an interface; Redis is a
   one-file swap.
6. **`channel_outage` is coarse** — a channel-day with zero impressions and zero
   spend. It does not distinguish an outage from a channel that was not running.

**Deliberately out of scope:** auth, deployment, CI, real multi-tenancy,
free-form SQL on the request path, and an agent framework. The brief scores none
of it.

`tenant_id` is nonetheless threaded through the compiler from day one as a
required argument, and is a real column on `fact`. There is one tenant and no
auth, so the predicate is a no-op — but a tenant filter retrofitted later is a
filter someone forgets on one query path. The parameter exists so the compiler
*cannot* produce SQL without it.

**No agent framework.** The loop is a dozen lines of control flow in
[orchestrate.ts](src/agent/orchestrate.ts). The trust boundary *is* the product,
and hiding it inside someone else's abstraction would make it harder to see and
harder to test.

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

---

## Running it on your own data

The runtime is not coupled to this extract. Coverage, `as_of`, channels,
campaigns, creatives, formats, objectives and currencies are all read from the
CSVs at boot, and the planner prompt is templated with the coverage window, so a
different extract needs **no code change to answer questions**.

What *is* coupled to this extract is the **oracle** — the golden set and the
canonical assertions, which are specific numbers from these specific files. That
coupling is deliberate: it is the thing that tells you a policy broke. Swap the
data and `npm test` fails loudly, which is the mechanism working, not a bug.

### 1. The contract the files have to meet

Four files, these names, these headers, in `data/` (or any directory — see
below). Column order does not matter; names do.

| file | required columns |
|---|---|
| `ad_performance_daily.csv` | `date, campaign_id, creative_id, impressions, clicks, conversions, spend, revenue, currency` |
| `campaigns.csv` | `campaign_id, campaign_name, channel, objective, currency, daily_budget, start_date, end_date` |
| `creatives.csv` | `creative_id, campaign_id, creative_name, format, headline, launched_on` |
| `fx_rates.csv` | `date, currency, rate_to_usd` |

Everything is read as text and then `TRY_CAST`, so **malformed values become
`NULL` and get counted in the flags rather than aborting the answer**. You do not
have to clean the extract, and you should not: the flags are how the answer tells
the user what it was working with.

Three real requirements, each of which is silent if you miss it:

* **`fx_rates.csv` must contain the reporting currency against itself** —
  `2026-06-01,USD,1.000000`. The FX join is on currency, so with no `USD` rows
  every USD campaign joins to a null rate and `spend_usd` comes out `NULL`.
* **The FX feed must start on or before the first performance date.** Gaps in
  the middle are fine — the last known rate is carried forward and flagged — but
  a rate is never carried *backwards*, so a feed that starts late leaves the
  first days unconverted. This extract's feed starts 2026-06-01, a week early,
  on purpose.
* **`campaigns.csv` owns the currency.** The `currency` column on the fact rows
  is advisory and, in this extract, sometimes wrong; it is used only when the
  campaign has none. If your extract's fact-row currency is the authoritative
  one, that is a one-line change in [`views.sql`](src/sql/views.sql) and a
  policy flip in [`policies.ts`](src/semantic/policies.ts) — not a config knob,
  because it changes every number.

Dates are ISO `YYYY-MM-DD`. A blank `end_date` means still running.

### 2. Put the files in place

```bash
cp /path/to/extract/*.csv data/          # replace in place
# or leave data/ alone and point at the new directory:
DASHBOARD_AGENT_DATA=/abs/path/to/extract npm run dev
DASHBOARD_AGENT_DATA=/abs/path/to/extract npm test
```

There is **nothing to migrate, no cache to clear and no index to rebuild.**
DuckDB is in-memory and the whole model is rebuilt from the CSVs at boot, so the
only thing to remember is that *boot* means process start: **restart
`npm run dev`** after replacing a file. `npm run ask` and `npm run sql` re-ingest
on every invocation.

### 3. Confirm it loaded, before you trust anything

```bash
npm run sql -- "SELECT * FROM coverage"
```

`last_date` is now `as_of` — every relative expression ("last week", "this
quarter") resolves against it, and the answer's dates will move accordingly.

Then the four checks that catch a bad load:

```bash
# a) rows with money but no converted money -> your FX feed does not cover them
npm run sql -- "SELECT COUNT(*) AS unconverted FROM fact
                WHERE spend IS NOT NULL AND spend_usd IS NULL"

# b) how much landed in the 'unmapped' bucket -> campaign_ids that resolve to nothing
npm run sql -- "SELECT channel, COUNT(*) AS rows, SUM(spend_usd) AS spend_usd
                FROM fact GROUP BY 1 ORDER BY 3 DESC"

# c) is the last day partial? compare it to the days before it
npm run sql -- "SELECT date, COUNT(*) AS rows FROM fact
                GROUP BY 1 ORDER BY date DESC LIMIT 8"

# d) what the dedup and restatement policies actually removed
npm run sql -- "SELECT (SELECT COUNT(*) FROM perf_typed)       AS typed,
                       (SELECT COUNT(*) FROM perf_exact_dedup) AS after_dedup,
                       (SELECT COUNT(*) FROM perf_resolved)     AS after_restatement"
```

**(a) must be zero.** Anything else means spend is being dropped from every
USD-denominated total in the system, and nothing else will tell you.

### 4. Review the policy constants against the new scale

These are in [`src/semantic/policies.ts`](src/semantic/policies.ts) and are
hard-coded on purpose — every one of them changes a number the user sees. None
of them is reachable by the model. Four are scale- or vocabulary-dependent and
should be looked at whenever the data changes:

| constant | why it might need to change |
|---|---|
| `POLICIES.partialFinalDay` | `true` assumes the last day of the extract is an incomplete load, so "last week" ends the day before it. If your extract's final day is **complete**, this silently throws away a good day — set it `false`. Check with (c) above. |
| `TURN_OFF_POLICY.objectives` | Matched **literally** against `campaigns.objective` (`IN ('conversions')`). If your extract calls it `purchase` or `sales`, the turn-off question returns no candidate and looks broken. |
| `TURN_OFF_POLICY.minSpendUsd` | An absolute `$5,000` floor for "enough spend to act on". On a smaller or shorter extract nothing clears it and the answer is empty; on a much larger one it stops filtering anything. |
| `TURN_OFF_POLICY.lookbackDays` | `28`. An extract shorter than that will clip, which is stated in the answer but worth knowing. |

The currency, dedup, restatement, FX-gap and orphan policies are implemented
once in [`views.sql`](src/sql/views.sql) — the constants in `policies.ts` name
them and document the reasoning, and the SQL is where they take effect. Changing
one means changing both, which is intentional friction.

**If you change any policy, bump `POLICY_VERSION`** (and `SEMANTIC_VERSION` in
[`catalogue.ts`](src/semantic/catalogue.ts) if you touch a metric expression).
Both ride in the trace on every answer, so a number someone screenshots stays
attributable to the rules that produced it.

Adding a **metric or dimension** is a code change in `catalogue.ts` with a test,
by design: the planner can only select names that exist there, so it can neither
invent a metric nor redefine one.

### 5. Re-baseline the oracle

`npm test` will now fail. Most of the suite does not care about your data — only
these four files carry numbers from it:

| file | what to do |
|---|---|
| [`examples/golden.jsonl`](examples/golden.jsonl) | **Re-derive the numbers.** 12 cases; each has `expect.values`, `expect.plan.range_resolved`, `expect.top_1`, `expect.must_flag` and a `guard`. |
| [`tests/golden.ts`](tests/golden.ts) | The `LOCATORS` map says *where* in the result each expected value lives, keyed by label (`meta_prospecting_us`, `youtube`, …). Update the labels to yours; the shapes stay. |
| [`tests/canonical.test.ts`](tests/canonical.test.ts) | Policy-by-policy assertions with literal dates and totals. Same treatment. |
| [`tests/golden.test.ts`](tests/golden.test.ts) | Two incidental couplings: the `toHaveLength(12)` case count, and one clean-window test pinned to 10–20 June. Pick a window in your data with no partial day and no clipping. |

Everything else is fixture-based and passes unchanged —
`compile.test.ts`, `narratorGuard.test.ts`, `resolve.test.ts`,
`validate.test.ts`, `orchestrate.test.ts`, `llmConfig.test.ts`, `quota.test.ts`
run against stubbed coverage and literal rows, because they test the resolver,
the compiler and the guard, not the extract.

One to watch: [`tests/ingest.test.ts`](tests/ingest.test.ts) asserts that
collapsing duplicates removes rows and resolving restatements removes more —
i.e. *that there are duplicates and restatements to get wrong in the first
place*. Against a genuinely clean extract that assertion fails correctly. If
your data is clean, that is the test to relax, and the FX, partial-day and
unmapped guards along with it.

**How to re-derive a number.** Run the query and paste the result — that is
exactly how the committed numbers were produced:

```bash
# q1: spend by channel over the last eight weeks
npm run sql -- "SELECT channel, SUM(spend_usd) AS spend_usd FROM fact
                WHERE date BETWEEN DATE '2026-07-11' AND DATE '2026-09-04'
                GROUP BY 1 ORDER BY 2 DESC"

# t6: the dedup policy, as the two numbers it decides between
npm run sql -- "SELECT (SELECT SUM(conversions) FROM fact
                        WHERE date BETWEEN DATE '2026-08-01' AND DATE '2026-08-31') AS deduped,
                       (SELECT SUM(conversions) FROM perf_typed
                        WHERE date BETWEEN DATE '2026-08-01' AND DATE '2026-08-31') AS naive"
```

Substitute your own dates — `SELECT * FROM coverage` tells you what they are.

Two things worth preserving while you do it, because they are the point of the
file rather than decoration:

* **Keep the `guard` clause honest.** It names the wrong answer the case exists
  to prevent, and every failure quotes it. A guard that still says "inflated by
  66 re-sent duplicate rows" when your extract has a different number of them is
  worse than no guard.
* **Keep a pair of cases that disagree.** The value of `t6` is that the naive
  query returns 5,650 and the correct one 5,584. If your extract has no
  duplicates, no FX gaps and no partial final day, those cases assert nothing —
  either inject the defects or replace the cases with ones your data can fail.

### 6. Then the LLM layer, and the prose

```bash
GOLDEN_LLM=1 npm run test:llm
```

This asserts the *plan* the model emits — type, metrics, dimensions, window —
and never the numbers, so it mostly survives a data swap untouched. What it does
not survive is a **question that no longer means what it meant**, and two of the
twelve are exactly that:

* `t6` asks *"how many conversions did we get in August?"*. If your extract does
  not reach August, the plan stays correct and the answer becomes a refusal —
  the case now tests coverage clipping instead of the dedup policy it was
  written for.
* `n5` asks *"show me May's spend by channel"* and expects a **refusal**,
  because May is outside this extract. If your extract covers May, that case's
  whole point inverts: it should now be answered, and a passing refusal is a
  false negative.

So read the questions, not just the numbers. A golden case only earns its place
if the data can still make it fail.

Finally, these go stale and nothing will tell you:

* [`examples/*.md`](examples/) — worked transcripts, with numbers in the prose.
* [`data/README.md`](data/README.md) — row counts, date range, defect inventory.
* This README's *What works* table, and the figures in
  [ARCHITECTURE.md](ARCHITECTURE.md).

### Shortcut: different data, same shape

If you only want a *different* extract rather than a *real* one, regenerate it.
[`scripts/generate_dataset.py`](scripts/generate_dataset.py) builds the committed
CSVs from a fixed seed, with every defect injected in a named function:

```bash
python3 scripts/generate_dataset.py --out data       # reproduces the committed files byte for byte
```

Change `SEED` (or the dates and campaigns in
[`scripts/dataset_spec.py`](scripts/dataset_spec.py)) for a new extract with the
same defect profile — then re-baseline per step 5. No third-party packages
needed; it is standard-library Python.

---

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
| [Design.md](Design.md) | Part 1 — the production design: trust, isolation, change safety, cuts |
| [ARCHITECTURE.md](ARCHITECTURE.md) | the same design as diagrams — 8 pages, source in [`architecture.drawio`](architecture.drawio) |
| [`mvp-architecture.drawio`](mvp-architecture.drawio) | 9 pages where every box is a file or function in *this* repository |
| [PLAN.md](PLAN.md) | how this MVP was scoped and built |
| [examples/](examples/) | worked transcripts, traps, refusals, and the golden set |
| [data/README.md](data/README.md) | the extract, its provenance, and its 13 defect classes |
