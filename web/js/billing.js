// 學生扣堂、收入與教室鐘點費的計算規則（不碰畫面、不碰資料庫，方便自動測試）
import { isFinished, dayKey, addDays, startOfDay, parseDay } from "./logic.js";

export const EXPIRY_WARN_DAYS = 14;

// 這堂一對一課要不要扣堂數：時間過了且沒取消，或取消時選了「扣堂數」
export function consumes(e, now) {
  if (e.kind !== "lesson") return false;
  if (e.status === "cancelled") return !!e.deduct;
  return isFinished(e, now);
}

// 學生的扣堂與收入
// student：{ id, perLessonPrice }，packages：[{ id, lessons, price, purchasedOn, expiresOn, createdAt }]
export function studentSummary(student, packages, events, now) {
  const mine = events.filter((e) => e.kind === "lesson" && e.studentId === student.id);
  const consumed = mine.filter((e) => consumes(e, now)).sort((a, b) => a.start - b.start);
  const booked = mine.filter((e) => e.status === "scheduled" && !isFinished(e, now)).sort((a, b) => a.start - b.start);

  const pk = [...packages]
    .sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((p) => ({ ...p, used: 0, value: p.price / p.lessons }));
  const single = student.perLessonPrice ?? null;

  let income = 0;
  let unpaid = 0;
  const history = [];
  for (const e of consumed) {
    const p = pk.find((x) => x.used < x.lessons);
    if (p) {
      p.used++;
      income += p.value;
      history.push({ event: e, source: "package", packageId: p.id, amount: p.value });
    } else if (single !== null) {
      income += single;
      history.push({ event: e, source: "single", amount: single });
    } else {
      unpaid++;
      history.push({ event: e, source: "unpaid", amount: 0 });
    }
  }

  const remaining = pk.reduce((n, p) => n + (p.lessons - p.used), 0);
  const today = dayKey(startOfDay(now));
  const warnUntil = dayKey(addDays(startOfDay(now), EXPIRY_WARN_DAYS));
  const alerts = [];

  if (single === null) {
    if (unpaid > 0) alerts.push({ level: "warn", text: `有 ${unpaid} 堂課沒有方案可以扣，請提醒繳費` });
    else if (remaining === 0 && (pk.length > 0 || booked.length > 0)) alerts.push({ level: "warn", text: "方案已用完，請提醒繳費" });
    if (booked.length > remaining && unpaid === 0 && remaining > 0) {
      alerts.push({ level: "warn", text: `已預約 ${booked.length} 堂，但方案只剩 ${remaining} 堂` });
    }
    if (remaining === 1) alerts.push({ level: "warn", text: "方案只剩 1 堂，快用完了" });
  }
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
    income: Math.round(income),
    paid: packages.reduce((n, p) => n + p.price, 0),
    unpaid,
    packages: pk.map((p) => ({ ...p, left: p.lessons - p.used })),
    history,
    alerts,
  };
}

// 教室鐘點費：底薪＋超過 N 人後每多 1 人加 X 元；沒填人數先算底薪
export function studioFee(studio, attendance) {
  const base = studio.baseFee ?? 0;
  if (attendance == null) return base;
  return base + Math.max(0, attendance - (studio.bonusAfter ?? 0)) * (studio.bonusPer ?? 0);
}

// 某間教室某段期間的對帳明細
export function studioStatement(studio, events, from, to, now) {
  const rows = events
    .filter((e) => e.kind === "studio" && e.studioId === studio.id && e.status !== "cancelled" && e.start >= from && e.start < to)
    .sort((a, b) => a.start - b.start)
    .map((e) => {
      const past = isFinished(e, now);
      return { event: e, past, fee: studioFee(studio, past ? e.attendance : null), missing: past && e.attendance == null };
    });
  const confirmed = rows.filter((r) => r.past).reduce((n, r) => n + r.fee, 0);
  const estimate = rows.filter((r) => !r.past).reduce((n, r) => n + r.fee, 0);
  return { rows, confirmed, estimate, total: confirmed + estimate, missing: rows.filter((r) => r.missing).length };
}
