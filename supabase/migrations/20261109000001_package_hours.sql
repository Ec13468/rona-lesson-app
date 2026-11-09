-- 方案改成儲值時數（lessons 欄位現在代表「小時」，可以是 1.5 這種小數；原本 1 堂＝1 小時）
alter table public.packages alter column lessons type numeric(7,2) using lessons::numeric;
