"""Train optional facility models after real observations have been collected.

Usage: python train_models.py data/facility_observations.csv

The web app intentionally uses a visible rule-based preview until there are
enough measured outcomes. Models are saved for reproducible offline analysis.
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parent
MIN_ROWS = 20
NUMERIC = ["hour", "day_of_week", "free_divisions", "total_divisions", "free_student_estimate", "exam_or_event"]
CATEGORICAL = ["facility"]


def prepare(path):
    data = pd.read_csv(path)
    required = {"recorded_at", "facility", "free_divisions", "total_divisions", "free_student_estimate"}
    missing = sorted(required - set(data.columns))
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")
    stamp = pd.to_datetime(data["recorded_at"], errors="coerce")
    data["hour"] = stamp.dt.hour
    data["day_of_week"] = stamp.dt.dayofweek
    data["exam_or_event"] = pd.to_numeric(data.get("exam_or_event", 0), errors="coerce")
    for column in ["free_divisions", "total_divisions", "free_student_estimate", "occupancy", "capacity", "wait_minutes", "queue_length"]:
        if column not in data:
            data[column] = np.nan
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data["occupancy_rate"] = np.where(data["capacity"] > 0, data["occupancy"] / data["capacity"], np.nan)
    data.loc[data["occupancy_rate"] > 1, "occupancy_rate"] = np.nan
    data["facility"] = data["facility"].astype("string").str.strip().str.lower()
    data.loc[data["facility"].isin(["", "nan", "<na>"]), "facility"] = pd.NA
    return data, stamp


def model_pipeline():
    features = ColumnTransformer([
        ("numeric", Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]), NUMERIC),
        ("categorical", Pipeline([("impute", SimpleImputer(strategy="most_frequent")), ("encode", OneHotEncoder(handle_unknown="ignore"))]), CATEGORICAL),
    ])
    return Pipeline([
        ("features", features),
        ("model", RandomForestRegressor(n_estimators=300, min_samples_leaf=2, max_features=0.8, random_state=42, n_jobs=-1)),
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("observations", nargs="?", default="data/facility_observations.csv")
    parser.add_argument("--output-dir", default="models")
    args = parser.parse_args()
    source = Path(args.observations)
    if not source.is_absolute():
        source = ROOT / source
    if not source.exists():
        raise SystemExit(f"Observation file not found: {source}\nCollect and export real campus measurements first.")
    data, stamps = prepare(source)
    output = Path(args.output_dir)
    if not output.is_absolute():
        output = ROOT / output
    output.mkdir(parents=True, exist_ok=True)
    metrics = {}
    trained = 0
    for target in ["occupancy_rate", "wait_minutes", "queue_length"]:
        usable = data.dropna(subset=NUMERIC + CATEGORICAL + [target]).copy()
        usable = usable.loc[stamps.loc[usable.index].notna()].sort_values("recorded_at")
        if len(usable) < MIN_ROWS:
            print(f"Skip {target}: {len(usable)} complete measurements; need at least {MIN_ROWS}.")
            continue
        split = max(1, min(len(usable) - 1, int(len(usable) * 0.8)))
        train, test = usable.iloc[:split], usable.iloc[split:]
        model = model_pipeline()
        model.fit(train[NUMERIC + CATEGORICAL], train[target])
        prediction = model.predict(test[NUMERIC + CATEGORICAL])
        baseline_prediction = np.repeat(float(train[target].mean()), len(test))
        scores = {
            "rows": int(len(usable)),
            "train_rows": int(len(train)),
            "holdout_rows": int(len(test)),
            "mae": round(float(mean_absolute_error(test[target], prediction)), 4),
            "rmse": round(float(mean_squared_error(test[target], prediction) ** 0.5), 4),
            "baseline_mean_mae": round(float(mean_absolute_error(test[target], baseline_prediction)), 4),
            "baseline_mean_rmse": round(float(mean_squared_error(test[target], baseline_prediction) ** 0.5), 4),
            "r2": round(float(r2_score(test[target], prediction)), 4) if len(test) > 1 else None,
            "validation": "chronological 80/20 holdout",
            "beats_mean_baseline_mae": bool(mean_absolute_error(test[target], prediction) < mean_absolute_error(test[target], baseline_prediction)),
        }
        model.fit(usable[NUMERIC + CATEGORICAL], usable[target])
        model_path = output / f"{target}_random_forest.joblib"
        joblib.dump({"model": model, "features": NUMERIC + CATEGORICAL, "target": target}, model_path)
        metrics[target] = scores
        trained += 1
        print(f"Trained {target}: {scores}")
    manifest = {
        "built_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else str(source),
        "trained_models": trained,
        "metrics": metrics,
        "note": "Small or biased samples do not establish reliable campus-wide performance; review holdout metrics and collect representative observations.",
    }
    (output / "training_metrics.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if not trained:
        print("No model was trained. Add at least 20 complete labeled records per target.")


if __name__ == "__main__":
    main()
