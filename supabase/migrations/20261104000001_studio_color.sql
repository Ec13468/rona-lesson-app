-- 每間教室一個顏色（日曆上分辨類別用）；空白＝依建立順序自動配色
alter table public.studios add column if not exists color text;
