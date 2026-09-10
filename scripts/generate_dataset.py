"""Generate the data/ extract described in ASSIGNMENT.md's data dictionary.

Deterministic: a fixed seed, so re-running reproduces the committed CSVs byte
for byte. The output is deliberately *not* clean. Every defect below is one
that shows up in real ad-platform extracts, and each is injected in a named,
readable function so the intent is auditable:

    re-sent days (exact duplicates)      restatements (same key, new numbers)
    FX rate gaps                         rows dated after a campaign's end
    orphan campaign / creative ids       negative spend (refunds and credits)
    revenue with zero spend              missing values, blank currency
    currency not matching the campaign   clicks > impressions
    a channel outage day                 an incomplete final day

Usage:  python3 scripts/generate_dataset.py [--out data]
"""

import argparse
import csv
import random
from datetime import date, timedelta
from pathlib import Path

from dataset_spec import (
    CAMPAIGNS, CREATIVES, DATE_END, DATE_START, DOW, FX_MISSING_DATES,
    FX_START, LAST_DAY_MISSING_CHANNELS, OUTAGE, PARTIAL_LAST_DAY_FACTOR,
    SALE_CURVE,
)

SEED = 20260904

BY_ID = {c["campaign_id"]: c for c in CAMPAIGNS}


def days(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


# --------------------------------------------------------------------------
# FX
# --------------------------------------------------------------------------

def build_fx(rng):
    """Daily INR/USD rates, with a handful of dates the feed never delivered."""
    span = days(FX_START, DATE_END)
    start_rate, end_rate = 0.011520, 0.011185
    rows = []
    for i, day in enumerate(span):
        if day in FX_MISSING_DATES:
            continue
        drift = start_rate + (end_rate - start_rate) * (i / (len(span) - 1))
        inr = drift * rng.uniform(0.9975, 1.0025)
        rows.append({"date": day, "currency": "USD", "rate_to_usd": 1.0})
        rows.append({"date": day, "currency": "INR", "rate_to_usd": round(inr, 6)})
    return rows


# --------------------------------------------------------------------------
# Base performance rows
# --------------------------------------------------------------------------

def shape_multipliers(campaign, day):
    """(spend multiplier, cvr multiplier) for a campaign on a given day."""
    shape = campaign["shape"]
    if shape == "summer_sale":
        offset = (day - campaign["start_date"]).days
        return (SALE_CURVE[offset] if 0 <= offset < len(SALE_CURVE) else 0.15), 1.0
    if shape == "budget_cut_late_aug":
        return (0.72 if day >= date(2026, 8, 20) else 1.0), 1.0
    if shape == "cvr_decay_late_aug":
        return 1.0, (0.82 if day >= date(2026, 8, 16) else 1.0)
    return 1.0, 1.0


def trend_factor(slope, day):
    return 1.0 + slope * ((day - DATE_START).days / (DATE_END - DATE_START).days)


def make_row(campaign, creative, day, slope, rng):
    spend_mult, cvr_mult = shape_multipliers(campaign, day)
    dow = DOW[campaign["channel"]][day.weekday()]

    spend = (campaign["base_spend"] * creative["share"] * dow * spend_mult
             * trend_factor(slope, day) * rng.uniform(0.88, 1.12))
    clicks = round(spend / campaign["cpc"] * rng.uniform(0.92, 1.08))
    impressions = round(clicks / campaign["ctr"] * rng.uniform(0.90, 1.10))

    expected_conv = clicks * campaign["cvr"] * cvr_mult * rng.uniform(0.80, 1.25)
    conversions = int(expected_conv) + (1 if rng.random() < expected_conv % 1 else 0)
    revenue = conversions * campaign["aov"] * rng.uniform(0.92, 1.08)

    return {
        "date": day,
        "campaign_id": campaign["campaign_id"],
        "creative_id": creative["creative_id"],
        "impressions": impressions,
        "clicks": clicks,
        "conversions": conversions,
        "spend": round(spend, 2),
        "revenue": round(revenue, 2),
        "currency": campaign["currency"],
    }


def is_live(campaign, creative, day):
    if day < campaign["start_date"] or day < creative["launched_on"]:
        return False
    return campaign["end_date"] is None or day <= campaign["end_date"]


def build_base_rows(rng):
    slopes = {c["campaign_id"]: rng.uniform(-0.10, 0.14) for c in CAMPAIGNS}
    rows = []
    for day in days(DATE_START, DATE_END):
        for creative in CREATIVES:
            campaign = BY_ID[creative["campaign_id"]]
            if is_live(campaign, creative, day):
                rows.append(make_row(campaign, creative, day, slopes[campaign["campaign_id"]], rng))
    return rows


def add_post_end_date_rows(rows, rng):
    """Platforms keep reporting attributed conversions after a campaign stops."""
    tails = (("C007", date(2026, 8, 3), 3), ("C011", date(2026, 8, 21), 2))
    extra = []
    for campaign_id, first, count in tails:
        campaign = BY_ID[campaign_id]
        slope = 0.0
        for offset in range(count):
            day = first + timedelta(days=offset)
            decay = 0.30 * (0.5 ** offset)
            for creative in CREATIVES:
                if creative["campaign_id"] != campaign_id:
                    continue
                row = make_row(campaign, creative, day, slope, rng)
                extra.append({
                    **row,
                    "impressions": round(row["impressions"] * decay),
                    "clicks": round(row["clicks"] * decay),
                    "conversions": round(row["conversions"] * decay),
                    "spend": round(row["spend"] * decay, 2),
                    "revenue": round(row["revenue"] * decay, 2),
                })
    return rows + extra


def apply_outage(rows):
    day, channels = OUTAGE
    return [r for r in rows
            if not (r["date"] == day and BY_ID[r["campaign_id"]]["channel"] in channels)]


def apply_partial_last_day(rows):
    """The most recent day is an incomplete load.

    Two things went wrong at once, which is the point of question 3: meta and
    youtube did not deliver at all, and everything that did deliver reported a
    fraction of the day. Nothing about the campaigns themselves changed.
    """
    f = PARTIAL_LAST_DAY_FACTOR
    out = []
    for row in rows:
        if row["date"] != DATE_END:
            out.append(row)
            continue
        if BY_ID[row["campaign_id"]]["channel"] in LAST_DAY_MISSING_CHANNELS:
            continue
        out.append({
            **row,
            "impressions": round(row["impressions"] * f),
            "clicks": round(row["clicks"] * f),
            "conversions": round(row["conversions"] * f),
            "spend": round(row["spend"] * f, 2),
            "revenue": round(row["revenue"] * f, 2),
        })
    return out


# --------------------------------------------------------------------------
# Defects
# --------------------------------------------------------------------------

def sort_key(row):
    return (row["date"].isoformat(), str(row["campaign_id"]), str(row["creative_id"]))


def pick(rng, rows, count, used, predicate=None):
    """Sample row indices not already claimed by another defect."""
    pool = [i for i, r in enumerate(rows)
            if i not in used and (predicate is None or predicate(r))]
    chosen = rng.sample(pool, count)
    used.update(chosen)
    return chosen


def inject_resent_days(rows, rng):
    """Whole days re-sent by the platform, byte-identical to the first send."""
    resends = ((date(2026, 7, 22), "C004"), (date(2026, 8, 11), "C010"))
    out = []
    for row in rows:
        out.append(row)
        if (row["date"], row["campaign_id"]) in resends:
            out.append(dict(row))
    scattered = rng.sample(range(len(out)), 8)
    doubled = []
    for i, row in enumerate(out):
        doubled.append(row)
        if i in scattered:
            doubled.append(dict(row))
    return doubled


def inject_restatements(rows, rng, used):
    """Same (date, campaign, creative), different numbers, arriving late.

    These land at the end of the file, the way a correction batch does. Exact
    duplicates can be collapsed safely; these cannot — a consumer has to choose
    a policy and say which one it chose.
    """
    idx = pick(rng, rows, 5, used,
               lambda r: date(2026, 6, 20) <= r["date"] <= date(2026, 8, 10))
    corrections = []
    for i in idx:
        row = rows[i]
        bump = rng.uniform(1.04, 1.19)
        corrections.append({
            **row,
            "impressions": round(row["impressions"] * bump),
            "clicks": round(row["clicks"] * bump),
            "conversions": round(row["conversions"] * bump),
            "spend": round(row["spend"] * bump, 2),
            "revenue": round(row["revenue"] * rng.uniform(1.02, 1.30), 2),
        })
    return rows + corrections


def inject_orphans(rows, rng):
    """Ids that resolve to nothing in the dimension files."""
    template = BY_ID["C004"]
    extra = []
    for offset in range(7):
        day = date(2026, 7, 6) + timedelta(days=offset * 4)
        clicks = rng.randint(180, 640)
        conversions = rng.randint(2, 11)
        extra.append({
            "date": day,
            "campaign_id": "C013",             # not in campaigns.csv
            "creative_id": "CR040",            # not in creatives.csv
            "impressions": round(clicks / 0.013),
            "clicks": clicks,
            "conversions": conversions,
            "spend": round(clicks * 1.15, 2),
            "revenue": round(conversions * template["aov"], 2),
            "currency": "USD",
        })
    for offset in range(4):
        day = date(2026, 8, 4) + timedelta(days=offset * 3)
        clicks = rng.randint(90, 300)
        conversions = rng.randint(1, 6)
        extra.append({
            "date": day,
            "campaign_id": "C005",             # real campaign...
            "creative_id": "CR999",            # ...creative that does not exist
            "impressions": round(clicks / 0.018),
            "clicks": clicks,
            "conversions": conversions,
            "spend": round(clicks * 0.92, 2),
            "revenue": round(conversions * 91.0, 2),
            "currency": "USD",
        })
    return rows + extra


def inject_refunds(rows, rng):
    """Credit lines: negative spend, no delivery."""
    credits = (
        (date(2026, 7, 14), "C002", "CR003", -418.60),
        (date(2026, 8, 6), "C004", "CR010", -1265.20),
        (date(2026, 8, 27), "C006", "CR016", -21400.00),
    )
    extra = [{
        "date": day, "campaign_id": cid, "creative_id": crid,
        "impressions": 0, "clicks": 0, "conversions": 0,
        "spend": amount, "revenue": 0.0,
        "currency": BY_ID[cid]["currency"],
    } for day, cid, crid, amount in credits]
    return rows + extra


def inject_zero_spend_with_revenue(rows, rng, used):
    """Billing lagged the conversion feed: revenue landed, cost did not."""
    idx = pick(rng, rows, 5, used, lambda r: r["conversions"] > 0 and r["revenue"] > 0)
    return [{**r, "spend": 0.0} if i in set(idx) else r for i, r in enumerate(rows)]


def inject_missing_values(rows, rng, used):
    """Nulls where the platform had nothing to report."""
    blank_spend = set(pick(rng, rows, 6, used, lambda r: r["spend"] > 0))
    blank_revenue = set(pick(rng, rows, 4, used))
    blank_conversions = set(pick(rng, rows, 3, used))
    blank_currency = set(pick(rng, rows, 2, used))
    out = []
    for i, row in enumerate(rows):
        if i in blank_spend:
            row = {**row, "spend": None}
        if i in blank_revenue:
            row = {**row, "revenue": None}
        if i in blank_conversions:
            row = {**row, "conversions": None}
        if i in blank_currency:
            row = {**row, "currency": None}
        out.append(row)
    return out


def inject_currency_mismatch(rows, rng, used):
    """Rows stamped with a currency the campaign does not bill in."""
    idx = set(pick(rng, rows, 3, used, lambda r: r["currency"] == "INR"))
    return [{**r, "currency": "USD"} if i in idx else r for i, r in enumerate(rows)]


def inject_impossible_ratios(rows, rng, used):
    """Funnel violations: more clicks than impressions, more conversions than clicks."""
    over_clicked = set(pick(rng, rows, 2, used,
                            lambda r: 500 < (r["impressions"] or 0) < 3000))
    # Deliberately bounded: a funnel violation on a million-impression row would
    # dominate every daily total and drown out the real signals in the data.
    over_converted = set(pick(rng, rows, 2, used,
                              lambda r: 40 < (r["clicks"] or 0) < 250))
    out = []
    for i, row in enumerate(rows):
        if i in over_clicked:
            row = {**row, "clicks": row["impressions"] + rng.randint(3, 40)}
        if i in over_converted:
            row = {**row, "conversions": row["clicks"] + rng.randint(1, 5)}
        out.append(row)
    return out


def inject_string_hygiene(rows, rng, used):
    """Padded ids and inconsistent casing, as any hand-touched export has."""
    padded = set(pick(rng, rows, 5, used))
    lowered = set(pick(rng, rows, 4, used, lambda r: r["currency"] is not None))
    out = []
    for i, row in enumerate(rows):
        if i in padded:
            row = {**row, "campaign_id": f" {row['campaign_id']} "}
        if i in lowered:
            row = {**row, "currency": row["currency"].lower()}
        out.append(row)
    return out


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------

def fmt_int(v):
    return "" if v is None else str(int(v))


def fmt_money(v):
    return "" if v is None else f"{v:.2f}"


def fmt_date(v):
    return "" if v is None else v.isoformat()


def write_csv(path, header, rows):
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)


def write_all(out_dir, perf_rows, fx_rows):
    out_dir.mkdir(parents=True, exist_ok=True)

    write_csv(
        out_dir / "ad_performance_daily.csv",
        ["date", "campaign_id", "creative_id", "impressions", "clicks",
         "conversions", "spend", "revenue", "currency"],
        [[fmt_date(r["date"]), r["campaign_id"], r["creative_id"],
          fmt_int(r["impressions"]), fmt_int(r["clicks"]), fmt_int(r["conversions"]),
          fmt_money(r["spend"]), fmt_money(r["revenue"]), r["currency"] or ""]
         for r in perf_rows],
    )

    write_csv(
        out_dir / "campaigns.csv",
        ["campaign_id", "campaign_name", "channel", "objective", "currency",
         "daily_budget", "start_date", "end_date"],
        [[c["campaign_id"], c["campaign_name"], c["channel"], c["objective"],
          c["currency"], c["daily_budget"], fmt_date(c["start_date"]),
          fmt_date(c["end_date"])] for c in CAMPAIGNS],
    )

    write_csv(
        out_dir / "creatives.csv",
        ["creative_id", "campaign_id", "creative_name", "format", "headline",
         "launched_on"],
        [[c["creative_id"], c["campaign_id"], c["creative_name"], c["format"],
          c["headline"], fmt_date(c["launched_on"])] for c in CREATIVES],
    )

    write_csv(
        out_dir / "fx_rates.csv",
        ["date", "currency", "rate_to_usd"],
        [[fmt_date(r["date"]), r["currency"], f"{r['rate_to_usd']:.6f}"]
         for r in fx_rows],
    )


def build(rng):
    rows = build_base_rows(rng)
    rows = add_post_end_date_rows(rows, rng)
    rows = apply_outage(rows)
    rows = apply_partial_last_day(rows)
    rows = sorted(rows, key=sort_key)

    rows = inject_resent_days(rows, rng)
    rows = inject_orphans(rows, rng)
    rows = sorted(rows, key=sort_key)

    used = set()
    rows = inject_zero_spend_with_revenue(rows, rng, used)
    rows = inject_impossible_ratios(rows, rng, used)
    rows = inject_currency_mismatch(rows, rng, used)
    rows = inject_missing_values(rows, rng, used)
    rows = inject_string_hygiene(rows, rng, used)

    rows = inject_restatements(rows, rng, used)
    rows = inject_refunds(rows, rng)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="data", help="output directory")
    args = parser.parse_args()

    rng = random.Random(SEED)
    perf_rows = build(rng)
    fx_rows = build_fx(rng)

    out_dir = Path(args.out)
    write_all(out_dir, perf_rows, fx_rows)
    print(f"{len(perf_rows)} performance rows, {len(fx_rows)} fx rows -> {out_dir}/")


if __name__ == "__main__":
    main()
