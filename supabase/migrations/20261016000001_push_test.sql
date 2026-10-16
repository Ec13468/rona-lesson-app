-- 第 0 階段：試做上課提醒
-- 手機訂閱通知的資料，以及測試用的提醒

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.test_reminders (
  id bigint generated always as identity primary key,
  fire_at timestamptz not null,
  title text not null,
  body text not null default '',
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.test_reminders enable row level security;

-- 試做階段還沒有登入功能：網頁只能新增，不能讀取或修改
drop policy if exists "test insert" on public.push_subscriptions;
create policy "test insert" on public.push_subscriptions
  for insert to anon with check (true);

drop policy if exists "test insert" on public.test_reminders;
create policy "test insert" on public.test_reminders
  for insert to anon
  with check (fire_at between now() and now() + interval '1 day');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 權限：寄送程式可以讀寫；網頁只能新增
grant select, insert, update, delete on public.push_subscriptions, public.test_reminders to service_role;
grant insert on public.push_subscriptions, public.test_reminders to anon;
