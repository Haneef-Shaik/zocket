"""Static specification of the synthetic ad-performance extract.

Separated from the generator so the shape of the business (campaigns,
creatives, economics) can be read without wading through the row-building
and defect-injection code.
"""

from datetime import date

# The extract covers 8 June to 4 September 2026 (89 days) per the brief.
DATE_START = date(2026, 6, 8)
DATE_END = date(2026, 9, 4)

# FX feed starts a little earlier than the performance data, as a real one would.
FX_START = date(2026, 6, 1)

CHANNELS = ("google_search", "meta", "youtube", "linkedin")
OBJECTIVES = ("conversions", "traffic", "awareness")

# Dates the FX feed simply does not have. Downstream must carry forward.
FX_MISSING_DATES = (
    date(2026, 7, 19),
    date(2026, 8, 15),
    date(2026, 8, 16),
    date(2026, 9, 4),
)

# The most recent day is an incomplete load, not a performance collapse:
# these channels never reported, and everything that did report is partial.
PARTIAL_LAST_DAY_FACTOR = 0.35
LAST_DAY_MISSING_CHANNELS = ("meta", "youtube")

# A youtube outage: no rows at all on this day.
OUTAGE = (date(2026, 8, 9), ("youtube",))


def _c(campaign_id, name, channel, objective, currency, daily_budget,
       start, end, base_spend, cpc, ctr, cvr, aov, shape=None):
    return {
        "campaign_id": campaign_id,
        "campaign_name": name,
        "channel": channel,
        "objective": objective,
        "currency": currency,
        "daily_budget": daily_budget,
        "start_date": start,
        "end_date": end,
        # economics, expressed in the campaign's own currency
        "base_spend": base_spend,
        "cpc": cpc,
        "ctr": ctr,
        "cvr": cvr,
        "aov": aov,
        "shape": shape or "flat",
    }


# Ground truth the five questions turn on:
#   - C007 leads revenue over the whole extract; C004 leads Q3 (July onward).
#   - C006 has the worst ROAS of the conversion campaigns above a spend floor.
#   - C006's raw INR revenue is numerically the largest in the file, so any
#     answer that skips currency conversion picks the wrong campaign.
#   - C008/C011/C012 are awareness campaigns with ~no conversions: decoys for
#     "which campaign should we turn off".
CAMPAIGNS = (
    _c("C001", "brand_search_us", "google_search", "conversions", "USD",
       800, date(2026, 5, 15), None, 250, 1.85, 0.115, 0.090, 165),
    _c("C002", "nonbrand_search_us", "google_search", "conversions", "USD",
       1200, date(2026, 5, 15), None, 900, 2.60, 0.052, 0.038, 152,
       shape="budget_cut_late_aug"),
    _c("C003", "search_in_generic", "google_search", "traffic", "INR",
       65000, date(2026, 6, 1), None, 40000, 22.0, 0.061, 0.015, 1620),
    _c("C004", "meta_prospecting_us", "meta", "conversions", "USD",
       1500, date(2026, 5, 20), None, 1300, 1.10, 0.0125, 0.022, 165,
       shape="cvr_decay_late_aug"),
    _c("C005", "meta_retargeting_us", "meta", "conversions", "USD",
       600, date(2026, 5, 20), None, 500, 0.90, 0.0180, 0.065, 78),
    _c("C006", "meta_prospecting_in", "meta", "conversions", "INR",
       90000, date(2026, 6, 8), None, 75000, 9.0, 0.0095, 0.0050, 1350),
    _c("C007", "summer_sale_meta", "meta", "conversions", "USD",
       2500, date(2026, 6, 20), date(2026, 8, 2), 2000, 1.25, 0.0155, 0.031, 182,
       shape="summer_sale"),
    _c("C008", "youtube_awareness_in", "youtube", "awareness", "INR",
       120000, date(2026, 6, 1), None, 95000, 3.6, 0.0042, 0.0004, 1400),
    _c("C009", "youtube_prospecting_us", "youtube", "traffic", "USD",
       700, date(2026, 7, 1), None, 620, 0.55, 0.0090, 0.0060, 118),
    _c("C010", "linkedin_b2b_leads", "linkedin", "conversions", "USD",
       900, date(2026, 5, 10), None, 780, 12.5, 0.0055, 0.070, 520,
       shape="b2b_weekly"),
    _c("C011", "linkedin_thought_leadership", "linkedin", "awareness", "USD",
       400, date(2026, 6, 15), date(2026, 8, 20), 330, 9.0, 0.0035, 0.0, 0.0,
       shape="b2b_weekly"),
    _c("C012", "diwali_teaser_in", "meta", "awareness", "INR",
       45000, date(2026, 8, 25), None, 38000, 5.2, 0.0072, 0.0008, 900),
)


def _cr(creative_id, campaign_id, name, fmt, headline, launched_on, share):
    return {
        "creative_id": creative_id,
        "campaign_id": campaign_id,
        "creative_name": name,
        "format": fmt,
        "headline": headline,
        "launched_on": launched_on,
        "share": share,  # share of the campaign's daily spend
    }


CREATIVES = (
    _cr("CR001", "C001", "brand_rsa_core", "responsive_search",
        "Official Store — Free 2-Day Shipping", date(2026, 5, 15), 0.62),
    _cr("CR002", "C001", "brand_rsa_offer", "responsive_search",
        "Shop Direct and Save 10%", date(2026, 5, 15), 0.38),

    _cr("CR003", "C002", "generic_rsa_running", "responsive_search",
        "Running Shoes Built for Long Miles", date(2026, 5, 15), 0.34),
    _cr("CR004", "C002", "generic_rsa_trail", "responsive_search",
        "Trail Shoes That Grip Everything", date(2026, 5, 15), 0.26),
    _cr("CR005", "C002", "generic_rsa_price", "responsive_search",
        "Performance Shoes From $89", date(2026, 5, 15), 0.24),
    _cr("CR006", "C002", "generic_dsa_catalog", "text",
        "Browse the Full Catalog", date(2026, 5, 15), 0.16),

    _cr("CR007", "C003", "in_generic_rsa_hi", "responsive_search",
        "Best Running Shoes Online", date(2026, 6, 1), 0.55),
    _cr("CR008", "C003", "in_generic_rsa_offers", "responsive_search",
        "Sale Live — Up To 40% Off", date(2026, 6, 1), 0.45),

    _cr("CR009", "C004", "prospect_ugc_v1", "video",
        "I Wore These For 300 Miles", date(2026, 5, 20), 0.30),
    _cr("CR010", "C004", "prospect_carousel_bestsellers", "carousel",
        "This Season's Bestsellers", date(2026, 5, 20), 0.28),
    _cr("CR011", "C004", "prospect_static_hero", "image",
        "Engineered For The Long Run", date(2026, 5, 20), 0.24),
    _cr("CR012", "C004", "prospect_ugc_v2", "video",
        "Three Months In — Honest Review", date(2026, 7, 20), 0.18),

    _cr("CR013", "C005", "retarget_dpa", "carousel",
        "Still Thinking About It?", date(2026, 5, 20), 0.65),
    _cr("CR014", "C005", "retarget_cart_reminder", "image",
        "Your Cart Is Waiting", date(2026, 5, 20), 0.35),

    _cr("CR015", "C006", "in_prospect_reel_v1", "video",
        "Made For Indian Roads", date(2026, 6, 8), 0.40),
    _cr("CR016", "C006", "in_prospect_static", "image",
        "Free Delivery Across India", date(2026, 6, 8), 0.33),
    _cr("CR017", "C006", "in_prospect_carousel", "carousel",
        "Six Styles, One Price", date(2026, 6, 8), 0.27),

    _cr("CR018", "C007", "sale_hero_video", "video",
        "Summer Sale — Up To 50% Off", date(2026, 6, 20), 0.45),
    _cr("CR019", "C007", "sale_countdown", "image",
        "48 Hours Left", date(2026, 6, 20), 0.32),
    _cr("CR020", "C007", "sale_carousel", "carousel",
        "Sale Picks Under $100", date(2026, 6, 20), 0.23),

    _cr("CR021", "C008", "yt_brand_film_30s", "video",
        "Every Mile Counts", date(2026, 6, 1), 0.60),
    _cr("CR022", "C008", "yt_bumper_6s", "video",
        "Every Mile Counts — 6s", date(2026, 6, 1), 0.40),

    _cr("CR023", "C009", "yt_demo_15s", "video",
        "See The Midsole In Action", date(2026, 7, 1), 0.55),
    _cr("CR024", "C009", "yt_review_cutdown", "video",
        "What Runners Are Saying", date(2026, 7, 1), 0.45),

    _cr("CR025", "C010", "b2b_whitepaper", "image",
        "The 2026 Team Kit Buyer's Guide", date(2026, 5, 10), 0.42),
    _cr("CR026", "C010", "b2b_case_study", "image",
        "How One Club Cut Kit Costs 30%", date(2026, 5, 10), 0.33),
    _cr("CR027", "C010", "b2b_demo_request", "text",
        "Book A Bulk Pricing Call", date(2026, 5, 10), 0.25),

    _cr("CR028", "C011", "tl_founder_post", "image",
        "Why We Stopped Discounting", date(2026, 6, 15), 0.58),
    _cr("CR029", "C011", "tl_industry_report", "image",
        "State Of Team Sportswear 2026", date(2026, 6, 15), 0.42),

    _cr("CR030", "C012", "diwali_teaser_reel", "video",
        "Something Is Coming This Diwali", date(2026, 8, 25), 0.60),
    _cr("CR031", "C012", "diwali_teaser_static", "image",
        "Diwali Drop — Save The Date", date(2026, 8, 25), 0.40),
)

# Day-of-week multipliers, indexed Monday=0.
DOW = {
    "google_search": (1.02, 1.03, 1.03, 1.01, 0.98, 0.90, 0.88),
    "meta": (0.97, 0.98, 0.99, 1.00, 1.04, 1.06, 1.05),
    "youtube": (0.96, 0.98, 0.99, 1.01, 1.05, 1.08, 1.06),
    "linkedin": (1.18, 1.20, 1.19, 1.15, 0.95, 0.32, 0.28),
}

# The summer sale: spend multiplier by offset from 2026-06-20.
SALE_CURVE = (
    0.60, 0.90, 1.30, 1.80,                    # Jun 20-23 ramp
    2.60, 3.00, 3.20, 3.00, 2.80, 2.50, 2.20,  # Jun 24-30 peak
    1.90, 1.70, 1.50, 1.40, 1.20, 1.10, 1.00,  # Jul 1-7 post-peak
    0.95, 0.90, 0.85, 0.82, 0.78, 0.75, 0.72,  # Jul 8-14
    0.60, 0.55, 0.50, 0.46, 0.42, 0.39, 0.36,  # Jul 15-21 budget pulled back
    0.33, 0.30, 0.28, 0.26, 0.24, 0.22, 0.20,  # Jul 22-28
    0.19, 0.18, 0.17, 0.16,                    # Jul 29 - Aug 1
    0.15,                                      # Aug 2 (last scheduled day)
)
