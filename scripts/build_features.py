"""Create division-hour and campus-hour feature tables from the cleaned timetable."""
import csv
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "timetable_clean.csv"
DIVISION_OUTPUT = ROOT / "data" / "division_hour_features.csv"
CAMPUS_OUTPUT = ROOT / "data" / "campus_hour_features.csv"
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
HOURS = range(8, 20)


def read_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def write_rows(path, fields, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    events = read_rows(INPUT)
    divisions = sorted({row["division"] for row in events if row["division"]})
    event_groups = defaultdict(list)
    for row in events:
        event_groups[(row["division"], row["day"], row["start_time"])].append(row)

    detail = []
    for division in divisions:
        year = next((event["year"] for event in events if event["division"] == division), "")
        for day in DAYS:
            for hour in HOURS:
                start = f"{hour:02d}:00"
                group = event_groups.get((division, day, start), [])
                rooms = sorted({event["room"] for event in group if event["room"]})
                detail.append({
                    "year": year,
                    "division": division,
                    "day": day,
                    "start_time": start,
                    "end_time": f"{hour + 1:02d}:00",
                    "class_scheduled": int(bool(group)),
                    "class_card_count": len(group),
                    "activity_types": ";".join(sorted({event["activity_type"] for event in group if event["activity_type"]})),
                    "known_rooms": ";".join(rooms),
                    "unresolved_room_cards": sum(event["room_status"] != "extracted" for event in group),
                    "source_pages": ";".join(str(page) for page in sorted({int(event["source_page"]) for event in group if event["source_page"]})),
                })

    campus = []
    for day in DAYS:
        for hour in HOURS:
            start = f"{hour:02d}:00"
            group = [row for row in detail if row["day"] == day and row["start_time"] == start]
            busy = sum(int(row["class_scheduled"]) for row in group)
            free = max(0, len(divisions) - busy)
            campus.append({
                "day": day,
                "start_time": start,
                "end_time": f"{hour + 1:02d}:00",
                "total_divisions": len(divisions),
                "divisions_with_class_card": busy,
                "divisions_without_detected_class": free,
                "potentially_free_division_ratio": round(free / len(divisions), 4) if divisions else "",
                "class_card_count": sum(int(row["class_card_count"]) for row in group),
                "unresolved_room_cards": sum(int(row["unresolved_room_cards"]) for row in group),
                "interpretation": "timetable_proxy_not_student_count",
            })

    write_rows(DIVISION_OUTPUT,
               ["year", "division", "day", "start_time", "end_time", "class_scheduled", "class_card_count", "activity_types", "known_rooms", "unresolved_room_cards", "source_pages"],
               detail)
    write_rows(CAMPUS_OUTPUT,
               ["day", "start_time", "end_time", "total_divisions", "divisions_with_class_card", "divisions_without_detected_class", "potentially_free_division_ratio", "class_card_count", "unresolved_room_cards", "interpretation"],
               campus)
    print(f"Wrote {len(detail)} division-hour rows and {len(campus)} campus-hour rows.")


if __name__ == "__main__":
    main()
