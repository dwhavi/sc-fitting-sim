# Discord 로그인·역할 연동 설정 안내

사이트는 이미 코드가 올라가 있고, 아래 설정을 마치면 로그인과 권한 연동이 켜진다.
설정 전에는 로그인 버튼이 "준비 중"으로 표시되고 기존 기능은 그대로 동작한다.

예상 소요: 30~40분. 봇은 임시 Discord 서버에서 먼저 시험하는 것을 권장.

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에서 GitHub 계정으로 가입 (무료).
2. **New project** → 이름 아무거나(예: `sc-fitting-sim`), DB 비밀번호 생성(안전하게 보관), 리전 **Northeast Asia (Seoul)** 선택.
3. 프로젝트가 만들어지면 **Project Settings > API** 에서 두 값을 복사:
   - `Project URL`
   - `anon public` 키 (공개돼도 되는 키. `service_role` 키는 절대 코드에 넣지 않음)

## 2. DB 테이블 만들기

1. Supabase 대시보드 **SQL Editor** → **New query**.
2. 이 저장소의 `supabase/migrations/0001_init.sql` 전체를 붙여넣고 **Run**.
3. 같은 방법으로 `supabase/migrations/0002_fittings.sql`도 실행.
4. **Table Editor**에서 profiles, groups, group_members, discord_role_mappings, member_discord_roles, member_guild_checks, audit_log, fittings, fitting_groups 테이블이 보이면 성공.

## 3. Discord 개발자 앱과 봇 만들기

1. https://discord.com/developers/applications → **New Application** (이름 예: `SC Fitting Sim`).
2. **OAuth2** 메뉴:
   - **Redirects**에 Supabase 콜백 URL 추가: `https://<프로젝트ID>.supabase.co/auth/v1/callback`
   - `Client ID`와 `Client Secret`(Reset Secret으로 발급)을 복사.
3. **Bot** 메뉴:
   - **Reset Token**으로 봇 토큰 발급 → 안전하게 보관 (이후 다시 못 봄).
   - Privileged Gateway Intents는 이 구성에서 필요 없음 (REST만 사용).
4. 봇을 서버에 설치 (임시 서버 권장):
   - **OAuth2 > URL Generator**에서 scope `bot` 선택, 권한은 아무것도 체크하지 않아도 됨(역할 조회는 봇이 서버에 있는 것만으로 가능).
   - 만들어진 URL을 열어 임시 서버에 추가. 서버 소유자나 관리 권한자만 가능.

## 4. Supabase에 Discord 로그인 연결

1. Supabase 대시보드 **Authentication > Sign In / Providers > Discord** 활성화.
2. 3-2의 `Client ID`, `Client Secret` 입력 후 저장.
3. **Authentication > URL Configuration**:
   - Site URL: `https://sc-fitting-sim.vercel.app`
   - Redirect URLs에 `https://sc-fitting-sim.vercel.app/**` 추가.

## 5. Edge Function 배포와 비밀값 설정

Supabase CLI 필요 (`npm i -g supabase` 또는 https://supabase.com/docs/guides/cli 참고).

```bash
supabase login
supabase link --project-ref <프로젝트ID>
supabase functions deploy discord-sync
supabase functions deploy discord-refresh
supabase functions deploy discord-admin
supabase secrets set DISCORD_GUILD_ID=<Discord 서버 ID> DISCORD_BOT_TOKEN=<봇 토큰>
```

- Discord 서버 ID: Discord 앱 설정에서 개발자 모드를 켠 뒤 서버 우클릭 > **서버 ID 복사**.
- 봇 토큰은 여기(Supabase secrets)에만 둔다. 저장소·사이트 코드에 넣지 않는다.

## 6. 사이트 설정 값 채우기

`public/config.js`의 값을 채워 커밋·푸시하면 자동 배포된다.

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`: 1-3에서 복사한 값
- `DISCORD_GUILD_ID`: Discord 서버 ID
- `DISCORD_GUILD_LABEL`: 표시용 서버 이름(선택)

## 7. 첫 관리자 지정

1. 사이트에서 Discord로 한 번 로그인 (회원으로 가입됨).
2. Supabase 대시보드 **Authentication > Users**에서 본인의 User UID 복사.
3. **SQL Editor**에서 실행:

```sql
update public.profiles set site_role = 'admin' where id = '<본인 User UID>';
```

4. 사이트 헤더에 **관리** 링크가 나타나면 완료.

## 8. 동작 확인 (임시 서버 권장 순서)

1. 임시 서버에 시험 역할(예: `테스터`)을 만들고 본인 계정에 부여.
2. 관리 화면 > Discord 역할 연결에서 `테스터` → 시험 그룹 연결.
3. 로그아웃 후 다시 로그인 → 시험 그룹 소속 확인.
4. 임시 서버에서 역할 회수 → 재로그인 또는 재확인(discord-refresh) 후 그룹에서 빠지는지 확인. 확인이 24시간 이상 오래되면 재확인 전까지 그룹 소속이 자동으로 인정되지 않는지(차단)도 확인.
5. 문제 없으면 DISCORD_GUILD_ID를 실제 서버로 바꾸고 봇을 실제 서버에 설치 (서버 관리자 승인 필요).

### 권한 로직 시험 (선택)

로컬에서 DB 없이 권한 판별 로직만 시험할 수 있다.

```
npm i pg-mem
node scripts/permission-logic.pgmem.test.js
```

pg-mem은 실제 PostgreSQL이 아니므로 RLS 정책의 실제 행 필터링, plpgsql 함수(가입 트리거, 관리자 중재)는 이 시험이 검증하지 못한다. 실환경에서는 위 "동작 확인" 절차로 검증한다.

---

### 구조 요약

- 로그인: Supabase Auth의 Discord OAuth. 사이트는 Discord 비밀번호를 받지 않는다.
- 권한 근거: `member_discord_roles`(서버 측 확인 기록) + `discord_role_mappings` + `group_members`. 브라우저의 user_metadata는 권한 근거로 쓰지 않는다.
- 역할 확인 시점: 로그인 직후(discord-sync, 본인 토큰) + 이용 중 주기적 재확인(discord-refresh, 봇 토큰).
- 그룹 소속의 유효 조건(source와 무관하게 동일): 서버 측 Discord 멤버십 확인이 1시간 이내일 것. 관리자 직접 배정도 이 확인을 면제하지 않는다(면제는 미승인 예외).
- 실제 회수 반영 지연: 그룹 피팅 같은 제한 자료에 접근할 때마다 클라이언트가 discord-refresh로 즉시 재확인하므로, 역할 회수는 다음 접근 시점에 반영된다. 그 사이 이용 중에도 10분 간격으로 재확인한다.
- 1시간 TTL의 의미: Discord 장애 등으로 재확인 자체가 불가할 때의 유예 한도. 이 시각이 지나면 자동 차단(fail-closed). 즉시 회수가 아니며, 즉시 회수(게이트웨이 봇)는 이 단계 범위 밖이다.
- 계정 연결 검증: discord-sync는 로그인 토큰의 Discord 사용자와 Supabase 계정에 연결된 Discord identity가 일치하는지 확인하고, 다르면 403으로 거부한다. 남의 Discord 계정을 내 계정에 붙이는 우회를 막는다.
- 수집하지 않는 것: Discord 채팅·DM, Discord 비밀번호. 봇 토큰은 Supabase 서버 비밀 설정에만 보관.
- 역할 변경·탈퇴의 즉시 반영(게이트웨이 봇)은 상시 구동 서버가 필요해 이 단계 범위 밖. 필요하면 별도 호스팅을 정한 뒤 추가한다.
