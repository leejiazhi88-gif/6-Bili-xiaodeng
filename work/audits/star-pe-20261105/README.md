# STAR Composite PE cross-check, 2026-11-05

The dashboard's 36.85 is the value returned for 000680 by the CSI historical
index-performance API on 2026-11-05. A fresh request on 2026-11-07 returned
the same value. The archived CSI factsheet for 2026-10-30 reports 44.68,
matching the API for that date. The source field was not misread.

The user's Choice screenshot shows approximately 50.61 for its displayed
market-PE indicator, but its exact aggregation formula and timestamp are not
available in the screenshot. It cannot be treated as the same series without
first confirming Choice's methodology.

An independent calculation using the latest available constituent snapshot
and Tushare stock data for 2026-11-05 gives:

| Method | PE |
| --- | ---: |
| CSI official history | 36.85 |
| Positive-PE stocks, total cap / implied positive profit | 39.35 |
| All constituents, total cap / TTM attributable profit including losses | 56.28 |

The large method sensitivity is consistent with different profit inclusion and
index-calculation-capital rules; it does not identify Choice's exact formula.
CSI and stock-level calculations should remain separately labeled. The latter
uses a 2026-10-30 monthly constituent snapshot and a cached income history, so
it is an audit estimate rather than a replacement for official daily values.

Reproduce with `python work/audit_star_pe_week.py --end 20261105`. Raw responses,
per-stock observations, and the computed comparison are in this directory.
