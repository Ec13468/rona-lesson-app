// 每分鐘由排程呼叫一次：找出時間到了的提醒，推播到已訂閱的手機
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

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const { data: due, error } = await supabase
    .from("test_reminders")
    .select("id, title, body")
    .is("sent_at", null)
    .lte("fire_at", new Date().toISOString());
  if (error) return new Response(error.message, { status: 500 });
  if (!due?.length) return Response.json({ sent: 0 });

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  let sent = 0;
  for (const r of due) {
    const errors: string[] = [];
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: r.title, body: r.body }),
          { TTL: 3600, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 手機已取消訂閱：刪掉這筆
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
        }
        errors.push(`${code ?? ""} ${(e as Error).message}`);
      }
    }
    await supabase
      .from("test_reminders")
      .update({ sent_at: new Date().toISOString(), error: errors.join("; ") || null })
      .eq("id", r.id);
  }
  return Response.json({ reminders: due.length, sent });
});
