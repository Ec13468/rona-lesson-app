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

export function eventsOnDay(events, day) {
  return events.filter((e) => sameDay(e.start, day)).sort((a, b) => a.start - b.start);
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
