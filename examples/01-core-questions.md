# The five questions

Full transcripts, including the work. `as_of = 2026-09-04`.

---

## 1 · Spend by channel ✅⚠️

> **User:** What did we spend by channel over the last eight weeks?

**Agent**

> **Interpreted as:** total spend in USD, split by channel, **11 Jul – 4 Sep 2026**
> (8 weeks back from the latest day in your data).
>
> You spent **$398.3k** across four channels in the last eight weeks, and **Meta
> took $162.5k of it (41%)**. The one worth a second look is **YouTube: $98.4k,
> your second-largest channel, returning $0.58 per dollar** against Google
> Search's $2.90 on a smaller $82.4k. A further **$1.8k sits against campaign
> `C013`, which is not in your campaign list**, so it is shown separately rather
> than assigned to a channel.

```
bar · spend_usd by channel · 11 Jul – 4 Sep 2026
meta            ████████████████████████████████████████  162,490   ROAS 3.04
youtube         ████████████████████████                   98,384   ROAS 0.58
google_search   ████████████████████                       82,443   ROAS 2.90
linkedin        █████████████                              53,112   ROAS 2.33
(unmapped)      ▍                                           1,834   —
                                                    total 398,264
```

**Plan**

```json
{
  "plan_type": "breakdown",
  "metrics": ["spend_usd"],
  "dimensions": ["channel"],
  "range": {"token": "last_8_weeks", "resolved": ["2026-07-11", "2026-09-04"]},
  "grain": "total",
  "sort": {"by": "spend_usd", "dir": "desc"}
}
```

**SQL**

```sql
SELECT coalesce(c.channel, '(unmapped)') AS channel,
       sum(f.spend * fx.rate_to_usd)     AS spend_usd
FROM   fact_ad_performance f                 -- exact duplicates already collapsed
LEFT   JOIN dim_campaign c ON c.campaign_id = f.campaign_id
JOIN   fx_daily fx ON fx.date = f.fx_date    -- fx_date = last date with a published rate
                  AND fx.currency = f.currency_resolved
WHERE  f.date BETWEEN DATE '2026-07-11' AND DATE '2026-09-04'
GROUP  BY 1
ORDER  BY 2 DESC;
```

| channel | spend_usd | share | roas |
|---|---:|---:|---:|
| meta | 162,490 | 40.8% | 3.04 |
| youtube | 98,384 | 24.7% | 0.58 |
| google_search | 82,443 | 20.7% | 2.90 |
| linkedin | 53,112 | 13.3% | 2.33 |
| (unmapped) | 1,834 | 0.5% | 3.96 |
| **total** | **398,264** | | **2.31** |

**Flags** — 73 of 1,511 rows in this window (4.8%) carry at least one:

| flag | rows | effect on this answer |
|---|---:|---|
| `fx_carried_forward` | 23 | no rate published 19 Jul, 15–16 Aug, 4 Sep; last rate used |
| `post_end_date` | 13 | `summer_sale_meta` and `linkedin_thought_leadership` reported after their end dates |
| `partial_day` | 11 | 4 Sep is an incomplete load; the true 8-week total is higher |
| `null_value` | 9 | blank spend/revenue/conversions, excluded not zeroed |
| `unmapped_creative_id` | 9 | rows on `CR999`, kept under their campaign |
| `unmapped_campaign_id` | 5 | campaign `C013`, $1,834, shown separately |
| `negative_spend` | 3 | credit lines totalling −$1,923, netted in |
| `funnel_violation` | 3 | clicks > impressions; does not affect spend |
| `currency_mismatch` | 2 | **see below** |
| `zero_spend_with_revenue` | 2 | revenue booked with no cost |

`trace_id: tr_20260909_1c4a7e`

> **The defect that changes the ranking.** Two rows in this window belong to
> INR campaigns but are stamped `USD` in the `currency` column. Take that column
> at face value and ₹21,720 becomes $21,720: spend jumps to **$443.8k**, Google
> Search overtakes YouTube for second place (**$103.9k vs $98.4k**), and the
> answer to "where is our money going" is wrong at the ranking level, not just
> the decimal. The resolution policy is that **`campaigns.csv` wins** — a row
> claiming $21,720 against a campaign with a ₹65,000/day (~$740) budget is an
> error, not a fact — and the mismatch is flagged rather than silently repaired.
> Across the full extract this defect is worth **$63.6k of phantom spend (+9.4%)**.

---

## 2 · Most revenue this quarter ✅

> **User:** Which campaign generated the most revenue this quarter?

**Agent**

> **Interpreted as:** revenue in USD by campaign, **Q3 2026 (1 Jul – 4 Sep)**,
> clipped to the last day of data.
>
> **`meta_prospecting_us` generated the most revenue this quarter at $255.7k**,
> 28% ahead of `summer_sale_meta` at $200.2k. Note that over the full extract the
> order reverses — `summer_sale_meta` has made **$416.4k since 8 June**, because
> most of its revenue landed in the late-June sale peak, before this quarter began.

```
bar · revenue_usd by campaign · Q3 2026 (1 Jul – 4 Sep)
meta_prospecting_us   ████████████████████████████████████  255,727
summer_sale_meta      ████████████████████████████          200,194
meta_retargeting_us   ██████████████████████████            182,938
linkedin_b2b_leads    ████████████████████                  145,906
nonbrand_search_us    █████████████████                     125,890
```

**Plan**

```json
{
  "plan_type": "ranking",
  "metrics": ["revenue_usd"],
  "dimensions": ["campaign"],
  "range": {"token": "this_quarter", "resolved": ["2026-07-01", "2026-09-04"],
            "clipped": {"from": "2026-09-30", "reason": "data coverage ends 2026-09-04"}},
  "sort": {"by": "revenue_usd", "dir": "desc"},
  "limit": 5
}
```

**SQL**

```sql
SELECT c.campaign_name,
       sum(f.revenue * fx.rate_to_usd) AS revenue_usd
FROM   fact_ad_performance f
JOIN   dim_campaign c ON c.campaign_id = f.campaign_id
JOIN   fx_daily fx ON fx.date = f.date AND fx.currency = f.currency_resolved
WHERE  f.date BETWEEN DATE '2026-07-01' AND DATE '2026-09-04'
GROUP  BY 1 ORDER BY 2 DESC LIMIT 5;
```

| campaign | revenue_usd | spend_usd | roas |
|---|---:|---:|---:|
| meta_prospecting_us | 255,727 | 76,375 | 3.35 |
| summer_sale_meta | 200,194 | 42,638 | 4.70 |
| meta_retargeting_us | 182,938 | 32,548 | 5.62 |
| linkedin_b2b_leads | 145,906 | 48,470 | 3.01 |
| nonbrand_search_us | 125,890 | 52,795 | 2.38 |

**Flags** — 77 of 1,793 rows (4.3%) · `range_clipped` (Q3 requested through 30 Sep,
data ends 4 Sep) · `fx_carried_forward` 23 · `post_end_date` 13 · `partial_day` 11 ·
`unmapped_creative_id` 11 · `null_value` 11 · `unmapped_campaign_id` 7

`trace_id: tr_20260909_9be033`

> **The trap in this question.** Three campaigns bill in INR. Summing the raw
> `revenue` column without converting puts `meta_prospecting_in` on top with
> "3,810,994" — a number in rupees compared against numbers in dollars. Its real
> Q3 revenue is **$43.1k**, eighth of thirteen. Currency conversion is not a
> refinement here; it changes the answer.

---

## 3 · The conversions cliff ⚠️

> **User:** Conversions look like they fell off a cliff on the most recent day. What happened?

**Agent**

> **Interpreted as:** decomposition of the change in conversions on **4 Sep 2026**
> against the trailing 7-day mean (28 Aug – 3 Sep).
>
> **Conversions fell from a 178/day baseline to 23 (−87%) — but this looks like an
> incomplete data load, not a drop in performance.** Two of your four channels
> reported *nothing at all* on 4 Sep (meta, −105 conversions; youtube, −20), and
> the campaigns that did report show only 11 rows against a typical 26, with spend
> down 89% in lockstep. **A genuine conversion collapse would not take spend down
> with it.** I would re-check this once 4 Sep has fully loaded before acting on it.

```
paired_bar · conversions · baseline/day vs 4 Sep, by channel
                  baseline      4 Sep
meta            ██████████ 105   ·      0    ← no rows at all
google_search   █████       50   ██    20    ← 35% of a normal day
youtube         ██          20   ·      0    ← no rows at all
linkedin        ▍            4   ▍      3
                     total 178         23   (−87%)
```

**Plan**

```json
{
  "plan_type": "diagnose_drop",
  "metrics": ["conversions", "spend_usd", "row_count"],
  "target_date": "2026-09-04",
  "baseline": {"token": "trailing_7d", "resolved": ["2026-08-28", "2026-09-03"]},
  "decompose_by": ["channel", "campaign"],
  "check_data_quality": true
}
```

`diagnose_drop` is a fixed plan shape: compare, decompose, then check the flags.
The model chose the shape; it did not choose what a diagnosis is.

**Result — decomposition**

| channel | baseline/day | 4 Sep | delta | rows 3 Sep → 4 Sep |
|---|---:|---:|---:|---|
| meta | 104.9 | 0 | −104.9 | 11 → 0 |
| google_search | 49.6 | 20 | −29.6 | 6 → 6 |
| youtube | 19.6 | 0 | −19.6 | 4 → 0 |
| linkedin | 4.3 | 3 | −1.3 | 3 → 3 |
| **total** | **178.3** | **23** | **−155.3** | **26 → 11** |

Corroborating: campaigns reporting on 3 Sep = 10; on 4 Sep = 4
(`C001`, `C002`, `C003`, `C010`). Spend $6,901/day → $768 (−89%).

**Flags** · `partial_day` (4 Sep, all rows) · `fx_carried_forward` (2 INR rows,
no rate published for 4 Sep)

`trace_id: tr_20260909_44d1f2`

> **What makes this the hard one.** Every ingredient of a real incident is present —
> a big drop, on the newest day, in the metric people watch. The evidence that it
> is *not* real is structural, not statistical: missing rows, and spend falling with
> conversions. An agent that only queries `conversions` cannot see it, which is why
> the plan shape pulls `row_count` and `spend` whether the user asked for them or not.

---

## 4 · Which campaign to turn off ⚠️

> **User:** Which campaign should we turn off?

**Agent**

> **Interpreted as:** ranking by ROAS and CPA over the **trailing 28 days
> (8 Aug – 4 Sep)**, restricted to campaigns whose objective is `conversions` and
> whose spend exceeds $5,000 in the window.
>
> **By these criteria `meta_prospecting_in` is the weakest: $22.9k spent to return
> $17.9k, a ROAS of 0.78 — the only conversion campaign in the set returning less
> than it costs.** The next weakest, `nonbrand_search_us`, returns 2.38. I have
> excluded your three awareness campaigns, which look worse on ROAS (0.00–0.16) but
> are not bought for revenue, and `diwali_teaser_in`, which has 11 days of data.
> **This is a ranking, not a recommendation** — the data has no margin, attribution
> window, or learning-phase status in it.

```
bar · roas · conversion campaigns, trailing 28d, spend > $5k
brand_search_us       ████████████████████████████████████ 8.48
meta_retargeting_us   ████████████████████████             5.71
meta_prospecting_us   █████████████                        3.09
linkedin_b2b_leads    ████████████                         2.95
nonbrand_search_us    ██████████                           2.38
meta_prospecting_in   ███                                  0.78  ← break-even is 1.00
```

**Plan**

```json
{
  "plan_type": "ranking",
  "metrics": ["roas", "cpa", "spend_usd", "revenue_usd", "conversions"],
  "dimensions": ["campaign"],
  "range": {"token": "trailing_28d", "resolved": ["2026-08-08", "2026-09-04"]},
  "filters": [
    {"field": "objective", "op": "eq", "value": "conversions"},
    {"field": "spend_usd", "op": "gte", "value": 5000}
  ],
  "sort": {"by": "roas", "dir": "asc"}
}
```

| campaign | objective | spend_usd | revenue_usd | roas | cpa |
|---|---|---:|---:|---:|---:|
| meta_prospecting_in | conversions | 22,907 | 17,929 | **0.78** | 19.4 |
| nonbrand_search_us | conversions | 19,863 | 47,281 | 2.38 | 63.7 |
| linkedin_b2b_leads | conversions | 20,596 | 60,856 | 2.95 | 173.1 |
| meta_prospecting_us | conversions | 33,578 | 103,637 | 3.09 | 53.7 |
| meta_retargeting_us | conversions | 13,455 | 76,772 | 5.71 | 13.7 |
| brand_search_us | conversions | 6,255 | 53,062 | 8.48 | 19.7 |

Excluded, and why:

| campaign | objective | roas | excluded because |
|---|---|---:|---|
| linkedin_thought_leadership | awareness | 0.00 | not bought for revenue; also ended 20 Aug |
| diwali_teaser_in | awareness | 0.14 | awareness; 11 days of data; $4.1k < spend floor |
| youtube_awareness_in | awareness | 0.16 | awareness — $30.6k, worth a separate conversation |
| search_in_generic | traffic | 1.12 | traffic objective |
| youtube_prospecting_us | traffic | 1.30 | traffic objective |

**Flags** — 36 of 707 rows (5.1%) · `fx_carried_forward` 16 · `partial_day` 11 ·
`post_end_date` 4 · `null_value` 3 · `unmapped_creative_id` 2 · `negative_spend` 1 ·
`zero_spend_with_revenue` 1

`trace_id: tr_20260909_7fa5b1`

> **Two ways to get this wrong.** Rank everything on ROAS and you turn off
> `linkedin_thought_leadership`, an awareness campaign doing exactly what it was
> bought to do. Rank on CPA and you turn off `linkedin_b2b_leads` at $173/lead —
> the *second most profitable* campaign you own, because B2B leads are worth more.
> Only the objective-aware ranking survives contact with someone who knows the account.

---

## 5 · Competitor comparison ⛔

> **User:** How does our spend compare to our competitors'?

**Agent**

> **I can't answer this — there is no competitor or benchmark data in your dataset.**
> The four tables cover your own delivery only: daily performance by campaign and
> creative, campaign metadata, creative metadata, and FX rates. Nothing in them
> refers to another advertiser.
>
> What I *can* show you is your own spend, and how it splits — here is the last
> eight weeks by channel. If you have industry benchmark data (a Nielsen or
> Kantar extract, a category share-of-voice report), it can be loaded as a
> separate source and this question becomes answerable.

```
bar · spend_usd by channel · 11 Jul – 4 Sep 2026   [offered, not asked for]
meta            ████████████████████████████████████████  162,490
youtube         ████████████████████████                   98,384
google_search   ████████████████████                       82,443
linkedin        █████████████                              53,112
```

**Plan**

```json
{
  "plan_type": "unanswerable",
  "reason": "no_such_entity",
  "missing": ["competitor_spend", "benchmark_spend", "market_share"],
  "available_dimensions": ["channel", "campaign", "creative", "objective", "currency", "date"],
  "nearest_answerable": {
    "plan_type": "breakdown", "metrics": ["spend_usd"], "dimensions": ["channel"],
    "range": {"token": "last_8_weeks", "resolved": ["2026-07-11", "2026-09-04"]}
  }
}
```

No SQL ran against a competitor table, because there is no competitor table.

`trace_id: tr_20260909_0e91cc`

> **Why the validator decides this, not the model.** A language model asked about
> competitor spend has a strong prior that such data exists and a genuine
> willingness to estimate it. The plan it proposes is rejected because
> `competitor_spend` is not in the metric whitelist — the refusal is a schema
> property, not a judgment call, and it holds even if the model is confident.
