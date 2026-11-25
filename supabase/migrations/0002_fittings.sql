-- SC Fitting Sim — 2단계: 피팅 서버 저장과 공개 범위
-- 0001_init.sql 적용 후 실행.
-- 공개 피팅: 로그인 없이(anon 포함) 누구나 열람.
-- 그룹 지정 피팅: 직접 DB 접근 불가. fittings-api가 요청마다 Discord 역할을
-- 즉시 재검증한 뒤 중개한다 (유예 없음). my_group_ids의 1시간 신선도 캐시는
-- 내 그룹 목록·피팅의 대상 그룹 표시 같은 메타데이터에만 쓰이고 피팅 내용의
-- 접근 권한은 주지 않는다.
-- 작성자 예외는 기획에서 명시적으로 제거됐다: 탈퇴·만료 후 작성자도 차단.
-- 관리자 전체 열람은 사용자 미결정 사항이라 넣지 않는다.
-- 관리자의 숨김/삭제는 내용을 반환하지 않는 admin_moderate_fitting 함수로만 한다.
-- RLS 정책 간 상호 참조(무한 재귀)를 피하기 위해 교차 조회는
-- 모두 security definer 함수를 거친다.

create table public.fittings (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  ship_slug text not null,
  name text not null,
  payload jsonb not null,
  visibility text not null default 'public' check (visibility in ('public', 'groups')),
  patch_version text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fittings_public_idx on public.fittings (created_at desc) where visibility = 'public' and not hidden;

-- 피팅에 지정된 그룹 목록 (RLS 우회, 읽기 전용 계산)
create or replace function public.fitting_group_ids(p_fitting_id uuid)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select group_id from public.fitting_groups where fitting_id = p_fitting_id;
$$;

-- 피팅 열람 가능 여부의 단일 정의 (정책과 다른 테이블 정책이 공용)
create or replace function public.fitting_is_visible(p_fitting_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.fittings f
    where f.id = p_fitting_id
      and not f.hidden
      and (
        f.visibility = 'public'
        or exists (
          -- 작성자 예외 없음: 그룹 탈퇴·확인 만료 후에는 작성자 본인도
          -- 비공개 피팅을 읽을 수 없다 (기획 확정 사항)
          select 1 from public.fitting_group_ids(f.id) gid
          where gid in (select public.my_group_ids())
        )
      )
  );
$$;

alter table public.fittings enable row level security;

-- PostgREST 직접 읽기는 공개 피팅만. 그룹 지정 피팅과 본인 목록은
-- fittings-api Edge Function이 Discord 역할을 즉시 재검증한 뒤 중개한다
-- (클라이언트가 재확인 호출을 생략하고 DB를 직접 치는 우회 차단).
create policy "fittings_select_public"
  on public.fittings for select
  using (not hidden and visibility = 'public');

-- 직접 쓰기는 공개 피팅뿐. 그룹 지정 피팅의 생성·수정·삭제·공개범위 변경은
-- 모두 fittings-api Edge Function이 Discord 역할을 즉시 재검증한 뒤 중개한다.
-- (확인 캐시가 TTL 안에 남은 상태의 쓰기 우회 차단)
create policy "fittings_insert_member"
  on public.fittings for insert
  with check (auth.uid() is not null and author_id = auth.uid() and visibility = 'public');

create policy "fittings_update_author"
  on public.fittings for update
  using (author_id = auth.uid() and visibility = 'public' and not hidden)
  with check (author_id = auth.uid() and visibility = 'public');

create policy "fittings_delete_author"
  on public.fittings for delete
  using (author_id = auth.uid() and visibility = 'public');

-- ===== 피팅별 공개 대상 그룹 =====

create table public.fitting_groups (
  fitting_id uuid not null references public.fittings (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  primary key (fitting_id, group_id)
);

alter table public.fitting_groups enable row level security;

-- 읽기: 피팅이 보이는 사람은 대상 그룹 목록(메타데이터)도 볼 수 있다.
-- 그룹 지정 피팅의 내용(payload)은 이 정책과 무관하게 fittings-api만 반환한다.
create policy "fitting_groups_select"
  on public.fitting_groups for select
  using (public.fitting_is_visible(fitting_id));

-- 지정: 직접 쓰기 정책 없음. fittings-api(service role)만 쓴다.
-- 읽기 정책은 위 fitting_groups_select만 유지.

-- ===== 관리자 중재 (내용 열람 없이 숨김/해제/삭제) =====
-- 반환값 없이 상태만 바꾸고 관리 기록을 남긴다.

create or replace function public.admin_moderate_fitting(
  p_fitting_id uuid,
  p_action text  -- 'hide' | 'unhide' | 'delete'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_action = 'hide' then
    update public.fittings set hidden = true, updated_at = now() where id = p_fitting_id;
  elsif p_action = 'unhide' then
    update public.fittings set hidden = false, updated_at = now() where id = p_fitting_id;
  elsif p_action = 'delete' then
    delete from public.fittings where id = p_fitting_id;
  else
    raise exception 'unknown action';
  end if;
  insert into public.audit_log (actor_id, action, target)
  values (auth.uid(), 'fitting_' || p_action, p_fitting_id::text);
end;
$$;

revoke all on function public.admin_moderate_fitting(uuid, text) from public;
grant execute on function public.admin_moderate_fitting(uuid, text) to authenticated;
