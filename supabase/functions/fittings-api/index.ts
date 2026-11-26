// fittings-api: 제한 자료(그룹 지정 피팅, 본인 목록)의 서버 측 중개.
// 클라이언트가 DB를 직접 치는 경로에는 공개 피팅만 열려 있고(RLS),
// 제한 자료는 이 함수가 Discord 역할을 즉시 재검증한 뒤에만 반환한다.
// 재검증 자체가 불가(Discord 장애·봇 미설정)하면 제한 자료는 반환하지 않는다
// (fail-closed). 공개 피팅은 재검증 없이 반환한다.
//
// 권한 규칙 (0002_fittings.sql의 fitting_is_visible과 동일, 작성자 예외 없음):
//   보임 = not hidden AND (visibility='public' OR 지정 그룹 ∩ 허용 그룹 ≠ ∅)
//   허용 그룹 = 방금 재검증한 Discord 역할 ↔ 그룹 연결로만 계산.
//   group_members 캐시는 권한 근거로 쓰지 않는다.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DISCORD_API = "https://discord.com/api/v10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const guildId = Deno.env.get("DISCORD_GUILD_ID");
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");

  const authHeader = req.headers.get("Authorization") ?? "";
  const admin = createClient(supabaseUrl, serviceKey);
  // 익명 허용: 공개 피팅의 browse/get은 로그인 없이 볼 수 있다 (공개 피팅은
  // 로그인 없이 열람 가능한 기획). 쓰기와 비공개 자료는 로그인 필수.
  let user: { id: string } | null = null;
  if (authHeader) {
    const { data: userData } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    user = userData.user;
  }

  let body: {
    action?: string;
    id?: string;
    comment_id?: string;
    record_id?: string;
    body?: string;
    conditions?: string;
    values?: unknown;
    patch_version?: string;
    memo?: string;
    ship_slug?: string;
    name?: string;
    payload?: unknown;
    visibility?: string;
    max_grade?: number;
  } = {};
  try { body = await req.json(); } catch { /* 빈 본문 허용 */ }
  const action = body.action ?? "browse";

  // ---- 1. Discord 역할 즉시 재검증 ----
  // verified: 이번 요청에서 서버 확인이 성공했는가. 실패 시 제한 자료 차단.
  let verified = false;
  // 등급 (0~4). 확인 실패·미연결·탈퇴는 4 (fail-closed).
  let grade = 4;
  if (user && guildId && botToken) {
    const { data: profile } = await admin
      .from("profiles")
      .select("discord_user_id")
      .eq("id", user.id)
      .single();

    if (profile?.discord_user_id) {
      const memberRes = await fetch(
        `${DISCORD_API}/guilds/${guildId}/members/${profile.discord_user_id}`,
        { headers: { Authorization: `Bot ${botToken}` } },
      ).catch(() => null);

      if (memberRes && (memberRes.ok || memberRes.status === 404)) {
        // 200=멤버, 404=탈퇴 확정. 그 외 오류는 미확인이라 기존 기록을 유지한다.
        verified = true;
        const isMember = memberRes.ok;
        const member = isMember ? await memberRes.json() : null;
        const roleIds: string[] = member?.roles ?? [];
        const now = new Date().toISOString();

        await admin.from("member_guild_checks").upsert({
          user_id: user.id, guild_id: guildId, is_member: isMember, checked_at: now,
        });
        await admin.from("member_discord_roles").delete()
          .eq("user_id", user.id).eq("guild_id", guildId);
        if (roleIds.length) {
          await admin.from("member_discord_roles").insert(
            roleIds.map((r) => ({
              user_id: user.id, guild_id: guildId, discord_role_id: r, last_seen_at: now,
            })),
          );
        }

        // 등급: 보유 역할에 연결된 등급 중 가장 높은 것(숫자가 작은 것).
        // (설계 선택: 여러 역할이 있으면 가장 높은 등급 적용)
        if (isMember) {
          const { data: gm } = await admin
            .from("discord_role_grade_mappings")
            .select("discord_role_id, grade")
            .eq("guild_id", guildId);
          const held = (gm ?? []).filter((m) => roleIds.includes(m.discord_role_id)).map((m) => m.grade as number);
          if (held.length) grade = Math.min(...held);
        }
      }
    }
  }

  // ---- 2. 규칙 적용 ----
  // 보임 = 숨김 아님 AND (일반 OR (보안 AND 재검증 통과 AND 등급<=3 AND 등급<=자료의 max_grade)).
  // 작성자 예외 없음. 이전 'groups' 값은 보안으로 이관됐고, 남아 있어도 보이지 않는다.
  async function visibleFittingRows(rows: any[]) {
    return rows.filter((f) => !f.hidden && (
      f.visibility === "public" ||
      (f.visibility === "security" && verified && grade <= 3 && grade <= (f.max_grade ?? 3))
    )).map((f) => {
      const { profiles, ...rest } = f;
      return { ...rest, author_name: profiles?.display_name ?? null };
    });
  }
  const canCreateSecurity = verified && grade <= 3;
  const canRestrict = verified && grade <= 2;

  // isAdmin: 댓글·기록 삭제 버튼 표시와 관리자 삭제에 사용. profiles.site_role 기준.
  const { data: myProfile } = user ? await admin
    .from("profiles").select("site_role").eq("id", user.id).maybeSingle() : { data: null };
  const isAdmin = myProfile?.site_role === "admin";

  if (action === "me") {
    if (!user) return json({ ok: true, verified, grade: 4, signed_in: false });
    return json({ ok: true, verified, signed_in: true, grade, can_create_security: canCreateSecurity, can_restrict: canRestrict });
  }

  // 노출 제한: 0~2등급만. 자료의 작성자와 무관하게 보안 자료의 열람 등급을 바꾼다.
  if (action === "set_exposure") {
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!canRestrict) return json({ error: "forbidden" }, 403);
    const mg = Number(body.max_grade);
    if (![0, 1, 2, 3].includes(mg)) return json({ error: "invalid_max_grade" }, 400);
    const v = await visibleFitting(body.id);
    if (!("fitting" in v)) return json({ error: v.error }, v.status);
    if (v.fitting.visibility !== "security") return json({ error: "not_security" }, 400);
    const { error } = await admin.from("fittings").update({ max_grade: mg, updated_at: new Date().toISOString() }).eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    await admin.from("audit_log").insert({ actor_id: user.id, action: "fitting_exposure", target: body.id, detail: { max_grade: mg, actor_grade: grade } });
    return json({ ok: true, max_grade: mg });
  }

  if (action === "list_mine") {
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data, error } = await admin
      .from("fittings")
      .select("id, ship_slug, name, visibility, max_grade, created_at, profiles!fittings_author_id_fkey(display_name)")
      .eq("author_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, verified, fittings: await visibleFittingRows(data ?? []) });
  }

  if (action === "get") {
    if (!body.id) return json({ error: "id_required" }, 400);
    const { data, error } = await admin
      .from("fittings")
      .select("id, ship_slug, name, visibility, max_grade, payload, created_at, profiles!fittings_author_id_fkey(display_name)")
      .eq("id", body.id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "not_found" }, 404);
    const visible = await visibleFittingRows([data]);
    if (!visible.length) return json({ error: "not_found" }, 404); // 존재 자체 비공개
    const extra = await loadDiscussion(data.id);
    return json({ ok: true, verified, fitting: { ...visible[0], ...extra }, me: user ? { id: user.id, admin: isAdmin, grade, can_restrict: canRestrict } : null });
  }

  // ---- 댓글·테스트 기록: 피팅 열람 권한과 같은 경로로만 ----
  async function loadDiscussion(fittingId: string) {
    const { data: comments } = await admin
      .from("comments")
      .select("id, author_id, body, created_at, updated_at, profiles!comments_author_id_fkey(display_name)")
      .eq("fitting_id", fittingId)
      .order("created_at", { ascending: true })
      .limit(200);
    const { data: records } = await admin
      .from("test_records")
      .select("id, author_id, conditions, values, patch_version, memo, created_at, updated_at, profiles!test_records_author_id_fkey(display_name)")
      .eq("fitting_id", fittingId)
      .order("created_at", { ascending: false })
      .limit(100);
    const flat = (rows: any[]) => (rows ?? []).map((r) => {
      const { profiles, ...rest } = r;
      return { ...rest, author_name: profiles?.display_name ?? null };
    });
    return { comments: flat(comments ?? []), test_records: flat(records ?? []) };
  }

  // 쓰기 공통: 대상 피팅이 요청자에게 보여야 한다 (열람 권한 = 댓글·기록 쓰기 권한).
  // 그룹 지정 피팅은 이 검사가 verified 재검증을 통과해야만 보이므로 fail-closed.
  async function visibleFitting(fittingId: string | undefined) {
    if (!fittingId) return { error: "id_required", status: 400 } as const;
    const { data } = await admin
      .from("fittings").select("id, visibility, max_grade, hidden").eq("id", fittingId).maybeSingle();
    if (!data) return { error: "not_found", status: 404 } as const;
    const visible = await visibleFittingRows([data]);
    if (!visible.length) return { error: "not_found", status: 404 } as const;
    return { fitting: data } as const;
  }

  if (action === "comment_add") {
    if (!user) return json({ error: "unauthorized" }, 401);
    const text = (body.body ?? "").trim();
    if (!text || text.length > 2000) return json({ error: "invalid_body" }, 400);
    const v = await visibleFitting(body.id);
    if (!("fitting" in v)) return json({ error: v.error }, v.status);
    const { data, error } = await admin.from("comments").insert({
      fitting_id: body.id, author_id: user.id, body: text,
    }).select("id, created_at").single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, id: data.id });
  }

  if (action === "comment_edit") {
    if (!user) return json({ error: "unauthorized" }, 401);
    const text = (body.body ?? "").trim();
    if (!body.comment_id) return json({ error: "id_required" }, 400);
    if (!text || text.length > 2000) return json({ error: "invalid_body" }, 400);
    const { data: own } = await admin.from("comments")
      .select("author_id").eq("id", body.comment_id).maybeSingle();
    if (!own || own.author_id !== user.id) return json({ error: "not_found" }, 404);
    const { error } = await admin.from("comments")
      .update({ body: text, updated_at: new Date().toISOString() }).eq("id", body.comment_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "comment_delete") {
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!body.comment_id) return json({ error: "id_required" }, 400);
    const { data: own } = await admin.from("comments")
      .select("author_id").eq("id", body.comment_id).maybeSingle();
    if (!own || (own.author_id !== user.id && !isAdmin)) return json({ error: "not_found" }, 404);
    const { error } = await admin.from("comments").delete().eq("id", body.comment_id);
    if (error) return json({ error: error.message }, 500);
    // 관리자가 남의 댓글을 지운 경우 관리 기록에 남긴다 (내용은 기록하지 않음).
    if (own.author_id !== user.id) await admin.from("audit_log").insert({ actor_id: user.id, action: "comment_delete_by_admin", target: body.comment_id, detail: { author_id: own.author_id } });
    return json({ ok: true });
  }

  if (action === "test_add") {
    if (!user) return json({ error: "unauthorized" }, 401);
    const conditions = (body.conditions ?? "").trim();
    if (!conditions || conditions.length > 2000) return json({ error: "invalid_conditions" }, 400);
    const v = await visibleFitting(body.id);
    if (!("fitting" in v)) return json({ error: v.error }, v.status);
    // 테스트 기록은 비공개(그룹 지정) 피팅에만 붙는다 (기획서 4단계).
    if (v.fitting.visibility !== "security") return json({ error: "records_only_on_security_fittings" }, 400);
    const memo = body.memo?.trim() || null;
    if (memo && memo.length > 2000) return json({ error: "invalid_memo" }, 400);
    const { data, error } = await admin.from("test_records").insert({
      fitting_id: body.id, author_id: user.id, conditions,
      values: (body.values && typeof body.values === "object") ? body.values : {},
      patch_version: body.patch_version?.trim() || null, memo,
    }).select("id, created_at").single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, id: data.id });
  }

  if (action === "test_delete") {
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!body.record_id) return json({ error: "id_required" }, 400);
    const { data: own } = await admin.from("test_records")
      .select("author_id").eq("id", body.record_id).maybeSingle();
    if (!own || (own.author_id !== user.id && !isAdmin)) return json({ error: "not_found" }, 404);
    const { error } = await admin.from("test_records").delete().eq("id", body.record_id);
    if (error) return json({ error: error.message }, 500);
    if (own.author_id !== user.id) await admin.from("audit_log").insert({ actor_id: user.id, action: "test_record_delete_by_admin", target: body.record_id, detail: { author_id: own.author_id } });
    return json({ ok: true });
  }

  if (action === "browse") {
    const { data, error } = await admin
      .from("fittings")
      .select("id, ship_slug, name, visibility, max_grade, created_at, profiles!fittings_author_id_fkey(display_name)")
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, verified, fittings: await visibleFittingRows(data ?? []) });
  }

  // ---- 쓰기: 제한 자료 mutation은 여기서만, 즉시 재검증 후 ----
  if (action === "save") {
    if (!user) return json({ error: "unauthorized" }, 401);
    const visibility = body.visibility === "security" ? "security" : "public";
    if (!body.ship_slug || !body.name || !body.payload) {
      return json({ error: "missing_fields" }, 400);
    }
    // 보안 자료 생성은 재검증 통과한 0~3등급만 (4등급은 일반 자료만).
    if (visibility === "security") {
      if (!verified) return json({ error: "verification_unavailable" }, 503);
      if (!canCreateSecurity) return json({ error: "grade_not_allowed" }, 403);
    }
    // 노출 등급 지정은 0~2등급만. 3등급이 지정하려 하면 거절, 미지정이면 기본/기존 유지.
    let wantMax: number | null = null;
    if (body.max_grade !== undefined && body.max_grade !== null) {
      wantMax = Number(body.max_grade);
      if (![0, 1, 2, 3].includes(wantMax)) return json({ error: "invalid_max_grade" }, 400);
    }
    let fittingId = body.id;
    let maxGrade = 3;
    if (fittingId) {
      const { data: existing } = await admin
        .from("fittings").select("author_id, visibility, max_grade").eq("id", fittingId).maybeSingle();
      if (!existing || existing.author_id !== user.id) return json({ error: "not_found" }, 404);
      // 기존이 보안 자료면 현재 열람 가능한 사람만 수정 가능 (작성자 예외 없음).
      if (existing.visibility === "security" || existing.visibility === "groups") {
        const v = await visibleFitting(fittingId);
        if (!("fitting" in v)) return json({ error: v.error }, v.status);
      }
      maxGrade = existing.max_grade ?? 3;
      if (wantMax !== null && wantMax !== maxGrade) {
        if (!canRestrict) return json({ error: "forbidden" }, 403);
        maxGrade = wantMax;
      }
      const { error } = await admin.from("fittings").update({
        ship_slug: body.ship_slug, name: body.name, payload: body.payload,
        visibility, max_grade: visibility === "security" ? maxGrade : 3,
        updated_at: new Date().toISOString(),
      }).eq("id", fittingId);
      if (error) return json({ error: error.message }, 500);
    } else {
      if (wantMax !== null && wantMax !== 3) {
        if (!canRestrict) return json({ error: "forbidden" }, 403);
        maxGrade = wantMax;
      }
      const { data, error } = await admin.from("fittings").insert({
        author_id: user.id, ship_slug: body.ship_slug, name: body.name,
        payload: body.payload, visibility,
        max_grade: visibility === "security" ? maxGrade : 3,
      }).select("id").single();
      if (error) return json({ error: error.message }, 500);
      fittingId = data.id;
    }
    return json({ ok: true, id: fittingId });
  }

  if (action === "delete") {
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!body.id) return json({ error: "id_required" }, 400);
    const { data: existing } = await admin
      .from("fittings").select("author_id, visibility").eq("id", body.id).maybeSingle();
    if (!existing || existing.author_id !== user.id) return json({ error: "not_found" }, 404);
    // 보안 자료 삭제도 현재 열람 가능(등급 재검증 통과) 후에만 (탈퇴 작성자의 조작 차단)
    if (existing.visibility === "security" || existing.visibility === "groups") {
      const v = await visibleFitting(body.id);
      if (!("fitting" in v)) return json({ error: v.error }, v.status);
    }
    const { error } = await admin.from("fittings").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
