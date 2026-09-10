# Phrasing variants

The same handful of intents, asked the way people actually ask them: slang,
platform nicknames, typos, half-questions, mixed languages, and jargon that does
not appear anywhere in the schema. Answers are abbreviated — the full contract
(plan, SQL, table, flags) still applies to every one.

**Default range:** when the user names no period, resolve to the **trailing 28 days**
(8 Aug – 4 Sep 2026) and say so in the interpretation line. Never silently use all time.

---

### 2.1 · "how much did we burn on fb last month?" ✅

*burn → `spend_usd` · fb → `channel = meta` · last month → 1–31 Aug 2026 (complete)*

> **Interpreted as:** Meta spend, August 2026.
>
> You spent **$83.5k on Meta in August**, returning $234.3k on 3,258 conversions —
> a ROAS of 2.81.

`breakdown · metrics[spend_usd,revenue_usd,conversions] · filters[channel=meta] · range last_month → 2026-08-01..2026-08-31`

> "Last month" is the one relative range where `as_of` and the wall clock usually
> agree, which is exactly why it hides bugs. Resolved against `as_of = 4 Sep` it is
> August. Resolved against a wall clock in, say, November it is October — and
> returns nothing at all.

---

### 2.2 · "what's our blended roas?" ✅

*blended → account-wide, no dimension · no period given → trailing 28d*

> **Interpreted as:** revenue ÷ spend, all campaigns, 8 Aug – 4 Sep 2026.
>
> **Blended ROAS is 2.16** over the last 28 days — $185.6k spent, $401.8k returned.
> Split by objective it is 3.08 on conversion campaigns, 1.22 on traffic, and 0.14
> on awareness, which is where the blend gets its drag.

`single_value · metrics[roas] · range trailing_28d` → chart: **stat tile**

> A single number gets a stat tile, not a chart with one bar. The objective split
> is volunteered because a blended figure across three objectives is close to
> meaningless on its own.

---

### 2.3 · "are we making money on youtube?" ⚠️

*making money → `roas` vs break-even 1.0*

> **Interpreted as:** ROAS for `channel = youtube`, trailing 28 days.
>
> **On a revenue basis, no: YouTube returned $0.57 per dollar over the last 28 days**
> ($47.9k spent, $27.1k returned). But two-thirds of that spend is
> `youtube_awareness_in`, an **awareness** campaign at ROAS 0.16 that was not bought
> for revenue. Your one revenue-intent YouTube campaign, `youtube_prospecting_us`,
> is at 1.30 — a traffic objective, still above break-even.

| campaign | objective | spend | roas |
|---|---|---:|---:|
| youtube_awareness_in | awareness | 30,612 | 0.16 |
| youtube_prospecting_us | traffic | 17,256 | 1.30 |

> The literal answer ("no, 0.57") is true and useless. The objective split is the
> answer someone can act on, and it is a fixed part of the plan shape for any
> ROAS question that spans more than one objective.

---

### 2.4 · "CAC by channel please" ⚠️

*CAC → `cpa` (with a caveat), by → `dimensions[channel]`*

> **Interpreted as:** cost per recorded conversion by channel, trailing 28 days.
> Your data has conversions, not customers, so this is **CPA — it does not
> distinguish new customers from repeat buyers.**
>
> Meta is cheapest at **$26.07**, Google Search close behind at $27.35, YouTube
> $96.70, and LinkedIn $206.88 — though LinkedIn's conversions are B2B leads
> worth roughly 30× a retail order, which is why its ROAS is still 2.47.

`breakdown · metrics[cpa,conversions,spend_usd] · dimensions[channel] · range trailing_28d`

> CAC and CPA are not synonyms and the difference matters to whoever asked.
> Answering the question while naming the substitution is better than either
> refusing or quietly pretending they are the same metric.

---

### 2.5 · "kitna kharcha hua on google last week?" ✅

*Hinglish; kharcha → `spend_usd` · google → `channel = google_search` · last week → last complete week*

> **Interpreted as:** Google Search spend, 28 Aug – 3 Sep 2026 (the last **complete**
> week — 4 Sep is still loading).
>
> **$9,163** on Google Search last week, returning $27.3k on 347 conversions (ROAS 2.98).

`breakdown · metrics[spend_usd] · filters[channel=google_search] · range last_complete_week → 2026-08-28..2026-09-03`

> Two decisions hide in "last week": which language it is asked in does not change
> the plan, and "last week" **excludes the partial final day**. See
> [03-traps.md](03-traps.md) for what happens when it does not.

---

### 2.6 · "wat did we spned on linkdin" ✅

*typos throughout; no period given*

> **Interpreted as:** LinkedIn spend, trailing 28 days (8 Aug – 4 Sep).
>
> **$24.6k on LinkedIn** over the last 28 days across two campaigns, returning
> $60.9k (ROAS 2.47).

> Typo tolerance belongs to the model — this is exactly the fuzzy interpretation
> work it is good at. What it must not do is *guess an entity that does not exist*;
> see [04-refusals-and-failures.md](04-refusals-and-failures.md).

---

### 2.7 · "show me the trend" 💥⚠️

*no metric, no dimension, no period — genuinely underspecified*

> **Interpreted as:** total spend and ROAS by week across all available data
> (8 Jun – 4 Sep 2026). You didn't name a metric, so I've used spend.
>
> Weekly spend peaked at **$78.7k in the week of 22 Jun** during the summer sale
> and has settled around **$48k/week** since early August. **ROAS has declined
> steadily from 3.28 at the sale peak to 2.07 in the week of 24 Aug** — the clearest
> trend in your account.

```
line · spend_usd + roas by week
     Jun08  Jun15  Jun22  Jun29  Jul06  Jul13  Jul20  Jul27  Aug03  Aug10  Aug17  Aug24
spend 40.7   45.8   78.7   70.0   61.4   55.7   54.1   52.0   45.9   50.1   48.1   47.9  ($k)
roas  2.45   2.48   3.28   3.06   2.72   2.58   2.46   2.34   2.31   2.19   2.14   2.07
```
*(week of 31 Aug omitted — incomplete)*

> **Flagged as a v1 weakness.** The assumption is stated, and it happens to surface
> something real. But "the trend" after a previous question about YouTube almost
> certainly means *YouTube's* trend, and v1 has no conversation state to know that
> ([DESIGN.md §8](../DESIGN.md)). The honest version of this answer names the
> assumption loudly enough that the user can correct it in one follow-up.

---

### 2.8 · "which platform is cheapest for conversions?" ✅

*platform → `channel` · cheapest for conversions → lowest `cpa`*

> **Interpreted as:** channel ranked by CPA ascending, trailing 28 days.
>
> **Meta, at $26.07 per conversion**, just ahead of Google Search at $27.35.
> YouTube ($96.70) and LinkedIn ($206.88) are 4–8× more expensive per conversion,
> but neither is primarily bought for conversions.

`ranking · metrics[cpa] · dimensions[channel] · sort cpa asc · range trailing_28d`

---

### 2.9 · "top performing ad" ⚠️

*ad → `creative` · performing → ambiguous; resolved to `roas` with a spend floor*

> **Interpreted as:** creatives ranked by ROAS, trailing 28 days, minimum $2,000
> spend to exclude noise. "Performing" could also mean conversion volume — say the
> word and I'll re-rank.
>
> **`brand_rsa_offer` at ROAS 8.70** ($2.4k spent, 126 conversions at $18.98 each),
> narrowly ahead of `brand_rsa_core` at 8.35. Both are brand search text ads, so
> they are capturing demand rather than creating it — your best *prospecting*
> creative is `prospect_ugc_v1` (video) at 3.43.

| creative | format | spend | roas | cpa |
|---|---|---:|---:|---:|
| brand_rsa_offer | responsive_search | 2,391 | 8.70 | 18.98 |
| brand_rsa_core | responsive_search | 3,864 | 8.35 | 20.23 |
| retarget_cart_reminder | image | 4,537 | 5.94 | 13.38 |
| retarget_dpa | carousel | 8,544 | 5.76 | 13.48 |
| prospect_ugc_v1 | video | 9,388 | 3.43 | 48.39 |

> The spend floor is not decoration. Without it the top of this list is a creative
> that spent $40 and got one conversion, and the answer is arithmetically correct
> and completely useless.

---

### 2.10 · "how's the summer thing doing?" ✅

*fuzzy entity → `summer_sale_meta` · "doing" → spend, revenue, ROAS*

> **Interpreted as:** `summer_sale_meta` — the closest match to "the summer thing".
> **This campaign ended on 2 Aug 2026**, so these are lifetime figures, not current.
>
> `summer_sale_meta` spent **$89.9k and returned $416.4k (ROAS 4.63)** across 2,498
> conversions over 8 Jun – 2 Aug. It is the highest-revenue campaign in the whole
> extract. Note it has **9 rows dated after its end date** (3–5 Aug), which is
> normal post-campaign attribution and is included above.

> Entity resolution is the model's job — it is matching intent to a name list. But
> the *fact* that the campaign has ended is not something the model should have to
> notice: the answer template injects it from `dim_campaign.end_date` whenever the
> matched campaign's end date precedes `as_of`.

---

### 2.11 · "give me week on week spend for search" ✅

*search → `channel = google_search` · week on week → `grain: week`*

> **Interpreted as:** Google Search spend by week, 8 Jun – 4 Sep 2026.
>
> Google Search spend has been **remarkably flat at $10–11k a week** for three
> months, easing to $9.4k in the week of 24 Aug. The week of 31 Aug shows $5.8k
> only because it is a partial week ending on the incomplete 4 Sep.

```
line · spend_usd by week · google_search
11.0k ┤ ●─●─●─●─●─●─●─●─●─●
      │                    ●─●
 9.0k ┤                       ╲
 5.8k ┤                        ● ← partial week
      └ Jun08 ······················ Aug31
```

---

### 2.12 · "how many sales did we do last week?" ✅

*sales → `conversions` (not revenue) · last week → last complete week*

> **Interpreted as:** conversions, 28 Aug – 3 Sep 2026 (last complete week).
>
> **1,248 conversions last week**, essentially flat against the 1,246 of the week
> before. Revenue on those was $98.7k at a ROAS of 2.04.

> "Sales" is ambiguous between count and value in every ad account in the world.
> Resolving it to conversions and quoting revenue in the same breath answers both
> readings without asking.

---

### 2.13 · "what's our CTR" ⚠️

> **Interpreted as:** clicks ÷ impressions by channel, trailing 28 days. **I have
> not given you a single blended figure** — it would be misleading.
>
> Google Search runs at **6.12%**, an order of magnitude above Meta's 0.93%,
> LinkedIn's 0.49% and YouTube's 0.43%. Blending them produces 0.54%, a number
> dominated entirely by YouTube's impression volume that describes no channel you
> actually run.

> Refusing to blend is a *code* rule, not a model judgment: rate metrics with
> wildly different denominators get broken out by default.

---

### 2.14 · "total spend to date" ✅

> **Interpreted as:** all spend in the dataset, 8 Jun – 4 Sep 2026 (89 days).
>
> **$679.2k total spend, $1.73M revenue, 18,234 conversions — a blended ROAS of 2.55.**
> This includes $2.7k against the unmapped campaign `C013` and nets off $1.9k of
> credit lines.

`single_value · metrics[spend_usd,revenue_usd,conversions,roas] · range full_coverage`

> "To date" means the data's dates, not today's. The interpretation line prints the
> actual coverage so nobody reads this as a year-to-date figure.
