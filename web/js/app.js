import { store } from "./store.js";
import { DEMO } from "./config.js";
import {
  WEEKDAYS, addDays, startOfDay, startOfWeek, sameDay, dayKey, hhmm, minutesBetween,
  monthGrid, isFinished, findConflicts, eventsOnDay, todayView,
} from "./logic.js";

// ---------- 狀態 ----------
const state = {
  user: null,
  tab: "today",
  calMode: "week",
  cursor: startOfDay(new Date()),
  students: [],
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

const allEvents = () => [...state.events.values()];
const studentName = (id) => state.students.find((s) => s.id === id)?.name ?? "（學生已刪除）";
const eventTitle = (e) => (e.kind === "lesson" ? studentName(e.studentId) : e.title || KIND_NAME[e.kind]);

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
  const mins = minutesBetween(e.start, e.end);
  return `<li><button class="item ${cls.join(" ")}" data-action="open" data-id="${e.id}">
    <span class="item-time">${hhmm(e.start)}<small>${mins} 分鐘</small></span>
    <span class="item-bar"></span>
    <span class="item-body">
      <span class="item-title">${esc(eventTitle(e))}${tag}</span>
      <span class="item-sub">${KIND_NAME[e.kind]}・到 ${hhmm(e.end)}</span>
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
    title = `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}`;
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
        <h3>${d.getMonth() + 1}/${d.getDate()} 週${WEEKDAYS[d.getDay()]}${sameDay(d, today) ? "・今天" : ""}</h3>
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
    <div class="legend"><span><i style="background:var(--lesson)"></i>一對一</span><span><i style="background:var(--personal)"></i>個人行程</span></div>
    ${body}`;
}

function viewMe() {
  return `
    <h1 class="page-title">我的</h1>
    <div class="panel">
      <div class="panel-row"><span>登入帳號</span><span>${esc(state.user.email)}</span></div>
      <div class="panel-row"><span>學生人數</span><span>${state.students.length} 位</span></div>
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
    draft = { ...existing, date: dayKey(existing.start), time: hhmm(existing.start), mins: minutesBetween(existing.start, existing.end) };
  } else {
    const now = new Date();
    const start = new Date(base);
    // 預設：今天就用下一個整點，其他天用 10:00
    if (sameDay(base, now)) start.setHours(Math.min(now.getHours() + 1, 21), 0, 0, 0);
    else start.setHours(10, 0, 0, 0);
    draft = { id: null, kind: "lesson", studentId: state.students[0]?.id ?? null, title: "", date: dayKey(start), time: hhmm(start), mins: 60, status: "scheduled", deduct: true };
  }
  draft.error = "";
  draft.addingStudent = state.students.length === 0;
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
  const isLesson = draft.kind === "lesson";
  const durations = [60, 75, 90, 120];
  const custom = !durations.includes(draft.mins);
  let end = "";
  try { end = hhmm(draftTimes().end); } catch (_) {}

  const typeSeg = editing ? "" : `
    <div class="seg type-seg" role="group" aria-label="類型">
      <button type="button" data-action="kind" data-kind="lesson" aria-pressed="${isLesson}">一對一</button>
      <button type="button" data-action="kind" data-kind="personal" aria-pressed="${!isLesson}">個人行程</button>
    </div>`;

  const who = isLesson ? `
    <div class="field"><span class="label">學生</span>
      <div class="chips">
        ${state.students.map((s) => `<button type="button" class="chip" data-action="pick-student" data-id="${s.id}" aria-pressed="${draft.studentId === s.id}">${esc(s.name)}</button>`).join("")}
        ${draft.addingStudent ? "" : '<button type="button" class="chip add" data-action="add-student-open">＋ 新增學生</button>'}
      </div>
      ${draft.addingStudent ? `<div class="inline-add"><input class="input" id="new-student" placeholder="學生名字" autocomplete="off"><button type="button" class="chip" data-action="add-student" aria-pressed="true">加入</button></div>` : ""}
    </div>` : `
    <div class="field"><label for="title">名稱</label><input class="input" id="title" data-bind="title" value="${esc(draft.title)}" placeholder="例如：看牙醫" autocomplete="off"></div>`;

  const statusNote = draft.status === "cancelled"
    ? `<div class="state-note">這堂課已取消（${draft.deduct ? "有扣堂數" : "沒扣堂數"}）。</div>`
    : draft.status === "done" ? '<div class="state-note">這堂課已標記為上完。</div>' : "";

  const actions = [];
  if (editing && isLesson && draft.status === "scheduled") {
    actions.push('<button type="button" class="btn quiet" data-action="mark-done">標記已上完</button>');
    actions.push('<button type="button" class="btn danger" data-action="cancel-lesson">取消這堂課</button>');
  }
  if (editing && isLesson && draft.status !== "scheduled") {
    actions.push('<button type="button" class="btn quiet" data-action="restore">恢復成已排定</button>');
  }
  if (editing && !isLesson) actions.push('<button type="button" class="btn danger" data-action="delete">刪除這個行程</button>');

  $sheetRoot.innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <form class="sheet" data-form="event" role="dialog" aria-modal="true" aria-label="${editing ? "編輯" : "新增"}">
      <div class="grip"></div>
      <h2>${editing ? (isLesson ? "編輯課程" : "編輯個人行程") : "新增"}</h2>
      ${typeSeg}${statusNote}${who}
      <div class="row2">
        <div class="field"><label for="date">日期</label><input class="input" id="date" type="date" data-bind="date" value="${draft.date}" required></div>
        <div class="field"><label for="time">開始時間</label><input class="input" id="time" type="time" data-bind="time" value="${draft.time}" step="300" required></div>
      </div>
      <div class="field"><span class="label">時長</span>
        <div class="chips">
          ${durations.map((m) => `<button type="button" class="chip" data-action="mins" data-mins="${m}" aria-pressed="${draft.mins === m}">${m} 分</button>`).join("")}
          <button type="button" class="chip" data-action="mins-custom" aria-pressed="${custom}">自訂</button>
        </div>
        ${custom ? `<div class="inline-add"><input class="input" id="mins" type="number" min="5" max="600" step="5" data-bind="mins" value="${draft.mins}" inputmode="numeric"><span style="align-self:center">分鐘</span></div>` : ""}
        <div class="end-hint">${end ? `到 ${end} 結束` : ""}</div>
      </div>
      ${draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : ""}
      <button class="btn ${isLesson ? "" : "personal"}" type="submit">${editing ? "儲存" : "新增"}</button>
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

let toastTimer;
function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function persist(e, message) {
  try {
    const saved = await store.saveEvent(e);
    state.events.set(saved.id, saved);
    closeSheet();
    render();
    toast(message);
  } catch (err) {
    if (draft) { draft.error = "沒有存成功，請檢查網路後再按一次。"; renderSheet(); }
    console.error(err);
  }
}

async function submitEvent() {
  draft.error = "";
  if (draft.kind === "lesson" && !draft.studentId) { draft.error = "請先選一位學生。"; return renderSheet(); }
  if (draft.kind === "personal" && !draft.title.trim()) { draft.error = "請輸入行程名稱。"; return renderSheet(); }
  if (!draft.date || !draft.time) { draft.error = "請選日期和開始時間。"; return renderSheet(); }
  if (!(draft.mins >= 5)) { draft.error = "時長至少 5 分鐘。"; return renderSheet(); }

  const { start, end } = draftTimes();
  const candidate = {
    id: draft.id, kind: draft.kind, studentId: draft.studentId, title: draft.title.trim(),
    start, end, status: draft.status, deduct: draft.deduct,
  };
  if (candidate.status !== "cancelled") {
    await ensureLoaded(addDays(startOfDay(start), -1), addDays(startOfDay(start), 2));
    const conflicts = findConflicts(candidate, allEvents());
    if (conflicts.length) {
      const list = `<ul class="conflicts">${conflicts.map((c) =>
        `<li><b>${hhmm(c.start)}–${hhmm(c.end)}</b>${KIND_NAME[c.kind]}：${esc(eventTitle(c))}</li>`).join("")}</ul>`;
      const choice = await showDialog({
        title: "時間撞到了", text: "這個時段已經有：", list, warn: true,
        buttons: [{ label: "改時間", value: "back" }, { label: "照樣儲存", value: "save", style: "quiet" }],
      });
      if (choice !== "save") return;
    }
  }
  await persist(candidate, draft.id ? "已儲存" : "已新增");
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
  else if (a === "pick-day") {
    const [y, m, d] = el.dataset.day.split("-").map(Number);
    state.cursor = new Date(y, m - 1, d);
    await loadCalendar(); render();
  }
  else if (a === "sign-out") { await store.signOut(); state.user = null; render(); }
  else if (a === "demo-reset") { localStorage.removeItem("rona-demo-v1"); location.reload(); }
  // 抽屜裡的操作
  else if (!draft) return;
  else if (a === "kind") { draft.kind = el.dataset.kind; draft.error = ""; renderSheet(); }
  else if (a === "pick-student") { draft.studentId = el.dataset.id; renderSheet(); }
  else if (a === "add-student-open") { draft.addingStudent = true; renderSheet(); document.getElementById("new-student")?.focus(); }
  else if (a === "add-student") await addStudentFromSheet();
  else if (a === "mins") { draft.mins = Number(el.dataset.mins); renderSheet(); }
  else if (a === "mins-custom") { if ([60, 75, 90, 120].includes(draft.mins)) draft.mins = 45; renderSheet(); }
  else if (a === "mark-done") await persist({ ...state.events.get(draft.id), status: "done" }, "已標記上完");
  else if (a === "restore") await persist({ ...state.events.get(draft.id), status: "scheduled", deduct: true }, "已恢復");
  else if (a === "cancel-lesson") {
    const choice = await showDialog({
      title: "取消這堂課", text: `${studentName(draft.studentId)}・${draft.date.slice(5).replace("-", "/")} ${draft.time}。這堂要扣堂數嗎？`,
      buttons: [
        { label: "不扣堂數", value: "keep" },
        { label: "扣堂數", value: "deduct", style: "quiet" },
        { label: "返回", value: "back", style: "danger" },
      ],
    });
    if (choice === "back") return;
    await persist({ ...state.events.get(draft.id), status: "cancelled", deduct: choice === "deduct" }, "已取消這堂課");
  }
  else if (a === "delete") {
    const choice = await showDialog({
      title: "刪除這個行程？", text: draft.title,
      buttons: [{ label: "刪除", value: "delete" }, { label: "返回", value: "back", style: "quiet" }],
    });
    if (choice !== "delete") return;
    try {
      await store.deleteEvent(draft.id);
      state.events.delete(draft.id);
      closeSheet(); render(); toast("已刪除");
    } catch (err) { draft.error = "沒有刪除成功，請檢查網路後再試。"; renderSheet(); }
  }
});

async function addStudentFromSheet() {
  const input = document.getElementById("new-student");
  const name = input?.value.trim();
  if (!name) { input?.focus(); return; }
  try {
    const st = await store.addStudent(name);
    state.students.push(st);
    draft.studentId = st.id;
    draft.addingStudent = false;
    draft.error = "";
  } catch (err) {
    draft.error = "沒有加成功，請檢查網路後再試。";
  }
  renderSheet();
}

document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.action === "toggle-personal") {
    state.showPersonal = el.checked; writePref("showPersonal", el.checked); render(); return;
  }
  if (!draft || !el.dataset.bind) return;
  const key = el.dataset.bind;
  draft[key] = key === "mins" ? Number(el.value) : el.value;
  const hint = document.querySelector(".end-hint");
  if (hint) { try { hint.textContent = `到 ${hhmm(draftTimes().end)} 結束`; } catch (_) { hint.textContent = ""; } }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.id === "new-student") { ev.preventDefault(); addStudentFromSheet(); }
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
    await submitEvent();
  }
});

async function loadCalendar() {
  const [from, to] = rangeFor(state.calMode, state.cursor);
  await ensureLoaded(from, to);
}

async function boot() {
  $app.innerHTML = '<p class="loading">載入中…</p>';
  state.students = await store.listStudents();
  const t = startOfDay(new Date());
  await ensureLoaded(addDays(t, -62), addDays(t, 120));
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
