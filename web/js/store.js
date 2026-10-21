// 資料存取：正式版存雲端（Supabase），展示版存在這台電腦的瀏覽器
import { SUPABASE_URL, SUPABASE_PUBLIC_KEY, DEMO } from "./config.js?v=dev";
import { addDays, startOfDay, dayKey } from "./logic.js?v=dev";

const toEvent = (r) => ({
  id: r.id,
  kind: r.kind,
  studentId: r.student_id,
  studioId: r.studio_id ?? null,
  courseId: r.course_id ?? null,
  title: r.title,
  start: new Date(r.start_at),
  end: new Date(r.end_at),
  status: r.status,
  deduct: r.deduct,
  note: r.note ?? "",
  seriesId: r.series_id ?? null,
  occurrenceDate: r.occurrence_date ?? null,
  attendance: r.attendance ?? null,
  lessonNotes: r.lesson_notes ?? "",
  singlePrice: r.single_price ?? null,
  allDay: !!r.all_day,
  remind: r.remind ?? null,
});

const toRow = (e) => ({
  kind: e.kind,
  student_id: e.kind === "lesson" ? e.studentId : null,
  studio_id: e.kind === "studio" ? e.studioId : null,
  course_id: e.kind === "studio" ? e.courseId ?? null : null,
  title: e.title ?? "",
  start_at: e.start.toISOString(),
  end_at: e.end.toISOString(),
  status: e.status ?? "scheduled",
  deduct: e.deduct ?? true,
  note: e.note ?? "",
  series_id: e.seriesId ?? null,
  occurrence_date: e.occurrenceDate ?? null,
  attendance: e.kind === "studio" ? e.attendance ?? null : null,
  lesson_notes: e.lessonNotes ?? "",
  single_price: e.kind === "lesson" ? e.singlePrice ?? null : null,
  all_day: e.kind === "personal" ? !!e.allDay : false,
  remind: e.remind ?? null,
});

const toPerson = (r) => ({
  id: r.id, name: r.name, hidden: !!r.archived_at,
  perLessonPrice: r.per_lesson_price ?? null,
  baseFee: r.base_fee ?? 0, bonusAfter: r.bonus_after ?? 0, bonusPer: r.bonus_per ?? 0,
});
const personRow = (x) => {
  const row = {};
  if ("name" in x) row.name = x.name;
  if ("perLessonPrice" in x) row.per_lesson_price = x.perLessonPrice;
  if ("baseFee" in x) row.base_fee = x.baseFee;
  if ("bonusAfter" in x) row.bonus_after = x.bonusAfter;
  if ("bonusPer" in x) row.bonus_per = x.bonusPer;
  return row;
};
export const DEFAULT_SETTINGS = { remindMinutes: 120, remindLesson: true, remindStudio: true, remindPersonal: false, weekLimit: 20 };
const toSettings = (r) => r ? {
  remindMinutes: r.remind_minutes, remindLesson: r.remind_lesson, remindStudio: r.remind_studio,
  remindPersonal: r.remind_personal, weekLimit: Number(r.week_limit),
} : { ...DEFAULT_SETTINGS };
const settingsRow = (x) => ({
  remind_minutes: x.remindMinutes, remind_lesson: x.remindLesson, remind_studio: x.remindStudio,
  remind_personal: x.remindPersonal, week_limit: x.weekLimit, updated_at: new Date().toISOString(),
});

const toCourse = (r) => ({
  id: r.id, studioId: r.studio_id, name: r.name, hidden: !!r.archived_at,
  baseFee: r.base_fee ?? 0, bonusAfter: r.bonus_after ?? 0, bonusPer: r.bonus_per ?? 0,
});
const courseRow = (c) => {
  const row = {};
  if ("studioId" in c) row.studio_id = c.studioId;
  if ("name" in c) row.name = c.name;
  if ("baseFee" in c) row.base_fee = c.baseFee;
  if ("bonusAfter" in c) row.bonus_after = c.bonusAfter;
  if ("bonusPer" in c) row.bonus_per = c.bonusPer;
  return row;
};
const toPackage = (r) => ({
  id: r.id, studentId: r.student_id, lessons: r.lessons, price: r.price,
  purchasedOn: r.purchased_on, expiresOn: r.expires_on, createdAt: r.created_at,
});
const packageRow = (p) => ({
  student_id: p.studentId, lessons: p.lessons, price: p.price, purchased_on: p.purchasedOn, expires_on: p.expiresOn || null,
});

const toSeries = (r) => ({
  id: r.id,
  kind: r.kind,
  studentId: r.student_id,
  studioId: r.studio_id,
  courseId: r.course_id ?? null,
  singlePrice: r.single_price ?? null,
  title: r.title,
  startDate: r.start_date,
  startTime: String(r.start_time).slice(0, 5),
  durationMin: r.duration_min,
  endDate: r.end_date,
  generatedUntil: r.generated_until,
});

const seriesRow = (s) => {
  const row = {};
  const map = {
    kind: "kind", studentId: "student_id", studioId: "studio_id", courseId: "course_id", singlePrice: "single_price", title: "title", startDate: "start_date",
    startTime: "start_time", durationMin: "duration_min", endDate: "end_date", generatedUntil: "generated_until",
  };
  for (const [k, col] of Object.entries(map)) if (k in s) row[col] = s[k];
  return row;
};

function cloudStore() {
  let client;
  const db = async () => {
    if (!client) {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
      client = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    }
    return client;
  };
  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const t = async (name) => (await db()).from(name);

  return {
    async currentUser() {
      const { data } = await (await db()).auth.getSession();
      return data.session?.user ?? null;
    },
    async signIn(email, password) {
      const { data, error } = await (await db()).auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return data.user;
    },
    async signOut() {
      await (await db()).auth.signOut();
    },
    async listStudents() {
      return check(await (await t("students")).select("id, name, archived_at, per_lesson_price").order("created_at")).map(toPerson);
    },
    async addStudent(name) {
      return toPerson(check(await (await t("students")).insert({ name }).select("id, name, archived_at, per_lesson_price").single()));
    },
    async listStudios() {
      return check(await (await t("studios")).select("*").order("created_at")).map(toPerson);
    },
    async addStudio(name) {
      return toPerson(check(await (await t("studios")).insert({ name }).select("*").single()));
    },
    async updateStudent(id, patch) {
      return toPerson(check(await (await t("students")).update(personRow(patch)).eq("id", id).select("id, name, archived_at, per_lesson_price").single()));
    },
    async updateStudio(id, patch) {
      return toPerson(check(await (await t("studios")).update(personRow(patch)).eq("id", id).select("*").single()));
    },
    async listCourses() {
      return check(await (await t("studio_courses")).select("*").order("created_at")).map(toCourse);
    },
    async getSettings() {
      return toSettings(check(await (await t("user_settings")).select("*").maybeSingle()));
    },
    async saveSettings(x) {
      return toSettings(check(await (await t("user_settings")).upsert(settingsRow(x)).select().single()));
    },
    // 這支手機的通知訂閱
    async savePushSubscription(json) {
      check(await (await t("push_subscriptions")).upsert(
        { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: "endpoint" },
      ));
    },
    async removePushSubscription(endpoint) {
      check(await (await t("push_subscriptions")).delete().eq("endpoint", endpoint));
    },
    async sendTestPush() {
      const { data } = await (await db()).auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-reminders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_PUBLIC_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()).sent;
    },
    async addCourse(c) {
      return toCourse(check(await (await t("studio_courses")).insert(courseRow(c)).select().single()));
    },
    async updateCourse(id, patch) {
      return toCourse(check(await (await t("studio_courses")).update(courseRow(patch)).eq("id", id).select().single()));
    },
    // 有排過課就只隱藏，沒有就刪掉
    async removeCourse(id) {
      const { count, error } = await (await t("events")).select("id", { count: "exact", head: true }).eq("course_id", id);
      if (error) throw new Error(error.message);
      const { count: c2 } = await (await t("event_series")).select("id", { count: "exact", head: true }).eq("course_id", id);
      if (count + (c2 ?? 0) > 0) {
        check(await (await t("studio_courses")).update({ archived_at: new Date().toISOString() }).eq("id", id));
        return "hidden";
      }
      check(await (await t("studio_courses")).delete().eq("id", id));
      return "deleted";
    },
    async listPackages() {
      return check(await (await t("packages")).select("*").order("purchased_on")).map(toPackage);
    },
    async updatePackage(id, p) {
      return toPackage(check(await (await t("packages")).update(packageRow(p)).eq("id", id).select().single()));
    },
    async addPackage(p) {
      return toPackage(check(await (await t("packages")).insert(packageRow(p)).select().single()));
    },
    async deletePackage(id) {
      check(await (await t("packages")).delete().eq("id", id));
    },
    // 刪除學生或教室：有課就只從清單隱藏（紀錄保留），沒有課就整個刪掉；回傳 "hidden" 或 "deleted"
    async removeRef(type, id) {
      const table = type === "student" ? "students" : "studios";
      const col = type === "student" ? "student_id" : "studio_id";
      const used = async (name) => {
        const { count, error } = await (await t(name)).select("id", { count: "exact", head: true }).eq(col, id);
        if (error) throw new Error(error.message);
        return count;
      };
      if ((await used("events")) + (await used("event_series")) > 0) {
        check(await (await t(table)).update({ archived_at: new Date().toISOString() }).eq("id", id));
        return "hidden";
      }
      check(await (await t(table)).delete().eq("id", id));
      return "deleted";
    },
    async listSeries() {
      return check(await (await t("event_series")).select("*").order("created_at")).map(toSeries);
    },
    async createSeries(s) {
      return toSeries(check(await (await t("event_series")).insert(seriesRow(s)).select().single()));
    },
    async updateSeries(id, patch) {
      return toSeries(check(await (await t("event_series")).update(seriesRow(patch)).eq("id", id).select().single()));
    },
    async deleteSeries(id) {
      check(await (await t("event_series")).delete().eq("id", id));
    },
    async listEvents(from, to) {
      const rows = check(
        await (await t("events")).select("*")
          .gte("start_at", from.toISOString()).lt("start_at", to.toISOString())
          .order("start_at").limit(5000),
      );
      return rows.map(toEvent);
    },
    async insertEvents(list) {
      if (!list.length) return [];
      return check(await (await t("events")).insert(list.map(toRow)).select()).map(toEvent);
    },
    async saveEvent(e) {
      const q = await t("events");
      const row = { ...toRow(e), updated_at: new Date().toISOString() };
      const res = e.id ? await q.update(row).eq("id", e.id).select().single() : await q.insert(row).select().single();
      return toEvent(check(res));
    },
    async deleteEvent(id) {
      check(await (await t("events")).delete().eq("id", id));
    },
    // 固定課：從某天起（含）的每一堂
    async deleteSeriesEventsFrom(seriesId, fromKey) {
      check(await (await t("events")).delete().eq("series_id", seriesId).gte("occurrence_date", fromKey));
    },
    async cancelSeriesEventsFrom(seriesId, fromKey) {
      return check(
        await (await t("events")).update({ status: "cancelled", deduct: false, updated_at: new Date().toISOString() })
          .eq("series_id", seriesId).gte("occurrence_date", fromKey).eq("status", "scheduled").select(),
      ).map(toEvent);
    },
  };
}

// 展示版：附幾筆假資料，方便在電腦上把每個功能點一遍
function demoStore() {
  const KEY = "rona-demo-v5";
  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw) return raw;
    } catch (_) {}
    return seed();
  };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const uid = () => crypto.randomUUID();

  function seed() {
    const today = startOfDay(new Date());
    const at = (dayOffset, h, m = 0) => addDays(today, dayOffset).getTime() + (h * 60 + m) * 60000;
    const students = [
      { id: uid(), name: "王小美" },
      { id: uid(), name: "陳怡君" },
      { id: uid(), name: "林佳穎" },
    ];
    const studios = [{ id: uid(), name: "52sYoga" }];
    const courses = [
      { id: uid(), studio_id: studios[0].id, name: "一般團課", base_fee: 800, bonus_after: 6, bonus_per: 50 },
      { id: uid(), studio_id: studios[0].id, name: "空中瑜伽", base_fee: 800, bonus_after: 3, bonus_per: 50 },
    ];
    const ev = (kind, ref, title, s, mins, note = "") => ({
      id: uid(), kind,
      student_id: kind === "lesson" ? students[ref].id : null,
      studio_id: kind === "studio" ? studios[0].id : null,
      course_id: kind === "studio" ? courses[ref].id : null,
      title: kind === "studio" ? courses[ref].name : title, start_at: new Date(s).toISOString(), end_at: new Date(s + mins * 60000).toISOString(),
      status: "scheduled", deduct: true, note, series_id: null, occurrence_date: null,
    });
    const s = {
      user: null,
      students,
      studios,
      series: [],
      courses,
      packages: [
        { id: uid(), student_id: students[0].id, lessons: 10, price: 8000, purchased_on: dayKey(addDays(today, -30)), expires_on: dayKey(addDays(today, 10)), created_at: "1" },
        { id: uid(), student_id: students[2].id, lessons: 2, price: 1800, purchased_on: dayKey(addDays(today, -20)), expires_on: null, created_at: "2" },
      ],
      events: [
        ev("lesson", 0, "", at(0, 9), 60),
        ev("studio", 0, "哈達瑜伽", at(0, 14), 60),
        ev("personal", null, "看牙醫", at(0, 16, 30), 60),
        ev("lesson", 2, "", at(0, 19), 60, "上次說右膝不舒服，避開跪姿"),
        ev("lesson", 0, "", at(1, 10), 60),
        ev("personal", null, "家庭聚餐", at(1, 18), 120),
        { ...ev("lesson", 1, "", at(3, 11), 90), single_price: 1000 },
        { ...ev("lesson", 1, "", at(-6, 11), 60), single_price: 1000, lesson_notes: "第一次上課，柔軟度不錯，想加強核心" },
        { ...ev("personal", null, "台南旅行", at(5, 9), 0), end_at: new Date(at(7, 18)).toISOString() },
        ev("lesson", 2, "", at(-2, 15), 60),
        ev("lesson", 0, "", at(-7, 10), 60),
        ev("studio", 0, "哈達瑜伽", at(-5, 11), 60),
        ev("studio", 1, "空中瑜伽入門", at(-4, 9), 60),
      ],
    };
    save(s);
    return s;
  }

  const mutate = (fn) => { const s = load(); const r = fn(s); save(s); return r; };

  return {
    async currentUser() { return load().user; },
    async signIn(email) { return mutate((s) => (s.user = { email: email || "demo@localhost" })); },
    async signOut() { mutate((s) => { s.user = null; }); },
    async listStudents() { return load().students.map(toPerson); },
    async addStudent(name) { return mutate((s) => { const x = { id: uid(), name }; s.students.push(x); return toPerson(x); }); },
    async listStudios() { return load().studios.map(toPerson); },
    async addStudio(name) { return mutate((s) => { const x = { id: uid(), name }; s.studios.push(x); return toPerson(x); }); },
    async updateStudent(id, patch) {
      return mutate((s) => { const x = s.students.find((r) => r.id === id); Object.assign(x, personRow(patch)); return toPerson(x); });
    },
    async updateStudio(id, patch) {
      return mutate((s) => { const x = s.studios.find((r) => r.id === id); Object.assign(x, personRow(patch)); return toPerson(x); });
    },
    async listPackages() { return (load().packages ?? []).map(toPackage); },
    async updatePackage(id, p) {
      return mutate((s) => { const x = s.packages.find((r) => r.id === id); Object.assign(x, packageRow(p)); return toPackage(x); });
    },
    async listCourses() { return (load().courses ?? []).map(toCourse); },
    async getSettings() { return toSettings(load().settings); },
    async saveSettings(x) { return mutate((s) => { s.settings = settingsRow(x); return toSettings(s.settings); }); },
    async savePushSubscription() { throw new Error("展示版不支援通知"); },
    async removePushSubscription() {},
    async sendTestPush() { throw new Error("展示版不支援通知"); },
    async addCourse(c) {
      return mutate((s) => { const row = { ...courseRow(c), id: uid() }; (s.courses ??= []).push(row); return toCourse(row); });
    },
    async updateCourse(id, patch) {
      return mutate((s) => { const x = s.courses.find((r) => r.id === id); Object.assign(x, courseRow(patch)); return toCourse(x); });
    },
    async removeCourse(id) {
      return mutate((s) => {
        if (s.events.some((e) => e.course_id === id) || s.series.some((e) => e.course_id === id)) {
          s.courses.find((x) => x.id === id).archived_at = new Date().toISOString();
          return "hidden";
        }
        s.courses = s.courses.filter((x) => x.id !== id);
        return "deleted";
      });
    },
    async addPackage(p) {
      return mutate((s) => {
        const row = { ...packageRow(p), id: uid(), created_at: new Date().toISOString() };
        (s.packages ??= []).push(row);
        return toPackage(row);
      });
    },
    async deletePackage(id) { mutate((s) => { s.packages = (s.packages ?? []).filter((x) => x.id !== id); }); },
    async removeRef(type, id) {
      return mutate((s) => {
        const list = type === "student" ? s.students : s.studios;
        const col = type === "student" ? "student_id" : "studio_id";
        if (s.events.some((e) => e[col] === id) || s.series.some((e) => e[col] === id)) {
          list.find((x) => x.id === id).archived_at = new Date().toISOString();
          return "hidden";
        }
        list.splice(list.findIndex((x) => x.id === id), 1);
        return "deleted";
      });
    },
    async listSeries() { return load().series.map(toSeries); },
    async createSeries(x) {
      return mutate((s) => {
        const row = { ...seriesRow(x), id: uid() };
        s.series.push(row);
        return toSeries(row);
      });
    },
    async updateSeries(id, patch) {
      return mutate((s) => {
        const row = s.series.find((r) => r.id === id);
        Object.assign(row, seriesRow(patch));
        return toSeries(row);
      });
    },
    async deleteSeries(id) { mutate((s) => { s.series = s.series.filter((r) => r.id !== id); }); },
    async listEvents(from, to) {
      return load().events.map(toEvent).filter((e) => e.start >= from && e.start < to);
    },
    async insertEvents(list) {
      return mutate((s) => list.map((e) => {
        const row = { ...toRow(e), id: uid() };
        s.events.push(row);
        return toEvent(row);
      }));
    },
    async saveEvent(e) {
      return mutate((s) => {
        const row = { ...toRow(e), id: e.id || uid() };
        const i = s.events.findIndex((x) => x.id === row.id);
        if (i >= 0) s.events[i] = row; else s.events.push(row);
        return toEvent(row);
      });
    },
    async deleteEvent(id) { mutate((s) => { s.events = s.events.filter((x) => x.id !== id); }); },
    async deleteSeriesEventsFrom(seriesId, fromKey) {
      mutate((s) => { s.events = s.events.filter((x) => !(x.series_id === seriesId && x.occurrence_date >= fromKey)); });
    },
    async cancelSeriesEventsFrom(seriesId, fromKey) {
      return mutate((s) => s.events
        .filter((x) => x.series_id === seriesId && x.occurrence_date >= fromKey && x.status === "scheduled")
        .map((x) => { x.status = "cancelled"; x.deduct = false; return toEvent(x); }));
    },
  };
}

export const store = DEMO ? demoStore() : cloudStore();
