-- Canonical analytical model.
--
-- Every policy in src/semantic/policies.ts is implemented exactly once, here.
-- Nothing downstream re-derives a join, an FX conversion, or a dedup rule.
--
-- Ingest runs single-threaded with insertion order preserved because the
-- restatement policy is "last row in FILE ORDER wins" -- _ord has to mean
-- something. tests/ingest.test.ts asserts that it still does.

SET preserve_insertion_order = true;
SET threads = 1;

-- ---------------------------------------------------------------- raw ingest
-- all_varchar: the extract has blank currencies, nulls, and non-numeric
-- hygiene defects. We want to see them, not have the CSV reader guess.

CREATE OR REPLACE TABLE raw_perf AS
SELECT row_number() OVER () AS _ord, *
FROM read_csv($perf_path, header = true, all_varchar = true);

CREATE OR REPLACE TABLE raw_campaigns AS
SELECT * FROM read_csv($campaigns_path, header = true, all_varchar = true);

CREATE OR REPLACE TABLE raw_creatives AS
SELECT * FROM read_csv($creatives_path, header = true, all_varchar = true);

CREATE OR REPLACE TABLE raw_fx AS
SELECT * FROM read_csv($fx_path, header = true, all_varchar = true);

-- ------------------------------------------------------------------- typing
-- TRY_CAST, not CAST: a malformed number becomes NULL and gets counted in the
-- flags, rather than aborting the whole answer.

CREATE OR REPLACE VIEW perf_typed AS
SELECT
    _ord,
    TRY_CAST(NULLIF(TRIM(date), '') AS DATE)            AS date,
    NULLIF(UPPER(TRIM(campaign_id)), '')                AS campaign_id,
    NULLIF(UPPER(TRIM(creative_id)), '')                AS creative_id,
    TRY_CAST(NULLIF(TRIM(impressions), '') AS BIGINT)   AS impressions,
    TRY_CAST(NULLIF(TRIM(clicks), '') AS BIGINT)        AS clicks,
    TRY_CAST(NULLIF(TRIM(conversions), '') AS BIGINT)   AS conversions,
    TRY_CAST(NULLIF(TRIM(spend), '') AS DOUBLE)         AS spend,
    TRY_CAST(NULLIF(TRIM(revenue), '') AS DOUBLE)       AS revenue,
    NULLIF(UPPER(TRIM(currency)), '')                   AS row_currency
FROM raw_perf;

CREATE OR REPLACE VIEW campaigns AS
SELECT
    NULLIF(UPPER(TRIM(campaign_id)), '')                AS campaign_id,
    TRIM(campaign_name)                                 AS campaign_name,
    TRIM(channel)                                       AS channel,
    TRIM(objective)                                     AS objective,
    NULLIF(UPPER(TRIM(currency)), '')                   AS currency,
    TRY_CAST(NULLIF(TRIM(daily_budget), '') AS DOUBLE)  AS daily_budget,
    TRY_CAST(NULLIF(TRIM(start_date), '') AS DATE)      AS start_date,
    TRY_CAST(NULLIF(TRIM(end_date), '') AS DATE)        AS end_date
FROM raw_campaigns;

CREATE OR REPLACE VIEW creatives AS
SELECT
    NULLIF(UPPER(TRIM(creative_id)), '')                AS creative_id,
    NULLIF(UPPER(TRIM(campaign_id)), '')                AS campaign_id,
    TRIM(creative_name)                                 AS creative_name,
    TRIM(format)                                        AS format,
    TRIM(headline)                                      AS headline,
    TRY_CAST(NULLIF(TRIM(launched_on), '') AS DATE)     AS launched_on
FROM raw_creatives;

-- ----------------------------------------------------------------------- FX
-- The feed has missing dates. Dropping those rows loses real spend; defaulting
-- to 1.0 converts INR at 90x. Carry the last known rate forward and flag it.

CREATE OR REPLACE VIEW fx_typed AS
SELECT
    TRY_CAST(NULLIF(TRIM(date), '') AS DATE)            AS date,
    NULLIF(UPPER(TRIM(currency)), '')                   AS currency,
    TRY_CAST(NULLIF(TRIM(rate_to_usd), '') AS DOUBLE)   AS rate_to_usd
FROM raw_fx;

CREATE OR REPLACE VIEW fx_spine AS
WITH bounds AS (
    SELECT LEAST(MIN(date), (SELECT MIN(date) FROM fx_typed))  AS lo,
           GREATEST(MAX(date), (SELECT MAX(date) FROM fx_typed)) AS hi
    FROM perf_typed WHERE date IS NOT NULL
),
spine AS (
    SELECT d::DATE AS date, c AS currency
    FROM bounds, UNNEST(generate_series(lo, hi, INTERVAL 1 DAY)) AS g(d),
         (SELECT DISTINCT currency FROM fx_typed WHERE currency IS NOT NULL) AS cs(c)
)
SELECT
    s.date,
    s.currency,
    -- last known rate at or before this date, per currency
    last_value(f.rate_to_usd IGNORE NULLS) OVER (
        PARTITION BY s.currency ORDER BY s.date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )                                                   AS rate_to_usd,
    f.rate_to_usd IS NULL                               AS rate_carried_forward
FROM spine s
LEFT JOIN fx_typed f ON f.date = s.date AND f.currency = s.currency;

-- ------------------------------------------------------------------- dedup
-- Two different defects that look alike:
--   * an exact re-send of a row      -> collapse, it is the same fact twice
--   * the same key with new numbers  -> a restatement; the later one is true

CREATE OR REPLACE VIEW perf_exact_dedup AS
SELECT MIN(_ord) AS _ord, date, campaign_id, creative_id,
       impressions, clicks, conversions, spend, revenue, row_currency
FROM perf_typed
GROUP BY ALL;

CREATE OR REPLACE VIEW perf_resolved AS
SELECT * EXCLUDE (_rn)
FROM (
    SELECT *, row_number() OVER (
        PARTITION BY date, campaign_id, creative_id ORDER BY _ord DESC
    ) AS _rn
    FROM perf_exact_dedup
)
WHERE _rn = 1;

-- ------------------------------------------------------------------- fact
-- The one view every query reads. Orphans survive as `unmapped` rather than
-- being dropped (which loses spend) or folded into a real campaign (which
-- misattributes it).

CREATE OR REPLACE VIEW fact AS
SELECT
    p._ord,
    p.date,
    p.campaign_id,
    p.creative_id,
    COALESCE(c.campaign_name, 'unmapped:' || COALESCE(p.campaign_id, 'null')) AS campaign_name,
    COALESCE(c.channel,   'unmapped')                   AS channel,
    COALESCE(c.objective, 'unmapped')                   AS objective,
    COALESCE(cr.creative_name, 'unmapped:' || COALESCE(p.creative_id, 'null')) AS creative_name,
    COALESCE(cr.format, 'unmapped')                     AS format,
    c.daily_budget,
    c.end_date,

    p.impressions, p.clicks, p.conversions,
    p.spend, p.revenue,

    -- The campaign owns the currency. The row's own column is advisory and,
    -- in this extract, sometimes wrong.
    COALESCE(c.currency, p.row_currency)                AS currency,
    p.row_currency,
    fx.rate_to_usd,
    fx.rate_carried_forward,

    p.spend   * fx.rate_to_usd                          AS spend_usd,
    p.revenue * fx.rate_to_usd                          AS revenue_usd,

    -- row-level defect markers, aggregated by the result validator
    (c.campaign_id IS NULL)                             AS is_unmapped_campaign,
    (cr.creative_id IS NULL)                            AS is_unmapped_creative,
    (p.row_currency IS NOT NULL AND c.currency IS NOT NULL
        AND p.row_currency <> c.currency)               AS is_currency_mismatch,
    (p.clicks > p.impressions OR p.conversions > p.clicks) AS is_funnel_violation,
    (p.spend < 0)                                       AS is_negative_spend,
    (COALESCE(p.spend, 0) = 0 AND COALESCE(p.revenue, 0) > 0) AS is_revenue_without_spend,
    (c.end_date IS NOT NULL AND p.date > c.end_date)    AS is_after_campaign_end,
    (p.impressions IS NULL OR p.clicks IS NULL OR p.conversions IS NULL
        OR p.spend IS NULL OR p.revenue IS NULL)        AS has_null_measure
FROM perf_resolved p
LEFT JOIN campaigns c  ON c.campaign_id = p.campaign_id
LEFT JOIN creatives cr ON cr.creative_id = p.creative_id
LEFT JOIN fx_spine fx  ON fx.date = p.date
                      AND fx.currency = COALESCE(c.currency, p.row_currency);

-- --------------------------------------------------------------- coverage
-- Read at boot. `as_of` comes from here, never from the wall clock.

CREATE OR REPLACE VIEW coverage AS
SELECT MIN(date) AS first_date, MAX(date) AS last_date, COUNT(*) AS row_count
FROM fact WHERE date IS NOT NULL;
