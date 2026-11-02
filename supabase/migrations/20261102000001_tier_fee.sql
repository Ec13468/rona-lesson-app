-- 鐘點費兩種算法：bonus＝超過 N 人每人加 X；tier＝達到某人數，整堂換成某金額
alter table public.studio_courses add column if not exists fee_mode text not null default 'bonus' check (fee_mode in ('bonus', 'tier'));
alter table public.studio_courses add column if not exists tiers jsonb not null default '[]'::jsonb;
