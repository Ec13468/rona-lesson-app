-- 第 1.5 階段：教室分類、固定每週的課

-- 教室：鐘點費規則跟著教室（底薪＋超過 N 人每人加 X 元），第 2 階段開始計算
create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  base_fee integer not null default 0,
  bonus_after integer not null default 0,
  bonus_per integer not null default 0,
  created_at timestamptz not null default now()
);

-- 固定每週的課：記規則，實際每一堂另外產生在 events 裡
create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('lesson', 'studio')),
  student_id uuid references public.students(id) on delete set null,
  studio_id uuid references public.studios(id) on delete set null,
  title text not null default '',
  start_date date not null,
  start_time time not null,
  duration_min integer not null check (duration_min between 5 and 600),
  end_date date,
  generated_until date,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

alter table public.events add column if not exists studio_id uuid references public.studios(id) on delete set null;
alter table public.events add column if not exists series_id uuid references public.event_series(id) on delete set null;
alter table public.events add column if not exists occurrence_date date;
create unique index if not exists events_series_occurrence on public.events (series_id, occurrence_date);

alter table public.events drop constraint if exists events_studio_needs_studio;
alter table public.events add constraint events_studio_needs_studio check (kind <> 'studio' or studio_id is not null);

alter table public.studios enable row level security;
alter table public.event_series enable row level security;

drop policy if exists "own rows" on public.studios;
create policy "own rows" on public.studios
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own rows" on public.event_series;
create policy "own rows" on public.event_series
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.studios, public.event_series to authenticated, service_role;
