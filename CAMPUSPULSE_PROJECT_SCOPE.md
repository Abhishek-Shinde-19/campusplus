# CAMPUSPULSE

## Smart Campus Crowd & Facility Prediction System

### Project objective

CAMPUSPULSE estimates campus activity from the Computer Science timetable and helps students choose when to visit shared facilities or study in a classroom with no class listed. It combines schedule-derived features with facility measurements collected over time. It does not track or identify individual students.

### Problem

Students often do not know whether the canteen or Xerox center will be busy, whether the library may have seats, or whether parking may be near capacity. Activity changes as divisions finish classes and enter free periods. A timetable can provide a useful campus-specific demand signal, but it cannot show actual attendance or facility usage by itself.

### Implemented application

- **Campus activity:** view division-level timetable presence by weekday and hour.
- **Free-student proxy:** multiply divisions with no detected class card by an editable assumed division strength. The default of 50 is an illustrative assumption, not an official enrolment count.
- **Study-room finder:** list known room codes with no class assigned across a selected 1–4-hour timetable window. Search by room code, save favorite rooms, and use the weekly heatmap to jump to a day and time. It is available only Monday–Saturday, 08:00–20:00.
- **Facility outlook:** show relative rule-based pressure until measured facility outcomes are collected.
- **Observation logging:** collect date/time, facility, occupancy/capacity, wait, queue, and event flag. The current web app stores entries in that browser until exported as CSV.

### Supplied timetable data

The cleaned extract has 1,396 class-card records across 30 divisions, Monday–Saturday, with 12 one-hour slots per day. It contains 622 lab, 561 theory, and 213 tutorial records. There are 1,175 readable room labels across 24 room codes; 168 source rows do not specify a room and 53 room labels need verification. Only 34 batch labels were readable; 1,362 need review.

The timetable supports recurring schedule analysis and room-candidate filtering. It does not include division headcounts, student attendance, facility measurements, room capacity or locations, exam calendars, live bookings, or other departments' schedules. A room shown as a candidate may be in use for another purpose; verify it before occupying it.

### Data science workflow

1. **Collect and clean:** use `data/timetable_clean.csv`; collect facility observations in the dashboard or from an approved manual count process. Do not collect student names or individual movement data.
2. **Explore:** `reports/EDA_Report.md` describes the available data and its quality. `scripts/run_eda.py` regenerates the report and hourly summary.
3. **Engineer features:** `scripts/build_features.py` creates division-hour and campus-hour tables. Candidate predictors include day of week, hour, divisions without a detected class, an explicitly assumed headcount proxy, facility, and an exam/event flag.
4. **Train:** `train_models.py` fits separate Random Forest regression models for occupancy rate, wait minutes, and queue length once each target has at least 20 complete measured records.
5. **Evaluate:** models use a chronological 80/20 holdout and are compared with a mean baseline. MAE, RMSE, and R² are saved in `models/training_metrics.json`. Sparse or biased observations are not sufficient evidence for deployment.
6. **Predict:** `generate_predictions.py` scores weekday/hour/facility combinations and writes `data/model_predictions.csv`, which the dashboard reads when model outputs exist.

### Current model status

No facility observation history was supplied, so there are no trained facility models or accuracy results yet. The live dashboard labels its facility cards as a rule-based preview until observation data is logged, exported, and used to train/evaluate the models. It does not invent waits, occupied seats, or available parking spaces. Absolute seats/spaces also require verified facility capacities.

### Example explanation

“CAMPUSPULSE uses the Computer Science timetable to estimate how many divisions may be free, then combines those schedule features with observed facility data to predict relative crowding, wait, and occupancy. It also lists classroom candidates that have no class in the timetable for the selected slot.”

### Project files

- `index.html`, `styles.css`, `app.js` — web application.
- `data/timetable_clean.csv` — normalized source schedule.
- `data/classroom_availability_template.csv` — derived room/time view.
- `data/facility_observations_template.csv` — measurement schema.
- `data/division_hour_features.csv`, `data/campus_hour_features.csv` — engineered schedule features.
- `data/timetable_hourly_summary.csv`, `data/timetable_eda_summary.json`, `reports/EDA_Report.md` — EDA outputs.
- `train_models.py`, `generate_predictions.py` — optional train/evaluate and prediction generation steps.
- `README.md` — run and data workflow instructions.
