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
  const { data: userData, error: userErr } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
  const user = userData.user;

  let body: {
    action?: string;
    id?: string;
    ship_slug?: string;
    name?: string;
    payload?: unknown;
    visibility?: string;
    group_ids?: string[];
  } = {};
  try { body = await req.json(); } catch { /* 빈 본문 허용 */ }
  const action = body.action ?? "browse";

  // ---- 1. Discord 역할 즉시 재검증 ----
  // verified: 이번 요청에서 서버 확인이 성공했는가. 실패 시 제한 자료 차단.
  let verified = false;
  let allowedGroups: string[] = [];
  if (guildId && botToken) {
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

        const { data: mappings } = await admin
          .from("discord_role_mappings")
          .select("discord_role_id, group_id")
          .eq("guild_id", guildId);
        allowedGroups = isMember
          ? [...new Set((mappings ?? [])
              .filter((m) => roleIds.includes(m.discord_role_id))
              .map((m) => m.group_id))]
          : [];

        // 표시용 캐시 갱신 (권한 근거 아님)
        await admin.from("group_members").delete()
          .eq("user_id", user.id).eq("source", "discord");
        if (allowedGroups.length) {
          await admin.from("group_members").upsert(
            allowedGroups.map((g) => ({
              group_id: g, user_id: user.id, source: "discord", added_by: null,
            })),
            { onConflict: "group_id,user_id", ignoreDuplicates: true },
          );
        }
      }
    }
  }

  // ---- 2. 규칙 적용 ----
  async function visibleFittingRows(rows: any[]) {
    const groupRows = rows.filter((f) => f.visibility === "groups");
    if (!groupRows.length) return rows.filter((f) => !f.hidden);
    if (!verified || !allowedGroups.length) return rows.filter((f) => !f.hidden && f.visibility === "public");
    const { data: fgs } = await admin
      .from("fitting_groups")
      .select("fitting_id, group_id")
      .in("fitting_id", groupRows.map((f) => f.id));
    const allowed = new Set(
      (fgs ?? []).filter((g) => allowedGroups.includes(g.group_id)).map((g) => g.fitting_id),
    );
    return rows.filter((f) => !f.hidden && (f.visibility === "public" || allowed.has(f.id)));
  }

  if (action === "list_mine") {
    const { data, error } = await admin
      .from("fittings")
      .select("id, ship_slug, name, visibility, created_at")
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
      .select("id, ship_slug, name, visibility, payload, created_at")
      .eq("id", body.id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "not_found" }, 404);
    const visible = await visibleFittingRows([data]);
    if (!visible.length) return json({ error: "not_found" }, 404); // 존재 자체 비공개
    return json({ ok: true, verified, fitting: visible[0] });
  }

  if (action === "browse") {
    const { data, error } = await admin
      .from("fittings")
      .select("id, ship_slug, name, visibility, created_at")
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, verified, fittings: await visibleFittingRows(data ?? []) });
  }

  // ---- 쓰기: 제한 자료 mutation은 여기서만, 즉시 재검증 후 ----
  if (action === "save") {
    const visibility = body.visibility === "groups" ? "groups" : "public";
    const groupIds = [...new Set(body.group_ids ?? [])];
    if (!body.ship_slug || !body.name || !body.payload) {
      return json({ error: "missing_fields" }, 400);
    }
    if (visibility === "groups") {
      // 그룹 지정 저장은 이번 요청의 재검증 통과 그룹만 허용 (캐시·TTL 무관)
      if (!verified) return json({ error: "verification_unavailable" }, 503);
      if (!groupIds.length) return json({ error: "groups_required" }, 400);
      if (!groupIds.every((g) => allowedGroups.includes(g))) {
        return json({ error: "group_not_allowed" }, 403);
      }
    }
    let fittingId = body.id;
    if (fittingId) {
      const { data: existing } = await admin
        .from("fittings").select("author_id, visibility").eq("id", fittingId).maybeSingle();
      if (!existing || existing.author_id !== user.id) return json({ error: "not_found" }, 404);
      // 기존이 그룹 지정 피팅이면 공개 전환을 포함한 모든 변경에 재검증 필요
      // (탈퇴 작성자가 공개 전환으로 읽기 권한을 되찾는 우회 차단)
      if (existing.visibility === "groups" && !verified) {
        return json({ error: "verification_unavailable" }, 503);
      }
      const { error } = await admin.from("fittings").update({
        ship_slug: body.ship_slug, name: body.name, payload: body.payload,
        visibility, updated_at: new Date().toISOString(),
      }).eq("id", fittingId);
      if (error) return json({ error: error.message }, 500);
    } else {
      const { data, error } = await admin.from("fittings").insert({
        author_id: user.id, ship_slug: body.ship_slug, name: body.name,
        payload: body.payload, visibility,
      }).select("id").single();
      if (error) return json({ error: error.message }, 500);
      fittingId = data.id;
    }
    await admin.from("fitting_groups").delete().eq("fitting_id", fittingId);
    if (visibility === "groups") {
      const { error } = await admin.from("fitting_groups").insert(
        groupIds.map((g) => ({ fitting_id: fittingId, group_id: g })),
      );
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, id: fittingId });
  }

  if (action === "delete") {
    if (!body.id) return json({ error: "id_required" }, 400);
    const { data: existing } = await admin
      .from("fittings").select("author_id, visibility").eq("id", body.id).maybeSingle();
    if (!existing || existing.author_id !== user.id) return json({ error: "not_found" }, 404);
    // 그룹 지정 피팅 삭제도 재검증 후에만 (탈퇴 작성자의 조작 차단)
    if (existing.visibility === "groups" && !verified) {
      return json({ error: "verification_unavailable" }, 503);
    }
    await admin.from("fitting_groups").delete().eq("fitting_id", body.id);
    const { error } = await admin.from("fittings").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
