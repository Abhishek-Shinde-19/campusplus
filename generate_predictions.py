"""Apply trained facility models to all timetable weekday/hour combinations.

Run after train_models.py. The resulting CSV is consumed by the static dashboard.
"""
import argparse
import csv
from pathlib import Path

import joblib

ROOT = Path(__file__).resolve().parent
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
FACILITIES = ["canteen", "xerox", "library", "parking"]


def load_events(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--students-per-division", type=int, default=50)
    parser.add_argument("--exam-or-event", type=int, choices=[0, 1], default=0, help="Set to 1 only for an upcoming event day; default assumes no event.")
    parser.add_argument("--output", default="data/model_predictions.csv")
    parser.add_argument("--models-dir", default="models")
    args = parser.parse_args()
    events = load_events(ROOT / "data" / "timetable_clean.csv")
    divisions = sorted({row["division"] for row in events})
    active = {}
    for row in events:
        key = (row["day"], row["start_time"])
        active.setdefault(key, set()).add(row["division"])

    models = {}
    for target in ["occupancy_rate", "wait_minutes", "queue_length"]:
        model_path = ROOT / args.models_dir / f"{target}_random_forest.joblib"
        if model_path.exists():
            models[target] = joblib.load(model_path)["model"]
    if not models:
        raise SystemExit("No trained models found. Run train_models.py with real facility observations first.")

    rows = []
    for day_index, day in enumerate(DAYS):
        for hour in range(8, 20):
            start = f"{hour:02d}:00"
            free = len(divisions) - len(active.get((day, start), set()))
            for facility in FACILITIES:
                features = pd.DataFrame([{
                    "hour": hour,
                    "day_of_week": day_index,
                    "free_divisions": free,
                    "total_divisions": len(divisions),
                    "free_student_estimate": free * args.students_per_division,
                    "exam_or_event": args.exam_or_event,
                    "facility": facility,
                }])
                predicted = {}
                if "occupancy_rate" in models:
                    predicted["occupancy_rate"] = max(0.0, min(1.0, float(models["occupancy_rate"].predict(features)[0])))
                if "wait_minutes" in models:
                    predicted["wait_minutes"] = max(0.0, float(models["wait_minutes"].predict(features)[0]))
                if "queue_length" in models:
                    predicted["queue_length"] = max(0.0, float(models["queue_length"].predict(features)[0]))
                rows.append({
                    "day": day,
                    "start_time": start,
                    "end_time": f"{hour + 1:02d}:00",
                    "facility": facility,
                    "predicted_occupancy_rate": f"{predicted['occupancy_rate']:.4f}" if "occupancy_rate" in predicted else "",
                    "predicted_wait_minutes": f"{predicted['wait_minutes']:.2f}" if "wait_minutes" in predicted else "",
                    "predicted_queue_length": f"{predicted['queue_length']:.2f}" if "queue_length" in predicted else "",
                    "model_targets": ";".join(sorted(predicted)),
                    "note": "predicted from logged data; no absolute seat/space count without verified capacity",
                })
    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} time/facility predictions to {output} using {', '.join(sorted(models))}.")


if __name__ == "__main__":
    main()
