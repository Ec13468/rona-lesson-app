import { test } from "node:test";
import assert from "node:assert/strict";
import { studentSummary, studioFee, studioStatement, consumes, lessonIncomeStatement, addMonthsKey } from "../web/js/billing.js";

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
  const s = studentSummary(A, [], [lesson(15, { singlePrice: 1000 }), lesson(25, { singlePrice: 1000 })], now);
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
  const studio = { id: "S" };
  const general = { baseFee: 800, bonusAfter: 6, bonusPer: 50 };
  const ev = (day, extra = {}) => ({ id: "s" + ++n, kind: "studio", studioId: "S", courseId: "G", start: at(day), end: at(day, 11), status: "scheduled", ...extra });
  const st = studioStatement(studio, () => general, [
    ev(7, { attendance: 10 }),               // 1000
    ev(14),                                  // 沒填人數 800
    ev(15, { status: "cancelled" }),         // 不算
    ev(21, { attendance: 9 }),               // 未來：預估用底薪 800
    ev(28),                                  // 未來 800
    { ...ev(8), studioId: "OTHER" },         // 別間教室
  ].map((e) => e), new Date(2026, 9, 1), new Date(2026, 10, 1), now);
  assert.equal(st.confirmed, 1800);
  assert.equal(st.estimate, 1600);
  assert.equal(st.total, 3400);
  assert.equal(st.missing, 1);
  assert.equal(st.rows.length, 4);
});

test("只有一對一課會扣堂", () => {
  assert.equal(consumes({ kind: "studio", status: "scheduled", end: at(1) }, now), false);
});

test("同一間教室不同課程種類：鐘點費各算各的", () => {
  const courses = { G: { baseFee: 800, bonusAfter: 6, bonusPer: 50 }, A: { baseFee: 800, bonusAfter: 3, bonusPer: 50 } };
  const ev = (day, courseId, attendance) => ({ id: "c" + ++n, kind: "studio", studioId: "Y", courseId, start: at(day), end: at(day, 11), status: "scheduled", attendance });
  const st = studioStatement({ id: "Y" }, (id) => courses[id], [ev(6, "G", 7), ev(8, "A", 6)], new Date(2026, 9, 1), new Date(2026, 10, 1), now);
  assert.deepEqual(st.rows.map((r) => r.fee), [850, 950]);
  assert.equal(st.confirmed, 1800);
});

test("一對一認列：這個月上了 4 堂就認列 4 堂的錢，還沒上的另外預估", () => {
  const ls = [lesson(2), lesson(9), lesson(14), lesson(16), lesson(23), lesson(30), lesson(40)];
  const r = lessonIncomeStatement([A], () => [pkg()], ls, new Date(2026, 9, 1), new Date(2026, 10, 1), now);
  assert.equal(r.rows[0].doneCount, 4);
  assert.equal(r.rows[0].doneAmount, 3200);
  assert.equal(r.rows[0].futureCount, 2);
  assert.equal(r.rows[0].futureAmount, 1600);
  assert.equal(r.total, 4800);
});

test("一對一認列：上個月上的課不算這個月；方案不夠的堂數標成沒付費", () => {
  const ls = [lesson(-20), lesson(5), lesson(6)]; // 第一堂在 9 月
  const r = lessonIncomeStatement([A], () => [pkg({ lessons: 2, price: 1600 })], ls, new Date(2026, 9, 1), new Date(2026, 10, 1), now);
  assert.equal(r.rows[0].doneCount, 2);
  assert.equal(r.rows[0].doneAmount, 800);
  assert.equal(r.rows[0].unpaid, 1);
});

test("一對一認列：單堂付費的課", () => {
  const r = lessonIncomeStatement([A], () => [], [lesson(5, { singlePrice: 1000 }), lesson(25, { singlePrice: 1000 })], new Date(2026, 9, 1), new Date(2026, 10, 1), now);
  assert.equal(r.confirmed, 1000);
  assert.equal(r.estimate, 1000);
});

test("到期日：X 個月後，月底自動調整", () => {
  assert.equal(addMonthsKey("2026-10-19", 4), "2027-02-19");
  assert.equal(addMonthsKey("2026-10-31", 4), "2027-02-28");
  assert.equal(addMonthsKey("2026-01-31", 1), "2026-02-28");
});

test("單堂付費的課不扣方案", () => {
  const s = studentSummary(A, [pkg({ lessons: 2, price: 1600 })], [lesson(14), lesson(15, { singlePrice: 1200 })], now);
  assert.equal(s.remaining, 1);
  assert.equal(s.income, 800 + 1200);
});

test("扣掉已預約（要扣方案的）後還能排幾堂", () => {
  const s = studentSummary(A, [pkg({ lessons: 3, price: 2400 })], [lesson(25), lesson(26, { singlePrice: 900 })], now);
  assert.equal(s.available, 2);
});
