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

import { occurrenceDates, pendingOccurrences, buildOccurrence, dayBefore } from "../web/js/logic.js";

const weekly = (extra = {}) => ({
  id: "s1", kind: "studio", studioId: "st", studentId: null, title: "哈達瑜伽",
  startDate: "2026-10-21", startTime: "11:00", durationMin: 60, endDate: null, generatedUntil: null, ...extra,
});

test("固定課：每週同一天", () => {
  assert.deepEqual(occurrenceDates(weekly(), "2026-10-01", "2026-11-11"),
    ["2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11"]);
});

test("固定課：有結束日就停在結束日", () => {
  assert.deepEqual(occurrenceDates(weekly({ endDate: "2026-11-04" }), "2026-10-01", "2026-12-31"),
    ["2026-10-21", "2026-10-28", "2026-11-04"]);
});

test("固定課：只補還沒排出來的", () => {
  const list = pendingOccurrences(weekly({ generatedUntil: "2026-10-28" }), "2026-11-11");
  assert.deepEqual(list.map((e) => e.occurrenceDate), ["2026-11-04", "2026-11-11"]);
  assert.equal(pendingOccurrences(weekly({ generatedUntil: "2026-11-11" }), "2026-11-11").length, 0);
});

test("固定課：每一堂的時間、時長、類型", () => {
  const e = buildOccurrence(weekly({ durationMin: 75 }), "2026-10-28");
  assert.equal(e.start.getDay(), 3);
  assert.equal(e.start.getHours(), 11);
  assert.equal((e.end - e.start) / 60000, 75);
  assert.equal(e.studioId, "st");
  assert.equal(e.studentId, null);
  assert.equal(e.note, "");
});

test("前一天（跨月）", () => {
  assert.equal(dayBefore("2026-11-01"), "2026-10-31");
});

import { spanLabel } from "../web/js/logic.js";

test("跨日行程：經過的每一天都看得到，也會撞期", () => {
  const trip = { id: "t", kind: "personal", start: new Date(2026, 9, 20, 9), end: new Date(2026, 9, 23, 18), status: "scheduled" };
  assert.equal(eventsOnDay([trip], new Date(2026, 9, 19)).length, 0);
  for (const d of [20, 21, 22, 23]) assert.equal(eventsOnDay([trip], new Date(2026, 9, d)).length, 1);
  assert.equal(eventsOnDay([trip], new Date(2026, 9, 24)).length, 0);
  assert.equal(findConflicts({ id: "x", start: new Date(2026, 9, 21, 10), end: new Date(2026, 9, 21, 11) }, [trip]).length, 1);
  assert.deepEqual(spanLabel(trip, new Date(2026, 9, 20)), { time: "09:00", sub: "開始" });
  assert.deepEqual(spanLabel(trip, new Date(2026, 9, 21)), { time: "整天", sub: null });
  assert.deepEqual(spanLabel(trip, new Date(2026, 9, 23)), { time: "到 18:00", sub: "結束" });
});

test("整天行程：結束在隔天 0 點，不會多出一天", () => {
  const off = { id: "o", kind: "personal", allDay: true, start: new Date(2026, 9, 20), end: new Date(2026, 9, 22), status: "scheduled" };
  assert.equal(eventsOnDay([off], new Date(2026, 9, 21)).length, 1);
  assert.equal(eventsOnDay([off], new Date(2026, 9, 22)).length, 0);
  assert.deepEqual(spanLabel(off, new Date(2026, 9, 20)), { time: "整天", sub: null });
});

test("一般行程不受影響", () => {
  const e = { id: "e", kind: "lesson", start: new Date(2026, 9, 20, 9), end: new Date(2026, 9, 20, 10), status: "scheduled" };
  assert.equal(spanLabel(e, new Date(2026, 9, 20)), null);
  assert.equal(eventsOnDay([e], new Date(2026, 9, 21)).length, 0);
});

import { weekMinutes, gapsToday, hoursText } from "../web/js/logic.js";

test("每週時數：週一到週日的課，取消和個人行程不算", () => {
  const evs = [
    ev("a", "lesson", new Date(2026, 9, 12, 9), new Date(2026, 9, 12, 10)),          // 週一 60
    ev("b", "studio", new Date(2026, 9, 18, 9), new Date(2026, 9, 18, 10, 30)),      // 週日 90
    ev("c", "lesson", new Date(2026, 9, 14, 9), new Date(2026, 9, 14, 10), { status: "cancelled" }),
    ev("d", "personal", new Date(2026, 9, 14, 9), new Date(2026, 9, 14, 12)),
    ev("e", "lesson", new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10)),          // 下週一
  ];
  assert.equal(weekMinutes(evs, new Date(2026, 9, 16)), 150);
  assert.equal(hoursText(150), "2 小時 30 分");
  assert.equal(hoursText(1200), "20 小時");
});

test("空檔：兩堂課之間空 2 小時以上才算", () => {
  const now = at(8);
  const evs = [ev("a", "lesson", at(10), at(11)), ev("b", "studio", at(13), at(14)), ev("c", "lesson", at(15), at(16))];
  const g = gapsToday(evs, now);
  assert.equal(g.length, 1);
  assert.equal(g[0].after.id, "a");
  assert.equal(g[0].minutes, 120);
});

test("空檔：中間有個人行程就不算；已經過去的空檔不列", () => {
  const evs = [ev("a", "lesson", at(9), at(10)), ev("p", "personal", at(11), at(12)), ev("b", "lesson", at(14), at(15))];
  assert.equal(gapsToday(evs, at(8)).length, 0);
  const evs2 = [ev("a", "lesson", at(9), at(10)), ev("b", "lesson", at(13), at(14))];
  assert.equal(gapsToday(evs2, at(13, 30)).length, 0);
  assert.equal(gapsToday(evs2, at(12)).length, 1);
});
