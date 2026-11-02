-- 日常工作室（2026-11-02）：還原 Rona 自己的設定，並把地板瑜珈改成階梯式鐘點費
-- 皮拉提斯 → 地板瑜珈（700，6 人 750、8 人 800）；基礎空中 → 空中瑜珈（800）；移除多建的「空中課」
do $$
declare sid uuid; floor_id uuid; air_id uuid; extra_id uuid;
begin
  select id into sid from public.studios where name = '日常工作室';
  select id into floor_id from public.studio_courses where studio_id = sid and name = '地板瑜珈';
  select id into air_id from public.studio_courses where studio_id = sid and name = '空中瑜珈';
  select id into extra_id from public.studio_courses where studio_id = sid and name = '空中課';
  update public.events set course_id = floor_id where studio_id = sid and title = '皮拉提斯';
  update public.event_series set course_id = floor_id where studio_id = sid and title = '皮拉提斯';
  update public.events set course_id = air_id where studio_id = sid and title = '基礎空中';
  update public.event_series set course_id = air_id where studio_id = sid and title = '基礎空中';
  delete from public.studio_courses where id = extra_id;
  update public.studio_courses set fee_mode = 'tier', base_fee = 700, tiers = '[{"min":6,"fee":750},{"min":8,"fee":800}]'::jsonb where id = floor_id;
end $$;
