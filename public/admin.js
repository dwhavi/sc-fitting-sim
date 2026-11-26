// SC Fitting Sim — 관리 화면 (관리자 전용)
// 권한 검사는 서버 RLS가 최종 담당. 여기서는 화면 노출만 가린다.
(function () {
  const $ = (id) => document.getElementById(id);
  let sb = null;
  let groups = [];
  let guildRoles = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtTime(t) {
    if (!t) return "-";
    const d = new Date(t);
    return d.toLocaleString("ko-KR", { hour12: false });
  }

  async function audit(action, target, detail) {
    await sb.from("audit_log").insert({
      actor_id: window.scAuth.session.user.id,
      action, target, detail: detail || null,
    });
  }

  // ===== Discord 역할 연결 =====

  async function loadMappings() {
    const { data, error } = await sb
      .from("discord_role_mappings")
      .select("id, discord_role_id, discord_role_name, group_id, groups(name)")
      .order("created_at");
    if (error) { $("mappingList").innerHTML = '<span class="bad">불러오기 실패: ' + esc(error.message) + "</span>"; return; }
    if (!data.length) {
      $("mappingList").innerHTML = '<span class="dim">연결된 역할이 없습니다.</span>';
      return;
    }
    $("mappingList").innerHTML = "<table><tr><th>Discord 역할</th><th>사이트 그룹</th><th></th></tr>" +
      data.map((m) => "<tr><td><span class='tag dc'>" + esc(m.discord_role_name || m.discord_role_id) + "</span></td>" +
        "<td><span class='tag gr'>" + esc(m.groups ? m.groups.name : "?") + "</span></td>" +
        "<td><button class='danger fix' data-del-map='" + m.id + "'>해제</button></td></tr>").join("") +
      "</table>";
    $("mappingList").querySelectorAll("[data-del-map]").forEach((b) => {
      b.onclick = async () => {
        await sb.from("discord_role_mappings").delete().eq("id", b.dataset.delMap);
        await audit("role_mapping_delete", b.dataset.delMap);
        loadMappings(); loadAudit();
      };
    });
  }

  async function loadGuildRoles() {
    const sel = $("mapRole");
    sel.innerHTML = "<option value=''>Discord 역할 불러오는 중…</option>";
    const res = await fetch(window.SCFIT_CONFIG.SUPABASE_URL + "/functions/v1/discord-admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + window.scAuth.session.access_token,
      },
      body: JSON.stringify({ action: "list_roles" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      sel.innerHTML = "<option value=''>역할 조회 실패 (봇 설정 확인)</option>";
      $("mapMsg").textContent = "Discord 서버 역할을 못 가져왔어요. 봇 토큰 설정과 서버 설치를 확인하세요. (" + (data.error || res.status) + ")";
      return;
    }
    guildRoles = data.roles;
    const gsel = $("gradeRole");
    if (gsel) gsel.innerHTML = "<option value=''>Discord 역할 선택…</option>" +
      guildRoles.map((r) => "<option value='" + esc(r.id) + "'>" + esc(r.name) + "</option>").join("");
    sel.innerHTML = "<option value=''>Discord 역할 선택…</option>" +
      guildRoles.map((r) => "<option value='" + esc(r.id) + "'>" + esc(r.name) + "</option>").join("");
  }

  async function addMapping() {
    const roleId = $("mapRole").value;
    const groupId = $("mapGroup").value;
    if (!roleId || !groupId) { $("mapMsg").textContent = "역할과 그룹을 모두 고르세요."; return; }
    const role = guildRoles.find((r) => r.id === roleId);
    const { error } = await sb.from("discord_role_mappings").insert({
      guild_id: window.SCFIT_CONFIG.DISCORD_GUILD_ID,
      discord_role_id: roleId,
      discord_role_name: role ? role.name : null,
      group_id: groupId,
      created_by: window.scAuth.session.user.id,
    });
    if (error) { $("mapMsg").textContent = "추가 실패: " + error.message; return; }
    $("mapMsg").textContent = "";
    await audit("role_mapping_add", roleId, { group_id: groupId, role_name: role ? role.name : null });
    loadMappings(); loadAudit();
  }

  // ===== Discord 역할 → 등급 연결 =====
  const GRADE_LABEL = ["0 함장", "1 항해사·전투원·상인", "2 베테랑 탐사원", "3 탐사원"];

  async function loadGradeMappings() {
    const { data, error } = await sb.from("discord_role_grade_mappings")
      .select("id, discord_role_id, discord_role_name, grade").order("grade").order("created_at");
    if (error) { $("gradeMapList").innerHTML = '<span class="bad">불러오기 실패: ' + esc(error.message) + "</span>"; return; }
    if (!data.length) { $("gradeMapList").innerHTML = '<span class="dim">연결된 역할이 없습니다. 지금은 모든 회원이 4등급이에요.</span>'; return; }
    $("gradeMapList").innerHTML = "<table><tr><th>Discord 역할</th><th>등급</th><th></th></tr>" +
      data.map((m) => "<tr><td><span class='tag dc'>" + esc(m.discord_role_name || m.discord_role_id) + "</span></td>" +
        "<td>" + esc(GRADE_LABEL[m.grade]) + "</td>" +
        "<td><button class='danger fix' data-del-gmap='" + m.id + "'>해제</button></td></tr>").join("") + "</table>";
    $("gradeMapList").querySelectorAll("[data-del-gmap]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("이 역할의 등급 연결을 해제할까요? 해당 역할 회원은 다음 확인부터 등급을 잃어요.")) return;
        await sb.from("discord_role_grade_mappings").delete().eq("id", b.dataset.delGmap);
        await audit("grade_mapping_delete", b.dataset.delGmap);
        loadGradeMappings(); loadAudit();
      };
    });
  }

  async function addGradeMapping() {
    const roleId = $("gradeRole").value;
    const grade = $("gradeVal").value;
    if (!roleId || grade === "") { $("gradeMapMsg").textContent = "역할과 등급을 모두 고르세요."; return; }
    const role = guildRoles.find((r) => r.id === roleId);
    const { error } = await sb.from("discord_role_grade_mappings").insert({
      guild_id: window.SCFIT_CONFIG.DISCORD_GUILD_ID,
      discord_role_id: roleId,
      discord_role_name: role ? role.name : null,
      grade: Number(grade),
      created_by: window.scAuth.session.user.id,
    });
    if (error) { $("gradeMapMsg").textContent = "추가 실패: " + (error.code === "23505" ? "이미 연결된 역할이에요." : error.message); return; }
    $("gradeMapMsg").textContent = "";
    await audit("grade_mapping_add", roleId, { grade: Number(grade), role_name: role ? role.name : null });
    loadGradeMappings(); loadAudit();
  }

  // ===== 그룹 =====

  async function loadGroups() {
    const { data, error } = await sb.from("groups").select("id, name, created_at").order("name");
    if (error) { $("groupList").innerHTML = '<span class="bad">불러오기 실패</span>'; return; }
    groups = data;
    $("mapGroup").innerHTML = "<option value=''>사이트 그룹 선택…</option>" +
      groups.map((g) => "<option value='" + g.id + "'>" + esc(g.name) + "</option>").join("");
    if (!groups.length) {
      $("groupList").innerHTML = '<span class="dim">그룹이 없습니다. 먼저 만드세요.</span>';
      return;
    }
    const { data: members } = await sb.from("group_members").select("group_id, user_id, source, profiles!group_members_user_id_fkey(display_name, discord_user_id)");
    const byGroup = {};
    (members || []).forEach((m) => {
      (byGroup[m.group_id] = byGroup[m.group_id] || []).push(m);
    });
    $("groupList").innerHTML = "<table><tr><th>그룹</th><th>회원</th><th></th></tr>" +
      groups.map((g) => {
        const ms = byGroup[g.id] || [];
        return "<tr><td><span class='tag gr'>" + esc(g.name) + "</span></td><td>" +
          (ms.length ? ms.map((m) => "<span class='tag' title='" + esc(m.profiles ? m.profiles.discord_user_id : "") + "'>" +
            esc(m.profiles ? m.profiles.display_name : m.user_id) + (m.source === "discord" ? " ·DC" : "") +
            " <a href='#' data-rm-member='" + g.id + ":" + m.user_id + "' style='color:var(--bad)'>×</a></span>").join(" ") : '<span class="dim">없음</span>') +
          "</td><td><button class='danger fix' data-del-group='" + g.id + "'>삭제</button></td></tr>";
      }).join("") + "</table>";
    $("groupList").querySelectorAll("[data-del-group]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("그룹을 삭제할까요? 연결된 역할 매핑과 소속 정보가 함께 삭제됩니다.")) return;
        await sb.from("groups").delete().eq("id", b.dataset.delGroup);
        await audit("group_delete", b.dataset.delGroup);
        loadGroups(); loadMappings(); loadAudit();
      };
    });
    $("groupList").querySelectorAll("[data-rm-member]").forEach((a) => {
      a.onclick = async (e) => {
        e.preventDefault();
        if (!confirm("이 회원을 그룹에서 뺄까요?")) return;
        const [gid, uid] = a.dataset.rmMember.split(":");
        await sb.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
        await audit("group_member_remove", uid, { group_id: gid });
        loadGroups(); loadAudit();
      };
    });
  }

  async function addGroup() {
    const name = $("newGroupName").value.trim();
    if (!name) return;
    const { error } = await sb.from("groups").insert({ name, created_by: window.scAuth.session.user.id });
    if (error) { alert("만들기 실패: " + error.message); return; }
    $("newGroupName").value = "";
    await audit("group_create", name);
    loadGroups(); loadAudit();
  }

  // ===== 회원 =====

  async function loadMembers() {
    const q = $("memberSearch").value.trim();
    let query = sb.from("profiles").select("id, discord_user_id, display_name, site_role, created_at").order("created_at", { ascending: false }).limit(200);
    if (q) query = query.or("display_name.ilike.%" + q + "%,discord_user_id.ilike.%" + q + "%");
    const { data, error } = await query;
    if (error) { $("memberList").innerHTML = '<span class="bad">불러오기 실패</span>'; return; }
    if (!data.length) { $("memberList").innerHTML = '<span class="dim">회원이 없습니다.</span>'; return; }
    $("memberList").innerHTML = "<table><tr><th>이름</th><th>Discord ID</th><th>역할</th><th>가입</th></tr>" +
      data.map((p) => "<tr><td>" + esc(p.display_name || "-") + "</td><td class='dim'>" + esc(p.discord_user_id || "-") + "</td>" +
        "<td><select data-role-user='" + p.id + "' style='width:auto'>" +
        // 연구자 역할은 등급 체계로 대체됨: 이미 연구자인 회원에게만 현재 값으로 보인다.
        ["member", ...(p.site_role === "researcher" ? ["researcher"] : []), "admin"].map((r) =>
          "<option value='" + r + "'" + (p.site_role === r ? " selected" : "") + ">" +
          { member: "회원", researcher: "연구자 (등급으로 대체)", admin: "관리자" }[r] + "</option>").join("") +
        "</select></td><td class='dim'>" + fmtTime(p.created_at) + "</td></tr>").join("") + "</table>";
    const adminCount = data.filter((p) => p.site_role === "admin").length;
    const meId = window.scAuth.session.user.id;
    $("memberList").querySelectorAll("[data-role-user]").forEach((sel) => {
      const prev = (data.find((p) => p.id === sel.dataset.roleUser) || {}).site_role;
      sel.onchange = async () => {
        // 마지막 관리자 보호: 관리자가 1명뿐이면 강등 불가, 본인 강등은 확인을 받는다.
        if (prev === "admin" && sel.value !== "admin") {
          if (adminCount <= 1) { alert("마지막 관리자는 강등할 수 없어요. 먼저 다른 관리자를 지정하세요."); sel.value = prev; return; }
          if (sel.dataset.roleUser === meId && !confirm("본인의 관리자 권한을 내려놓을까요? 이후 이 화면에 들어올 수 없어요.")) { sel.value = prev; return; }
        }
        const { error: e2 } = await sb.from("profiles").update({ site_role: sel.value, updated_at: new Date().toISOString() }).eq("id", sel.dataset.roleUser);
        if (e2) { alert("역할 변경 실패: " + e2.message); loadMembers(); return; }
        await audit("site_role_change", sel.dataset.roleUser, { site_role: sel.value });
        loadAudit();
      };
    });
  }

  // ===== 관리 기록 =====

  const ACTION_LABEL = {
    site_role_change: "사이트 역할 변경", role_mapping_add: "역할→그룹 연결 추가", role_mapping_delete: "역할→그룹 연결 해제",
    grade_mapping_add: "역할→등급 연결 추가", grade_mapping_delete: "역할→등급 연결 해제",
    group_member_remove: "그룹에서 회원 제외", group_create: "그룹 생성", group_delete: "그룹 삭제",
    fitting_exposure: "피팅 열람 등급 변경", discord_sync: "Discord 역할 동기화", discord_refresh: "Discord 역할 재확인", comment_delete_by_admin: "관리자가 댓글 삭제", test_record_delete_by_admin: "관리자가 테스트 기록 삭제",
  };

  async function loadAudit() {
    const { data, error } = await sb.from("audit_log").select("action, target, detail, created_at, profiles(display_name)").order("created_at", { ascending: false }).limit(100);
    if (error) { $("auditList").innerHTML = '<span class="bad">불러오기 실패</span>'; return; }
    if (!data.length) { $("auditList").innerHTML = '<span class="dim">기록이 없습니다.</span>'; return; }
    // 대상 ID를 이름으로 바꾼다 (회원·그룹·역할 연결). 이미 지워진 대상은 짧은 ID로 표시.
    const [pr, gr, rm, gm, fr] = await Promise.all([
      sb.from("profiles").select("id, display_name"),
      sb.from("groups").select("id, name"),
      sb.from("discord_role_mappings").select("id, discord_role_id, discord_role_name"),
      sb.from("discord_role_grade_mappings").select("id, discord_role_id, discord_role_name"),
      sb.from("fittings").select("id, name"),
    ]);
    const names = {};
    (pr.data || []).forEach((x) => { names[x.id] = "회원 " + (x.display_name || "-"); });
    (gr.data || []).forEach((x) => { names[x.id] = "그룹 " + x.name; });
    (rm.data || []).concat(gm.data || []).forEach((x) => { names[x.id] = "역할 " + (x.discord_role_name || x.discord_role_id); names[x.discord_role_id] = "역할 " + (x.discord_role_name || x.discord_role_id); });
    (fr.data || []).forEach((x) => { names[x.id] = "피팅 " + x.name; });
    const tgt = (a) => {
      const d = a.detail || {};
      if (a.action === "fitting_exposure") return "보안 피팅 " + String(a.target).slice(0, 8) + (d.max_grade ? " → " + (d.max_grade === 0 ? "함장만" : "0~" + d.max_grade + "등급") : "");
      if (/_by_admin$/.test(a.action)) return (a.action.startsWith("comment") ? "댓글" : "테스트 기록") + " (작성: " + ((d.author_id && names[d.author_id] || "회원 알 수 없음").replace(/^회원 /, "")) + ")";
      if (a.action === "discord_sync" || a.action === "discord_refresh") return "자동 역할 확인";
      if (a.target && names[a.target]) return names[a.target];
      if (d.role_name) return "역할 " + d.role_name;
      if (d.group_name) return "그룹 " + d.group_name;
      if (a.target && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(a.target) && !/^\d{15,}$/.test(a.target)) return a.target;
      return a.target ? "(삭제됨 또는 알 수 없음) " + String(a.target).slice(0, 8) : "-";
    };
    $("auditList").innerHTML = "<table><tr><th>시각</th><th>행위자</th><th>동작</th><th>대상</th></tr>" +
      data.map((a) => "<tr><td class='dim'>" + fmtTime(a.created_at) + "</td><td>" + esc(a.profiles ? a.profiles.display_name : "-") +
        "</td><td>" + esc(ACTION_LABEL[a.action] || a.action) + "</td><td class='dim'>" + esc(tgt(a)) + "</td></tr>").join("") + "</table>";
  }

  // ===== 시작 =====

  async function boot() {
    const guard = $("guard");
    const cfg = window.SCFIT_CONFIG || {};
    if (!cfg.SUPABASE_URL) { guard.textContent = "연결 설정이 아직 안 됐어요. docs/SETUP_DISCORD_SUPABASE.md 를 따르세요."; return; }

    // auth.js가 세션을 준비할 때까지 잠시 대기
    for (let i = 0; i < 40 && !window.scAuth.session; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!window.scAuth.client) break;
    }
    if (!window.scAuth.session) { guard.textContent = "로그인이 필요합니다. 시뮬레이터 페이지에서 Discord로 로그인하세요."; return; }
    sb = window.scAuth.client;

    // 관리자 여부는 서버에서 한 번 더 확인
    const { data: me } = await sb.from("profiles").select("site_role").eq("id", window.scAuth.session.user.id).single();
    if (!me || me.site_role !== "admin") { guard.textContent = "관리자만 볼 수 있는 화면입니다."; return; }

    guard.style.display = "none";
    $("adminMain").style.display = "";
    $("mapAdd").onclick = addMapping;
    $("gradeMapAdd").onclick = addGradeMapping;
    $("groupAdd").onclick = addGroup;
    let searchTimer = null;
    $("memberSearch").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadMembers, 300); };
    loadMappings(); loadGradeMappings(); loadGuildRoles(); loadGroups(); loadMembers(); loadAudit();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
