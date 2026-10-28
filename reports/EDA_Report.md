# CAMPUSPULSE — Timetable EDA

## Dataset

This analysis uses the cleaned, event-level timetable at `data/timetable_clean.csv`. It contains **1,396 class-card records**, **30 divisions**, **6 weekdays**, and 12 one-hour slots from 08:00 to 20:00. A row is a scheduled class card, not a student.

## Activity type distribution

| Activity | Records | Share |
|---|---:|---:|
| Lab | 622 | 44.6% |
| Theory | 561 | 40.2% |
| Tutorial | 213 | 15.3% |

## Records by year group

| Year group | Records | Share |
|---|---:|---:|
| Final | 27 | 1.9% |
| SY | 596 | 42.7% |
| TY | 773 | 55.4% |

## Timetable availability proxy

The most potentially open slots in this timetable are:

| Day | Slot | Divisions with no detected class card |
|---|---|---:|
| Monday | 18:00–19:00 | 30 / 30 |
| Monday | 19:00–20:00 | 30 / 30 |
| Tuesday | 18:00–19:00 | 30 / 30 |
| Tuesday | 19:00–20:00 | 30 / 30 |
| Wednesday | 18:00–19:00 | 30 / 30 |

The fewest potentially open divisions are in:

| Day | Slot | Divisions with no detected class card |
|---|---|---:|
| Friday | 13:00–14:00 | 2 / 30 |
| Tuesday | 10:00–11:00 | 6 / 30 |
| Wednesday | 13:00–14:00 | 6 / 30 |
| Friday | 12:00–13:00 | 6 / 30 |
| Wednesday | 12:00–13:00 | 7 / 30 |

These counts use division-level class-card presence. They are not student headcounts or measured free periods: batch-level lab assignments may not represent every student in a division.

## Data quality

- Extracted room labels: **1,175** records across **24 room codes**.
- Room not specified in source: **168** records.
- Room needs verification: **53** records.
- Batch labels verified by OCR: **34**; unresolved: **1,362**.

## What can and cannot be concluded

The timetable supports weekly schedule analysis, feature engineering, and candidate-room filtering for known room assignments. It does **not** contain observed student attendance, facility demand, queue/wait outcomes, library seats, parking capacity, division strength, current bookings, or schedules from other departments. Therefore, facility outputs must remain an uncalibrated timetable-based preview until those labels are collected. No model accuracy claim can be made from the current files.

## Reproducible outputs

- `data/timetable_hourly_summary.csv` — 72 weekday/hour groups with division-level availability proxies.
- `data/timetable_eda_summary.json` — machine-readable dataset summary and known caveats.
- `data/division_hour_features.csv` and `data/campus_hour_features.csv` — feature tables from `python scripts/build_features.py`.
