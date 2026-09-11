# Part 2 — MVP build plan

**Status when this plan was written:** `Design.md` and `HLD.md` are complete, the
dataset and its defect catalogue are committed, and `examples/` holds worked
transcripts plus `golden.jsonl` — 12 machine-readable cases whose numbers were
independently reproduced. **No agent code existed.** The design was ahead of the
code, which is the right way round for this brief, but the code has to exist.

**What now exists** (this commit): a Next.js/TypeScript project, the semantic
catalogue, the plan grammar, the canonical DuckDB model, the date resolver, and
9 passing tests that reproduce the golden numbers exactly. Phases 2–8 below are
what remains.

**Remaining budget: ~4 hours.** The brief says stop at six and write down the
gaps. §11 is that list, written in advance rather than discovered at the buzzer.

---

## 1. Scope — the narrow slice

The brief asks for *one path that genuinely works* over five that mostly do, and
scores nothing for auth, deployment, CI, multi-user, or a designed UI.

**In:** the five questions plus the phrasing variants in `examples/02`; typed
plan → validated → compiled → executed → verified; plan + SQL + result table
shown on every answer; four refusal reasons; rule-chosen charts; the golden-set
runner.

**Out, on purpose:** auth, deployment, CI, real multi-tenancy, chart styling,
conversation memory, free-form SQL, an agent framework.

`tenant_id` is nonetheless threaded through the compiler from day one as a
required argument. There is one tenant and no auth, so it is a no-op predicate —
but a tenant filter retrofitted later is a filter someone forgets on one query
path. The parameter exists so the compiler cannot produce SQL without it.

---

## 2. Stack, and one divergence to flag

Single Next.js 16 app, TypeScript, App Router. `POST /api/ask` is the
microservice, `GET /api/config` serves the model list and quota badge, and
`app/page.tsx` is a deliberately undesigned panel showing finding, chart, plan,
SQL, table, flags. DuckDB in-process via `@duckdb/node-api`; Recharts for
rendering; Vitest for the checks.

**LLM: Azure OpenAI**, via the official `openai` SDK's `AzureOpenAI` client,
default deployment `gpt6-sol`. Both model calls go through one
`structured()` helper using strict JSON-schema structured outputs, so there is
exactly one place where a model response becomes a typed object.

**The divergence:** `Design.md` §21 names React/Next.js + FastAPI, and `HLD.md`
§12 says the golden set would be wired to pytest. This MVP collapses both into
one TypeScript process. That is a deliberate MVP choice - one language, one
`npm install`, one command to run, no cross-process contract to debug in a
six-hour build - and `Design.md` §21 explicitly says the interfaces matter more
than the vendors. `Design.md` also names Anthropic-agnostic "structured LLM
output" rather than a provider, so Azure OpenAI is a substitution at the vendor
layer, not an architectural change: the LLM still appears exactly twice and
still never touches a number.

**No agent framework**, per `HLD.md` §11. The loop is nine lines of control
flow; the trust boundary *is* the product, and hiding it inside someone else's
abstraction makes it harder to see and to test.

**One structured-output constraint worth recording**, because it shaped the
code: OpenAI strict schemas reject a union at the schema root
(`Root schema must have type: 'object'`), and `PlanSchema` is a discriminated
union. It is therefore wrapped in an envelope (`src/plan/wire.ts`) so the union
sits one level down, where it is allowed. Zod `.default()` fields also come out
as *required* in the generated schema, which means the model must state them
explicitly rather than relying on a default it cannot see. Both were verified
against the SDK's schema generator, not assumed.

---

## 3. The request path

Eight stages. The LLM appears exactly twice, at the two ends. In between —
where correctness and money live — there is only deterministic code.

| # | Stage | LLM? | File |
|---|---|---|---|
| 1 | API / tenant context / input validation | no | `app/api/ask/route.ts` |
| 2 | **Planner** — question → typed JSON plan | **yes** | `src/agent/planner.ts` |
| 3 | Validator — answerable? range in coverage? | no | `src/plan/validate.ts`, `src/plan/resolve.ts` |
| 4 | Compiler — plan → SQL (joins, FX, dedup, tenant) | no | `src/sql/compile.ts` |
| 5 | Execution | no | `src/db/duckdb.ts` |
| 6 | Result validator — invariants → flags | no | `src/verify/resultValidator.ts` |
| 7 | Chart spec — **by rule from the plan shape** | no | `src/chart/spec.ts` |
| 8 | **Narrator** — verified numbers → prose | **yes** | `src/agent/narrator.ts` |

The rule for what the model decides, from `HLD.md` §5: *a step is model-decided
if a wrong choice is visible and recoverable; hard-coded if a wrong choice is
invisible and silently corrupts the answer.* A user notices immediately if the
agent answered about the wrong metric. **No user will ever notice that FX was
applied at the wrong date.**

---

## 4. Build phases

Phase 0 and 1 are done. Each remaining phase lands with its own test and is
independently demoable.

### ✅ Phase 0 — Project skeleton
`package.json`, `tsconfig`, `next.config.ts` (`serverExternalPackages` for the
native DuckDB addon), `vitest.config.ts`, app shell, `/api/ask` route.
**Done:** `next build` clean, `tsc --noEmit` clean.

### ✅ Phase 1 — Canonical model + semantic layer
`src/sql/views.sql`, `src/db/duckdb.ts`, `src/semantic/catalogue.ts`,
`src/semantic/policies.ts`, `src/plan/schema.ts`, `src/plan/resolve.ts`.

Every policy is implemented exactly once, in `views.sql`. Nothing downstream
re-derives a join, an FX conversion, or a dedup rule.

**Done, verified against the golden numbers:** q1 all five channels and total,
q2 top-2 campaigns, t6 deduped vs raw (5584 / 5650), t4 clipped ROAS (2.91).
9 tests green.

### Phase 2 — Validator *(~25 min)*
`validatePlan(plan, coverage) → Verdict`. Metric and dimension exist; filter
fields are in `FILTERABLE`; range resolves and is non-empty; `limit` sane.
Forces `unanswerable` when the model claimed otherwise — the model's verdict is
a proposal.

**Accept:** `n2` (device dimension) → `no_such_dimension` listing what exists;
`n5` (May) → `outside_coverage`, **not** `$0`. A `SUM` over an empty range
returning zero is the single most dangerous silent failure in the system.

### Phase 3 — Compiler *(~60 min, the long pole)*
`compile(plan, range, tenantId) → { sql, columns, flagSql }`. One emitter per
plan type. Metric SQL comes from the catalogue; dimensions map to columns; ratio
metrics aggregate numerator and denominator separately and divide *after*
(`SUM(a)/SUM(b)`, never `AVG(a/b)`). Values are bound, never interpolated. The
emitted SQL is what the user is shown — no separate "explanation" query that
could drift from the one that ran.

**Accept:** unit tests per plan type; every `golden.jsonl` expected plan compiles
and reproduces its numbers within tolerance.

### Phase 4 — Result validator + flags *(~35 min)*
Aggregate the row-level markers already computed in `fact`
(`is_currency_mismatch`, `is_unmapped_campaign`, `is_funnel_violation`,
`rate_carried_forward`, …) over the queried window into `Flag[]`, plus
`partial_day`, `duplicates_collapsed`, `restatement_applied`, and
`coverage_clipped` from the resolver. Coerce BigInt → Number at this boundary
(**DuckDB returns `BIGINT` as JS `BigInt`, which `JSON.stringify` throws on** —
already handled in `coerce()`).

**Accept:** q1 raises `partial_day`, `currency_mismatch`, `unmapped_campaign_id`;
a clean window raises none.

### Phase 5 — Planner *(~40 min)*
`client.chat.completions.parse()` with `zodResponseFormat(PlanEnvelopeSchema,
"plan")` on the configured Azure deployment. System prompt carries the metric
catalogue, dimension list, coverage window, the plan-type menu, and the
**assume-and-state** rule: where a word is genuinely ambiguous — "performance",
"best", "sales" — pick the most common reading, state it in the interpretation
line, and do not ask. The prompt is a versioned file
(`src/agent/prompts/planner.md`), because a prompt is a production change and
has to be diffable.

The model never sees a data row — only the catalogue and the coverage window.

**Accept:** LLM golden layer (§5) puts all 12 cases on the right plan type.

### Phase 6 — Narrator + guard *(~30 min)*
Verified result + flags → at most three sentences. Then the guard: **extract
every numeric token from the prose and assert each appears in the result table**
(within rounding). A narrator that invents a figure fails the request rather
than shipping it. This is the cheapest real defence against the one failure the
whole design exists to prevent, and it is deterministic.

**Accept:** a unit test feeds a fabricated number through the guard and expects
rejection.

### Phase 7 — Orchestrator + UI *(~30 min)*
Wire stages 1–8, assemble `Answer`, stamp the trace with plan/prompt/semantic/
policy/compiler/data versions and per-stage latency. Render finding, chart
(Recharts, kind chosen by rule), plan JSON, SQL, table, flags, `trace_id`.
`npm run ask -- "…"` gives the same answer in the terminal.

**Accept:** all five brief questions answered end to end in the browser.

### Phase 8 — Golden runner + README *(~30 min)*
See §5. Then `README.md`: one command to run, what works, what does not.

---

## 5. The automated check

The brief asks for a mechanism, not a suite: *does the agent still answer
correctly after you change something?* Two layers, because the two things that
break are different things.

**Layer 1 — deterministic, no LLM, runs on every `npm test`.**
Feed each golden case's *expected plan* through validator → compiler → DuckDB →
result validator and assert the numbers and flags. Free, fast, no API key, no
flake. This catches the regressions that actually corrupt answers: a changed
dedup rule, a dropped FX join, a broken clip.

**Layer 2 — LLM, opt-in via `GOLDEN_LLM=1 npm run test:llm`.**
Feed the *question* and assert the emitted plan matches the expected shape
(plan type, metrics, dimensions, resolved range) — not the prose. This is the
layer that answers "we changed a prompt on Friday and answers got worse on
Monday": prompt v7 scored 12/12, v8 scores 10/12, v8 is rejected. Kept out of
the default run so the check stays free and deterministic.

Every case carries a **guard clause** naming the wrong answer it prevents —
already written in `golden.jsonl`. When `t6` fails it does not say
`expected 5584, got 5650`; it says *inflated by 66 re-sent duplicate rows*. That
is the difference between a failing test and a diagnosis, and it is the fourth
beat of the demo: change the dedup policy, re-run, watch `t6` name the exact
regression.

---

## 6. The five questions

| # | Question | Plan | The trap |
|---|---|---|---|
| 1 | Spend by channel, last 8 weeks | `breakdown`, rolling 8w → `2026-07-11..09-04` | Trusting the row `currency` column turns $398,264 into $443,457 — **+$45,193 (+11.3%) of phantom spend** over this window ($63,098 / +9.3% across the whole extract) — and reorders channels 2 and 3. Orphan rows must surface as `unmapped`, not vanish. |
| 2 | Top campaign by revenue this quarter | `ranking`, calendar quarter → `07-01..09-04`, **clipped** | Summing raw `revenue` without FX returns `meta_prospecting_in` — the INR campaign — instead of `meta_prospecting_us`. |
| 3 | Conversions fell off a cliff | `diagnose_drop`, target `latest`, 7-day baseline | **The hard one.** Nothing was wrong with the campaigns: the final day is a partial load — 11 rows against a typical 26, spend down 89% alongside conversions. Any answer naming a campaign or creative as the cause is wrong. The plan template *always* returns row counts on both sides, because the model cannot be trusted to remember to ask. |
| 4 | Which campaign to turn off | `turn_off_candidate` (fixed policy) | Ranking all campaigns by ROAS returns `linkedin_thought_leadership` at 0.00 — an *awareness* campaign never meant to produce tracked revenue. Ranking by CPA returns `linkedin_b2b_leads`, one of the most profitable. With the policy (conversions objective, ≥$5k spend, 28 days): `meta_prospecting_in`, ROAS 0.78 on $22,907. Reported as **an observation with criteria attached, not a recommendation.** |
| 5 | Spend vs. competitors | `unanswerable: no_such_entity` | There is no competitor data. Says what is missing, what is available, and what it *can* answer instead. Roughly one minute of the demo, and the most persuasive minute in it. |

---

## 7. Data defects → policy

The extract carries 13 named defect classes (`scripts/generate_dataset.py`).
Each has one policy, implemented once, in `views.sql`.

| Defect | Policy | Why not the obvious thing |
|---|---|---|
| Re-sent days (exact dupes) | Collapse | Same fact twice |
| Restatements (same key, new numbers) | Last in **file order** wins, count reported | A later correction is the true one |
| FX feed gaps | Carry last rate forward, flag | Dropping loses spend; defaulting to 1.0 converts INR at 90× |
| Row currency ≠ campaign currency | **Campaign wins**, flag | Trusting the row adds $63k of phantom spend |
| Orphan campaign/creative ids | Keep as `unmapped`, report separately | Dropping loses spend; folding misattributes it |
| Negative spend (refunds) | Keep | It is a real credit |
| Revenue with zero spend | Keep, `NULLIF` guards ROAS | Division by zero, not a data error |
| Nulls / blank currency | Stay null, counted | Zero is a claim; null is an absence |
| `clicks > impressions` | Keep, flag `funnel_violation` | Ranking "best day" by conversions surfaces a row with more conversions than clicks |
| Rows after `end_date` | Keep, flag | Real platform behaviour |
| Channel outage day | Keep, flag | A real zero, not missing data |
| Incomplete final day | `partial_day` flag; calendar ranges exclude it | Including it turns *+0.2% WoW* into *−12.3%* |

**Ordering caveat:** last-write-wins needs `_ord` to mean file order, so ingest
runs `threads=1` with `preserve_insertion_order=true`. A test asserts this
holds; if a DuckDB upgrade breaks it, restatements silently invert.

---

## 8. Saying "I don't know"

Four reasons, each with a distinct response shape: `no_such_entity` (Q5),
`no_such_dimension` (`n2` — lists what *does* exist), `outside_coverage` (`n5` —
states the window, never returns `$0`), `not_analytical`.

The failure mode we watch as closely as hallucination is **over-refusal**.
`n13` — *"are any campaigns hitting their budget caps?"* — looks unanswerable
because there is no `budget` metric, but `campaigns.csv` has `daily_budget` and
it is perfectly answerable. It is in the golden set specifically to fail if the
agent gets timid. Note it is answered in **campaign-native currency**: budgets
are *set* in INR and USD, so converting them to USD to compare against a cap
would be wrong.

---

## 9. Cost and latency (MVP)

Two model calls per question. Planner: roughly 1,500 input / 200 output tokens.
Narrator: roughly 800 input / 150 output. So about **2,300 in / 350 out per
question**, and the golden LLM layer is 12 questions per full run.

**I have not priced this in dollars, because I cannot verify a rate for the
`gpt6-sol` deployment** — Azure deployment names are tenant-chosen, and the
rate card for the underlying model is not something I can look up and stand
behind. The token profile above is the part that is ours; multiply it by your
Azure rate. If you tell me the model behind that deployment I will put a real
number in.

What the shape tells us regardless: the planner call dominates input tokens
(it carries the whole catalogue), so **prompt caching on the system prompt is
the first optimisation**, and it is free. DuckDB is in-process over 2,341 rows —
query time is single-digit milliseconds and rounds to nothing, so **model
latency is ~100% of wall clock**. That matches the production picture in
`Design.md` §14, and is why the trace records per-stage timings from day one:
optimisation should be measurable rather than speculative.

The per-device trial allowance (§10) exists so a shared demo key cannot be
drained by one visitor; callers who supply their own key are not metered.

---

## 10. LLM access: keys, models, and the trial quota

Built, tested, and live (`src/llm/`, `src/quota/`, 20 tests).

**Three credential paths**, resolved in `src/llm/config.ts`:

| Caller sends | Mode | Metered? | Deployment |
|---|---|---|---|
| nothing | `shared` | yes, 5 per device | allow-list only |
| `apiKey` + `endpoint` | `byok` | no | any |
| `apiKey` alone | — | rejected 400 | — |

A key without an endpoint is **refused rather than defaulted**. Falling through
to our resource would bill us while looking to the user like their own account,
which is the kind of failure nobody notices until the invoice.

On the shared key the deployment is **not** caller-controlled — an open
`deployment` field on our credentials is an invitation to run someone's
workload on the most expensive deployment in the resource. With their own key,
any deployment name is allowed; they know their resource and they are paying.

**Key handling.** The caller's key arrives in a POST body only (never a query
string, which lands in access logs and referrer headers), is never logged, never
written to disk, never placed in the trace, and never echoed back. It lives for
one request. The browser holds it in `localStorage` and re-sends it per request,
so clearing it in Settings is a complete revocation. `redact()` strips anything
credential-shaped before it can reach a log line.

**Device identity — and what it honestly is.** The ask was "capture the MAC
address". **A browser cannot read a MAC address** — there is no web API for it,
and deliberately never has been, since a hardware serial surviving every reset
would be a permanent supercookie. `os.networkInterfaces()` returns the *server's*
MAC, identical for every visitor. So the quota uses two weak signals instead:

1. a **signed httpOnly cookie** carrying a random id (HMAC-signed, so an id can
   be deleted but not forged as someone else's);
2. a **hash of IP + User-Agent + Accept-Language**, which survives cookie
   clearing but collides for everyone behind one office NAT.

A request is charged against **both** and refused if **either** is exhausted —
biased toward false refusals rather than free rides, which is right for a trial
because a user caught by a collision can supply their own key and is unblocked
immediately.

**This is a speed bump, not a security control.** A private window plus a VPN
resets it. Five requests is not worth defending harder than that; the real
answer is accounts, which the brief scopes out.

**Known limits of the current store:** counts live in memory, so they reset on
restart and a second instance would grant a fresh allowance each. The
`UsageStore` interface is separate from the policy precisely so swapping in
Redis is a one-file change.

**One scope note.** The brief says *"do not bother with: authentication,
deployment, CI, multi-user anything"* and scores none of it. A per-device quota
is arguably in that category. I have built it because you asked and it is
genuinely useful for sharing a demo link — but if the submission is being scored
strictly against the brief, this is the first thing I would move to a separate
branch so it does not read as time spent on the wrong axis.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Compiler is the long pole and could overrun | Emitters are independent; ship `breakdown`/`ranking`/`single_value` first — that is Q1, Q2, Q4, Q5. `diagnose_drop` (Q3) last, as the highest-value single case. |
| Planner mis-resolves a date range | Resolution is deterministic code, not the model; the model emits `{n, unit, calendar, offset}` only. |
| `preserve_insertion_order` regression | Explicit test on `_ord`. |
| BigInt escapes to `JSON.stringify` | Single coercion boundary in `resultValidator`. |
| Golden LLM layer flakes in CI | Not in the default run; opt-in by env var. |
| Recharts + Next 16 RSC friction | Chart is a `"use client"` leaf; if it fights, ship the table and a static SVG. The chart is required, the library is not. |
| `gpt6-sol` may not accept `response_format: json_schema`, or may be Responses-API-only | The model registry carries `api` and `structuredOutputs` per deployment, and `structured()` already branches on it. Untested against the real deployment — **this is the first thing to verify once a key exists.** |
| Trial counts reset on restart / per instance | Documented, not hidden. `UsageStore` is an interface; Redis is a one-file swap. |
| `x-forwarded-for` is client-spoofable | Only ever a quota hint, never authentication. Behind a real proxy the proxy overwrites it. |

---

## 12. If the clock runs out

In priority order, and the honest sequence:

1. **Q3 (`diagnose_drop`) is cut first.** It is the most valuable single case in
   the demo but also the most code. If it goes, the README says so and the
   `partial_day` flag still appears on Q1 — the system still *sees* the defect,
   it just does not narrate a diagnosis.
2. **The narrator LLM is cut second.** The finding falls back to a deterministic
   template over the verified result. Uglier prose, identical numbers. This is a
   cheap degradation because the numbers were never the model's to begin with —
   which is rather the point of the architecture.
3. **The chart is cut last**, to a table, per the brief's own failure-mode list.

What we would **not** cut is the shown work, the flags, or the golden runner.
Those are the exercise.
