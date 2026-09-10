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
