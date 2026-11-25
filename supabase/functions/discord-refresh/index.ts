// discord-refresh: 이용 중 권한 재확인.
// 봇 토큰(서버 비밀값)으로 호출자의 현재 서버 멤버십/역할을 다시 확인해
// member_discord_roles와 discord 소스 group_members를 갱신한다.
// 로그인 없이도 역할 회수·서버 탈퇴가 반영되게 하는 경로.

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
  if (!guildId || !botToken) return json({ error: "server_not_configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userErr } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
  const user = userData.user;

  const { data: profile } = await admin
    .from("profiles")
    .select("discord_user_id")
    .eq("id", user.id)
    .single();
  if (!profile?.discord_user_id) return json({ error: "no_discord_link" }, 400);

  const memberRes = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${profile.discord_user_id}`,
    { headers: { Authorization: `Bot ${botToken}` } },
  );

  const isMember = memberRes.ok;
  const member = isMember ? await memberRes.json() : null;
  const roleIds: string[] = member?.roles ?? [];
  const now = new Date().toISOString();

  await admin.from("member_guild_checks").upsert({
    user_id: user.id,
    guild_id: guildId,
    is_member: isMember,
    checked_at: now,
  });

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

  return json({
    ok: true,
    is_member: isMember,
    roles: roleIds.length,
    groups: mappedGroupIds.length,
    checked_at: now,
  });
});
