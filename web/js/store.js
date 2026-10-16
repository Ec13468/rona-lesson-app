// 資料存取：正式版存雲端（Supabase），展示版存在這台電腦的瀏覽器
import { SUPABASE_URL, SUPABASE_PUBLIC_KEY, DEMO } from "./config.js";
import { addDays, startOfDay } from "./logic.js";

const toEvent = (r) => ({
  id: r.id,
  kind: r.kind,
  studentId: r.student_id,
  title: r.title,
  start: new Date(r.start_at),
  end: new Date(r.end_at),
  status: r.status,
  deduct: r.deduct,
  note: r.note,
});

const toRow = (e) => ({
  kind: e.kind,
  student_id: e.kind === "lesson" ? e.studentId : null,
  title: e.title ?? "",
  start_at: e.start.toISOString(),
  end_at: e.end.toISOString(),
  status: e.status ?? "scheduled",
  deduct: e.deduct ?? true,
  note: e.note ?? "",
});

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
      return check(await (await db()).from("students").select("id, name").order("created_at"));
    },
    async addStudent(name) {
      return check(await (await db()).from("students").insert({ name }).select("id, name").single());
    },
    async listEvents(from, to) {
      const rows = check(
        await (await db())
          .from("events")
          .select("*")
          .gte("start_at", from.toISOString())
          .lt("start_at", to.toISOString())
          .order("start_at")
          .limit(5000),
      );
      return rows.map(toEvent);
    },
    async saveEvent(e) {
      const q = (await db()).from("events");
      const row = { ...toRow(e), updated_at: new Date().toISOString() };
      const res = e.id ? await q.update(row).eq("id", e.id).select().single() : await q.insert(row).select().single();
      return toEvent(check(res));
    },
    async deleteEvent(id) {
      check(await (await db()).from("events").delete().eq("id", id));
    },
  };
}

// 展示版：附幾筆假資料，方便在電腦上把每個功能點一遍
function demoStore() {
  const KEY = "rona-demo-v1";
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
    const t = startOfDay(new Date());
    const at = (dayOffset, h, m = 0) => addDays(t, dayOffset).getTime() + (h * 60 + m) * 60000;
    const students = [
      { id: uid(), name: "王小美" },
      { id: uid(), name: "陳怡君" },
      { id: uid(), name: "林佳穎" },
    ];
    const ev = (kind, studentIdx, title, s, mins) => ({
      id: uid(), kind, student_id: studentIdx == null ? null : students[studentIdx].id, title,
      start_at: new Date(s).toISOString(), end_at: new Date(s + mins * 60000).toISOString(),
      status: "scheduled", deduct: true, note: "",
    });
    const s = {
      user: null,
      students,
      events: [
        ev("lesson", 0, "", at(0, 9), 60),
        ev("lesson", 1, "", at(0, 14), 60),
        ev("personal", null, "看牙醫", at(0, 16, 30), 60),
        ev("lesson", 2, "", at(0, 19), 75),
        ev("lesson", 0, "", at(1, 10), 60),
        ev("personal", null, "家庭聚餐", at(1, 18), 120),
        ev("lesson", 1, "", at(3, 11), 90),
        ev("lesson", 2, "", at(-2, 15), 60),
      ],
    };
    save(s);
    return s;
  }

  return {
    async currentUser() { return load().user; },
    async signIn(email) {
      const s = load();
      s.user = { email: email || "demo@localhost" };
      save(s);
      return s.user;
    },
    async signOut() { const s = load(); s.user = null; save(s); },
    async listStudents() { return load().students; },
    async addStudent(name) {
      const s = load();
      const st = { id: uid(), name };
      s.students.push(st);
      save(s);
      return st;
    },
    async listEvents(from, to) {
      return load().events.map(toEvent).filter((e) => e.start >= from && e.start < to);
    },
    async saveEvent(e) {
      const s = load();
      const row = { ...toRow(e), id: e.id || uid() };
      const i = s.events.findIndex((x) => x.id === row.id);
      if (i >= 0) s.events[i] = row; else s.events.push(row);
      save(s);
      return toEvent(row);
    },
    async deleteEvent(id) {
      const s = load();
      s.events = s.events.filter((x) => x.id !== id);
      save(s);
    },
  };
}

export const store = DEMO ? demoStore() : cloudStore();
