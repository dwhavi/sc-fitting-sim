-- SC Fitting Sim — 4단계: 댓글과 테스트 수치 기록
-- 0002_fittings.sql 적용 후 실행.
-- 댓글: 공개 피팅은 로그인 회원 누구나, 그룹 지정 피팅은 현재 소속 확인된
--   그룹 회원만 쓸 수 있다. 읽기는 피팅 열람 권한과 같다.
--   역할을 잃어도 이미 단 댓글은 피팅에 남는다 (기획서 명시).
-- 테스트 기록: 비공개(그룹 지정) 피팅에만 붙는다. 측정 조건, 수치(jsonb),
--   게임 패치 버전, 메모를 구조화해 저장한다.
-- 두 테이블 모두 클라이언트 직접 접근 정책을 두지 않는다 (RLS만 켜고 정책 없음
-- = anon/authenticated 전면 차단). 모든 읽기·쓰기는 fittings-api가
-- Discord 역할을 즉시 재검증한 뒤 service role로 중개한다.
-- 수정·삭제는 본인 글만, 삭제는 사이트 관리자도 가능하다.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  fitting_id uuid not null references public.fittings (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_fitting_idx on public.comments (fitting_id, created_at);

create table public.test_records (
  id uuid primary key default gen_random_uuid(),
  fitting_id uuid not null references public.fittings (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  conditions text not null check (char_length(conditions) between 1 and 2000),
  values jsonb not null default '{}'::jsonb,
  patch_version text,
  memo text check (memo is null or char_length(memo) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index test_records_fitting_idx on public.test_records (fitting_id, created_at);

alter table public.comments enable row level security;
alter table public.test_records enable row level security;

-- 공개 피팅의 댓글은 피팅 내용의 일부로 누구나 읽을 수 있다 (쓰기는 fittings-api만).
create policy comments_select_public on public.comments for select
  using (exists (
    select 1 from public.fittings f
    where f.id = fitting_id and f.visibility = 'public' and not f.hidden
  ));
-- test_records에는 정책을 만들지 않는다: 그룹 지정 피팅 전용이므로
-- 직접 접근은 전면 차단, fittings-api(service role)만 통과.

-- 작성자 표시 이름 조회는 fittings-api가 service role로 profiles를 함께 읽어 처리.
