import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findConflicts, todayView, monthGrid, startOfWeek, eventsOnDay, isFinished,
} from "../web/js/logic.js";

const at = (h, m = 0, day = 16) => new Date(2026, 9, day, h, m);
const ev = (id, kind, s, e, extra = {}) => ({ id, kind, start: s, end: e, status: "scheduled", ...extra });

test("撞期：時間重疊就算撞期", () => {
  const personal = ev("p", "personal", at(14), at(15));
  const c = findConflicts(ev("new", "lesson", at(14, 30), at(15, 30)), [personal]);
  assert.deepEqual(c.map((x) => x.id), ["p"]);
});

test("撞期：剛好接上不算撞期", () => {
  const personal = ev("p", "personal", at(14), at(15));
  assert.equal(findConflicts(ev("new", "lesson", at(15), at(16)), [personal]).length, 0);
  assert.equal(findConflicts(ev("new", "lesson", at(13), at(14)), [personal]).length, 0);
});

test("撞期：已取消的課和自己本身不算", () => {
  const cancelled = ev("x", "lesson", at(10), at(11), { status: "cancelled" });
  const self = ev("me", "lesson", at(10), at(11));
  assert.equal(findConflicts(self, [cancelled, self]).length, 0);
});

test("首頁：已經過去的課不顯示", () => {
  const now = at(12);
  const v = todayView([ev("a", "lesson", at(9), at(10)), ev("b", "lesson", at(15), at(16))], now, false);
  assert.deepEqual(v.upcoming.map((x) => x.id), ["b"]);
  assert.equal(v.state, "upcoming");
});

test("首頁：今天的課都上完就顯示完成", () => {
  const now = at(18);
  const v = todayView([ev("a", "lesson", at(9), at(10)), ev("b", "lesson", at(15), at(16))], now, false);
  assert.equal(v.state, "done");
  assert.equal(v.upcoming.length, 0);
});

test("首頁：提早標記上完也算完成", () => {
  const now = at(15, 30);
  const v = todayView([ev("b", "lesson", at(15), at(16), { status: "done" })], now, false);
  assert.equal(v.state, "done");
});

test("首頁：今天沒有課", () => {
  assert.equal(todayView([], at(9), false).state, "none");
  // 只有個人行程，也算今天沒有課
  assert.equal(todayView([ev("p", "personal", at(12), at(13))], at(9), true).state, "none");
});

test("首頁：個人行程依開關顯示，但不影響「已完成」判斷", () => {
  const events = [ev("a", "lesson", at(9), at(10)), ev("p", "personal", at(19), at(20))];
  assert.equal(todayView(events, at(12), false).upcoming.length, 0);
  assert.deepEqual(todayView(events, at(12), true).upcoming.map((x) => x.id), ["p"]);
  assert.equal(todayView(events, at(12), true).state, "done");
});

test("首頁：已取消的課不顯示、也不算今天有課", () => {
  const v = todayView([ev("a", "lesson", at(15), at(16), { status: "cancelled" })], at(9), false);
  assert.equal(v.upcoming.length, 0);
  assert.equal(v.state, "none");
});

test("首頁：別天的課不顯示", () => {
  const v = todayView([ev("a", "lesson", at(15, 0, 17), at(16, 0, 17))], at(9), false);
  assert.equal(v.state, "none");
});

test("課程時間進行中還不算結束", () => {
  assert.equal(isFinished(ev("a", "lesson", at(9), at(10)), at(9, 30)), false);
  assert.equal(isFinished(ev("a", "lesson", at(9), at(10)), at(10)), true);
});

test("一週從週一開始", () => {
  const mon = startOfWeek(at(12, 0, 16)); // 2026-10-16 是週五
  assert.equal(mon.getDay(), 1);
  assert.equal(mon.getDate(), 12);
});

test("月曆：2026 年 10 月從 9/28 週一排到 11/1 週日", () => {
  const g = monthGrid(2026, 9);
  assert.equal(g.length % 7, 0);
  assert.equal(g[0].getMonth(), 8);
  assert.equal(g[0].getDate(), 28);
  const last = g[g.length - 1];
  assert.equal(last.getDay(), 0);
  assert.equal(last.getMonth(), 10);
  assert.equal(last.getDate(), 1);
});

test("某天的行程依時間排序", () => {
  const list = eventsOnDay([ev("b", "lesson", at(15), at(16)), ev("a", "lesson", at(9), at(10))], at(0));
  assert.deepEqual(list.map((x) => x.id), ["a", "b"]);
});
