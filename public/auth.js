// SC Fitting Sim — Discord 로그인과 권한 동기화 (1단계)
// config.js 값이 비어 있으면 로그인은 "준비 중"으로만 표시하고 사이트는 지금과 같이 동작한다.
(function () {
  const cfg = window.SCFIT_CONFIG || {};
  const area = () => document.getElementById("authArea");
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && cfg.DISCORD_GUILD_ID);

  let supabase = null;
  let session = null;
  let profile = null;

  function renderLoggedOut(reason) {
    const el = area();
    if (!el) return;
    el.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "auth-btn";
    if (!configured || !cfg.SUPABASE_URL) {
      btn.textContent = "🔒 로그인 준비 중";
      btn.disabled = true;
      btn.title = "Supabase·Discord 연결 설정이 아직 안 됐어요 (docs/SETUP_DISCORD_SUPABASE.md)";
    } else {
      btn.textContent = "Discord로 로그인";
      btn.onclick = login;
    }
    el.appendChild(btn);
    if (reason) {
      const msg = document.createElement("div");
      msg.className = "auth-msg";
      msg.textContent = reason;
      el.appendChild(msg);
    }
  }

  function renderLoggedIn() {
    const el = area();
    if (!el) return;
    el.innerHTML = "";
    const name = (profile && profile.display_name) || (session.user.user_metadata && session.user.user_metadata.full_name) || "회원";
    const chip = document.createElement("span");
    chip.className = "auth-chip";
    chip.textContent = "👤 " + name;
    el.appendChild(chip);
    if (profile && profile.site_role === "admin") {
      const a = document.createElement("a");
      a.href = "admin.html";
      a.className = "auth-admin";
      a.textContent = "관리";
      el.appendChild(a);
    }
    const out = document.createElement("button");
    out.className = "auth-btn";
    out.textContent = "로그아웃";
    out.onclick = logout;
    el.appendChild(out);
  }

  async function login() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        scopes: "identify guilds.members.read",
        redirectTo: location.origin + location.pathname,
      },
    });
    if (error) renderLoggedOut("로그인 실패: " + error.message);
  }

  async function logout() {
    await supabase.auth.signOut();
    session = null;
    profile = null;
    renderLoggedOut();
  }

  async function callFunction(name, body) {
    const res = await fetch(cfg.SUPABASE_URL + "/functions/v1/" + name, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify(body || {}),
    });
    return res.json().catch(() => ({}));
  }

  async function syncRoles() {
    // 로그인 직후 1회: provider_token으로 서버 멤버/역할 확인
    if (session.provider_token && !sessionStorage.getItem("scfit.synced")) {
      sessionStorage.setItem("scfit.synced", "1");
      await callFunction("discord-sync", { provider_token: session.provider_token });
    }
    // 이용 중 재확인 (봇 토큰 설정 후 동작)
    const last = Number(sessionStorage.getItem("scfit.refreshedAt") || 0);
    const interval = (cfg.ROLE_REFRESH_MINUTES || 10) * 60 * 1000;
    if (Date.now() - last > interval) {
      sessionStorage.setItem("scfit.refreshedAt", String(Date.now()));
      await callFunction("discord-refresh", {});
    }
  }

  async function loadProfile() {
    const { data } = await supabase
      .from("profiles")
      .select("display_name, site_role")
      .eq("id", session.user.id)
      .single();
    profile = data || null;
  }

  async function boot() {
    renderLoggedOut();
    if (!configured || !cfg.SUPABASE_URL) return;
    if (!window.supabase || !window.supabase.createClient) return;
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const { data } = await supabase.auth.getSession();
    session = data.session;
    if (session) {
      await syncRoles();
      await loadProfile();
      renderLoggedIn();
    }
    supabase.auth.onAuthStateChange(async (_event, s) => {
      session = s;
      if (session) {
        await syncRoles();
        await loadProfile();
        renderLoggedIn();
      } else {
        profile = null;
        sessionStorage.removeItem("scfit.synced");
        renderLoggedOut();
      }
    });
  }

  // 제한 자료 접근 시 서버 측 신선도 강제: 주기(throttle)와 무관하게
  // Discord 멤버십을 즉시 재확인한다. 실패해도 예외를 던지지 않고
  // DB의 마지막 확인 시각(TTL)에 따라 접근이 결정된다.
  async function refreshNow() {
    if (!session) return;
    sessionStorage.setItem("scfit.refreshedAt", String(Date.now()));
    await callFunction("discord-refresh", {});
  }

  // 다른 스크립트에서 쓸 공개 API
  window.scAuth = {
    get session() { return session; },
    get profile() { return profile; },
    get client() { return supabase; },
    isAdmin: () => !!(profile && profile.site_role === "admin"),
    refreshNow,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
