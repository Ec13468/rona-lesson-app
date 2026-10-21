// 上課提醒：排程每分鐘呼叫一次，找出「時間到了該提醒」的行程，推播到本人的手機
// 另外，登入的人可以要求送一則測試通知（{ test: true }）
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const DEFAULTS = { remind_minutes: 120, remind_lesson: true, remind_studio: true, remind_personal: false };
const TZ = "Asia/Taipei";
const hhmm = (d: Date) => d.toLocaleTimeString("zh-TW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

// 推播給某個人的所有手機；手機已取消訂閱的順便刪掉
async function pushTo(userId: string, payload: { title: string; body: string }) {
  const { data: subs } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

function lead(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} 小時後`;
  if (minutes > 60) return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分鐘後`;
  return `${minutes} 分鐘後`;
}

async function sendDue() {
  const now = new Date();
  const until = new Date(now.getTime() + 24 * 3600 * 1000);
  const { data: events, error } = await supabase
    .from("events")
    .select("id, user_id, kind, title, start_at, end_at, all_day, note, remind, reminded_for, student_id, studio_id, course_id")
    .eq("status", "scheduled")
    .gt("start_at", now.toISOString())
    .lte("start_at", until.toISOString());
  if (error) throw new Error(error.message);
  const pending = (events ?? []).filter((e) => !e.all_day && (!e.reminded_for || new Date(e.reminded_for).getTime() !== new Date(e.start_at).getTime()));
  if (!pending.length) return { checked: 0, sent: 0 };

  const users = [...new Set(pending.map((e) => e.user_id))];
  const { data: settingsRows } = await supabase.from("user_settings").select("*").in("user_id", users);
  const settingsOf = (u: string) => ({ ...DEFAULTS, ...(settingsRows ?? []).find((r) => r.user_id === u) });

  const ids = (k: string) => [...new Set(pending.map((e) => e[k]).filter(Boolean))];
  const [{ data: students }, { data: studios }, { data: courses }] = await Promise.all([
    supabase.from("students").select("id, name").in("id", ids("student_id")),
    supabase.from("studios").select("id, name").in("id", ids("studio_id")),
    supabase.from("studio_courses").select("id, name").in("id", ids("course_id")),
  ]);
  const nameOf = (list: { id: string; name: string }[] | null, id: string) => list?.find((x) => x.id === id)?.name ?? "";

  let sent = 0;
  for (const e of pending) {
    const st = settingsOf(e.user_id);
    const start = new Date(e.start_at);
    if (start.getTime() - st.remind_minutes * 60000 > now.getTime()) continue; // 還沒到提醒時間
    const typeOn = e.kind === "lesson" ? st.remind_lesson : e.kind === "studio" ? st.remind_studio : st.remind_personal;
    const want = e.remind ?? typeOn;
    if (want) {
      const what = e.kind === "lesson" ? `一對一・${nameOf(students, e.student_id)}`
        : e.kind === "studio" ? `${nameOf(studios, e.studio_id)}・${e.title && e.title !== nameOf(courses, e.course_id) ? `${e.title}（${nameOf(courses, e.course_id)}）` : nameOf(courses, e.course_id) || e.title}`
        : e.title;
      const minutesLeft = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60000));
      const body = `${hhmm(start)}–${hhmm(new Date(e.end_at))}（${lead(minutesLeft >= st.remind_minutes - 2 ? st.remind_minutes : minutesLeft)}開始）${e.note ? `\n備註：${e.note}` : ""}`;
      sent += await pushTo(e.user_id, { title: what, body });
    }
    await supabase.from("events").update({ reminded_for: e.start_at }).eq("id", e.id);
  }
  return { checked: pending.length, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 排程呼叫
  if (req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET")) {
    try {
      return Response.json(await sendDue());
    } catch (e) {
      return new Response((e as Error).message, { status: 500 });
    }
  }

  // 登入的人要求測試通知
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  if (!data.user) return new Response("forbidden", { status: 403, headers: cors });
  const sent = await pushTo(data.user.id, { title: "Rona 課表", body: "通知設定完成！之後上課前會在這裡提醒你。" });
  return Response.json({ sent }, { headers: cors });
});
