// 學生扣堂、收入與教室鐘點費的計算規則（不碰畫面、不碰資料庫，方便自動測試）
import { isFinished, dayKey, addDays, startOfDay, parseDay } from "./logic.js?v=dev";

export const EXPIRY_WARN_DAYS = 14;

// 這堂一對一課要不要扣堂數：時間過了且沒取消，或取消時選了「扣堂數」
export function consumes(e, now) {
  if (e.kind !== "lesson") return false;
  if (e.status === "cancelled") return !!e.deduct;
  return isFinished(e, now);
}

// 依序分配每堂課：預約時選單堂付費的照那堂金額；其他先扣最早買的方案；都沒有就是沒付費
function allocate(student, packages, lessons) {
  const pk = [...packages]
    .sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((p) => ({ ...p, used: 0, value: p.price / p.lessons }));
  const history = [];
  for (const e of [...lessons].sort((a, b) => a.start - b.start)) {
    if (e.singlePrice != null) {
      history.push({ event: e, source: "single", amount: e.singlePrice });
      continue;
    }
    const p = pk.find((x) => x.used < x.lessons);
    if (p) {
      p.used++;
      history.push({ event: e, source: "package", packageId: p.id, amount: p.value });
    } else {
      history.push({ event: e, source: "unpaid", amount: 0 });
    }
  }
  return { pk, history };
}

// 學生的扣堂與收入
// student：{ id }，packages：[{ id, lessons, price, purchasedOn, expiresOn, createdAt }]
export function studentSummary(student, packages, events, now) {
  const mine = events.filter((e) => e.kind === "lesson" && e.studentId === student.id);
  const consumed = mine.filter((e) => consumes(e, now));
  const booked = mine.filter((e) => e.status === "scheduled" && !isFinished(e, now));
  const bookedPkg = booked.filter((e) => e.singlePrice == null); // 要扣方案的預約
  const { pk, history } = allocate(student, packages, consumed);
  const unpaid = history.filter((h) => h.source === "unpaid").length;
  const income = history.reduce((n, h) => n + h.amount, 0);

  const remaining = pk.reduce((n, p) => n + (p.lessons - p.used), 0);
  const today = dayKey(startOfDay(now));
  const warnUntil = dayKey(addDays(startOfDay(now), EXPIRY_WARN_DAYS));
  const alerts = [];

  if (unpaid > 0) alerts.push({ level: "warn", text: `有 ${unpaid} 堂課沒有方案可以扣，請提醒繳費` });
  else if (remaining === 0 && (pk.length > 0 || bookedPkg.length > 0)) alerts.push({ level: "warn", text: "方案已用完，請提醒繳費" });
  if (bookedPkg.length > remaining && unpaid === 0 && remaining > 0) {
    alerts.push({ level: "warn", text: `已預約 ${bookedPkg.length} 堂，但方案只剩 ${remaining} 堂` });
  }
  if (remaining === 1) alerts.push({ level: "warn", text: "方案只剩 1 堂，快用完了" });
  for (const p of pk) {
    const left = p.lessons - p.used;
    if (!p.expiresOn || left <= 0) continue;
    const md = `${parseDay(p.expiresOn).getMonth() + 1}/${parseDay(p.expiresOn).getDate()}`;
    if (p.expiresOn < today) alerts.push({ level: "info", text: `有方案已在 ${md} 到期，還剩 ${left} 堂可以上` });
    else if (p.expiresOn <= warnUntil) alerts.push({ level: "warn", text: `方案 ${md} 到期，還剩 ${left} 堂` });
  }

  return {
    attended: consumed.length,
    booked: booked.length,
    remaining,
    available: remaining - bookedPkg.length, // 扣掉已預約後還能排幾堂
    income: Math.round(income),
    paid: packages.reduce((n, p) => n + p.price, 0),
    unpaid,
    packages: pk.map((p) => ({ ...p, left: p.lessons - p.used })),
    history: history.sort((a, b) => a.event.start - b.event.start),
    alerts,
  };
}

// 一對一的當月認列收入：上完（或取消且扣堂）的課認列；還沒上的課照同樣規則預估
export function lessonIncomeStatement(students, packagesOf, events, from, to, now) {
  const rows = [];
  for (const st of students) {
    const mine = events.filter((e) => e.kind === "lesson" && e.studentId === st.id);
    // 分配時把月底前已預約的課也排進去，才算得出預估
    const counted = mine.filter((e) => consumes(e, now) || (e.status === "scheduled" && !isFinished(e, now) && e.start < to));
    const { history } = allocate(st, packagesOf(st.id), counted);
    const inMonth = history.filter((h) => h.event.start >= from && h.event.start < to);
    if (!inMonth.length) continue;
    const done = inMonth.filter((h) => consumes(h.event, now));
    const future = inMonth.filter((h) => !consumes(h.event, now));
    rows.push({
      student: st,
      doneCount: done.length,
      doneAmount: done.reduce((n, h) => n + h.amount, 0),
      futureCount: future.length,
      futureAmount: future.reduce((n, h) => n + h.amount, 0),
      unpaid: inMonth.filter((h) => h.source === "unpaid").length,
    });
  }
  const confirmed = rows.reduce((n, r) => n + r.doneAmount, 0);
  const estimate = rows.reduce((n, r) => n + r.futureAmount, 0);
  return { rows, confirmed: Math.round(confirmed), estimate: Math.round(estimate), total: Math.round(confirmed + estimate) };
}

// 鐘點費（跟著課程種類）：底薪＋超過 N 人後每多 1 人加 X 元；沒填人數先算底薪
export function studioFee(course, attendance) {
  const base = course?.baseFee ?? 0;
  if (attendance == null) return base;
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
      return { event: e, course, past, fee: studioFee(course, past ? e.attendance : null), missing: past && e.attendance == null };
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
