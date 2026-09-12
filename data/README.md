# data/

Four CSVs of daily ad performance, 8 June – 4 September 2026 (89 days, 2,364 rows),
matching the data dictionary in [ASSIGNMENT.md](../ASSIGNMENT.md).

| file | grain |
|---|---|
| `ad_performance_daily.csv` | one row per campaign / creative / day |
| `campaigns.csv` | 12 campaigns across 4 channels and 3 objectives, INR and USD |
| `creatives.csv` | 31 creatives |
| `fx_rates.csv` | daily `rate_to_usd` per currency |

## Provenance

The brief's extract was not included in the repo, so this is a reconstruction built
to the published schema by [`scripts/generate_dataset.py`](../scripts/generate_dataset.py)
(fixed seed; re-running reproduces these files byte for byte).

It is **not clean**, by design — the brief's extract wasn't either. It carries the
defects an ad-platform export actually has: re-sent days, late restatements that
change numbers already reported, gaps in the FX feed, rows dated after a campaign
stopped, ids that resolve to nothing, refund lines with negative spend, revenue
booked against zero spend, nulls, currency stamped inconsistently, funnel
violations, a channel outage, and an incomplete final day. Deciding what to do
about each is part of the exercise; `scripts/generate_dataset.py` names them all
in readable functions if you want to check your handling against the source.

Money is in the campaign's own currency. Anything compared across campaigns has to
be converted first — the largest raw revenue figures in the file are INR.

## Replacing it with your own extract

The runtime reads coverage, channels, campaigns, creatives, objectives and
currencies from these files at boot, so a different extract needs no code change
to answer questions. What it does need is the file contract met, the scale-
dependent policy constants reviewed, and the golden set re-baselined — because
the expected numbers in `examples/golden.jsonl` and `tests/canonical.test.ts`
came from *these* files and are what tells you a policy broke.

The full procedure, with the queries to re-derive each number, is
[**Running it on your own data**](../README.md#running-it-on-your-own-data) in
the top-level README. The short version:

```bash
cp /path/to/extract/*.csv data/   # or: DASHBOARD_AGENT_DATA=/abs/path npm test
npm run sql -- "SELECT * FROM coverage"
npm run sql -- "SELECT COUNT(*) FROM fact WHERE spend IS NOT NULL AND spend_usd IS NULL"
```

That last count must be zero. Anything else means the FX feed does not cover
every currency-date in the extract, and spend is being silently dropped from
every USD total in the system.
