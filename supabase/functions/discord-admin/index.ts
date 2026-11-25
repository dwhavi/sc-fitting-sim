// discord-admin: 관리자 전용 Discord 조회.
// action=list_roles: 봇 토큰으로 서버 역할 목록을 가져와 역할 연결 화면에 쓴다.
// 관리자(site_role='admin')만 호출 가능.

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

  const { data: profile } = await admin
    .from("profiles")
    .select("site_role")
    .eq("id", userData.user.id)
    .single();
  if (profile?.site_role !== "admin") return json({ error: "forbidden" }, 403);

  const { action } = await req.json().catch(() => ({}));

  if (action === "list_roles") {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) return json({ error: "discord_roles_failed", status: res.status }, 502);
    const roles = await res.json();
    return json({
      ok: true,
      roles: roles
        .filter((r: { name: string }) => r.name !== "@everyone")
        .map((r: { id: string; name: string; position: number; color: number }) => ({
          id: r.id,
          name: r.name,
          position: r.position,
          color: r.color,
        }))
        .sort((a: { position: number }, b: { position: number }) => b.position - a.position),
    });
  }

  return json({ error: "unknown_action" }, 400);
});
