-- 第 3 階段：上課提醒正式版、每週時數上限

-- 每個人的設定：課前幾分鐘提醒、哪些類型要提醒、每週授課時數上限
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  remind_minutes integer not null default 120 check (remind_minutes between 5 and 1440),
  remind_lesson boolean not null default true,
  remind_studio boolean not null default true,
  remind_personal boolean not null default false,
  week_limit numeric not null default 20 check (week_limit > 0),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "own rows" on public.user_settings;
create policy "own rows" on public.user_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update, delete on public.user_settings to service_role;

-- 手機的通知訂閱：綁定登入的人
alter table public.push_subscriptions add column if not exists user_id uuid references auth.users(id) on delete cascade;
drop policy if exists "own rows" on public.push_subscriptions;
create policy "own rows" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
alter table public.push_subscriptions alter column user_id set default auth.uid();

-- 每一堂：要不要提醒（空白＝照類型設定）、已經提醒過哪個開始時間（改期後會再提醒）
alter table public.events add column if not exists remind boolean;
alter table public.events add column if not exists reminded_for timestamptz;
create index if not exists events_remind_scan on public.events (start_at) where status = 'scheduled';
