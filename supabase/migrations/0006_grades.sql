-- 등급 기반 권한 (사용자 결정 2026-11-26 14:06~14:09): 그룹 지정을 등급으로 대체.
-- 등급 0~4. 등급의 근거는 Discord 역할 → 등급 연결(이 테이블)이고, fittings-api가
-- 요청마다 재검증한 역할로 계산한다. 계산 실패·미연결·탈퇴는 4등급.
-- 보안 자료(visibility='security')는 기본 0~3등급 열람, max_grade=2면 0~2등급만.

alter table public.fittings drop constraint if exists fittings_visibility_check;
alter table public.fittings
  add constraint fittings_visibility_check check (visibility in ('public', 'groups', 'security'));
-- 이전 그룹 지정 피팅은 보안 자료로 이관 (적용 시점 0건 확인).
update public.fittings set visibility = 'security' where visibility = 'groups';
alter table public.fittings
  add column if not exists max_grade smallint not null default 3 check (max_grade in (2, 3));

create table if not exists public.discord_role_grade_mappings (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  discord_role_id text not null,
  discord_role_name text,
  grade smallint not null check (grade between 0 and 3),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (guild_id, discord_role_id)
);
alter table public.discord_role_grade_mappings enable row level security;
create policy grade_mappings_admin_only on public.discord_role_grade_mappings for all
  using (public.is_admin()) with check (public.is_admin());
