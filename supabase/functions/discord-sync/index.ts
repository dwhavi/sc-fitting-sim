// discord-sync: Discord 로그인 직후 호출.
// 클라이언트가 Supabase JWT + Discord provider_token을 내면
// 1) Discord API로 본인 계정과 서버 멤버/역할을 직접 확인하고
// 2) profiles.discord_user_id, member_discord_roles, group_members(discord 소스)를 갱신한다.
// 권한 근거는 Discord API 응답뿐이며 user_metadata는 쓰지 않는다.

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
  if (!guildId) return json({ error: "server_not_configured" }, 500);

  // 1) 호출자 확인 (Supabase JWT)
  const authHeader = req.headers.get("Authorization") ?? "";
  const admin = createClient(supabaseUrl, serviceKey);
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
  const user = userData.user;

  // 2) Discord provider token으로 본인/서버 멤버 확인
  const { provider_token: providerToken } = await req.json().catch(() => ({}));
  if (!providerToken) return json({ error: "missing_provider_token" }, 400);

  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  if (!meRes.ok) return json({ error: "discord_me_failed", status: meRes.status }, 502);
  const me = await meRes.json();

  // 2-1) 토큰의 Discord 계정이 로그인한 Supabase 사용자의 Discord identity와
  // 같은지 확인. 다르면 다른 사람의 Discord 역할을 내 계정에 입히는
  // 권한 상승 경로가 되므로 거부한다.
  const identities = (user.identities ?? []) as Array<{
    provider?: string;
    id?: string;
    identity_data?: { provider_id?: string; sub?: string };
  }>;
  const linked = identities.some(
    (i) =>
      i.provider === "discord" &&
      (i.id === me.id ||
        i.identity_data?.provider_id === me.id ||
        i.identity_data?.sub === me.id),
  );
  if (!linked) return json({ error: "discord_identity_mismatch" }, 403);

  const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });

  const isMember = memberRes.ok;
  const member = isMember ? await memberRes.json() : null;
  const roleIds: string[] = member?.roles ?? [];
  const displayName =
    member?.nick ?? me.global_name ?? me.username ?? "회원";

  // 3) 서버 측 기록 갱신
  const now = new Date().toISOString();
  const { error: profErr } = await admin
    .from("profiles")
    .update({
      discord_user_id: me.id,
      display_name: displayName,
      updated_at: now,
    })
    .eq("id", user.id);
  if (profErr) return json({ error: "profile_update_failed" }, 500);

  await admin.from("member_guild_checks").upsert({
    user_id: user.id,
    guild_id: guildId,
    is_member: isMember,
    checked_at: now,
  });

  // 역할 목록 전체 교체 (회수분 삭제)
  await admin
    .from("member_discord_roles")
    .delete()
    .eq("user_id", user.id)
    .eq("guild_id", guildId);
  if (roleIds.length) {
    await admin.from("member_discord_roles").insert(
      roleIds.map((r) => ({
        user_id: user.id,
        guild_id: guildId,
        discord_role_id: r,
        last_seen_at: now,
      })),
    );
  }

  // 4) 역할 매핑 → 그룹 소속 동기화 (discord 소스만)
  const { data: mappings } = await admin
    .from("discord_role_mappings")
    .select("discord_role_id, group_id")
    .eq("guild_id", guildId);
  const mappedGroupIds = [
    ...new Set(
      (mappings ?? [])
        .filter((m) => roleIds.includes(m.discord_role_id))
        .map((m) => m.group_id),
    ),
  ];

  await admin
    .from("group_members")
    .delete()
    .eq("user_id", user.id)
    .eq("source", "discord");
  if (isMember && mappedGroupIds.length) {
    await admin.from("group_members").upsert(
      mappedGroupIds.map((g) => ({
        group_id: g,
        user_id: user.id,
        source: "discord",
        added_by: null,
      })),
      { onConflict: "group_id,user_id", ignoreDuplicates: true },
    );
  }

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "discord_sync",
    target: guildId,
    detail: { is_member: isMember, roles: roleIds.length, groups: mappedGroupIds.length },
  });

  return json({
    ok: true,
    is_member: isMember,
    display_name: displayName,
    roles: roleIds.length,
    groups: mappedGroupIds.length,
  });
});
