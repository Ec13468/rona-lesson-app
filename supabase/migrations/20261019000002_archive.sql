-- 刪除有上課紀錄的學生或教室時，只從清單隱藏，紀錄保留
alter table public.students add column if not exists archived_at timestamptz;
alter table public.studios add column if not exists archived_at timestamptz;
