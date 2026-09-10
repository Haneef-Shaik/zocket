# Dashboard Agent — High-Level Design

**Audience:** senior management · **Purpose:** design review and demo walkthrough
**Status:** Part 1 (design) complete · Part 2 (MVP) not yet built
**Date:** 2026-09-10

---

## Provenance rule for this document

Every figure below is one of three kinds, and is labelled:

| Mark | Meaning |
|---|---|
| **[verified]** | Recomputed directly from the CSVs in `data/` by an independent script for this review. Reproducible. |
| **[estimate]** | A projection from stated assumptions. The assumptions are given inline. Not a measurement. |
| **[design]** | A design intent or target. Nothing is built yet, so it is not a claim about observed behaviour. |

Nothing in this document is asserted without one of those three labels. That is the same discipline the system itself is being built to enforce.

---

## 1. Executive summary

**What we are building.** A natural-language interface over marketing performance data. A user asks *"what did we spend by channel last quarter?"* and gets a number, a chart, and the query that produced the number.

**The actual engineering problem is not the chart.** Any LLM can draw a bar chart. The problem is producing a number a director will carry into a budget meeting and defend without having done the analysis themselves. Everything in this design follows from that.

**The governing decision, in one line:**

> The model decides **what should be analysed**. Deterministic code decides **what the data says**.

The LLM never computes a business number, never writes the tenant filter, never defines a metric, and never renders a chart. It interprets the question into a typed plan, and — after the numbers are computed and validated — it writes the sentence describing them.

**Why this matters commercially, in one number.** In our 89-day extract, a single unremarkable data-handling decision — trusting the `currency` column on the fact row instead of the campaign's own billing currency — inflates total spend by **$63,098, or +9.3%** **[verified]**, and reorders the channel ranking. That is a wrong answer that looks entirely plausible: the chart renders, the totals foot, nothing errors. A system that produces it once is a system nobody trusts again. Preventing that class of failure is the product.

---

## 2. What we are actually working with

The dataset is a 4-file extract of daily ad performance. **[verified]** against the raw CSVs:

| | |
|---|---|
| Fact rows | 2,364 |
| Coverage | 2026-06-08 → 2026-09-04 (89 days) |
| Campaigns / creatives | 12 / 31 |
| Channels | google_search, meta, youtube, linkedin |
| Currencies | INR and USD, with a daily FX table (184 rows) |

**It is not clean, deliberately.** The brief said so, and it holds up. Every defect below was independently counted for this review **[verified]**:

| Defect | Count | What it breaks if ignored |
|---|---:|---|
| Exact duplicate rows (re-sent days) | 14 | Inflates every SUM |
| Restated keys (same day/campaign/creative, different numbers) | 9 | Double-counts, or reports a superseded figure |
| Rows whose `currency` contradicts the campaign's | 5 | **+$63,098 phantom spend (+9.3%)** |
| Rows with a `campaign_id` that resolves to nothing (`C013`) | 7 | Silently absorbed into a named campaign, or silently dropped |
| Rows with an unresolvable `creative_id` | 11 | Same |
| Missing FX rates for INR | 4 dates | Revenue silently becomes 0, or the row is dropped |
| Null cells in metric columns | 13 | Nulls treated as zero corrupt averages |
| Negative spend (refund/credit lines) | 3 | Understates cost; can produce negative ROAS |
| Revenue booked against zero spend | 11 | Infinite / undefined ROAS |
| Funnel violations (clicks > impressions, conversions > clicks) | 4 | One row can win a "best day" ranking on its own |
| Incomplete most recent day | 11 rows vs 26 typical | Reads as a performance collapse |

**The point for management:** these are not exotic. This is what every ad-platform export looks like. The defects are the reason a naive "LLM writes SQL" implementation is not merely imperfect but *actively dangerous* — it will answer confidently and wrongly, and there will be no signal that it did.

---

## 3. How wrong answers actually happen — four worked cases

Each of these is a real trap in this dataset, with both the correct answer and the confident wrong one **[verified]**.

**A. Currency — "spend by channel, last 8 weeks"**

| Channel | Correct (campaign currency) | Naive (trust the row's `currency`) |
|---|---:|---:|
| meta | $162,490 | $186,562 |
| youtube | $98,384 | $98,384 |
| google_search | $82,443 | **$103,917** |
| linkedin | $53,112 | $52,759 |
| unmapped (orphan ids) | $1,834 | $1,834 |
| **Total** | **$398,264** | **$443,457** |

The naive path does not just inflate the total — it **swaps rank 2 and rank 3**. A budget conversation held off the second column reallocates money in the wrong direction.

**B. FX — "which campaign made the most revenue this quarter?"**

- Correct: **meta_prospecting_us, $255,727** (runner-up summer_sale_meta, $200,194).
- Summing the raw `revenue` column without converting: returns **meta_prospecting_in** on **₹3,810,994** — a number that is larger only because it is in rupees.

**C. Incomplete data mistaken for a business event — "conversions fell off a cliff"**

- Baseline 2026-08-28→09-03: **178.3 conversions/day**. Final day 2026-09-04: **23**.
- But spend on that day is **$768 against a $6,901/day baseline — down 89%** — and the day has **11 rows where 26 is typical**.
- The correct conclusion is **"the last day is an incomplete load, not a performance drop."** Any answer that names a campaign or creative as the cause is wrong. This is the case that separates a real system from a demo.

**D. Ranking without a policy — "which campaign should we turn off?"**

- Ranking every campaign by ROAS returns **linkedin_thought_leadership at ROAS 0.00** — which is an *awareness* campaign that was never meant to generate tracked revenue. Turning it off on that basis is a mistake caused by the tool.
- With a policy applied (conversions-objective campaigns only, ≥$5,000 spend, last 28 days), the answer is **meta_prospecting_in — ROAS 0.78 on $22,907 of spend**.

The system must state that this is *an observation with criteria attached*, not a recommendation. **[design]**

---

## 4. Architecture — the request path

```
   User question
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 1. API / Auth        tenant_id, user, permissions,        │  ← no LLM
│                      rate limits                          │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 2. PLANNER (LLM)     question + metric catalogue           │  ← LLM #1
│                      → typed JSON plan                     │     of 2
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 3. Validator         Is the metric real? the dimension?    │  ← no LLM
│                      the date range in coverage?           │
│                      → ANSWERABLE / UNANSWERABLE(reason)   │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 4. Compiler          plan → SQL. Owns joins, FX            │  ← no LLM
│                      conversion, dedup, tenant filter      │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 5. Warehouse         executes; returns aggregate rows      │  ← no LLM
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 6. Result validator  schema, nulls, invariants, coverage   │  ← no LLM
│                      → verified result + flags             │
└───────────────────────────────────────────────────────────┘
        │
        ├─────────────► 7. Chart spec  (chosen by RULE from plan shape)
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 8. NARRATOR (LLM)    verified numbers + flags → prose       │  ← LLM #2
│                      Cannot change a number.                │     of 2
└───────────────────────────────────────────────────────────┘
        │
        ▼
   Interpretation · Finding · Chart · Plan · SQL + table · Flags · trace_id
```

**The LLM appears exactly twice, at the two ends.** In between — where correctness, security, and money live — there is only deterministic code. That is the whole architecture in one sentence.

---

## 5. Fixed vs. decided — the rule, not just the answer

Management will reasonably ask why we don't simply let the model do more. The rule we apply:

> **A step is model-decided if a wrong choice is visible and recoverable. A step is hard-coded if a wrong choice is invisible and silently corrupts the answer.**

Applying it:

| Model-decided (wrong = visible) | Hard-coded (wrong = invisible) |
|---|---|
| Which metric the user means ("burn" → spend) | What the metric *is* (spend × that date's FX rate) |
| Which dimension ("platform" → channel) | The joins between fact and dimension tables |
| Which date range ("last quarter") | How the range is clipped to actual coverage |
| Which of the supported plan shapes fits | Deduplication and restatement policy |
| The wording of the finding | Every number in the finding |
| — | Tenant filter, currency conversion, chart type, SQL |

A user immediately notices if the agent answered about the wrong metric. **No user will ever notice that FX was applied at the wrong date.** That asymmetry is the line. **[design]**

**One consequence worth naming:** chart type is chosen by rule from the plan shape (breakdown → bar, time series → line, single value → stat), not by the model. It costs us nothing in quality and removes an entire class of "the chart says something different from the text" failures.

---

## 6. Trust — what stands between the model and the number

Five gates, each independently able to stop a bad answer **[design]**:

1. **The model cannot name a metric that doesn't exist.** It selects from a versioned catalogue; anything else fails validation before a query runs.
2. **The model never writes SQL.** A compiler turns the typed plan into SQL. Joins, FX, dedup and the tenant predicate are compiler-owned and covered by their own tests.
3. **Arithmetic happens in the database.** ROAS is `SUM(revenue_usd)/SUM(spend_usd)` executed in SQL, never model mental arithmetic.
4. **Results are validated before anyone sees them.** Coverage gaps, nulls, funnel violations, missing FX, duplicate keys — each produces a flag that travels with the answer.
5. **The narrator gets only verified numbers.** It cannot query, cannot recompute, and every figure in its sentence must appear in the result table.

**"What if it's wrong anyway — how would we find out?"**
Every answer carries a `trace_id` binding: prompt version, model, semantic-model version, compiler version, data version, the plan, the compiled SQL, and the result. Any answer can be replayed exactly. Without that, a disputed number is an argument; with it, it is a diff. **[design]**

**The honest limit:** these gates guarantee the number matches the plan. They do **not** guarantee the plan matches the question. If the user means one thing and the planner reads another, the pipeline will faithfully compute the wrong-but-correct number. The mitigations are (a) the mandatory interpretation line stating in plain English what was computed and over what dates, printed *first*, and (b) the golden set. This is a real residual risk and it should be stated as one.

---

## 7. Saying "I don't know"

Answerability is a first-class outcome, not an error path. Four refusal reasons, each with a distinct response **[design]**:

| Reason | Example | Response |
|---|---|---|
| `no_such_entity` | *"How does spend compare to competitors?"* | We hold our own performance only. No competitor data exists in the system. Here is what we *can* show. |
| `no_such_dimension` | *"Break conversions down by device."* | No device dimension. Available: channel, campaign, creative, objective, format, date. |
| `outside_coverage` | *"Show me May's spend."* | Coverage is 2026-06-08 → 2026-09-04. May is outside it. |
| `data_quality_failure` | FX feed gap too wide to carry forward | Refuse or degrade with an explicit caveat. |

**The failure this prevents is specific and dangerous.** A `SUM` over an empty date range returns **$0**. Rendered as a chart, "$0" reads as *"we spent nothing in May"* — a false business fact — rather than *"we have no May data."* Returning zero here is worse than returning nothing.

A partial-credit variant matters too: *"What was our ROAS last quarter?"* is answerable, but only 23 of Q2's 91 days exist in the extract. The correct answer is **ROAS 2.91 on $186,148 spend** *with the clip stated* **[verified]**. The same number without the caveat is a wrong answer wearing a right answer's clothes.

---

## 8. Multi-tenant isolation

The system targets a few hundred teams. Tenant scoping is enforced by the compiler and the warehouse, never by anything the model produces. **[design]**

**The obvious control:** `tenant_id` comes from the authenticated session, is injected by the compiler, and is additionally enforced by row-level security in the warehouse — two independent layers, so a compiler bug alone cannot leak.

**Where leaks actually happen** — the non-obvious surfaces, which is what this section is really for:

- **Caches** keyed on query hash alone. Cache keys must be `tenant_id + semantic_version + data_version + query_hash`. This is the single most likely leak in the system.
- **Conversation history** replayed into a later prompt after a user switches workspace.
- **Rendered charts and exports** served from a shared object store by guessable URL.
- **Error messages and stack traces** echoing another tenant's identifiers.
- **Logs and traces** — the observability pipeline sees everything by construction.
- **Few-shot examples** in prompts, if ever built from real customer questions.
- **Background jobs and scheduled reports**, which run outside the request's auth context.
- **Vector stores**, if semantic search over past questions is added later.

Every one of these is outside the request path, which is exactly why they get missed.

---

## 9. Cost and latency

**Volume [estimate]:** 500 users × 20 questions/day × 30 days ≈ **300,000 questions/month**.

**Per-question model usage [estimate]** — two calls: a planner (~3,000 input / ~300 output tokens) and a narrator (~1,500 input / ~200 output). Published Anthropic list prices per million tokens:

| Model choice | $/question | Monthly at 300k |
|---|---:|---:|
| Haiku 4.5 both calls ($1 / $5) | ~$0.007 | **~$2,100** |
| Sonnet 5 both calls ($2 / $10) | ~$0.014 | ~$4,200 |
| Opus 5 both calls ($5 / $25) | ~$0.035 | ~$10,500 |

**Model inference dominates.** Warehouse compute for aggregate queries over data of this shape is a rounding error beside it. **[estimate]**

**Where we attack it, in order [design]:**

1. **Result cache** — "spend by channel last week" is asked by many people in the same team on the same day. A tenant-scoped, data-version-scoped cache serves those with **zero** model calls. Highest-leverage lever by a wide margin.
2. **Prompt caching on the stable prefix** — the system prompt and metric catalogue are identical across every request and should be cached rather than re-sent. Verify with `cache_read_input_tokens`; the exact discount is model- and TTL-dependent, so we measure rather than assume.
3. **Tier the models** — planning is a constrained classification task and runs well on the cheap tier; reserve the expensive tier for ambiguous questions only.
4. **Never send raw rows to the model** — the narrator sees an aggregate table, not a dataset. This is a correctness rule that happens to be a cost rule.

**Latency budget [design]** — target ~2–4s p50, decomposed so optimisation is measurable rather than guessed: auth ~50ms, planner call ~800ms, validation ~10ms, query ~200ms, result validation ~20ms, chart spec ~5ms, narrator call ~600ms. Cache hits return in ~100ms. These are targets. Nothing is built, so there are no measured figures to report.

---

## 10. Change safety — "we changed a prompt and answers got worse"

Prompt changes are production changes and get treated as such. **[design]**

The mechanism is a version-controlled golden set: **12 cases exist today** **[verified]** in `examples/golden.jsonl`, each pinning not just an expected answer but the *specific wrong answer it guards against*. Example, from the file:

> **Q:** *How many conversions did we get in August?* → expected **5,584**, must flag `duplicates_collapsed`.
> **Guard:** *"querying raw rows returns 5,650, inflated by 66 re-sent duplicate rows."*

Both figures independently reproduce **[verified]**. That guard clause is the valuable part: it means a regression doesn't just fail, it tells you *which* mistake came back.

The set scores five dimensions: intent, plan, numeric accuracy, abstention correctness (does it refuse when it should), and grounding.

**So when someone says Monday that answers got worse:** run the golden set at Friday's prompt version and at today's. Either the score moved — in which case they are right and we roll back — or it did not, in which case we have a specific case they can point at, and it becomes case 13. The argument is resolved with evidence in minutes instead of opinion.

---

## 11. Scope — what v1 does, what we cut, and what each cut costs

**In v1 [design]:** the five brief questions plus phrasing variants; typed plan → validated SQL → verified result; shown work (plan + SQL + result table on every answer); the four refusal reasons; rule-chosen charts; the golden-set check.

**Cut on purpose, with the bill for each:**

| Cut | Why | What it costs us later |
|---|---|---|
| Multi-agent orchestration | Adds latency, cost, and failure modes; does not make a number more correct. One loop, two model calls. | Genuinely multi-step research questions will need re-architecting between planner and executor. |
| Free-form SQL generation | The whole design is the refusal to do this. | Long-tail questions the plan grammar can't express get refused rather than answered. We accept a lower answer rate for a higher trust rate. |
| An agent framework | The trust boundary *is* the product; hiding it inside someone else's abstraction makes it harder to see and to test. | More glue code we own. Judged worth it. |
| Forecasting / causal inference | Different discipline, different validation, different confidence semantics. | "Will we hit target?" is unanswerable until we build it. |
| Autonomous recommendations | *"Turn off campaign X"* needs business policy and risk tolerance we don't have. We report the observation and the criteria. | Users must still decide. That is the correct default. |
| Real-time data | Periodic refresh is sufficient for budget decisions. | Intra-day questions unsupported. |
| Auth, deployment, CI, designed UI | Explicitly out of scope per the brief. | None for this exercise. |

**The cut we would defend hardest** is free-form SQL. It is the one that would most obviously make the demo look better and the product worse.

---

## 12. Where the work actually stands

Stated plainly, because a design review is worth nothing if the status is dressed up. **[verified]**

**Done:**
- `DESIGN.md` — 1,314 lines, 25 sections, covering all eight required topics.
- `data/` — 4 CSVs, defects catalogued and independently counted.
- `examples/` — worked transcripts for the five questions, phrasing variants, traps, refusals.
- `examples/golden.jsonl` — 12 machine-readable cases with guard clauses. Every numeric expectation in it was independently reproduced during this review and **all of them matched**.

**Not done:**
- **No MVP implementation exists.** The only code in the repo is the dataset generator. Part 2 of the brief — the running agent — has not been written.
- **No `README.md`.** The brief requires it as a submission artifact, and requires the system to run from a clean checkout.
- **No automated check is wired up.** The golden set exists as data; nothing executes it.

**Two things to fix before submission:**
- The dataset is a **reconstruction**, not the brief's original extract, generated from the published schema by `scripts/generate_dataset.py`. It is documented as such in `data/README.md` — and it must stay documented, because presenting it as the supplied extract would misrepresent the work.
- `DESIGN.md` contains **10 leftover citation artifacts** (`filecite…turn0file0…`) — residue from an authoring tool. Cosmetic, but it is the first thing a reviewer notices.

**The critical path is the MVP**, and the honest sequence is: implement the planner→validator→compiler→validator path over DuckDB for the five questions, wire the golden set to a `pytest` runner, write the README. The design is ahead of the code, which is the right way round for this brief — but the code has to exist.

---

## 13. Demo script (15 minutes)

1. **Q1, spend by channel** — the answer, then the SQL. Point at the FX join. State the $63k the join is preventing.
2. **Q5, competitors** — it refuses, names what is missing, and offers what it *can* do. Roughly one minute, and it is the most persuasive minute in the demo.
3. **Q3, the cliff** — it declines to blame a campaign and identifies an incomplete load instead. Show the 11-vs-26 row count. This is the case that demonstrates the difference between a system and a demo.
4. **Break something** — change the dedup policy, re-run the golden set, watch case `t6` fail with its guard clause naming the exact regression.
5. **Q4, turn-off** — show it distinguishing the observation from the recommendation, and show what naive ROAS ranking would have said instead.

---

## Appendix — verification method

Every **[verified]** figure was recomputed from the raw CSVs by an independent script written for this review, not read from the existing documents. The reimplementation applied the documented policies — collapse exact duplicates, last-write-wins on restated keys, campaign currency overrides row currency, FX carried forward across feed gaps, orphan ids reported separately — and reproduced **every** numeric expectation in `examples/golden.jsonl` that it tested, to the stated tolerances.

Two figures differ trivially from the repo's own documentation and the repo's are the ones to reconcile, not this document's: the phantom-spend total computes to **$63,098 (+9.3%)** here against `$63.6k (+9.4%)` in `data/README.md`, and the naive-currency 8-week total to **$443,457** against `443,810` in the golden file's guard string. Both are under 0.1% and neither changes any conclusion, but they should be reconciled before submission — the guard strings are supposed to be exact.

Cost figures are **[estimate]** built on stated token assumptions and published list prices. Latency figures are **[design]** targets. Neither is a measurement, and neither should be presented as one.
