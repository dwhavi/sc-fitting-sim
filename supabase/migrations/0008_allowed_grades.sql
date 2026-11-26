-- 자료별 열람 등급을 "허용 등급 집합"으로 바꾼다. 0~3 중 임의 조합(비연속 포함), 기본은 모두 허용.
-- 4등급은 보안 자료를 볼 수 없으므로 집합에 들어갈 수 없다.
alter table public.fittings
  add column if not exists allowed_grades smallint[] not null default '{0,1,2,3}';
update public.fittings set allowed_grades = (select array_agg(g::smallint order by g) from generate_series(0, max_grade) g)
  where max_grade is not null and max_grade < 3;
alter table public.fittings drop constraint if exists fittings_allowed_grades_check;
alter table public.fittings add constraint fittings_allowed_grades_check
  check (cardinality(allowed_grades) between 1 and 4 and allowed_grades <@ array[0,1,2,3]::smallint[]);
alter table public.fittings drop column if exists max_grade;
