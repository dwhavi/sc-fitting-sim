-- 자료별 열람 등급: 0~3 중 선택 (max_grade = 열람 가능한 가장 낮은 등급 번호의 상한)
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.fittings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%max_grade%'
  loop execute format('alter table public.fittings drop constraint %I', c); end loop;
end $$;
alter table public.fittings add constraint fittings_max_grade_check check (max_grade between 0 and 3);
