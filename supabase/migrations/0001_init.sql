-- SC Fitting Sim — 멀티유저 권한 기반 스키마 (1단계: 로그인·역할·그룹·관리자)
-- Supabase SQL Editor 또는 `supabase db push`로 실행.
-- 권한 판단은 auth.uid() + 서버 측 권한 테이블만 근거로 한다.
-- 브라우저에서 변경 가능한 user_metadata는 권한 근거로 쓰지 않는다.

-- ===== 헬퍼 함수 =====

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and site_role = 'admin'
  );
$$;

-- 그룹 소속의 유일한 근거는 Discord 역할이다: 서버 측에 기록된 보유 역할
-- (member_discord_roles)이 역할↔그룹 연결(discord_role_mappings)과 맞고,
-- 마지막 서버 멤버십 확인이 DISCORD_CHECK_TTL 이내여야 한다.
-- group_members는 관리 화면 표시용 캐시일 뿐 권한 근거가 아니다.
-- 따라서 관리자 직접 배정이나 캐시 행 삽입만으로는 접근 권한이 생기지
-- 않는다(미승인 우회 예외 없음). 역할을 잃은 서버 멤버도 차단된다.
-- 확인이 TTL보다 오래되면 재확인 전까지 소속 불인정(fail-closed).
create or replace function public.discord_check_ttl()
returns interval
language sql
immutable
as $$ select interval '1 hour' $$;

create or replace function public.my_group_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select distinct drm.group_id
  from public.discord_role_mappings drm
  join public.member_discord_roles mdr
    on mdr.guild_id = drm.guild_id
   and mdr.discord_role_id = drm.discord_role_id
   and mdr.user_id = auth.uid()
  where exists (
    select 1 from public.member_guild_checks c
    where c.user_id = auth.uid()
      and c.guild_id = drm.guild_id
      and c.is_member
      and c.checked_at > now() - public.discord_check_ttl()
  );
$$;

-- ===== 회원 =====

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  discord_user_id text unique,
  display_name text,
  site_role text not null default 'member'
    check (site_role in ('member', 'researcher', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- 클라이언트 직접 insert/update 없음. 프로필 생성은 가입 트리거,
-- Discord 정보 갱신은 Edge Function(서비스 롤)만 한다.
-- 관리자의 역할 변경은 아래 정책으로만 허용.
create policy "profiles_update_admin"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

-- 가입 시 최소 프로필 자동 생성 (Discord ID는 sync 함수가 확정)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name',
                           new.raw_user_meta_data ->> 'name',
                           '회원'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== 그룹 =====

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.groups enable row level security;

create policy "groups_select_member_or_admin"
  on public.groups for select
  using (public.is_admin() or id in (select public.my_group_ids()));

create policy "groups_write_admin"
  on public.groups for all
  using (public.is_admin())
  with check (public.is_admin());

-- ===== 그룹 소속 =====
-- source: 'manual' = 관리자가 배정, 'discord' = Discord 역할 동기화로 배정

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'discord')),
  added_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

create policy "group_members_select_own_or_admin"
  on public.group_members for select
  using (user_id = auth.uid() or public.is_admin());

create policy "group_members_write_admin"
  on public.group_members for all
  using (public.is_admin())
  with check (public.is_admin());

-- ===== Discord 역할 ↔ 그룹 연결 =====

create table public.discord_role_mappings (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  discord_role_id text not null,
  discord_role_name text,
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (guild_id, discord_role_id, group_id)
);

alter table public.discord_role_mappings enable row level security;

create policy "role_mappings_admin_only"
  on public.discord_role_mappings for all
  using (public.is_admin())
  with check (public.is_admin());

-- ===== Discord 역할 확인 결과 (서버 측 기록) =====
-- Edge Function만 쓴다. 권한 회수 판단의 근거.

create table public.member_discord_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  guild_id text not null,
  discord_role_id text not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, guild_id, discord_role_id)
);

alter table public.member_discord_roles enable row level security;

create policy "member_roles_select_own_or_admin"
  on public.member_discord_roles for select
  using (user_id = auth.uid() or public.is_admin());

-- 서버 멤버십 마지막 확인 시각
create table public.member_guild_checks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  guild_id text not null,
  is_member boolean not null,
  checked_at timestamptz not null default now(),
  primary key (user_id, guild_id)
);

alter table public.member_guild_checks enable row level security;

create policy "guild_checks_select_own_or_admin"
  on public.member_guild_checks for select
  using (user_id = auth.uid() or public.is_admin());

-- ===== 관리 기록 =====

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "audit_select_admin"
  on public.audit_log for select
  using (public.is_admin());

create policy "audit_insert_self_or_admin"
  on public.audit_log for insert
  with check (actor_id = auth.uid() or public.is_admin());

-- ===== 첫 관리자 =====
-- 설치 후 사용자 본인의 회원 ID로 한 번 실행:
--   update public.profiles set site_role = 'admin' where id = '<본인 회원 UUID>';
-- 회원 UUID는 로그인 후 Supabase 대시보드 Authentication > Users에서 확인.
