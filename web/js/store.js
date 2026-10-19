// 資料存取：正式版存雲端（Supabase），展示版存在這台電腦的瀏覽器
import { SUPABASE_URL, SUPABASE_PUBLIC_KEY, DEMO } from "./config.js";
import { addDays, startOfDay } from "./logic.js";

const toEvent = (r) => ({
  id: r.id,
  kind: r.kind,
  studentId: r.student_id,
  studioId: r.studio_id ?? null,
  title: r.title,
  start: new Date(r.start_at),
  end: new Date(r.end_at),
  status: r.status,
  deduct: r.deduct,
  note: r.note ?? "",
  seriesId: r.series_id ?? null,
  occurrenceDate: r.occurrence_date ?? null,
});

const toRow = (e) => ({
  kind: e.kind,
  student_id: e.kind === "lesson" ? e.studentId : null,
  studio_id: e.kind === "studio" ? e.studioId : null,
  title: e.title ?? "",
  start_at: e.start.toISOString(),
  end_at: e.end.toISOString(),
  status: e.status ?? "scheduled",
  deduct: e.deduct ?? true,
  note: e.note ?? "",
  series_id: e.seriesId ?? null,
  occurrence_date: e.occurrenceDate ?? null,
});

const toPerson = (r) => ({ id: r.id, name: r.name, hidden: !!r.archived_at });

const toSeries = (r) => ({
  id: r.id,
  kind: r.kind,
  studentId: r.student_id,
  studioId: r.studio_id,
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
    kind: "kind", studentId: "student_id", studioId: "studio_id", title: "title", startDate: "start_date",
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
      return check(await (await t("students")).select("id, name, archived_at").order("created_at")).map(toPerson);
    },
    async addStudent(name) {
      return toPerson(check(await (await t("students")).insert({ name }).select("id, name, archived_at").single()));
    },
    async listStudios() {
      return check(await (await t("studios")).select("id, name, archived_at").order("created_at")).map(toPerson);
    },
    async addStudio(name) {
      return toPerson(check(await (await t("studios")).insert({ name }).select("id, name, archived_at").single()));
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
  const KEY = "rona-demo-v2";
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
    const studios = [
      { id: uid(), name: "52sYoga" },
      { id: uid(), name: "52sYoga 空中瑜伽" },
    ];
    const ev = (kind, ref, title, s, mins, note = "") => ({
      id: uid(), kind,
      student_id: kind === "lesson" ? students[ref].id : null,
      studio_id: kind === "studio" ? studios[ref].id : null,
      title, start_at: new Date(s).toISOString(), end_at: new Date(s + mins * 60000).toISOString(),
      status: "scheduled", deduct: true, note, series_id: null, occurrence_date: null,
    });
    const s = {
      user: null,
      students,
      studios,
      series: [],
      events: [
        ev("lesson", 0, "", at(0, 9), 60),
        ev("studio", 0, "哈達瑜伽", at(0, 14), 60),
        ev("personal", null, "看牙醫", at(0, 16, 30), 60),
        ev("lesson", 2, "", at(0, 19), 60, "上次說右膝不舒服，避開跪姿"),
        ev("lesson", 0, "", at(1, 10), 60),
        ev("personal", null, "家庭聚餐", at(1, 18), 120),
        ev("lesson", 1, "", at(3, 11), 90),
        ev("lesson", 2, "", at(-2, 15), 60),
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
