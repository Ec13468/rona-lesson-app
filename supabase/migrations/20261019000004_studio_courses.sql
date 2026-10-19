-- 教室底下分「課程種類」，鐘點費跟著課程種類（例如 52sYoga 的一般課、空中瑜伽）

create table if not exists public.studio_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  base_fee integer not null default 0 check (base_fee >= 0),
  bonus_after integer not null default 0 check (bonus_after >= 0),
  bonus_per integer not null default 0 check (bonus_per >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.events add column if not exists course_id uuid references public.studio_courses(id) on delete set null;
alter table public.event_series add column if not exists course_id uuid references public.studio_courses(id) on delete set null;

alter table public.studio_courses enable row level security;
drop policy if exists "own rows" on public.studio_courses;
create policy "own rows" on public.studio_courses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.studio_courses to authenticated, service_role;

-- 搬資料：每間教室原本的鐘點費變成「一般課」
insert into public.studio_courses (user_id, studio_id, name, base_fee, bonus_after, bonus_per)
select s.user_id, s.id, '一般課', s.base_fee, s.bonus_after, s.bonus_per
from public.studios s
where s.name <> '52sYoga 空中瑜伽'
  and not exists (select 1 from public.studio_courses c where c.studio_id = s.id);

-- 「52sYoga 空中瑜伽」併進 52sYoga，成為它底下的「空中瑜伽」
insert into public.studio_courses (user_id, studio_id, name, base_fee, bonus_after, bonus_per)
select y.user_id, y.id, '空中瑜伽', a.base_fee, a.bonus_after, a.bonus_per
from public.studios a
join public.studios y on y.user_id = a.user_id and y.name = '52sYoga'
where a.name = '52sYoga 空中瑜伽'
  and not exists (select 1 from public.studio_courses c where c.studio_id = y.id and c.name = '空中瑜伽');

update public.events e set studio_id = y.id,
  course_id = (select c.id from public.studio_courses c where c.studio_id = y.id and c.name = '空中瑜伽')
from public.studios a join public.studios y on y.user_id = a.user_id and y.name = '52sYoga'
where a.name = '52sYoga 空中瑜伽' and e.studio_id = a.id;

update public.event_series r set studio_id = y.id,
  course_id = (select c.id from public.studio_courses c where c.studio_id = y.id and c.name = '空中瑜伽')
from public.studios a join public.studios y on y.user_id = a.user_id and y.name = '52sYoga'
where a.name = '52sYoga 空中瑜伽' and r.studio_id = a.id;

delete from public.studios where name = '52sYoga 空中瑜伽';

-- 其他教室課：沒有課程種類的，掛到該教室的「一般課」，名稱也跟著課程種類
update public.events e set course_id = c.id
from public.studio_courses c
where e.kind = 'studio' and e.course_id is null and c.studio_id = e.studio_id and c.name = '一般課';

update public.event_series r set course_id = c.id
from public.studio_courses c
where r.kind = 'studio' and r.course_id is null and c.studio_id = r.studio_id and c.name = '一般課';

update public.events e set title = c.name from public.studio_courses c where e.course_id = c.id;
update public.event_series r set title = c.name from public.studio_courses c where r.course_id = c.id;
