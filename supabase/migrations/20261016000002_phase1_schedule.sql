-- 第 1 階段：學生與行程
-- 每筆資料都綁定登入者本人，別人看不到

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

-- kind：lesson＝一對一課、personal＝個人行程、studio＝教室固定課（第 2 階段啟用）
-- status：scheduled＝已排定、done＝已上完、cancelled＝已取消
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('lesson', 'personal', 'studio')),
  student_id uuid references public.students(id) on delete set null,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  deduct boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (kind <> 'lesson' or student_id is not null)
);

create index if not exists events_user_start on public.events (user_id, start_at);

alter table public.students enable row level security;
alter table public.events enable row level security;

drop policy if exists "own rows" on public.students;
create policy "own rows" on public.students
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own rows" on public.events;
create policy "own rows" on public.events
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.students, public.events to authenticated;
grant select, insert, update, delete on public.students, public.events to service_role;
