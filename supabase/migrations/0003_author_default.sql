-- 작성자 기본값: 클라이언트가 author_id를 생략해도 로그인 사용자로 채운다.
-- 정책(fittings_insert_member)이 author_id = auth.uid()를 강제하므로
-- 타인을 작성자로 지정하는 스푸핑은 여전히 불가.
alter table public.fittings
  alter column author_id set default auth.uid();
