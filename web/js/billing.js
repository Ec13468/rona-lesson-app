// 學生扣堂、收入與教室鐘點費的計算規則（不碰畫面、不碰資料庫，方便自動測試）
import { isFinished, dayKey, addDays, startOfDay, parseDay } from "./logic.js?v=dev";

export const EXPIRY_WARN_DAYS = 14;
const EPS = 1e-9;

// 這堂一對一課要不要扣堂數：時間過了且沒取消，或取消時選了「扣堂數」
export function consumes(e, now) {
  if (e.kind !== "lesson") return false;
  if (e.status === "cancelled") return !!e.deduct;
  return isFinished(e, now);
}

// 一堂課算幾堂：照時數，1 小時＝1 堂，1.5 小時＝1.5 堂
export function lessonUnits(e) {
  return Math.round(((e.end - e.start) / 3600000) * 100) / 100;
}

// 堂數顯示：整數就寫整數，有小數寫一位
export function unitsText(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// 依時間順序分配每堂課：
// 單堂付費＝每小時金額 × 時數；其他照時數扣方案（先扣最早買的，可以跨兩個方案）；方案不夠的部分是沒付費
function allocate(packages, lessons) {
  const pk = [...packages]
    .sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((p) => ({ ...p, used: 0, value: p.price / p.lessons }));
  const history = [];
  for (const e of [...lessons].sort((a, b) => a.start - b.start)) {
    const units = lessonUnits(e);
    if (e.singlePrice != null) {
      history.push({ event: e, units, source: "single", amount: e.singlePrice * units, unpaidUnits: 0 });
      continue;
    }
    let need = units, amount = 0;
    const from = [];
    for (const p of pk) {
      if (need <= EPS) break;
      const take = Math.min(need, p.lessons - p.used);
      if (take <= EPS) continue;
      p.used += take; need -= take; amount += take * p.value;
      from.push(p.id);
    }
    const unpaidUnits = need > EPS ? need : 0;
    history.push({
      event: e, units, amount, unpaidUnits, packageIds: from,
      source: unpaidUnits ? (from.length ? "partial" : "unpaid") : "package",
      leftAfter: pk.reduce((n, p) => n + (p.lessons - p.used), 0),
    });
  }
  return { pk, history };
}

const bookedOf = (mine, now) => mine.filter((e) => e.status === "scheduled" && !isFinished(e, now));

// 學生的扣堂與收入
// packages：[{ id, lessons, price, purchasedOn, expiresOn, createdAt }]
export function studentSummary(student, packages, events, now) {
  const mine = events.filter((e) => e.kind === "lesson" && e.studentId === student.id);
  const consumed = mine.filter((e) => consumes(e, now));
  const booked = bookedOf(mine, now);
  const bookedUnits = booked.filter((e) => e.singlePrice == null).reduce((n, e) => n + lessonUnits(e), 0);
  const { pk, history } = allocate(packages, consumed);
  const unpaid = history.filter((h) => h.unpaidUnits > 0).length;
  const income = history.reduce((n, h) => n + h.amount, 0);

  const remaining = Math.max(0, pk.reduce((n, p) => n + (p.lessons - p.used), 0));
  const today = dayKey(startOfDay(now));
  const warnUntil = dayKey(addDays(startOfDay(now), EXPIRY_WARN_DAYS));
  const alerts = [];

  if (unpaid > 0) alerts.push({ level: "warn", text: `有 ${unpaid} 堂課沒有方案可以扣，請提醒繳費` });
  else if (remaining < EPS && (pk.length > 0 || bookedUnits > 0)) alerts.push({ level: "warn", text: "方案已用完，請提醒繳費" });
  if (remaining > EPS && remaining <= 1 + EPS) alerts.push({ level: "warn", text: `方案只剩 ${unitsText(remaining)} 堂，快用完了` });
  for (const p of pk) {
    const left = p.lessons - p.used;
    if (!p.expiresOn || left <= EPS) continue;
    const md = `${parseDay(p.expiresOn).getMonth() + 1}/${parseDay(p.expiresOn).getDate()}`;
    if (p.expiresOn < today) alerts.push({ level: "info", text: `有方案已在 ${md} 到期，還剩 ${unitsText(left)} 堂可以上` });
    else if (p.expiresOn <= warnUntil) alerts.push({ level: "warn", text: `方案 ${md} 到期，還剩 ${unitsText(left)} 堂` });
  }

  return {
    attended: consumed.length,
    attendedUnits: consumed.reduce((n, e) => n + lessonUnits(e), 0),
    booked: booked.length,
    remaining,
    available: remaining - bookedUnits, // 扣掉已預約（要扣方案的）後還能排幾堂
    income: Math.round(income),
    paid: packages.reduce((n, p) => n + p.price, 0),
    unpaid,
    packages: pk.map((p) => ({ ...p, left: p.lessons - p.used })),
    history: history.sort((a, b) => a.event.start - b.event.start),
    alerts,
  };
}

// 「最後一堂」：把上過的和已預約的扣方案課照順序排下去，扣完這堂後方案剩不到 1 堂的那一堂
export function lastLessonIds(students, packagesOf, events, now) {
  const ids = new Set();
  for (const st of students) {
    const f = packageForecast(st.id, packagesOf(st.id), events, now);
    if (f.last) ids.add(f.last.id);
  }
  return ids;
}

// 方案預估：照已排好的課往下扣，哪一堂是最後一堂；如果排好的課都扣完還有剩，回傳剩幾堂
export function packageForecast(studentId, pkgs, events, now) {
  if (!pkgs.length) return { last: null, leftAfterBooked: 0 };
  const mine = events.filter((e) => e.kind === "lesson" && e.studentId === studentId && e.singlePrice == null);
  const counted = mine.filter((e) => consumes(e, now) || (e.status === "scheduled" && !isFinished(e, now)));
  const { history, pk } = allocate(pkgs, counted);
  const hit = history.find((h) => h.packageIds.length && h.leftAfter < 1 - EPS);
  return { last: hit ? hit.event : null, leftAfterBooked: pk.reduce((n, p) => n + (p.lessons - p.used), 0) };
}

// 一對一的當月認列收入：上完（或取消且扣堂）的課認列；還沒上的課照同樣規則預估
export function lessonIncomeStatement(students, packagesOf, events, from, to, now) {
  const rows = [];
  for (const st of students) {
    const mine = events.filter((e) => e.kind === "lesson" && e.studentId === st.id);
    // 分配時把月底前已預約的課也排進去，才算得出預估
    const counted = mine.filter((e) => consumes(e, now) || (e.status === "scheduled" && !isFinished(e, now) && e.start < to));
    const { history } = allocate(packagesOf(st.id), counted);
    const inMonth = history.filter((h) => h.event.start >= from && h.event.start < to);
    if (!inMonth.length) continue;
    const done = inMonth.filter((h) => consumes(h.event, now));
    const future = inMonth.filter((h) => !consumes(h.event, now));
    const futureShort = future.filter((h) => h.unpaidUnits > 0);
    rows.push({
      student: st,
      doneCount: done.length,
      doneAmount: done.reduce((n, h) => n + h.amount, 0),
      futureCount: future.length,
      futureAmount: future.reduce((n, h) => n + h.amount, 0),
      unpaidDone: done.filter((h) => h.unpaidUnits > 0).length,
      // 還沒上、但照目前的方案會不夠扣的第一堂
      shortFrom: futureShort.length ? futureShort[0].event.start : null,
    });
  }
  const confirmed = rows.reduce((n, r) => n + r.doneAmount, 0);
  const estimate = rows.reduce((n, r) => n + r.futureAmount, 0);
  return { rows, confirmed: Math.round(confirmed), estimate: Math.round(estimate), total: Math.round(confirmed + estimate) };
}

// 這種課要不要記人數：有設人數規則（每人加多少，或人數級距）才要；沒有就是開課固定金額
export function needsHeadcount(course) {
  if (!course) return false;
  if (course.feeMode === "tier") return (course.tiers ?? []).length > 0;
  return (course.bonusPer ?? 0) > 0;
}

// 鐘點費（跟著課程種類），沒填人數先算底薪。兩種算法：
// bonus＝底薪＋超過 N 人後每多 1 人加 X 元；tier＝達到某人數後，整堂換成那個金額
export function studioFee(course, attendance) {
  const base = course?.baseFee ?? 0;
  if (attendance == null) return base;
  if (course?.feeMode === "tier") {
    let fee = base;
    for (const t of [...(course.tiers ?? [])].sort((a, b) => a.min - b.min)) if (attendance >= t.min) fee = t.fee;
    return fee;
  }
  return base + Math.max(0, attendance - (course?.bonusAfter ?? 0)) * (course?.bonusPer ?? 0);
}

// 某間教室某段期間的對帳明細；courseOf(id) 找課程種類
export function studioStatement(studio, courseOf, events, from, to, now) {
  const rows = events
    .filter((e) => e.kind === "studio" && e.studioId === studio.id && e.status !== "cancelled" && e.start >= from && e.start < to)
    .sort((a, b) => a.start - b.start)
    .map((e) => {
      const past = isFinished(e, now);
      const course = courseOf(e.courseId);
      const counts = needsHeadcount(course);
      return { event: e, course, past, counts, fee: studioFee(course, past && counts ? e.attendance : null), missing: past && counts && e.attendance == null };
    });
  const confirmed = rows.filter((r) => r.past).reduce((n, r) => n + r.fee, 0);
  const estimate = rows.filter((r) => !r.past).reduce((n, r) => n + r.fee, 0);
  return { rows, confirmed, estimate, total: confirmed + estimate, missing: rows.filter((r) => r.missing).length };
}

// 方案到期日：X 個月後（同一天；遇到月底就取那個月最後一天）
export function addMonthsKey(key, months) {
  const d = parseDay(key);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return dayKey(target);
}
