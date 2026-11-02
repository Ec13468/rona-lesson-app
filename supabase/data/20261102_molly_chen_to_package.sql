-- 2026-11-02：Molly、陳姐的課從「單堂 0 元」（由私人課（待定）換過來）改成扣方案
update events set single_price = null where student_id in (select id from students where name in ('Molly 一對二','陳姐 一對一'));
update event_series set single_price = null where student_id in (select id from students where name in ('Molly 一對二','陳姐 一對一'));
