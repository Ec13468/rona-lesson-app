// 排課的計算規則（不碰畫面、不碰資料庫，方便自動測試）
// 行程格式：{ id, kind, studentId, title, start: Date, end: Date, status, deduct }

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// 一週從週一開始
export function startOfWeek(d) {
  const x = startOfDay(d);
  const back = (x.getDay() + 6) % 7;
  return addDays(x, -back);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function hhmm(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function minutesBetween(a, b) {
  return Math.round((b - a) / 60000);
}

// 月曆格子：從該月第一週的週一開始，到最後一週的週日
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days = [];
  for (let d = startOfWeek(first); d <= last || days.length % 7 !== 0; d = addDays(d, 1)) {
    days.push(d);
  }
  return days;
}

export function isActive(ev) {
  return ev.status !== "cancelled";
}

// 已經結束：手動標記上完，或時間已過
export function isFinished(ev, now) {
  return ev.status === "done" || (ev.status === "scheduled" && ev.end <= now);
}

export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

// 跟哪些行程撞期（已取消的不算，自己不算）
export function findConflicts(candidate, events) {
  return events
    .filter((e) => e.id !== candidate.id && isActive(e) && overlaps(candidate, e))
    .sort((a, b) => a.start - b.start);
}

// 某天有哪些行程（跨日的行程，經過的每一天都算）
export function eventsOnDay(events, day) {
  const from = startOfDay(day), to = addDays(from, 1);
  return events.filter((e) => e.start < to && (e.end > from || sameDay(e.start, day))).sort((a, b) => a.start - b.start);
}

// 跨日或整天的行程，在某一天要怎麼顯示時間
export function spanLabel(e, day) {
  const from = startOfDay(day), to = addDays(from, 1);
  const startsToday = e.start >= from, endsToday = e.end <= to;
  if (e.allDay || (!startsToday && !endsToday)) return { time: "整天", sub: null };
  if (startsToday && endsToday) return null; // 一般的當天行程
  if (startsToday) return { time: hhmm(e.start), sub: "開始" };
  return { time: "到 " + hhmm(e.end), sub: "結束" };
}

// ---------- 固定每週的課 ----------
// 固定課格式：{ id, kind, studentId, studioId, title, startDate: "YYYY-MM-DD", startTime: "HH:MM", durationMin, endDate, generatedUntil }

// 預先排好未來多久的課
export const SERIES_HORIZON_DAYS = 182;

export function parseDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// 從 fromKey 到 toKey（含頭尾）之間，這個固定課該上課的日期
export function occurrenceDates(series, fromKey, toKey) {
  const last = series.endDate && series.endDate < toKey ? series.endDate : toKey;
  const out = [];
  for (let d = parseDay(series.startDate); dayKey(d) <= last; d = addDays(d, 7)) {
    const k = dayKey(d);
    if (k >= fromKey) out.push(k);
  }
  return out;
}

export function buildOccurrence(series, key) {
  const [hh, mm] = series.startTime.split(":").map(Number);
  const start = parseDay(key);
  start.setHours(hh, mm, 0, 0);
  return {
    id: null,
    kind: series.kind,
    studentId: series.kind === "lesson" ? series.studentId : null,
    studioId: series.kind === "studio" ? series.studioId : null,
    courseId: series.kind === "studio" ? series.courseId ?? null : null,
    singlePrice: series.kind === "lesson" ? series.singlePrice ?? null : null,
    title: series.title ?? "",
    start,
    end: new Date(start.getTime() + series.durationMin * 60000),
    status: "scheduled",
    deduct: true,
    note: "",
    seriesId: series.id,
    occurrenceDate: key,
  };
}

// 還沒排出來、需要補上的每一堂（只補 generatedUntil 之後，刪掉的單堂不會再長回來）
export function pendingOccurrences(series, untilKey) {
  const from = series.generatedUntil ? dayKey(addDays(parseDay(series.generatedUntil), 1)) : series.startDate;
  if (from > untilKey) return [];
  return occurrenceDates(series, from, untilKey).map((k) => buildOccurrence(series, k));
}

export function dayBefore(key) {
  return dayKey(addDays(parseDay(key), -1));
}

const isClass = (e) => e.kind === "lesson" || e.kind === "studio";

// 首頁：今天還沒結束的行程
// state：none＝今天沒有課、done＝今天的課都上完了、upcoming＝還有課
export function todayView(events, now, showPersonal) {
  const today = eventsOnDay(events, now).filter(isActive);
  const classes = today.filter(isClass);
  const upcoming = today.filter((e) => !isFinished(e, now) && (isClass(e) || showPersonal));
  const classesLeft = classes.filter((e) => !isFinished(e, now));
  let state = "upcoming";
  if (classes.length === 0) state = "none";
  else if (classesLeft.length === 0) state = "done";
  return { upcoming, state, classesLeft: classesLeft.length };
}
