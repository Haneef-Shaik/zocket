# Traps

Questions that produce a confident, plausible, wrong answer. Each one shows the
number a reasonable implementation returns, the number that is actually right,
and what has to exist in the system for the difference to be caught.

These are the cases worth putting in the automated check, because they are the
ones a refactor silently breaks.

---

### T1 · The partial day poisons every comparison ⚠️

> **User:** How did last week compare to the week before?

| | conversions | verdict |
|---|---:|---|
| **Naive** — trailing 7 days incl. 4 Sep (29 Aug – 4 Sep) vs prior 7 | 1,092 vs 1,245 | **−12.3%** — "conversions are down" |
| **Correct** — last complete week (28 Aug – 3 Sep) vs prior | 1,248 vs 1,246 | **+0.2%** — flat |

> **Agent:** **Interpreted as:** last *complete* week, 28 Aug – 3 Sep 2026, against
> 21–27 Aug. I have excluded 4 Sep because it is an incomplete load.
>
> **Conversions were flat week on week: 1,248 against 1,246.** Spend rose 3.6% to
> $48.3k, so ROAS slipped from 2.16 to 2.04. Including the partial 4 Sep would
> show a 12% decline that does not exist.

> **Why this is the most dangerous question in the set.** It is the single most
> common thing anyone asks a dashboard, the wrong answer is directionally
> plausible, and it is off by 12 points in the direction people are primed to
> believe. Nothing about the output looks broken. The only defence is that
> `as_of` and window resolution are **code**, and the partial-day rule is applied
> by the range resolver rather than remembered by a prompt.

---

### T2 · "Money" means three different things ⚠️

> **User:** Which campaign made us the most money?

Three readings, three answers, all defensible:

| reading | answer | figure |
|---|---|---:|
| revenue, this quarter | `meta_prospecting_us` | $255.7k |
| revenue, all data | `summer_sale_meta` | $416.4k |
| **raw `revenue` column, unconverted** | `meta_prospecting_in` | **"3,810,994"** ← rupees |
| profit | — | not in the data |

> **Agent:** **Interpreted as:** highest revenue in USD, across all your data
> (8 Jun – 4 Sep). Say "this quarter" if you want it scoped.
>
> **`summer_sale_meta` generated the most revenue: $416.4k on $89.9k of spend
> (ROAS 4.63).** Restricted to this quarter the answer changes to
> `meta_prospecting_us` at $255.7k, because the sale peaked in late June.
> Note this is **revenue, not profit** — your data has no cost of goods or margin.

> **The trap inside the trap.** `meta_prospecting_in` bills in INR. Sum the
> `revenue` column without converting and it wins by an order of magnitude with a
> number that is in the wrong unit. Its actual all-data revenue is **$57.9k** — 
> seventh, not first. Currency conversion is the difference between the right
> campaign and the wrong one.

---

### T3 · A false premise, stated with confidence ⚠️

> **User:** Why did Meta ROAS drop 40% last week?

> **Agent:** **It didn't — not last week.** Meta ROAS was 2.42 in the week of
> 24 Aug against 2.72 the week before, a **fall of 11%**. But the 40% figure is
> real over a longer window: **Meta ROAS has fallen from 4.02 at the sale peak
> (week of 29 Jun) to 2.42 — a fall of 40% across the quarter.**
>
> The driver is mix, not decay. `summer_sale_meta` ran at ROAS 4.63 and ended on
> 2 Aug; what remains is weighted toward `meta_prospecting_in` at 0.78.
> `meta_retargeting_us` is unchanged at 5.71.

```
line · meta roas by week
4.0 ┤       ●─●                        ← summer sale
3.5 ┤  ●─●─╯   ╲●─●
3.0 ┤ ●          ╲●─●─●
2.5 ┤                  ╲●─●            ← "last week" = 2.42, not a cliff
    └ Jun08 ──────────────── Aug24
```

> **What the agent must not do:** accept the premise and go hunting for a cause of
> a 40% weekly drop. It will find one — there is always a campaign that got worse.
> Checking the claim *before* explaining it is a fixed step in the `diagnose_drop`
> plan shape, not something the model decides to do.

---

### T4 · A range the data does not cover ⚠️

> **User:** What was our ROAS last quarter?

> **Agent:** **Interpreted as:** Q2 2026 — but your data starts on **8 June**, so
> this covers **8–30 June only, not the full quarter.**
>
> **ROAS for 8–30 June was 2.91** ($186.1k spent, $541.6k returned). Roughly two
> thirds of Q2 is missing, and the part you have contains the summer sale peak, so
> this figure is not representative of the quarter.

`ranking → range {token: last_quarter, requested: [2026-04-01, 2026-06-30], resolved: [2026-06-08, 2026-06-30], clipped: true}`

> Returning 2.91 labelled "Q2 ROAS" would be a *number* the user takes into a
> meeting and cannot defend. The clip is recorded in the plan, so the answer can
> state it without the narrator having to notice.

---

### T5 · A superlative over a statistical tie ⚠️

> **User:** What's our biggest campaign?

> **Agent:** **Interpreted as:** largest by spend, all data. By revenue the answer
> is different — see below.
>
> **Two campaigns are effectively tied for largest by spend: `meta_prospecting_us`
> at $100.6k and `youtube_awareness_in` at $99.8k — 0.7% apart**, which is inside
> the margin of the data-quality issues in this extract. By revenue the answer is
> `summer_sale_meta` ($416.4k), which is only fourth by spend.

| campaign | spend | revenue |
|---|---:|---:|
| meta_prospecting_us | 100,557 | 339,615 |
| youtube_awareness_in | 99,847 | 15,715 |
| summer_sale_meta | 89,930 | 416,423 |
| meta_prospecting_in | 75,940 | 57,944 |

> Naming a single winner 0.7% ahead of second place implies a precision the data
> does not have — this extract has 23 FX-carried rows and 14 nulls. Declaring a
> tie is the more accurate answer, and it takes an explicit rule to do it, because
> `ORDER BY spend DESC LIMIT 1` will always return exactly one row.

---

### T6 · Re-sent days inflate every count ⚠️

> **User:** How many conversions did we get in August?

| | conversions |
|---|---:|
| raw rows | 5,650 |
| **exact duplicates collapsed** | **5,584** |
| difference | 66 (1.2%) |

> **Agent:** **5,584 conversions in August 2026.** 66 conversions were removed as
> exact duplicate rows — the platform re-sent 11 Aug for `linkedin_b2b_leads` and
> some scattered rows.

> 1.2% is small enough to pass unnoticed and large enough to make two dashboards
> disagree. The dedup rule belongs in the view, not in the query the planner
> emits, or it will be applied inconsistently across plan shapes.

---

### T7 · The best day that never happened ⚠️

> **User:** What was our best day?

| ranked by | naive answer | what is actually there |
|---|---|---|
| conversions | **16 Jul, 408 conversions** | one row reports **205 conversions from 200 clicks** |
| revenue | 26 Jun, $45.7k | genuine — summer sale peak |

> **Agent:** **Interpreted as:** highest single day, by revenue.
>
> **Your best day was 26 June 2026 at $45.7k revenue on 350 conversions**, the peak
> of the summer sale. By conversion count, 16 July shows 408 — **but that day
> contains a row claiming 205 conversions from 200 clicks on $270 of spend, which
> is not possible.** Excluding it, 16 July was an ordinary 203-conversion day and
> the real leader is again 26 June at 350.

> Superlatives run straight into the dirtiest row in the table, because the
> dirtiest row is usually the largest. Any `max`/`top-1` plan shape gets the funnel
> invariant checked on the winning row before the answer is written.

---

### T8 · The parts do not add to the whole ✅

> **User:** Your channel numbers don't add up to the total. Which one is wrong?

> **Agent:** **Neither — the gap is $1,834 of spend on campaign `C013`, which does
> not exist in `campaigns.csv`.**
>
> Channels sum to $396,429. The total is $398,264. The difference is 5 rows on 5
> dates referencing a campaign id with no metadata (7 rows and $2,657 across the
> full extract), so it has no channel to be
> counted under. I report it as `(unmapped)` rather than dropping it or guessing.

```
meta + youtube + google_search + linkedin = 396,429
unmapped (C013)                           =   1,834
total                                       398,264  ✓
```

> A user who checks the arithmetic is the best bug detector the system has, so the
> reconciling line has to already be in the answer. Silently dropping orphan rows
> makes the sum work and loses $1,834 of real spend; silently bucketing them into
> a channel is worse.

---

### T9 · A wrong number embedded in the question ✅

> **User:** We spent about $2M last quarter — what did that get us?

> **Agent:** **Your Q3 spend is $493.0k, not $2M** — roughly a quarter of the figure
> in your question, so it is worth checking where the $2M came from before we go
> further. (One possibility: $2M is close to the **INR** total. ₹2M ≈ $22.8k, but
> your INR campaigns have spent ₹14.6M this quarter.)
>
> For the record, Q3 to date (1 Jul – 4 Sep): **$493.0k spent, $1.19M returned,
> 13,073 conversions, ROAS 2.42.**

> Accepting the premise and answering "that got you a 0.6 ROAS" would be arithmetic
> performed on a number the user made up. The prose verifier only checks figures
> the *agent* produced; a figure asserted by the *user* has to be checked against
> the result table explicitly, and contradicted in the first sentence when it is wrong.

---

### T10 · The partial month flips the sign ⚠️

> **User:** How's September tracking against August?

| | spend/day | conversions/day |
|---|---:|---:|
| Sep 1–4 incl. partial 4 Sep | $5,529 | 142 |
| **Sep 1–3, complete days only** | **$7,116** | **182** |
| Aug (31 days) | $6,832 | 180 |

> **Agent:** **Interpreted as:** daily averages, September to date vs August, using
> **1–3 Sep only** — 4 Sep is an incomplete load.
>
> **September is running slightly ahead of August: $7,116/day against $6,832
> (+4%), with conversions flat at 182/day vs 180.** Three days is far too short to
> call a trend. Including 4 Sep would show spend 19% *below* August, which is an
> artifact of the missing data, not a slowdown.

> Same defect as T1, opposite surface: here it inverts the sign of the comparison.
> One partial day out of four is 25% of the window.

---

### T11 · Three questions wearing one coat ⚠️

> **User:** What did we spend on meta last week and why is our ROAS down and should we move budget to search?

> **Agent:** Three questions — the first two I can answer, the third I can only inform.
>
> **1. Meta spend, 28 Aug – 3 Sep: $20.8k**, returning $48.3k (ROAS 2.32).
>
> **2. ROAS is down because of mix, not decay.** Account ROAS fell from 3.28 (week
> of 22 Jun) to 2.07 (week of 24 Aug). `summer_sale_meta` at ROAS 4.63 ended on
> 2 Aug and its budget did not follow it; `youtube_awareness_in` at 0.16 is now
> your second-largest line at $30.6k over the last 28 days.
>
> **3. On budget: Google Search returns 2.94 against Meta's 2.69 over the last 28
> days**, so the arithmetic points that way — but Google Search spend has been flat
> at $10–11k a week for three months, which usually means it is limited by search
> volume rather than budget. **I cannot tell you from this data whether search can
> absorb more money**; impression share and budget-lost metrics are not in it.

> Compound questions are where an agent is most tempted to answer the easy part
> and let the hard part ride on its coattails. Each clause gets its own plan; the
> judgment clause gets criteria, evidence, and an explicit statement of what the
> data cannot settle.
