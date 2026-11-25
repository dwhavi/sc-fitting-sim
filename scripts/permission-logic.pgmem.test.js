// 실행: npm i pg-mem && node scripts/permission-logic.pgmem.test.js
// 저장소 루트에서 실행하면 마이그레이션 SQL을 읽어 검증한다.
// pg-mem 기반 RLS/권한 로직 검증.
// pg-mem은 실제 PostgreSQL이 아니라 JS 재구현 엔진이다. 이 테스트가 검증하는 것:
//   - 마이그레이션 SQL이 실제 SQL 문법으로 파싱·실행되는가
//   - 권한 판별 함수(my_group_ids, fitting_is_visible, is_admin)의 로직이
//     시나리오별로 올바른 결과를 내는가
//   - RLS 정책이 pg-mem의 정책 평가기 아래서 의도대로 행을 거르는가 (pg-mem이 지원하는 범위)
// 검증하지 못하는 것: 실제 Supabase/Postgres의 security definer·auth.uid() 의미론,
//   정책 평가 최적화, 트리거 타이밍, 실제 JWT 연동. 실환경 검증은 프로젝트 생성 후 별도 실행.
const fs = require("fs");
const { newDb, DataType } = require("pg-mem");

const REPO = require("path").resolve(__dirname, "..");
let sql1 = fs.readFileSync(REPO + "/supabase/migrations/0001_init.sql", "utf8");
let sql2 = fs.readFileSync(REPO + "/supabase/migrations/0002_fittings.sql", "utf8");

const db = newDb();

// ---- Supabase auth 스키마 시뮬레이션 ----
let currentUid = null;
db.public.none("create schema auth");
db.public.none("create table auth.users(id uuid primary key, raw_user_meta_data jsonb)");
db.getSchema("auth").registerFunction({
  name: "uid",
  returns: DataType.uuid,
  implementation: () => currentUid,
  impure: true,
});
// pg-mem에 gen_random_uuid가 없으면 등록
let uuidCounter = 0;
try { db.public.one("select gen_random_uuid() as u"); } catch (e) {
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => "00000000-0000-4000-8000-" + String(++uuidCounter).padStart(12, "0"),
    impure: true,
  });
}

function run(label, fn) {
  try { fn(); console.log("PASS  " + label); }
  catch (e) { console.log("FAIL  " + label + " :: " + e.message); process.exitCode = 1; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ---- 마이그레이션 적용 (pg-mem 호환 전처리) ----
// pg-mem이 파싱하지 못하는 구문: security definer / set search_path /
// enable row level security / create policy. RLS 행 필터링은 pg-mem에서
// 검증 불가하므로 정책 구문은 건너뛰고, 권한 판별 함수 로직만 검증한다.
function splitStmts(sql) {
  const out = []; let cur = "", inD = false, i = 0;
  while (i < sql.length) {
    if (sql.startsWith("$$", i)) { inD = !inD; cur += "$$"; i += 2; continue; }
    if (sql[i] === ";" && !inD) { out.push(cur); cur = ""; i++; continue; }
    cur += sql[i]; i++;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s && !s.split("\n").every((l) => !l.trim() || l.trim().startsWith("--")));
}
function loadMigration(sql, label) {
  const stmts = splitStmts(sql);
  let skipped = 0;
  const deferred = [];
  for (const s of stmts) {
    const head = s.replace(/--.*$/gm, "").trim();
    if (
      /^alter table .* enable row level security/i.test(head) ||
      /^create policy /i.test(head) ||
      /^(revoke|grant) /i.test(head) ||
      /^create trigger /i.test(head) ||
      /language plpgsql/i.test(s)
    ) { skipped++; continue; }
    // pg-mem은 setof 반환 함수를 지원하지 않으므로 returns table로 치환하고
    // 호출부도 같은 의미로 맞춘다 (실제 SQL은 실환경에서 그대로 실행·검증).
    const stripped = s
      .replace(/^\s*security definer\s*$/gim, "")
      .replace(/^\s*set search_path = public\s*$/gim, "")
      // pg-mem은 stable 함수를 생성 시점에 상수 평가하므로 제거한다
      .replace(/^\s*stable\s*$/gim, "")
      .replace(/returns setof uuid/gi, "returns table (g uuid)")
      .replace(/\(select public\.my_group_ids\(\)\)/g, "(select g from public.my_group_ids())")
      .replace(/from public\.fitting_group_ids\((f\.id|fittings\.id)\) gid/g, "from public.fitting_group_ids($1)")
      .replace(/where gid in \(select/g, "where g in (select")
      // pg-mem 2단계 상관참조 미지원: my_group_ids의 exists를 동치 join으로 치환
      .replace(
        /where exists \(\s*select 1 from public\.member_guild_checks c\s*where c\.user_id = auth\.uid\(\)\s*and c\.guild_id = drm\.guild_id\s*and c\.is_member\s*and c\.checked_at > now\(\) - public\.discord_check_ttl\(\)\s*\)/,
        "join public.member_guild_checks c on c.user_id = auth.uid() and c.guild_id = drm.guild_id and c.is_member and c.checked_at > now() - public.discord_check_ttl()"
      );
    if (/^create (or replace )?function /i.test(head) || /^create trigger /i.test(head)) deferred.push(stripped);
    else db.public.none(stripped);
  }
  // pg-mem은 SQL 함수 본문을 생성 시점에 실행해 반환형을 추론하므로,
  // 실제 Postgres(호출 시점 검증)와 달리 테이블이 먼저 있어야 한다.
  // 함수/트리거는 마지막에 실행한다.
  for (const s of deferred) db.public.none(s);
  if (skipped) console.log(`INFO  ${label}: RLS/정책/plpgsql/트리거 구문 ${skipped}건 건너뜀 (pg-mem 미지원, 실환경 검증 필요)`);
}
run("0001_init.sql 파싱·실행", () => loadMigration(sql1, "0001"));
run("0002_fittings.sql 파싱·실행", () => loadMigration(sql2, "0002"));

// ---- 픽스처 ----
const U = {
  admin: "11111111-1111-4111-8111-111111111111",
  manualMem: "22222222-2222-4222-8222-222222222222",
  discordFresh: "33333333-3333-4333-8333-333333333333",
  discordStale: "44444444-4444-4444-8444-444444444444",
  discordKicked: "55555555-5555-4555-8555-555555555555",
  outsider: "66666666-6666-4666-8666-666666666666",
  manualStale: "77777777-7777-4777-8777-777777777777",
  roleless: "88888888-8888-4888-8888-888888888888",
};

db.public.none(`
  insert into auth.users(id) values
    ('${U.admin}'),('${U.manualMem}'),('${U.discordFresh}'),('${U.discordStale}'),('${U.discordKicked}'),('${U.outsider}'),('${U.manualStale}'),('${U.roleless}');
`);
// 가입 트리거(handle_new_user)는 plpgsql이라 pg-mem에서 검증 불가.
// 실환경에서 확인하도록 남기고, 여기서는 트리거 결과를 직접 시딩한다.
console.log("INFO  가입 트리거(handle_new_user, plpgsql): pg-mem 미검증 — 실환경 확인 필요");
db.public.none(`
  insert into public.profiles(id, display_name)
  select id, '테스트회원' from auth.users on conflict (id) do nothing;
`);

db.public.none(`
  update public.profiles set site_role='admin' where id='${U.admin}';
  insert into public.groups(id, name) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '테스트그룹');
  -- group_members는 표시용 캐시: 어떤 source 행도 권한을 주지 않아야 한다
  insert into public.group_members(group_id, user_id, source) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${U.manualMem}', 'manual'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${U.manualStale}', 'manual'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${U.roleless}', 'discord');
  -- 역할↔그룹 연결과 서버 측 역할 기록이 진짜 근거
  insert into public.discord_role_mappings(guild_id, discord_role_id, discord_role_name, group_id) values
    ('g1', 'r1', '클랜원', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  insert into public.member_discord_roles(user_id, guild_id, discord_role_id) values
    ('${U.discordFresh}', 'g1', 'r1'),
    ('${U.discordStale}', 'g1', 'r1'),
    ('${U.discordKicked}', 'g1', 'r1');
  -- Discord 동기화 배정 3명 (신선 / 오래됨 / 탈퇴)
  insert into public.group_members(group_id, user_id, source) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${U.discordFresh}', 'discord'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${U.discordStale}', 'discord'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${U.discordKicked}', 'discord');
  insert into public.member_guild_checks(user_id, guild_id, is_member, checked_at) values
    ('${U.discordFresh}', 'g1', true, now()),
    ('${U.discordStale}', 'g1', true, now() - interval '25 hours'),
    ('${U.discordKicked}', 'g1', false, now()),
    ('${U.manualMem}', 'g1', true, now()),
    ('${U.manualStale}', 'g1', true, now() - interval '25 hours'),
    ('${U.roleless}', 'g1', true, now());
  insert into public.fittings(id, author_id, ship_slug, name, payload, visibility, hidden) values
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${U.outsider}', 'taurus', '공개피팅', '{}', 'public', false),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${U.discordFresh}', 'taurus', '그룹피팅', '{\"secret\":1}', 'groups', false),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${U.outsider}', 'taurus', '숨김피팅', '{}', 'public', true),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${U.outsider}', 'taurus', '탈퇴작성자피팅', '{}', 'groups', false);
  insert into public.fitting_groups(fitting_id, group_id) values
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
`);

// ---- 함수 단위 검증 ----
function groupsOf(uid) {
  currentUid = uid;
  return db.public.many("select g::text from public.my_group_ids()").map((r) => r.g);
}
run("group_members 캐시 행 + 신선 확인만으로는 소속 불인정 (역할 근거 없음)", () => {
  assert(groupsOf(U.manualMem).length === 0, "캐시 행이 권한을 줌");
});
run("캐시 행 + 확인 만료 → 차단", () => {
  assert(groupsOf(U.manualStale).length === 0);
});
run("서버 멤버라도 연결된 Discord 역할이 없으면 차단 (역할 기준 강제)", () => {
  assert(groupsOf(U.roleless).length === 0);
});
run("Discord 소속 + 신선한 확인 → 그룹 소속 인정", () => {
  assert(groupsOf(U.discordFresh).length === 1);
});
run("Discord 소속 + 확인 만료(25h) → 차단 (접근 회수 fail-closed)", () => {
  assert(groupsOf(U.discordStale).length === 0);
});
run("Discord 소속 + 서버 탈퇴 확인 → 즉시 차단", () => {
  assert(groupsOf(U.discordKicked).length === 0);
});
run("비소속자는 그룹 없음", () => {
  assert(groupsOf(U.outsider).length === 0);
});
// pg-mem은 스칼라 SQL 함수를 생성 시점의 데이터로 상수화한다(표 함수는 정상 동작).
// 따라서 스칼라 함수(is_admin, fitting_is_visible)는 함수 본문과 동일한 판별식을
// 직접 쿼리로 평가한다. 함수 래퍼 자체의 동작은 실환경에서 검증한다.
console.log("INFO  스칼라 함수(is_admin/fitting_is_visible): pg-mem 상수화로 본문 판별식을 직접 평가 — 래퍼는 실환경 확인 필요");
function isAdminQ(uid) {
  currentUid = uid;
  return db.public.one("select exists (select 1 from public.profiles where id = auth.uid() and site_role = 'admin') as a").a;
}
run("is_admin 판별식: 관리자만 true", () => {
  assert(isAdminQ(U.admin) === true);
  assert(isAdminQ(U.manualMem) === false);
});

function visible(uid, fitting) {
  // my_group_ids()는 별도 시나리오로 검증 완료. pg-mem이 중첩 서브쿼리의
  // 비상관 서브쿼리를 상수 평가하려다 실패하므로, 여기서는 그 결과를
  // 먼저 구해 인라인한다 (조합 자체는 실환경에서 검증).
  const groups = groupsOf(uid);
  currentUid = uid;
  const glist = groups.length ? groups.map((g) => `'${g}'`).join(",") : "select null::uuid where false";
  return db.public.one(`select exists (
    select 1 from public.fittings f
    where f.id = '${fitting}'
      and not f.hidden
      and (
        f.visibility = 'public'
        or exists (
          -- pg-mem이 함수 호출을 상수 평가하려다 실패하므로 fitting_group_ids
          -- 본문과 동일한 서브쿼리로 인라인한다 (래퍼 조합은 실환경 검증)
          -- 작성자 예외 없음(기획 확정): 마이그레이션과 같은 판별식
          select 1 from public.fitting_groups fg
          where fg.fitting_id = '${fitting}' -- pg-mem 2단계 상관참조 미지원으로 리터럴 사용 (동일 의미)
            and fg.group_id in (${glist})
        )
      )
  ) as v`).v;
}
const F_PUBLIC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const F_GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const F_HIDDEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const F_GROUP2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

run("공개 피팅: 로그아웃(anon)도 열람 가능", () => assert(visible(null, F_PUBLIC) === true));
run("그룹 피팅: 신선한 Discord 소속은 열람 가능", () => assert(visible(U.discordFresh, F_GROUP) === true));
run("그룹 피팅: 확인 만료 소속자는 차단", () => assert(visible(U.discordStale, F_GROUP) === false));
run("그룹 피팅: 탈퇴자는 차단", () => assert(visible(U.discordKicked, F_GROUP) === false));
run("그룹 피팅: 비소속·로그아웃 차단 (존재 자체 비공개)", () => {
  assert(visible(U.outsider, F_GROUP) === false);
  assert(visible(null, F_GROUP) === false);
});
run("그룹 피팅: 관리자라도 그룹 비소속이면 차단 (전체 열람 미확정 사항 미적용)", () => {
  assert(visible(U.admin, F_GROUP) === false);
});
run("그룹 피팅: 그룹 소속 작성자는 열람 가능 (소속 경로)", () => assert(visible(U.discordFresh, F_GROUP) === true));
run("그룹 피팅: 비소속 작성자 본인도 차단 (작성자 예외 제거 확인)", () => assert(visible(U.outsider, F_GROUP2) === false));
// 수정·삭제 정책의 판별식(author_id 일치 AND 현재 열람 가능) 시뮬레이션.
// RLS 정책 자체는 실환경 검증.
function canManage(uid, fitting, authorId) {
  return authorId === uid && visible(uid, fitting);
}
run("관리 정책: 소속 작성자는 수정·삭제 가능", () => {
  assert(canManage(U.discordFresh, F_GROUP, U.discordFresh) === true);
});
run("관리 정책: 탈퇴·비소속 작성자는 수정·삭제 불가 (공개 전환 우회 차단)", () => {
  assert(canManage(U.outsider, F_GROUP2, U.outsider) === false);
});
run("관리 정책: 타인 피팅은 관리 불가", () => {
  assert(canManage(U.discordFresh, F_GROUP2, U.outsider) === false);
});
run("숨김 피팅: 누구도 열람 불가", () => {
  assert(visible(U.admin, F_HIDDEN) === false);
  assert(visible(null, F_HIDDEN) === false);
});

// ---- RLS 정책 행 필터링 ----
// pg-mem은 enable row level security / create policy 자체를 파싱하지 못하므로
// 정책 수준 검증은 불가. 아래 함수 수준 검증이 정책과 동일한 판별식을 사용하는지는
// SQL 원문 대조로 확인했고, 실제 행 필터링은 Supabase 프로젝트 생성 후 검증한다.
console.log("INFO  RLS 행 필터링: pg-mem 미지원으로 건너뜀 (정책식=함수식 대조 완료, 실환경 검증 필요)");

// ---- 관리자 중재 함수 (plpgsql라 pg-mem에서 함수 자체는 미검증) ----
// 아래는 함수 본문과 같은 데이터 연산을 is_admin 판별식과 함께 수행하는 시뮬레이션이다.
// 실제 admin_moderate_fitting의 예외/감사 동작은 실환경에서 검증한다.
console.log("INFO  admin_moderate_fitting(plpgsql): pg-mem 미검증 — 데이터 연산만 시뮬레이션, 실환경 확인 필요");
function moderateSim(uid, fitting, action) {
  if (!isAdminQ(uid)) throw new Error("관리자만 사용할 수 있습니다");
  currentUid = uid;
  if (action === "hide") db.public.none(`update public.fittings set hidden=true where id='${fitting}'`);
  if (action === "unhide") db.public.none(`update public.fittings set hidden=false where id='${fitting}'`);
  if (action === "delete") db.public.none(`delete from public.fittings where id='${fitting}'`);
  db.public.none(`insert into public.audit_log(actor_id, action, target) values ('${uid}', 'fitting_${action}', '${fitting}')`);
}
run("중재 시뮬레이션: 비관리자는 is_admin=false로 거부된다", () => {
  let threw = false;
  try { moderateSim(U.outsider, F_PUBLIC, "hide"); } catch (e) { threw = true; }
  assert(threw, "비관리자가 숨김 성공");
});
run("중재 시뮬레이션: 관리자 숨김 + 감사 기록", () => {
  moderateSim(U.admin, F_PUBLIC, "hide");
  const h = db.public.one(`select hidden from public.fittings where id='${F_PUBLIC}'`).hidden;
  assert(h === true, "hidden이 아님");
  const n = db.public.one("select count(*)::int as c from public.audit_log where action='fitting_hide'").c;
  assert(n === 1, "감사 기록 없음");
  moderateSim(U.admin, F_PUBLIC, "unhide");
});

console.log(process.exitCode ? "일부 실패" : "모두 통과");
