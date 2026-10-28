"""Run reproducible descriptive analysis on the extracted timetable data."""
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
HOURS = range(8, 20)


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    events = read_csv(DATA / "timetable_clean.csv")
    divisions = sorted({row["division"] for row in events if row["division"]})
    type_counts = Counter(row["activity_type"] for row in events)
    year_counts = Counter(row["year"] for row in events)
    room_counts = Counter(row["room_status"] for row in events)
    batch_counts = Counter(row["batch_status"] for row in events)
    day_counts = Counter(row["day"] for row in events)
    division_events = defaultdict(set)
    room_events = defaultdict(list)
    for event in events:
        division_events[(event["day"], event["start_time"])].add(event["division"])
        if event["room"] and event["room_status"] == "extracted":
            room_events[event["room"]].append(event)

    hourly = []
    for day in DAYS:
        for hour in HOURS:
            start, end = f"{hour:02d}:00", f"{hour + 1:02d}:00"
            active = len(division_events[(day, start)])
            hourly.append({
                "day": day,
                "start_time": start,
                "end_time": end,
                "total_divisions": len(divisions),
                "divisions_with_class_card": active,
                "divisions_without_detected_class": len(divisions) - active,
                "potentially_free_division_ratio": round((len(divisions) - active) / len(divisions), 4) if divisions else "",
                "interpretation": "schedule proxy; not a student headcount",
            })
    write_csv(DATA / "timetable_hourly_summary.csv", list(hourly[0]), hourly)

    summary = {
        "source": "data/timetable_clean.csv",
        "event_rows": len(events),
        "unique_divisions": len(divisions),
        "division_events_by_year": dict(sorted(year_counts.items())),
        "event_rows_by_activity_type": dict(sorted(type_counts.items())),
        "event_rows_by_day": {day: day_counts[day] for day in DAYS},
        "room_assignment_status": dict(sorted(room_counts.items())),
        "batch_read_status": dict(sorted(batch_counts.items())),
        "rooms_with_at_least_one_extracted_label": len(room_events),
        "hourly_slots": len(hourly),
        "most_divisions_without_class": max(hourly, key=lambda row: row["divisions_without_detected_class"]),
        "fewest_divisions_without_class": min(hourly, key=lambda row: row["divisions_without_detected_class"]),
        "data_caveats": [
            "Weekly timetable presence is a proxy for potential availability; it is not actual student movement.",
            "Division-level free counts do not resolve incomplete batch labels.",
            "Room assignments may be absent or OCR-ambiguous.",
            "No facility outcome measurements, division strengths, capacities, or live bookings were supplied.",
        ],
    }
    DATA.mkdir(exist_ok=True)
    (DATA / "timetable_eda_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    REPORTS.mkdir(exist_ok=True)
    type_table = "\n".join(f"| {name.title()} | {count} | {count / len(events):.1%} |" for name, count in sorted(type_counts.items()))
    year_table = "\n".join(f"| {name} | {count} | {count / len(events):.1%} |" for name, count in sorted(year_counts.items()))
    high_free = sorted(hourly, key=lambda row: row["divisions_without_detected_class"], reverse=True)[:5]
    low_free = sorted(hourly, key=lambda row: row["divisions_without_detected_class"])[:5]
    slot_rows = "\n".join(f"| {r['day']} | {r['start_time']}–{r['end_time']} | {r['divisions_without_detected_class']} / {r['total_divisions']} |" for r in high_free)
    low_rows = "\n".join(f"| {r['day']} | {r['start_time']}–{r['end_time']} | {r['divisions_without_detected_class']} / {r['total_divisions']} |" for r in low_free)
    report = f'''# CAMPUSPULSE — Timetable EDA

## Dataset

This analysis uses the cleaned, event-level timetable at `data/timetable_clean.csv`. It contains **{len(events):,} class-card records**, **{len(divisions)} divisions**, **{len(DAYS)} weekdays**, and 12 one-hour slots from 08:00 to 20:00. A row is a scheduled class card, not a student.

## Activity type distribution

| Activity | Records | Share |
|---|---:|---:|
{type_table}

## Records by year group

| Year group | Records | Share |
|---|---:|---:|
{year_table}

## Timetable availability proxy

The most potentially open slots in this timetable are:

| Day | Slot | Divisions with no detected class card |
|---|---|---:|
{slot_rows}

The fewest potentially open divisions are in:

| Day | Slot | Divisions with no detected class card |
|---|---|---:|
{low_rows}

These counts use division-level class-card presence. They are not student headcounts or measured free periods: batch-level lab assignments may not represent every student in a division.

## Data quality

- Extracted room labels: **{room_counts.get('extracted', 0):,}** records across **{len(room_events)} room codes**.
- Room not specified in source: **{room_counts.get('not_specified_in_source', 0):,}** records.
- Room needs verification: **{room_counts.get('needs_verification', 0):,}** records.
- Batch labels verified by OCR: **{batch_counts.get('verified_ocr', 0):,}**; unresolved: **{batch_counts.get('needs_verification', 0):,}**.

## What can and cannot be concluded

The timetable supports weekly schedule analysis, feature engineering, and candidate-room filtering for known room assignments. It does **not** contain observed student attendance, facility demand, queue/wait outcomes, library seats, parking capacity, division strength, current bookings, or schedules from other departments. Therefore, facility outputs must remain an uncalibrated timetable-based preview until those labels are collected. No model accuracy claim can be made from the current files.

## Reproducible outputs

- `data/timetable_hourly_summary.csv` — 72 weekday/hour groups with division-level availability proxies.
- `data/timetable_eda_summary.json` — machine-readable dataset summary and known caveats.
- `data/division_hour_features.csv` and `data/campus_hour_features.csv` — feature tables from `python scripts/build_features.py`.
'''
    (REPORTS / "EDA_Report.md").write_text(report, encoding="utf-8")
    print(f"Analyzed {len(events)} records, {len(divisions)} divisions; wrote EDA summary and report.")


if __name__ == "__main__":
    main()
