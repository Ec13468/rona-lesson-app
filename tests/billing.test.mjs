import { test } from "node:test";
import assert from "node:assert/strict";
import { studentSummary, studioFee, studioStatement, consumes } from "../web/js/billing.js";

const now = new Date(2026, 9, 19, 12, 0);
const at = (day, h = 10) => new Date(2026, 9, day, h);
let n = 0;
const lesson = (day, extra = {}) => ({
  id: "e" + ++n, kind: "lesson", studentId: "A", start: at(day), end: at(day, 11), status: "scheduled", deduct: true, ...extra,
});
const pkg = (extra = {}) => ({ id: "p" + ++n, lessons: 10, price: 8000, purchasedOn: "2026-10-01", expiresOn: null, createdAt: "1", ...extra });
const A = { id: "A", perLessonPrice: null };

test("方案：上完一堂 → 已上 1、剩 9、收入 800", () => {
  const s = studentSummary(A, [pkg()], [lesson(15)], now);
  assert.equal(s.attended, 1);
  assert.equal(s.remaining, 9);
  assert.equal(s.income, 800);
});

test("單堂付費：上完一堂收入 1,000，不會提醒繳費", () => {
  const s = studentSummary({ id: "A", perLessonPrice: 1000 }, [], [lesson(15)], now);
  assert.equal(s.income, 1000);
  assert.equal(s.alerts.length, 0);
});

test("還沒上的課不扣；時間過了才扣", () => {
  const s = studentSummary(A, [pkg()], [lesson(15), lesson(25)], now);
  assert.equal(s.attended, 1);
  assert.equal(s.booked, 1);
  assert.equal(s.remaining, 9);
});

test("取消時選扣堂數才扣，選不扣就不扣", () => {
  const s = studentSummary(A, [pkg()], [
    lesson(15, { status: "cancelled", deduct: true }),
    lesson(16, { status: "cancelled", deduct: false }),
  ], now);
  assert.equal(s.attended, 1);
  assert.equal(s.income, 800);
});

test("先扣最早買的方案", () => {
  const older = pkg({ lessons: 1, price: 1000, purchasedOn: "2026-09-01" });
  const newer = pkg({ lessons: 5, price: 4000, purchasedOn: "2026-10-01" });
  const s = studentSummary(A, [newer, older], [lesson(14), lesson(15)], now);
  assert.equal(s.income, 1000 + 800);
  assert.equal(s.packages.find((p) => p.id === older.id).left, 0);
  assert.equal(s.packages.find((p) => p.id === newer.id).left, 4);
});

test("方案用完：提醒繳費；超出的堂數標成沒付費", () => {
  const s = studentSummary(A, [pkg({ lessons: 1, price: 800 })], [lesson(14), lesson(15)], now);
  assert.equal(s.remaining, 0);
  assert.equal(s.unpaid, 1);
  assert.match(s.alerts[0].text, /沒有方案可以扣/);
});

test("剛好用完、還沒超上：提醒方案已用完", () => {
  const s = studentSummary(A, [pkg({ lessons: 1, price: 800 })], [lesson(14)], now);
  assert.ok(s.alerts.some((a) => a.text === "方案已用完，請提醒繳費"));
});

test("剩 1 堂：快用完", () => {
  const s = studentSummary(A, [pkg({ lessons: 2, price: 1600 })], [lesson(14)], now);
  assert.ok(s.alerts.some((a) => /只剩 1 堂/.test(a.text)));
});

test("預約的課比剩餘堂數多：提醒", () => {
  const s = studentSummary(A, [pkg({ lessons: 2, price: 1600 })], [lesson(20), lesson(21), lesson(22)], now);
  assert.ok(s.alerts.some((a) => a.text === "已預約 3 堂，但方案只剩 2 堂"));
});

test("2 週內到期：提醒；過期也能繼續扣", () => {
  const soon = studentSummary(A, [pkg({ expiresOn: "2026-11-01" })], [], now);
  assert.ok(soon.alerts.some((a) => /11\/1 到期，還剩 10 堂/.test(a.text)));
  const expired = studentSummary(A, [pkg({ expiresOn: "2026-10-10" })], [lesson(15)], now);
  assert.equal(expired.remaining, 9);
  assert.equal(expired.income, 800);
  assert.ok(expired.alerts.some((a) => /已在 10\/10 到期/.test(a.text)));
  const far = studentSummary(A, [pkg({ expiresOn: "2026-12-31" })], [], now);
  assert.equal(far.alerts.length, 0);
});

test("鐘點費：52sYoga 底薪 800，第 7 人起每人 +50", () => {
  const s = { baseFee: 800, bonusAfter: 6, bonusPer: 50 };
  assert.equal(studioFee(s, 6), 800);
  assert.equal(studioFee(s, 7), 850);
  assert.equal(studioFee(s, 10), 1000);
  assert.equal(studioFee(s, null), 800);
});

test("鐘點費：空中瑜伽 底薪 800，第 4 人起每人 +50", () => {
  const s = { baseFee: 800, bonusAfter: 3, bonusPer: 50 };
  assert.equal(studioFee(s, 3), 800);
  assert.equal(studioFee(s, 4), 850);
  assert.equal(studioFee(s, 6), 950);
});

test("鐘點費：每堂固定金額", () => {
  assert.equal(studioFee({ baseFee: 1200, bonusAfter: 0, bonusPer: 0 }, 15), 1200);
});

test("教室對帳：已上完、預估、取消不算、沒填人數先算底薪", () => {
  const studio = { id: "S", baseFee: 800, bonusAfter: 6, bonusPer: 50 };
  const ev = (day, extra = {}) => ({ id: "s" + ++n, kind: "studio", studioId: "S", start: at(day), end: at(day, 11), status: "scheduled", ...extra });
  const st = studioStatement(studio, [
    ev(7, { attendance: 10 }),               // 1000
    ev(14),                                  // 沒填人數 800
    ev(15, { status: "cancelled" }),         // 不算
    ev(21, { attendance: 9 }),               // 未來：預估用底薪 800
    ev(28),                                  // 未來 800
    { ...ev(8), studioId: "OTHER" },         // 別間教室
  ], new Date(2026, 9, 1), new Date(2026, 10, 1), now);
  assert.equal(st.confirmed, 1800);
  assert.equal(st.estimate, 1600);
  assert.equal(st.total, 3400);
  assert.equal(st.missing, 1);
  assert.equal(st.rows.length, 4);
});

test("只有一對一課會扣堂", () => {
  assert.equal(consumes({ kind: "studio", status: "scheduled", end: at(1) }, now), false);
});
