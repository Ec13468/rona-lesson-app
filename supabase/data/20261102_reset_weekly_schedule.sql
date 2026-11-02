-- 2026-11-02：清空所有課程資料，依 Rona 的每週課表重新建立（帳號、提醒設定、手機通知保留）
-- 私人課先用學生「私人課（待定）」，單堂 0 元；之後點開換成真正的學生
do $$
declare
  uid uuid; s52 uuid; sdaily uuid; scare uuid;
  c52 uuid; c52air uuid; cdaily uuid; ccare uuid; stu uuid;
  r record; ser uuid; d date; last_d date; first_d date;
  horizon date := current_date + 182;
begin
  select id into uid from auth.users limit 1;

  delete from public.events;
  delete from public.event_series;
  delete from public.packages;
  delete from public.students;
  delete from public.studio_courses;
  delete from public.studios;

  insert into public.studios (user_id, name) values (uid, '52sYoga') returning id into s52;
  insert into public.studios (user_id, name) values (uid, '日常工作室') returning id into sdaily;
  insert into public.studios (user_id, name) values (uid, '晨心長照機構') returning id into scare;

  insert into public.studio_courses (user_id, studio_id, name, base_fee, bonus_after, bonus_per) values (uid, s52, '一般團課', 800, 6, 50) returning id into c52;
  insert into public.studio_courses (user_id, studio_id, name, base_fee, bonus_after, bonus_per) values (uid, s52, '空中瑜伽', 800, 3, 50) returning id into c52air;
  insert into public.studio_courses (user_id, studio_id, name, base_fee, bonus_after, bonus_per) values (uid, sdaily, '一般團課', 800, 0, 0) returning id into cdaily;
  insert into public.studio_courses (user_id, studio_id, name, base_fee, bonus_after, bonus_per) values (uid, scare, '一般團課', 800, 0, 0) returning id into ccare;

  insert into public.students (user_id, name) values (uid, '私人課（待定）') returning id into stu;

  -- 星期（1＝週一）、時間、類型、教室、課程種類、課程名稱
  for r in select * from (values
    (1, '09:10'::time, 'lesson', null::uuid, null::uuid, ''),
    (1, '10:45', 'studio', s52, c52, '瑜珈輪'),
    (1, '12:00', 'lesson', null, null, ''),
    (2, '09:30', 'studio', scare, ccare, '晨心長照'),
    (2, '14:00', 'lesson', null, null, ''),
    (2, '15:30', 'studio', s52, c52, '療癒舒展'),
    (2, '20:00', 'studio', s52, c52, '基礎瑜伽'),
    (3, '11:00', 'studio', s52, c52, '大球核心'),
    (3, '14:30', 'studio', s52, c52air, '低空療癒'),
    (3, '19:30', 'lesson', null, null, ''),
    (4, '14:30', 'lesson', null, null, ''),
    (4, '18:30', 'studio', s52, c52air, '基礎空中'),
    (4, '20:00', 'lesson', null, null, ''),
    (5, '09:30', 'studio', sdaily, cdaily, '皮拉提斯'),
    (5, '10:45', 'studio', sdaily, cdaily, '基礎空中'),
    (5, '13:00', 'lesson', null, null, ''),
    (5, '19:00', 'studio', s52, c52, '皮拉提斯'),
    (5, '20:15', 'studio', s52, c52, '陰陽伸展'),
    (6, '11:00', 'studio', s52, c52, '皮拉提斯'),
    (6, '15:00', 'lesson', null, null, ''),
    (7, '10:00', 'lesson', null, null, '')
  ) as t(dow, tm, kind, studio_id, course_id, title)
  loop
    first_d := date '2026-11-02' + (r.dow - 1);
    insert into public.event_series (user_id, kind, student_id, studio_id, course_id, title, start_date, start_time, duration_min, single_price)
    values (uid, r.kind, case when r.kind = 'lesson' then stu end, r.studio_id, r.course_id, r.title, first_d, r.tm, 60,
            case when r.kind = 'lesson' then 0 end)
    returning id into ser;

    d := first_d;
    while d <= horizon loop
      insert into public.events (user_id, kind, student_id, studio_id, course_id, title, start_at, end_at, series_id, occurrence_date, single_price)
      values (uid, r.kind, case when r.kind = 'lesson' then stu end, r.studio_id, r.course_id, r.title,
              (d + r.tm) at time zone 'Asia/Taipei', (d + r.tm + interval '60 minutes') at time zone 'Asia/Taipei',
              ser, d, case when r.kind = 'lesson' then 0 end);
      last_d := d;
      d := d + 7;
    end loop;
    update public.event_series set generated_until = last_d where id = ser;
  end loop;
end $$;
