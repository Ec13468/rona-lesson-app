import { store } from "./store.js";
import { DEMO } from "./config.js";
import {
  WEEKDAYS, addDays, startOfDay, startOfWeek, sameDay, dayKey, hhmm, minutesBetween,
  monthGrid, isFinished, findConflicts, eventsOnDay, todayView,
  SERIES_HORIZON_DAYS, parseDay, occurrenceDates, buildOccurrence, pendingOccurrences, dayBefore,
} from "./logic.js";

// ---------- 狀態 ----------
const state = {
  user: null,
  tab: "today",
  calMode: "week",
  cursor: startOfDay(new Date()),
  students: [],
  studios: [],
  series: new Map(),
  events: new Map(),
  loaded: null, // { from, to }
  showPersonal: readPref("showPersonal", true),
};

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem("rona-pref-" + key);
    return v === null ? fallback : JSON.parse(v);
  } catch (_) { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem("rona-pref-" + key, JSON.stringify(value)); } catch (_) {}
}

const $app = document.getElementById("app");
const $sheetRoot = document.getElementById("sheet-root");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const icons = {
  plus: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  prev: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  today: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  cal: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  me: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.3l3 3 6-6.3"/></svg>',
  note: '<svg class="mini" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="有備註"><path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5M8.5 9h7M8.5 12.5h4"/></svg>',
  repeat: '<svg class="mini" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="固定每週"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 01-3 3H4"/></svg>',
};

const KIND_NAME = { lesson: "一對一", personal: "個人行程", studio: "教室課" };

// ---------- 資料 ----------
async function ensureLoaded(from, to) {
  const l = state.loaded;
  if (l && from >= l.from && to <= l.to) return;
  const nf = l ? new Date(Math.min(from, l.from)) : from;
  const nt = l ? new Date(Math.max(to, l.to)) : to;
  const list = await store.listEvents(nf, nt);
  state.events = new Map(list.map((e) => [e.id, e]));
  state.loaded = { from: nf, to: nt };
}

async function reloadEvents() {
  const l = state.loaded;
  state.loaded = null;
  await ensureLoaded(l.from, l.to);
}

const horizonKey = () => dayKey(addDays(startOfDay(new Date()), SERIES_HORIZON_DAYS));

// 固定課：把還沒排出來的每一堂補到 untilKey
async function generateSeries(untilKey) {
  for (const s of state.series.values()) {
    const target = s.endDate && s.endDate < untilKey ? s.endDate : untilKey;
    if (s.generatedUntil && s.generatedUntil >= target) continue;
    const list = pendingOccurrences(s, target);
    const saved = await store.insertEvents(list);
    saved.forEach((e) => state.events.set(e.id, e));
    const updated = await store.updateSeries(s.id, { generatedUntil: target });
    state.series.set(s.id, updated);
  }
}

async function createSeries(def, firstNote) {
  const series = await store.createSeries({ ...def, generatedUntil: null });
  state.series.set(series.id, series);
  const target = series.endDate && series.endDate < horizonKey() ? series.endDate : horizonKey();
  const list = pendingOccurrences(series, target);
  if (list.length && firstNote) list[0].note = firstNote;
  await store.insertEvents(list);
  state.series.set(series.id, await store.updateSeries(series.id, { generatedUntil: target }));
}

// 固定課在 fromKey（含）之後全部結束
async function endSeriesFrom(series, fromKey) {
  if (fromKey <= series.startDate) {
    await store.deleteSeries(series.id);
    state.series.delete(series.id);
  } else {
    state.series.set(series.id, await store.updateSeries(series.id, { endDate: dayBefore(fromKey) }));
  }
}

const allEvents = () => [...state.events.values()];
const activeStudents = () => state.students.filter((s) => !s.hidden);
const activeStudios = () => state.studios.filter((s) => !s.hidden);
const studentName = (id) => state.students.find((s) => s.id === id)?.name ?? "（學生已刪除）";
const studioName = (id) => state.studios.find((s) => s.id === id)?.name ?? "（教室已刪除）";
const eventTitle = (e) => (e.kind === "lesson" ? studentName(e.studentId) : e.title || studioName(e.studioId));
const eventSub = (e) => (e.kind === "studio" ? studioName(e.studioId) : KIND_NAME[e.kind]);
const describe = (e) => `${e.kind === "studio" ? studioName(e.studioId) + " " : ""}${eventTitle(e)}`;
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

function rangeFor(mode, cursor) {
  if (mode === "day") return [startOfDay(cursor), addDays(startOfDay(cursor), 1)];
  if (mode === "week") { const s = startOfWeek(cursor); return [s, addDays(s, 7)]; }
  const g = monthGrid(cursor.getFullYear(), cursor.getMonth());
  return [g[0], addDays(g[g.length - 1], 1)];
}

// ---------- 畫面 ----------
function render() {
  if (!state.user) return renderLogin();
  const body = state.tab === "today" ? viewToday() : state.tab === "calendar" ? viewCalendar() : viewMe();
  const nav = (id, label, icon) =>
    `<button data-action="tab" data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ""}>${icon}<span>${label}</span></button>`;
  $app.innerHTML = `
    <main class="screen">${body}</main>
    ${state.tab !== "me" ? `<button class="fab" data-action="new" aria-label="新增行程">${icons.plus}</button>` : ""}
    <nav class="nav">${nav("today", "今天", icons.today)}${nav("calendar", "日曆", icons.cal)}${nav("me", "我的", icons.me)}</nav>`;
}

function itemHTML(e, now = new Date()) {
  const cls = [e.kind];
  let tag = "";
  if (e.status === "cancelled") { cls.push("is-cancelled"); tag = '<span class="tag cancel">已取消</span>'; }
  else if (isFinished(e, now)) { cls.push("is-past"); if (e.kind !== "personal") tag = '<span class="tag done">已上完</span>'; }
  const marks = `${e.seriesId ? icons.repeat : ""}${e.note ? icons.note : ""}`;
  return `<li><button class="item ${cls.join(" ")}" data-action="open" data-id="${e.id}">
    <span class="item-time">${hhmm(e.start)}<small>${minutesBetween(e.start, e.end)} 分鐘</small></span>
    <span class="item-bar"></span>
    <span class="item-body">
      <span class="item-title">${esc(eventTitle(e))}${marks ? `<span class="marks">${marks}</span>` : ""}${tag}</span>
      <span class="item-sub">${esc(eventSub(e))}・到 ${hhmm(e.end)}</span>
    </span></button></li>`;
}

function viewToday() {
  const now = new Date();
  const v = todayView(allEvents(), now, state.showPersonal);
  let status = "";
  if (v.state === "done") {
    status = `<div class="done-banner">${icons.check}<span>已完成今日所有課程</span></div>`;
  } else if (v.state === "upcoming") {
    status = `<p class="today-status">今天還有 <strong>${v.classesLeft} 堂課</strong></p>`;
  } else {
    status = `<p class="today-status">今天沒有排課</p>`;
  }
  const list = v.upcoming.length
    ? `<ul class="timeline">${v.upcoming.map((e) => itemHTML(e, now)).join("")}</ul>`
    : v.state === "none" ? `<div class="empty"><p>按右下角的 ＋ 新增課程或個人行程。</p></div>` : "";
  return `
    <h1 class="today-date">${now.getMonth() + 1}月${now.getDate()}日</h1>
    <p class="today-week">星期${WEEKDAYS[now.getDay()]}</p>
    ${status}
    <div class="switch-row" style="margin-top:18px">
      <span id="sw-label">顯示個人行程</span>
      <label class="switch"><input type="checkbox" data-action="toggle-personal" aria-labelledby="sw-label" ${state.showPersonal ? "checked" : ""}><span></span></label>
    </div>
    ${list}`;
}

function viewCalendar() {
  const c = state.cursor;
  const mode = state.calMode;
  const segBtn = (m, label) => `<button data-action="cal-mode" data-mode="${m}" aria-pressed="${mode === m}">${label}</button>`;
  let title;
  if (mode === "day") title = `${c.getMonth() + 1}月${c.getDate()}日 週${WEEKDAYS[c.getDay()]}`;
  else if (mode === "week") {
    const s = startOfWeek(c), e = addDays(s, 6);
    title = `${md(s)} – ${md(e)}`;
  } else title = `${c.getFullYear()}年${c.getMonth() + 1}月`;

  let body = "";
  const all = allEvents();
  const today = startOfDay(new Date());
  if (mode === "day") {
    const list = eventsOnDay(all, c);
    body = list.length ? `<ul class="timeline">${list.map((e) => itemHTML(e)).join("")}</ul>` : `<div class="empty"><p>這天沒有行程。</p></div>`;
  } else if (mode === "week") {
    const s = startOfWeek(c);
    body = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(s, i);
      const list = eventsOnDay(all, d);
      return `<section class="week-day ${sameDay(d, today) ? "is-today" : ""}">
        <h3>${md(d)} 週${WEEKDAYS[d.getDay()]}${sameDay(d, today) ? "・今天" : ""}</h3>
        ${list.length ? `<ul class="timeline">${list.map((e) => itemHTML(e)).join("")}</ul>` : '<div class="none">沒有行程</div>'}
      </section>`;
    }).join("");
  } else {
    const grid = monthGrid(c.getFullYear(), c.getMonth());
    const cells = grid.map((d) => {
      const dots = eventsOnDay(all, d).filter((e) => e.status !== "cancelled").slice(0, 4)
        .map((e) => `<i class="${e.kind}"></i>`).join("");
      const cls = [d.getMonth() !== c.getMonth() ? "other" : "", sameDay(d, today) ? "is-today" : ""].join(" ");
      return `<button class="${cls}" data-action="pick-day" data-day="${dayKey(d)}" aria-pressed="${sameDay(d, c)}" aria-label="${d.getMonth() + 1}月${d.getDate()}日">
        <span class="num">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
    }).join("");
    const list = eventsOnDay(all, c);
    body = `<div class="month">${["一", "二", "三", "四", "五", "六", "日"].map((w) => `<span class="wd">${w}</span>`).join("")}${cells}</div>
      <div class="month-list"><h3>${c.getMonth() + 1}月${c.getDate()}日 週${WEEKDAYS[c.getDay()]}</h3>
      ${list.length ? `<ul class="timeline">${list.map((e) => itemHTML(e)).join("")}</ul>` : '<div class="empty"><p>這天沒有行程。</p></div>'}</div>`;
  }

  return `
    <div class="seg" role="group" aria-label="檢視方式">${segBtn("day", "日")}${segBtn("week", "週")}${segBtn("month", "月")}</div>
    <div class="cal-nav">
      <button class="icon-btn" data-action="cal-move" data-dir="-1" aria-label="上一個">${icons.prev}</button>
      <span class="cal-title">${title}</span>
      <button class="text-btn" data-action="cal-today">今天</button>
      <button class="icon-btn" data-action="cal-move" data-dir="1" aria-label="下一個">${icons.next}</button>
    </div>
    <div class="legend"><span><i style="background:var(--lesson)"></i>一對一</span><span><i style="background:var(--studio)"></i>教室</span><span><i style="background:var(--personal)"></i>個人行程</span><span class="legend-icon">${icons.note}備註</span></div>
    ${body}`;
}

function viewMe() {
  const rows = (type, list, empty) => list.length
    ? list.map((x) => `<div class="panel-row"><span>${esc(x.name)}</span>
        <button class="row-del" data-action="remove-ref" data-type="${type}" data-id="${x.id}" aria-label="刪除 ${esc(x.name)}">刪除</button></div>`).join("")
    : `<div class="panel-row"><span class="muted">${empty}</span></div>`;
  return `
    <h1 class="page-title">我的</h1>
    <h2 class="section-title">學生（${activeStudents().length} 位）</h2>
    <div class="panel">${rows("student", activeStudents(), "還沒有學生，新增一對一課時可以加入")}</div>
    <h2 class="section-title">教室</h2>
    <div class="panel">${rows("studio", activeStudios(), "還沒有教室，新增課程時可以加入")}</div>
    <h2 class="section-title">帳號</h2>
    <div class="panel">
      <div class="panel-row"><span>登入帳號</span><span class="muted">${esc(state.user.email)}</span></div>
    </div>
    <button class="btn quiet" data-action="sign-out" style="margin-top:20px">登出</button>
    ${DEMO ? '<button class="btn danger" data-action="demo-reset">重設展示資料</button>' : ""}`;
}

function renderLogin(error = "") {
  $app.innerHTML = `
    <form class="login" data-form="login">
      <h1>Rona 課表</h1>
      <p>${DEMO ? "展示模式：隨便輸入就能登入" : "用你的 Email 和密碼登入"}</p>
      <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autocomplete="username" ${DEMO ? "" : "required"}></div>
      <div class="field"><label for="pw">密碼</label><input class="input" id="pw" type="password" autocomplete="current-password" ${DEMO ? "" : "required"}></div>
      ${error ? `<p class="form-error">${esc(error)}</p>` : ""}
      <button class="btn" type="submit">登入</button>
    </form>`;
}

// ---------- 新增／編輯抽屜 ----------
let draft = null;

function openSheet(existing) {
  const base = state.tab === "calendar" ? state.cursor : new Date();
  if (existing) {
    draft = {
      ...existing,
      date: dayKey(existing.start), time: hhmm(existing.start), mins: minutesBetween(existing.start, existing.end),
      noteOn: !!existing.note, repeat: "once", endDate: "",
    };
    draft.original = { date: draft.date, time: draft.time, mins: draft.mins, title: draft.title, studentId: draft.studentId };
  } else {
    const now = new Date();
    const start = new Date(base);
    // 預設：今天就用下一個整點，其他天用 10:00
    if (sameDay(base, now)) start.setHours(Math.min(now.getHours() + 1, 21), 0, 0, 0);
    else start.setHours(10, 0, 0, 0);
    draft = {
      id: null, kind: "lesson", studentId: activeStudents()[0]?.id ?? null, studioId: null, title: "",
      date: dayKey(start), time: hhmm(start), mins: 60, status: "scheduled", deduct: true,
      note: "", noteOn: false, repeat: "once", endDate: "", seriesId: null,
    };
  }
  draft.error = "";
  draft.adding = null; // "student" | "studio"
  renderSheet();
}

function closeSheet() {
  draft = null;
  $sheetRoot.innerHTML = "";
}

function draftTimes() {
  const [y, m, d] = draft.date.split("-").map(Number);
  const [hh, mm] = draft.time.split(":").map(Number);
  const start = new Date(y, m - 1, d, hh, mm);
  return { start, end: new Date(start.getTime() + draft.mins * 60000) };
}

function renderSheet() {
  if (!draft) return;
  const editing = !!draft.id;
  const k = draft.kind;
  const custom = draft.mins !== 60;
  let end = "";
  try { end = hhmm(draftTimes().end); } catch (_) {}

  const catChip = (kind, label, studioId = "") => {
    const on = kind === k && (kind !== "studio" || draft.studioId === studioId);
    return `<button type="button" class="chip cat-${kind}" data-action="kind" data-kind="${kind}" data-studio="${studioId}" aria-pressed="${on}">${esc(label)}</button>`;
  };
  const category = editing ? "" : `
    <div class="field"><span class="label">分類</span>
      <div class="chips">
        ${catChip("lesson", "一對一")}
        ${activeStudios().map((s) => catChip("studio", s.name, s.id)).join("")}
        ${catChip("personal", "個人行程")}
        ${draft.adding === "studio" ? "" : '<button type="button" class="chip add" data-action="adding" data-what="studio">＋ 新增教室</button>'}
      </div>
      ${draft.adding === "studio" ? `<div class="inline-add"><input class="input" id="new-name" placeholder="教室名稱，例如 52sYoga" autocomplete="off"><button type="button" class="chip" data-action="add-studio" aria-pressed="true">加入</button></div>` : ""}
    </div>`;

  let who = "";
  if (k === "lesson") {
    who = `<div class="field"><span class="label">學生</span>
      <div class="chips">
        ${activeStudents().map((s) => `<button type="button" class="chip" data-action="pick-student" data-id="${s.id}" aria-pressed="${draft.studentId === s.id}">${esc(s.name)}</button>`).join("")}
        ${draft.adding === "student" ? "" : '<button type="button" class="chip add" data-action="adding" data-what="student">＋ 新增學生</button>'}
      </div>
      ${draft.adding === "student" ? `<div class="inline-add"><input class="input" id="new-name" placeholder="學生名字" autocomplete="off"><button type="button" class="chip" data-action="add-student" aria-pressed="true">加入</button></div>` : ""}
    </div>`;
  } else {
    const label = k === "studio" ? "課程名稱" : "名稱";
    const ph = k === "studio" ? "例如：哈達瑜伽" : "例如：看牙醫";
    who = `<div class="field"><label for="title">${label}</label><input class="input" id="title" data-bind="title" value="${esc(draft.title)}" placeholder="${ph}" autocomplete="off"></div>`;
  }

  const canRepeat = !editing && k !== "personal";
  const weekday = (() => { try { return WEEKDAYS[parseDay(draft.date).getDay()]; } catch (_) { return ""; } })();
  const repeat = canRepeat ? `
    <div class="seg type-seg" role="group" aria-label="單次或固定每週">
      <button type="button" data-action="repeat" data-repeat="once" aria-pressed="${draft.repeat === "once"}">單次</button>
      <button type="button" data-action="repeat" data-repeat="weekly" aria-pressed="${draft.repeat === "weekly"}">固定每週</button>
    </div>` : "";
  const weekly = canRepeat && draft.repeat === "weekly" ? `
    <div class="field"><label for="end-date">結束日期（不填就一直排下去）</label>
      <input class="input" id="end-date" type="date" data-bind="endDate" value="${draft.endDate}" min="${draft.date}">
      <div class="end-hint" id="repeat-hint">每週${weekday} ${draft.time} 上課</div>
    </div>` : "";

  const seriesNote = editing && draft.seriesId ? `<div class="state-note">${icons.repeat} 這是固定每週的課，修改時可以選只改這一堂，或這一堂和之後的都改。</div>` : "";
  const statusNote = draft.status === "cancelled"
    ? `<div class="state-note">這堂課已取消${k === "lesson" ? `（${draft.deduct ? "有扣堂數" : "沒扣堂數"}）` : ""}。</div>` : "";

  const actions = [];
  if (editing && k !== "personal" && draft.status === "scheduled") actions.push('<button type="button" class="btn quiet" data-action="cancel-event">取消這堂課</button>');
  if (editing && k !== "personal" && draft.status === "cancelled") actions.push('<button type="button" class="btn quiet" data-action="restore">恢復這堂課</button>');
  if (editing) actions.push(`<button type="button" class="btn danger" data-action="delete">${k === "personal" ? "刪除這個行程" : "刪除這堂課"}</button>`);

  const heading = editing
    ? (k === "lesson" ? "編輯一對一" : k === "studio" ? `編輯 ${esc(studioName(draft.studioId))}` : "編輯個人行程")
    : "新增";
  const btnClass = k === "personal" ? "personal" : k === "studio" ? "studio" : "";

  $sheetRoot.innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <form class="sheet" data-form="event" role="dialog" aria-modal="true" aria-label="${editing ? "編輯" : "新增"}">
      <div class="grip"></div>
      <h2>${heading}</h2>
      ${seriesNote}${statusNote}${category}${who}${repeat}
      <div class="row2">
        <div class="field"><label for="date">${draft.repeat === "weekly" ? "第一堂日期" : "日期"}</label><input class="input" id="date" type="date" data-bind="date" value="${draft.date}" required></div>
        <div class="field"><label for="time">開始時間</label><input class="input" id="time" type="time" data-bind="time" value="${draft.time}" step="300" required></div>
      </div>
      ${weekly}
      <div class="field"><span class="label">時長</span>
        <div class="chips">
          <button type="button" class="chip" data-action="mins" aria-pressed="${!custom}">60 分</button>
          <button type="button" class="chip" data-action="mins-custom" aria-pressed="${custom}">自訂</button>
        </div>
        ${custom ? `<div class="inline-add"><input class="input" id="mins" type="number" min="5" max="600" step="5" data-bind="mins" value="${draft.mins}" inputmode="numeric"><span style="align-self:center">分鐘</span></div>` : ""}
        <div class="end-hint" id="end-hint">${end ? `到 ${end} 結束` : ""}</div>
      </div>
      <div class="field">
        <div class="switch-row" style="margin:0">
          <span id="note-label">備註</span>
          <label class="switch"><input type="checkbox" data-action="note-toggle" aria-labelledby="note-label" ${draft.noteOn ? "checked" : ""}><span></span></label>
        </div>
        ${draft.noteOn ? `<textarea class="input note-input" id="note" data-bind="note" rows="3" placeholder="例如：帶瑜珈輪、學生右膝不舒服">${esc(draft.note)}</textarea>` : ""}
      </div>
      ${draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : ""}
      <button class="btn ${btnClass}" type="submit">${editing ? "儲存" : "新增"}</button>
      ${actions.join("")}
    </form>`;
}

function showDialog({ title, text = "", list = "", warn = false, buttons }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="backdrop dialog-backdrop"></div>
      <div class="dialog ${warn ? "warn" : ""}" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}${list}
        ${buttons.map((b) => `<button class="btn ${b.style || ""}" data-value="${b.value}">${esc(b.label)}</button>`).join("")}
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector(".dialog .btn")?.focus();
    wrap.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-value]");
      if (!b && !ev.target.classList.contains("dialog-backdrop")) return;
      wrap.remove();
      resolve(b ? b.dataset.value : "back");
    });
  });
}

// 固定課的範圍選擇
function askScope(verb) {
  return showDialog({
    title: `${verb}固定課`,
    text: "這是固定每週的課，要怎麼處理？",
    buttons: [
      { label: `只${verb}這一堂`, value: "one" },
      { label: `這一堂和之後的都${verb}`, value: "future", style: "quiet" },
      { label: "返回", value: "back", style: "danger" },
    ],
  });
}

let toastTimer;
function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function failed(message) {
  if (draft) { draft.error = message; renderSheet(); }
}

async function persist(e, message) {
  try {
    const saved = await store.saveEvent(e);
    state.events.set(saved.id, saved);
    closeSheet();
    render();
    toast(message);
  } catch (err) {
    console.error(err);
    failed("沒有存成功，請檢查網路後再按一次。");
  }
}

// 撞期確認：回傳 true 表示可以存
async function confirmConflicts(candidates, ignore = () => false) {
  const others = allEvents().filter((e) => !ignore(e));
  const hits = [];
  for (const c of candidates) {
    for (const x of findConflicts(c, others)) hits.push({ c, x });
  }
  if (!hits.length) return true;
  const shown = hits.slice(0, 5).map(({ c, x }) =>
    `<li><b>${candidates.length > 1 ? `${md(c.start)} ` : ""}${hhmm(x.start)}–${hhmm(x.end)}</b>${esc(eventSub(x))}：${esc(eventTitle(x))}</li>`).join("");
  const more = hits.length > 5 ? `<li>還有 ${hits.length - 5} 堂也撞到</li>` : "";
  const choice = await showDialog({
    title: "時間撞到了",
    text: candidates.length > 1 ? `這門固定課有 ${new Set(hits.map((h) => h.c)).size} 堂撞到：` : "這個時段已經有：",
    list: `<ul class="conflicts">${shown}${more}</ul>`, warn: true,
    buttons: [{ label: "改時間", value: "back" }, { label: "照樣儲存", value: "save", style: "quiet" }],
  });
  return choice === "save";
}

function validate() {
  draft.error = "";
  if (draft.kind === "lesson" && !draft.studentId) draft.error = "請先選一位學生。";
  else if (draft.kind === "studio" && !draft.studioId) draft.error = "請先選一間教室。";
  else if (draft.kind === "studio" && !draft.title.trim()) draft.error = "請輸入課程名稱。";
  else if (draft.kind === "personal" && !draft.title.trim()) draft.error = "請輸入行程名稱。";
  else if (!draft.date || !draft.time) draft.error = "請選日期和開始時間。";
  else if (!(draft.mins >= 5)) draft.error = "時長至少 5 分鐘。";
  else if (draft.repeat === "weekly" && draft.endDate && draft.endDate < draft.date) draft.error = "結束日期不能早於第一堂。";
  if (draft.error) renderSheet();
  return !draft.error;
}

const seriesDef = () => ({
  kind: draft.kind, studentId: draft.kind === "lesson" ? draft.studentId : null,
  studioId: draft.kind === "studio" ? draft.studioId : null, title: draft.title.trim(),
  startDate: draft.date, startTime: draft.time, durationMin: draft.mins,
});

async function submitEvent() {
  if (!validate()) return;
  const note = draft.noteOn ? draft.note.trim() : "";
  const { start, end } = draftTimes();

  // 新增固定每週的課
  if (!draft.id && draft.repeat === "weekly") {
    const def = { ...seriesDef(), endDate: draft.endDate || null };
    const until = def.endDate && def.endDate < horizonKey() ? def.endDate : horizonKey();
    await ensureLoaded(startOfDay(start), addDays(parseDay(until), 1));
    const preview = occurrenceDates(def, def.startDate, until).map((k) => buildOccurrence({ ...def, id: null }, k));
    if (!(await confirmConflicts(preview))) return;
    try {
      await createSeries(def, note);
      await reloadEvents();
      closeSheet(); render(); toast("已建立固定課");
    } catch (err) { console.error(err); failed("沒有建立成功，請檢查網路後再按一次。"); }
    return;
  }

  const candidate = {
    id: draft.id, kind: draft.kind, studentId: draft.studentId, studioId: draft.studioId, title: draft.title.trim(),
    start, end, status: draft.status, deduct: draft.deduct, note,
    seriesId: draft.seriesId ?? null, occurrenceDate: draft.occurrenceDate ?? null,
  };

  // 修改固定課的某一堂：只動備註就不用問範圍
  if (draft.id && draft.seriesId) {
    const o = draft.original;
    const changed = o.date !== draft.date || o.time !== draft.time || o.mins !== draft.mins
      || o.title !== draft.title || o.studentId !== draft.studentId;
    if (changed) {
      const scope = await askScope("改");
      if (scope === "back") return;
      if (scope === "future") return changeSeriesFuture(note);
    }
  }

  if (candidate.status !== "cancelled") {
    await ensureLoaded(addDays(startOfDay(start), -1), addDays(startOfDay(start), 2));
    if (!(await confirmConflicts([candidate]))) return;
  }
  await persist(candidate, draft.id ? "已儲存" : "已新增");
}

// 這一堂和之後的都改：舊的固定課在這堂之前結束，從這堂起用新設定
async function changeSeriesFuture(note) {
  const old = state.series.get(draft.seriesId);
  const fromKey = draft.occurrenceDate;
  const def = { ...seriesDef(), endDate: old?.endDate && old.endDate >= draft.date ? old.endDate : null };
  const until = def.endDate && def.endDate < horizonKey() ? def.endDate : horizonKey();
  await ensureLoaded(startOfDay(parseDay(draft.date)), addDays(parseDay(until), 1));
  const preview = occurrenceDates(def, def.startDate, until).map((k) => buildOccurrence({ ...def, id: null }, k));
  const replaced = (e) => e.seriesId === draft.seriesId && e.occurrenceDate >= fromKey;
  if (!(await confirmConflicts(preview, replaced))) return;
  try {
    await store.deleteSeriesEventsFrom(draft.seriesId, fromKey);
    if (old) await endSeriesFrom(old, fromKey);
    await createSeries(def, note);
    await reloadEvents();
    closeSheet(); render(); toast("已更新這一堂和之後的課");
  } catch (err) { console.error(err); failed("沒有存成功，請檢查網路後再按一次。"); }
}

// 取消只針對這一堂；固定課之後不上了請用刪除
async function cancelEvent() {
  const ev = state.events.get(draft.id);
  let deduct = false;
  if (ev.kind === "lesson") {
    const choice = await showDialog({
      title: "取消這堂課", text: `${describe(ev)}・${md(ev.start)} ${hhmm(ev.start)}。這堂要扣堂數嗎？`,
      buttons: [
        { label: "不扣堂數", value: "keep" },
        { label: "扣堂數", value: "deduct", style: "quiet" },
        { label: "返回", value: "back", style: "danger" },
      ],
    });
    if (choice === "back") return;
    deduct = choice === "deduct";
  } else {
    const choice = await showDialog({
      title: "取消這堂課？", text: `${describe(ev)}・${md(ev.start)} ${hhmm(ev.start)}`,
      buttons: [{ label: "取消這堂課", value: "ok" }, { label: "返回", value: "back", style: "quiet" }],
    });
    if (choice === "back") return;
  }
  await persist({ ...ev, status: "cancelled", deduct }, "已取消這堂課");
}

async function deleteEvent() {
  const ev = state.events.get(draft.id);
  let scope = "one";
  if (ev.seriesId) {
    scope = await askScope("刪");
    if (scope === "back") return;
  } else {
    const choice = await showDialog({
      title: ev.kind === "personal" ? "刪除這個行程？" : "刪除這堂課？",
      text: `${describe(ev)}・${md(ev.start)} ${hhmm(ev.start)}${ev.kind !== "personal" ? "。刪除後不會留下紀錄；如果只是停課，請改用「取消這堂課」。" : ""}`,
      buttons: [{ label: "刪除", value: "delete", style: "danger-fill" }, { label: "返回", value: "back", style: "quiet" }],
    });
    if (choice !== "delete") return;
  }
  try {
    if (scope === "future") {
      await store.deleteSeriesEventsFrom(ev.seriesId, ev.occurrenceDate);
      const s = state.series.get(ev.seriesId);
      if (s) await endSeriesFrom(s, ev.occurrenceDate);
      await reloadEvents();
    } else {
      await store.deleteEvent(ev.id);
      state.events.delete(ev.id);
    }
    closeSheet(); render(); toast(scope === "future" ? "已刪除這一堂和之後的課" : "已刪除");
  } catch (err) { console.error(err); failed("沒有刪除成功，請檢查網路後再試。"); }
}

// ---------- 操作 ----------
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;

  if (a === "tab") { state.tab = el.dataset.tab; if (state.tab === "calendar") await loadCalendar(); render(); window.scrollTo(0, 0); }
  else if (a === "new") openSheet(null);
  else if (a === "open") openSheet(state.events.get(el.dataset.id));
  else if (a === "close-sheet") closeSheet();
  else if (a === "cal-mode") { state.calMode = el.dataset.mode; await loadCalendar(); render(); }
  else if (a === "cal-today") { state.cursor = startOfDay(new Date()); await loadCalendar(); render(); }
  else if (a === "cal-move") {
    const dir = Number(el.dataset.dir);
    const c = state.cursor;
    state.cursor = state.calMode === "day" ? addDays(c, dir)
      : state.calMode === "week" ? addDays(c, 7 * dir)
      : new Date(c.getFullYear(), c.getMonth() + dir, 1);
    await loadCalendar(); render();
  }
  else if (a === "pick-day") { state.cursor = parseDay(el.dataset.day); await loadCalendar(); render(); }
  else if (a === "sign-out") { await store.signOut(); state.user = null; render(); }
  else if (a === "demo-reset") { localStorage.removeItem("rona-demo-v2"); location.reload(); }
  else if (a === "remove-ref") await removeRef(el.dataset.type, el.dataset.id);
  // 抽屜裡的操作
  else if (!draft) return;
  else if (a === "kind") {
    draft.kind = el.dataset.kind;
    draft.studioId = draft.kind === "studio" ? el.dataset.studio : null;
    if (draft.kind === "personal") draft.repeat = "once";
    draft.error = ""; renderSheet();
  }
  else if (a === "pick-student") { draft.studentId = el.dataset.id; renderSheet(); }
  else if (a === "adding") { draft.adding = el.dataset.what; renderSheet(); document.getElementById("new-name")?.focus(); }
  else if (a === "add-student" || a === "add-studio") await addFromSheet(a === "add-student" ? "student" : "studio");
  else if (a === "repeat") { draft.repeat = el.dataset.repeat; renderSheet(); }
  else if (a === "mins") { draft.mins = 60; renderSheet(); }
  else if (a === "mins-custom") { if (draft.mins === 60) draft.mins = 45; renderSheet(); document.getElementById("mins")?.focus(); }
  else if (a === "cancel-event") await cancelEvent();
  else if (a === "restore") await persist({ ...state.events.get(draft.id), status: "scheduled", deduct: true }, "已恢復這堂課");
  else if (a === "delete") await deleteEvent();
});

async function removeRef(type, id) {
  const list = type === "student" ? state.students : state.studios;
  const item = list.find((x) => x.id === id);
  const label = type === "student" ? "學生" : "教室";
  const choice = await showDialog({
    title: `刪除${label}「${item.name}」？`,
    text: `刪除後新增課程時就不會出現。已經排好的課和過去的紀錄都會保留；如果之後的課不上了，請到日曆刪除那些課。`,
    buttons: [{ label: "刪除", value: "ok", style: "danger-fill" }, { label: "返回", value: "back", style: "quiet" }],
  });
  if (choice !== "ok") return;
  try {
    const result = await store.removeRef(type, id);
    if (result === "hidden") item.hidden = true;
    else list.splice(list.indexOf(item), 1);
    render(); toast(`已刪除${label}`);
  } catch (err) {
    console.error(err);
    toast("沒有刪除成功，請檢查網路後再試");
  }
}

async function addFromSheet(what) {
  const input = document.getElementById("new-name");
  const name = input?.value.trim();
  if (!name) { input?.focus(); return; }
  try {
    if (what === "student") {
      const st = await store.addStudent(name);
      state.students.push(st);
      draft.studentId = st.id;
    } else {
      const st = await store.addStudio(name);
      state.studios.push(st);
      draft.kind = "studio";
      draft.studioId = st.id;
    }
    draft.adding = null;
    draft.error = "";
  } catch (err) {
    draft.error = "沒有加成功，請檢查網路後再試。";
  }
  renderSheet();
}

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.action === "toggle-personal") {
    state.showPersonal = el.checked; writePref("showPersonal", el.checked); render();
  } else if (el.dataset.action === "note-toggle" && draft) {
    draft.noteOn = el.checked; renderSheet();
    if (el.checked) document.getElementById("note")?.focus();
  }
});

document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (!draft || !el.dataset.bind) return;
  const key = el.dataset.bind;
  draft[key] = key === "mins" ? Number(el.value) : el.value;
  try {
    document.getElementById("end-hint").textContent = `到 ${hhmm(draftTimes().end)} 結束`;
    const rh = document.getElementById("repeat-hint");
    if (rh) rh.textContent = `每週${WEEKDAYS[parseDay(draft.date).getDay()]} ${draft.time} 上課`;
  } catch (_) {}
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.id === "new-name") { ev.preventDefault(); addFromSheet(draft.adding); }
  if (ev.key === "Escape" && draft && !document.querySelector(".dialog")) closeSheet();
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (form.dataset.form === "login") {
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      state.user = await store.signIn(form.email.value.trim(), form.pw.value);
      await boot();
    } catch (err) {
      renderLogin(/invalid/i.test(err.message) ? "Email 或密碼不對，請再試一次。" : "登入失敗，請檢查網路後再試一次。");
    }
  } else if (form.dataset.form === "event") {
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try { await submitEvent(); } finally { if (btn.isConnected) btn.disabled = false; }
  }
});

async function loadCalendar() {
  const [from, to] = rangeFor(state.calMode, state.cursor);
  const until = dayKey(addDays(to, -1));
  if (until > horizonKey()) await generateSeries(until);
  await ensureLoaded(from, to);
}

async function boot() {
  $app.innerHTML = '<p class="loading">載入中…</p>';
  const [students, studios, series] = await Promise.all([store.listStudents(), store.listStudios(), store.listSeries()]);
  state.students = students;
  state.studios = studios;
  state.series = new Map(series.map((s) => [s.id, s]));
  const t = startOfDay(new Date());
  await ensureLoaded(addDays(t, -62), addDays(t, 120));
  await generateSeries(horizonKey());
  render();
}

// 每分鐘更新一次，讓上完的課自動從首頁消失
setInterval(() => { if (state.user && !draft && state.tab === "today") render(); }, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.user && !draft) render();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

(async () => {
  try {
    state.user = await store.currentUser();
    if (state.user) await boot(); else render();
  } catch (err) {
    console.error(err);
    $app.innerHTML = '<p class="loading">連不上網路，請確認網路後重新打開。</p>';
  }
})();
