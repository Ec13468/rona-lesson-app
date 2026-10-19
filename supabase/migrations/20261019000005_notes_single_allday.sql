-- 上課筆記、單堂付費金額（記在每一堂）、整天行程
alter table public.events add column if not exists lesson_notes text not null default '';
alter table public.events add column if not exists single_price integer check (single_price >= 0);
alter table public.events add column if not exists all_day boolean not null default false;
alter table public.event_series add column if not exists single_price integer check (single_price >= 0);
