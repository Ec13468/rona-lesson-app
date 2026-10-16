-- 每天自動叫醒資料庫用：回傳現在時間，不碰任何資料
create or replace function public.ping() returns timestamptz
language sql stable as $$ select now() $$;
grant execute on function public.ping() to anon;
