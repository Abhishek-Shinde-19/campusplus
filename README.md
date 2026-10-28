# CAMPUSPULSE

**Smart Campus Crowd & Facility Prediction System** is a timetable-aware prototype for campus demand and study-room discovery. It estimates when divisions have no detected class, highlights classroom candidates, and gives relative facility-pressure previews. It does not track individual students.

## Run the web app

Use Python 3 from this project folder:

```powershell
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). The app reads `data/timetable_clean.csv`. Browsers need the local server for this CSV fetch; opening `index.html` directly will not load it.

## What works in this prototype

- **Timetable pulse:** select a day, date, and hour to see divisions with no detected class card. The hourly chart shows the week’s timetable-derived free-division pattern.
- **Study-room finder:** lists rooms with no class assigned in the uploaded Computer Science timetable during the selected one-hour block. It excludes times outside Monday–Saturday, 08:00–20:00.
- **Study planning:** require 1–4 consecutive free hours, search by room code, save favorite rooms, and click the weekly heatmap to jump to a day/time.
- **Facility outlook:** provides transparent low/moderate/high relative pressure previews for the canteen, Xerox center, library, and parking. The calculation combines the share of divisions without a detected class card with a simple time-of-day weight. It does not claim to predict wait minutes, seat counts, or parking spaces.
- **Observation collection:** enter measured facility occupancy/capacity, wait, or queue counts. Entries stay in this browser’s local storage. Export them to CSV before moving to the training pipeline.
- **Feature engineering:** build division-hour and campus-hour feature tables from the cleaned timetable.
- **Optional machine learning:** train occupancy-rate, wait-time, and queue-length regression models when enough real labeled observations exist.
- **EDA report:** summarizes actual timetable distributions, availability proxies, and extraction gaps without fabricating facility outcomes.

## Data sources and limitations

`data/timetable_clean.csv` contains 1,396 extracted class-card records across 30 divisions, Monday–Saturday, with 12 one-hour slots per day. The timetable is a weekly schedule. It does not provide division strength, facility measurements, room capacity, building/location, room reservations, exam/event calendars, or schedules for other departments.

The room finder can only identify **candidate-free rooms** using this Computer Science schedule. A room with no class listed might be used by another department, booked for an event, or unavailable. Check the room in person or against a current reservation source before treating it as free. At the selected time, missing or uncertain room assignments are surfaced as a data-quality limitation.

Some batch labels could not be read from the source scan. A division with any detected class card is treated as active for the full division-hour, even if a lab card applies to only one batch. Thus the “free students” number is an editable illustrative proxy (`assumed students per division`, default 50), not a measured headcount. Add verified division counts and batch schedules before using it for operational decisions.

Facility measurements were not included in the supplied data. Therefore, the dashboard labels its levels as a rule-based preview and requires observation data before trained facility predictions or quantitative waits/occupancy can be justified. Observations saved in the browser are local to that browser until exported.

## Data science workflow

1. **Collect:** timetable plus observed crowd, queue, wait, occupancy, capacity, and event information. Start with `data/facility_observations_template.csv`; do not include student names or personal identifiers.
2. **Clean:** the timetable export has been normalized in `data/timetable_clean.csv`. Review room and batch statuses before interpreting affected records.
3. **Explore and engineer features:** run:

   ```powershell
   python scripts/build_features.py
   ```

   This creates `data/division_hour_features.csv` and `data/campus_hour_features.csv`. They include timetable presence, class-card counts, activity types, known room codes, source pages, and the ratio of divisions without detected class cards. The ratio is a proxy, not a student count.

4. **Train and evaluate:** export observations from the dashboard, save the file as `data/facility_observations.csv`, then run:

   ```powershell
   python -m pip install -r requirements.txt
   python train_models.py
   python generate_predictions.py
   ```

   Models are fit separately for occupancy rate, wait minutes, and queue length when at least 20 complete labeled records are available for a target. Evaluation uses a chronological 80/20 holdout and compares MAE/RMSE with a training-mean baseline; results and R² are written to `models/training_metrics.json`. `generate_predictions.py` writes `data/model_predictions.csv`; reload the dashboard to use any available model outputs. For known exam/event days, pass `--exam-or-event 1`. Review sample sizes and holdout errors before using predictions operationally. No trained model or model-accuracy claim is included until facility measurements exist.

## Project flow

```text
Timetable → free-division proxy → estimated available students
          → relative facility-pressure preview
          → candidate-free room list

Observed facility data → feature engineering → chronological model evaluation
                      → occupancy / wait / queue models
```

## Main files

- `index.html`, `styles.css`, `app.js` — responsive CAMPUSPULSE dashboard.
- `data/timetable_clean.csv` — normalized timetable events.
- `data/classroom_availability_template.csv` — room-slot view derived from known room assignments.
- `data/facility_observations_template.csv` — historical measurement schema.
- `scripts/build_features.py` — timetable feature generation.
- `scripts/run_eda.py` — descriptive analysis and report generation.
- `reports/EDA_Report.md` — data-backed EDA findings and limitations.
- `train_models.py` — optional, reproducible model training and evaluation.
- `generate_predictions.py` — scores the weekly timetable with available trained models for dashboard use.
