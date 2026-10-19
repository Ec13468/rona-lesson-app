-- 第 2 階段：學生方案、單堂價、教室課上課人數

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  lessons integer not null check (lessons > 0),
  price integer not null check (price >= 0),
  purchased_on date not null default current_date,
  expires_on date,
  created_at timestamptz not null default now()
);

alter table public.students add column if not exists per_lesson_price integer check (per_lesson_price >= 0);
alter table public.events add column if not exists attendance integer check (attendance >= 0);

alter table public.packages enable row level security;
drop policy if exists "own rows" on public.packages;
create policy "own rows" on public.packages
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.packages to authenticated, service_role;
