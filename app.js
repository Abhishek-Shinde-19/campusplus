const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DIVISION_COUNT = 30;
const STORAGE_KEY = "campuspulse.observations.v1";
const FAVORITES_KEY = "campuspulse.favoriteRooms.v1";
let sessions = [];
let modelPredictions = [];
let favoritesOnly = false;
let assumedStudents = Number(localStorage.getItem("campuspulse.assumedStudents") || 50);
let toastTimer;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const timeText = (hour) => `${pad(hour)}:00`;
const dayName = (date) => new Intl.DateTimeFormat("en", { weekday: "long" }).format(date);
const dateLong = (date) => new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
const parseTime = (value) => Number(String(value || "").slice(0, 2));

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); if (row.some((v) => v !== "")) rows.push(row);
      row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map((h) => h.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, (values[i] || "").trim()])));
}

function localDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getSelected() {
  const date = new Date(`${$("date-input").value}T12:00:00`);
  const hour = Number($("time-input").value.slice(0, 2));
  const valid = !Number.isNaN(date.valueOf()) && !Number.isNaN(hour);
  return { date, day: valid ? dayName(date) : "", hour, valid };
}

function isCovered({ day, hour }) { return DAYS.includes(day) && hour >= 8 && hour < 20; }
function eventsAt(day, hour) { return sessions.filter((s) => s.day === day && parseTime(s.start_time) <= hour && parseTime(s.end_time) > hour); }
function getDivisionActivity(day, hour) {
  const events = eventsAt(day, hour);
  const busy = new Set(events.map((e) => e.division));
  return { events, busy, free: Math.max(0, DIVISION_COUNT - busy.size) };
}

function showToast(message) {
  const toast = $("toast"); toast.textContent = message; toast.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function fillDaySelect() {
  const select = $("day-select");
  select.innerHTML = DAYS.map((day) => `<option value="${day}">${day}</option>`).join("");
  const today = dayName(new Date());
  select.value = DAYS.includes(today) ? today : "Monday";
}

function chartForDay(day) {
  const svg = $("activity-chart");
  const left = 39, right = 663, top = 12, bottom = 172, width = right - left, height = bottom - top;
  const points = [];
  for (let hour = 8; hour < 20; hour++) {
    const free = getDivisionActivity(day, hour).free;
    points.push({ hour, free, x: left + ((hour - 8) / 11) * width, y: bottom - (free / DIVISION_COUNT) * height });
  }
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${right},${bottom} L${left},${bottom} Z`;
  const current = getSelected();
  const grids = [0, 10, 20, 30].map((n) => {
    const y = bottom - (n / DIVISION_COUNT) * height;
    return `<line class="chart-gridline" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="chart-axis" x="${left - 14}" y="${y + 3}" text-anchor="end">${n}</text>`;
  }).join("");
  const labels = points.filter((p) => p.hour % 2 === 0).map((p) => `<text class="chart-axis" x="${p.x}" y="196" text-anchor="middle">${pad(p.hour)}</text>`).join("");
  const dots = points.map((p) => `<circle class="chart-point ${current.day === day && current.hour === p.hour ? "current" : ""}" cx="${p.x}" cy="${p.y}" r="${current.day === day && current.hour === p.hour ? 5 : 2.6}"><title>${timeText(p.hour)} · ${p.free} divisions without a detected class</title></circle>`).join("");
  svg.innerHTML = `<defs><linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6481f4" stop-opacity=".22"/><stop offset="100%" stop-color="#6481f4" stop-opacity=".015"/></linearGradient></defs>${grids}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${dots}${labels}`;
  const outOfCoverage = !DAYS.includes(day);
  $("chart-note").textContent = outOfCoverage ? "Sunday isn’t included in the supplied timetable" : "One-hour slots · source timetable";
  if (outOfCoverage) svg.innerHTML = `<text class="chart-axis" x="340" y="94" text-anchor="middle">No Sunday timetable data</text>`;
}

function renderEda() {
  const types = new Map();
  const rooms = { extracted: 0, not_specified_in_source: 0, needs_verification: 0 };
  const batches = { verified_ocr: 0, needs_verification: 0 };
  const activeBySlot = new Map();
  for (const row of sessions) {
    types.set(row.activity_type, (types.get(row.activity_type) || 0) + 1);
    if (Object.hasOwn(rooms, row.room_status)) rooms[row.room_status]++;
    if (Object.hasOwn(batches, row.batch_status)) batches[row.batch_status]++;
    const key = `${row.day}|${row.start_time}`;
    if (!activeBySlot.has(key)) activeBySlot.set(key, new Set());
    activeBySlot.get(key).add(row.division);
  }
  const total = sessions.length || 1;
  $("activity-bars").innerHTML = [...types.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => {
    const percent = count / total * 100;
    return `<div class="activity-row"><span>${escapeHtml(type)}</span><div class="activity-track"><span style="width:${percent}%"></span></div><b>${count.toLocaleString()} · ${percent.toFixed(1)}%</b></div>`;
  }).join("");
  $("quality-list").innerHTML = [
    ["Timetable class cards", sessions.length.toLocaleString()],
    ["Divisions", new Set(sessions.map((row) => row.division)).size],
    ["Readable room labels", `${rooms.extracted.toLocaleString()} · 24 codes`],
    ["Room missing / uncertain", `${(rooms.not_specified_in_source + rooms.needs_verification).toLocaleString()} records`],
    ["Batch labels OCR-verified", `${batches.verified_ocr} · ${batches.needs_verification.toLocaleString()} need review`],
  ].map(([label, value]) => `<div class="quality-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join("");
  let busiest = { count: -1, day: "", hour: "" };
  for (const [key, divisions] of activeBySlot) {
    if (divisions.size > busiest.count) {
      const [day, hour] = key.split("|");
      busiest = { count: divisions.size, day, hour };
    }
  }
  const free = DIVISION_COUNT - Math.max(0, busiest.count);
  $("eda-takeaway").innerHTML = `<b>Schedule signal:</b> ${busiest.count} of ${DIVISION_COUNT} divisions have a detected class card at ${escapeHtml(busiest.day)} ${escapeHtml(busiest.hour)}; ${free} have none detected. This is a timetable proxy, not measured attendance.`;
  renderWeeklyHeatmap();
}

function renderWeeklyHeatmap() {
  const root = $("weekly-heatmap");
  if (!root) return;
  const selected = getSelected();
  const columns = `<div class="heat-day-label"></div>${Array.from({ length: 12 }, (_, i) => `<div class="heat-hour-label">${pad(i + 8)}</div>`).join("")}`;
  root.innerHTML = `<div class="heatmap-row">${columns}</div>${DAYS.map((day) => {
    const cells = Array.from({ length: 12 }, (_, i) => {
      const hour = i + 8, free = getDivisionActivity(day, hour).free, ratio = free / DIVISION_COUNT;
      const level = ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
      const active = selected.valid && selected.day === day && selected.hour === hour;
      return `<button type="button" class="heat-cell heat-${level}${active ? " selected" : ""}" data-day="${day}" data-hour="${hour}" title="${day} ${timeText(hour)}: ${free} of ${DIVISION_COUNT} divisions have no detected class" aria-label="${day} ${timeText(hour)}, ${free} divisions without a detected class">${free}</button>`;
    }).join("");
    return `<div class="heatmap-row"><div class="heat-day-label">${day.slice(0, 3)}</div>${cells}</div>`;
  }).join("")}`;
}

function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveFavorites(favorites) { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); }

function renderRooms(day, hour, covered) {
  const roomNames = [...new Set(sessions.filter((s) => s.room && s.room_status === "extracted").map((s) => s.room))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const duration = Number($("room-duration").value || 1);
  const withinCoverage = covered && hour + duration <= 20;
  const windowEvents = withinCoverage ? sessions.filter((s) => s.day === day && parseTime(s.start_time) < hour + duration && parseTime(s.end_time) > hour) : [];
  const taken = new Set(windowEvents.filter((e) => e.room && e.room_status === "extracted").map((e) => e.room));
  const candidates = roomNames.filter((room) => !taken.has(room));
  const unresolved = windowEvents.filter((e) => e.room_status !== "extracted").length;
  const favoriteRooms = loadFavorites();
  const query = $("room-search").value.trim().toLowerCase();
  const filtered = candidates
    .filter((room) => !query || room.toLowerCase().includes(query))
    .filter((room) => !favoritesOnly || favoriteRooms.has(room))
    .sort((a, b) => Number(favoriteRooms.has(b)) - Number(favoriteRooms.has(a)) || a.localeCompare(b, undefined, { numeric: true }));
  $("nav-room-count").textContent = roomNames.length;
  $("room-footer-text").textContent = `${roomNames.length} room codes found in the timetable`;
  if (!withinCoverage) {
    $("rooms-value").textContent = "—";
    $("rooms-caption").textContent = covered ? "Study window ends after 20:00" : "Outside timetable coverage";
    $("room-subtitle").textContent = covered ? "Choose an earlier start or a shorter study duration." : "No room availability can be inferred for this day or hour.";
    $("rooms-list").innerHTML = `<div class="empty-state">${covered ? "This study window extends beyond 20:00, the end of the supplied timetable." : "The uploaded schedule covers Monday–Saturday, 08:00–20:00. This time is outside that range."}</div>`;
    return;
  }
  $("rooms-value").textContent = String(candidates.length);
  $("rooms-caption").textContent = `Candidates free for ${duration} hour${duration === 1 ? "" : "s"}`;
  $("room-subtitle").textContent = `${dateLong(getSelected().date)} · ${timeText(hour)}–${timeText(hour + duration)} · timetable-based candidates`;
  if (unresolved) {
    $("room-footer-text").textContent = `${unresolved} class card${unresolved === 1 ? "" : "s"} in this window have a missing or uncertain room code`;
  }
  if (!filtered.length) {
    const message = favoritesOnly && !query ? "No favorite rooms match this time. Star a room to save it here." : query ? `No candidate room matches “${escapeHtml(query)}”.` : `Every identifiable room has a scheduled class during this ${duration}-hour window. Try another time.`;
    $("rooms-list").innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }
  $("rooms-list").innerHTML = filtered.map((room) => `<div class="room-card"><div class="room-card-top"><b>${escapeHtml(room)}</b><button type="button" class="favorite-room ${favoriteRooms.has(room) ? "saved" : ""}" data-favorite-room="${escapeHtml(room)}" aria-label="${favoriteRooms.has(room) ? "Remove" : "Add"} ${escapeHtml(room)} ${favoriteRooms.has(room) ? "from" : "to"} favorites" aria-pressed="${favoriteRooms.has(room)}">${favoriteRooms.has(room) ? "★" : "☆"}</button></div><span class="room-card-time"><i class="room-status-dot"></i> No listed class · ${timeText(hour)}–${timeText(hour + duration)}</span></div>`).join("");
}

function pressureScore(freeRatio, hour, facility) {
  let factor = 1;
  if (facility === "canteen") factor = hour >= 11 && hour < 14 ? 1.28 : hour >= 16 && hour < 18 ? 1.08 : 0.78;
  if (facility === "xerox") factor = [9, 10, 12, 13, 15, 16].includes(hour) ? 1.16 : 0.82;
  if (facility === "library") factor = hour >= 12 && hour < 17 ? 1.12 : hour < 10 ? 0.8 : 0.94;
  if (facility === "parking") factor = hour >= 8 && hour < 10 ? 1.25 : hour >= 17 ? 0.72 : 0.9;
  return Math.max(0, Math.min(100, Math.round(freeRatio * factor * 100)));
}

function updateFacilityCard(name, score, freeDivisions, hour) {
  const tier = score >= 67 ? "High" : score >= 38 ? "Moderate" : "Low";
  const bar = $(`${name}-bar`); bar.style.width = `${Math.max(5, score)}%`;
  bar.className = score >= 67 ? "high" : score >= 38 ? "medium" : "";
  const selected = getSelected();
  const prediction = modelPredictions.find((p) => p.day === selected.day && parseTime(p.start_time) === hour && p.facility === name);
  const occupancy = prediction?.predicted_occupancy_rate === "" || !prediction ? NaN : Number(prediction.predicted_occupancy_rate);
  const wait = prediction?.predicted_wait_minutes === "" || !prediction ? NaN : Number(prediction.predicted_wait_minutes);
  const queue = prediction?.predicted_queue_length === "" || !prediction ? NaN : Number(prediction.predicted_queue_length);
  if (Number.isFinite(occupancy)) {
    const percent = Math.round(Math.max(0, Math.min(1, occupancy)) * 100);
    $(`${name}-result`).textContent = `${percent}% predicted occupancy`;
    bar.style.width = `${Math.max(5, percent)}%`;
    bar.className = percent >= 75 ? "high" : percent >= 45 ? "medium" : "";
  } else {
    $(`${name}-result`).textContent = `${tier} potential`;
  }
  const details = [];
  if (Number.isFinite(occupancy)) details.push(`${Math.round(Math.max(0, Math.min(1, occupancy)) * 100)}% occupancy`);
  if (Number.isFinite(wait)) details.push(`~${Math.max(0, Math.round(wait))} min wait`);
  if (Number.isFinite(queue)) details.push(`~${Math.max(0, Math.round(queue))} in queue`);
  $(`${name}-copy`).textContent = details.length
    ? `Trained model estimate · ${details.join(" · ")}`
    : `${freeDivisions} divisions without a detected class · ${timeText(hour)} weighting`;
  const dataValue = $(`${name}-measure`);
  if (dataValue) {
    if (name === "canteen" && Number.isFinite(wait)) dataValue.textContent = `~${Math.max(0, Math.round(wait))} min wait predicted`;
    else if (name === "xerox" && Number.isFinite(wait)) dataValue.textContent = `~${Math.max(0, Math.round(wait))} min wait predicted`;
    else if (name === "xerox" && Number.isFinite(queue)) dataValue.textContent = `~${Math.max(0, Math.round(queue))} jobs predicted`;
    else if (Number.isFinite(occupancy)) dataValue.textContent = "absolute seats/spaces need capacity";
    else dataValue.textContent = name === "library" ? "needs seat counts" : name === "parking" ? "needs occupancy logs" : "needs historical logs";
  }
}

function updateDashboard() {
  if (!sessions.length) return;
  const selected = getSelected();
  if (selected.valid && DAYS.includes(selected.day)) $("day-select").value = selected.day;
  const covered = selected.valid && isCovered(selected);
  const { events, free } = selected.valid ? getDivisionActivity(selected.day, selected.hour) : { events: [], free: 0 };
  const freeStudents = free * assumedStudents;
  $("free-divisions-value").innerHTML = covered ? `${free}<small> / 30</small>` : `—<small> / 30</small>`;
  $("free-divisions-caption").textContent = covered ? `${DIVISION_COUNT - free} divisions with a detected class` : "Outside timetable coverage";
  $("free-students-value").textContent = covered ? freeStudents.toLocaleString() : "—";
  $("student-caption").textContent = `Assumes ${assumedStudents} students per division`;
  $("selected-time-label").textContent = selected.valid ? `${dateLong(selected.date)} · ${selected.day} · ${timeText(selected.hour)}` : "Choose a valid date and time";
  renderRooms(selected.day, selected.hour, covered);
  if (covered) {
    const ratio = free / DIVISION_COUNT;
    ["canteen", "xerox", "library", "parking"].forEach((name) => updateFacilityCard(name, pressureScore(ratio, selected.hour, name), free, selected.hour));
  } else {
    ["canteen", "xerox", "library", "parking"].forEach((name) => {
      $(`${name}-result`).textContent = "No timetable estimate";
      $(`${name}-bar`).style.width = "4%";
      $(`${name}-copy`).textContent = "The selected time isn’t covered by this timetable.";
      const dataValue = $(`${name}-measure`);
      if (dataValue) dataValue.textContent = "no schedule data";
    });
  }
  chartForDay($("day-select").value);
  renderWeeklyHeatmap();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function loadObservations() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function updateObservationCount() { $("observation-count").textContent = loadObservations().length; }

function wireForm() {
  const now = new Date();
  $("date-input").value = localDateInput(now);
  $("time-input").value = `${pad(now.getHours())}:00`;
  $("obs-date").value = localDateInput(now);
  $("obs-time").value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $("strength-value").textContent = assumedStudents;
  ["date-input", "time-input"].forEach((id) => $(id).addEventListener("input", updateDashboard));
  $("day-select").addEventListener("change", () => chartForDay($("day-select").value));
  $("room-search").addEventListener("input", updateDashboard);
  $("room-duration").addEventListener("change", updateDashboard);
  $("favorites-only").addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    $("favorites-only").setAttribute("aria-pressed", String(favoritesOnly));
    $("favorites-only").classList.toggle("active", favoritesOnly);
    $("favorites-only").textContent = `${favoritesOnly ? "★" : "☆"} ${favoritesOnly ? "Showing favorites" : "Favorites only"}`;
    updateDashboard();
  });
  $("rooms-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-favorite-room]");
    if (!button) return;
    const favorites = loadFavorites(), room = button.dataset.favoriteRoom;
    if (favorites.has(room)) favorites.delete(room); else favorites.add(room);
    saveFavorites(favorites); updateDashboard();
    showToast(`${room} ${favorites.has(room) ? "added to" : "removed from"} favorites.`);
  });
  $("weekly-heatmap").addEventListener("click", (event) => {
    const cell = event.target.closest("[data-day][data-hour]");
    if (!cell) return;
    const day = cell.dataset.day, hour = Number(cell.dataset.hour), now = new Date();
    const delta = (DAYS.indexOf(day) - now.getDay() + 7) % 7;
    now.setDate(now.getDate() + delta);
    $("date-input").value = localDateInput(now);
    $("time-input").value = `${pad(hour)}:00`;
    $("day-select").value = day;
    updateDashboard();
    $("rooms").scrollIntoView({ behavior: "smooth" });
  });
  $("strength-minus").addEventListener("click", () => setStrength(assumedStudents - 5));
  $("strength-plus").addEventListener("click", () => setStrength(assumedStudents + 5));
  $("find-room-button").addEventListener("click", () => { $("rooms").scrollIntoView({ behavior: "smooth" }); });
  $("refresh-button").addEventListener("click", () => {
    const current = new Date();
    $("date-input").value = localDateInput(current);
    $("time-input").value = `${pad(current.getHours())}:00`;
    $("day-select").value = DAYS.includes(dayName(current)) ? dayName(current) : "Monday";
    updateDashboard(); showToast("Dashboard refreshed for the current time.");
  });
  $("observation-form").addEventListener("submit", saveObservation);
  $("download-observations").addEventListener("click", exportObservations);
  $("clear-observations").addEventListener("click", () => {
    if (loadObservations().length && confirm("Clear all observations saved in this browser?")) {
      localStorage.removeItem(STORAGE_KEY); updateObservationCount(); showToast("Saved observations cleared.");
    }
  });
  $("observation-form").querySelectorAll("input,select").forEach((input) => input.addEventListener("change", () => {}));
}

function setStrength(value) {
  assumedStudents = Math.max(10, Math.min(150, value));
  localStorage.setItem("campuspulse.assumedStudents", assumedStudents);
  $("strength-value").textContent = assumedStudents; updateDashboard();
}

function saveObservation(event) {
  event.preventDefault();
  const selected = getSelected();
  const date = $("obs-date").value, time = $("obs-time").value;
  const obsDate = new Date(`${date}T12:00:00`);
  const hour = Number(time.slice(0, 2));
  const { free } = getDivisionActivity(dayName(obsDate), hour);
  const optionalNumber = (id) => $(id).value === "" ? "" : Number($(id).value);
  const entry = {
    recorded_at: `${date}T${time}:00`, facility: $("obs-facility").value,
    occupancy: optionalNumber("obs-occupancy"), capacity: optionalNumber("obs-capacity"),
    wait_minutes: optionalNumber("obs-wait"), queue_length: optionalNumber("obs-queue"),
    free_divisions: isCovered({ day: dayName(obsDate), hour }) ? free : "",
    total_divisions: isCovered({ day: dayName(obsDate), hour }) ? DIVISION_COUNT : "",
    free_student_estimate: isCovered({ day: dayName(obsDate), hour }) ? free * assumedStudents : "",
    exam_or_event: $("obs-event").checked ? 1 : 0,
    notes: $("obs-notes").value.trim(),
  };
  if (![entry.occupancy, entry.wait_minutes, entry.queue_length].some((n) => n !== "")) {
    showToast("Add at least one observed count, wait, or queue value."); return;
  }
  const records = loadObservations(); records.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  updateObservationCount(); $("observation-form").reset();
  $("obs-date").value = localDateInput(new Date());
  $("obs-time").value = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  showToast("Observation saved in this browser.");
}

function csvCell(value) {
  const str = String(value ?? "");
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
function exportObservations() {
  const records = loadObservations();
  if (!records.length) { showToast("No observations to export yet."); return; }
  const fields = ["recorded_at", "facility", "occupancy", "capacity", "wait_minutes", "queue_length", "free_divisions", "total_divisions", "free_student_estimate", "exam_or_event", "notes"];
  const csv = [fields.join(","), ...records.map((r) => fields.map((f) => csvCell(r[f])).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  link.download = "campuspulse_observations.csv"; link.click(); URL.revokeObjectURL(link.href);
  showToast(`Exported ${records.length} observation${records.length === 1 ? "" : "s"}.`);
}

function updateClock() {
  const now = new Date();
  $("today-label").textContent = dateLong(now);
  $("clock-label").textContent = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: true }).format(now);
}

async function start() {
  fillDaySelect(); wireForm(); updateClock(); updateObservationCount();
  try {
    const response = await fetch("data/timetable_clean.csv");
    if (!response.ok) throw new Error(`Could not load timetable (${response.status})`);
    sessions = parseCsv(await response.text());
    if (!sessions.length) throw new Error("The timetable file has no event rows.");
    renderEda();
    try {
      const modelResponse = await fetch("data/model_predictions.csv");
      if (modelResponse.ok) {
        modelPredictions = parseCsv(await modelResponse.text());
        if (modelPredictions.some((row) => row.predicted_occupancy_rate || row.predicted_wait_minutes || row.predicted_queue_length)) {
          $("forecast-badge").innerHTML = "<i></i> TRAINED MODEL";
          $("forecast-badge").classList.add("model-ready");
          const notice = document.querySelector(".notice");
          notice.querySelector("b").textContent = "Facility models trained";
          notice.querySelector("span:not(.notice-icon)").textContent = "The selected time uses saved model outputs trained from logged campus observations.";
        }
      }
    } catch { modelPredictions = []; }
    updateDashboard();
  } catch (error) {
    $("rooms-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message)} Start the app with the local server command in README.md.</div>`;
    $("rooms-caption").textContent = "Timetable not loaded";
  }
  setInterval(updateClock, 30_000);
}

document.addEventListener("DOMContentLoaded", start);
