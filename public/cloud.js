// SC Fitting Sim — 서버 피팅 저장/불러오기 (로그인 필요, 2단계)
// 공개 피팅만 RLS로 직접 읽는다. 그룹 지정 피팅과 본인 목록은 fittings-api
// Edge Function이 Discord 역할을 즉시 재검증한 뒤 중개한다. 이 파일은 화면과 요청만 담당.
(function () {
  const $ = (id) => document.getElementById(id);

  function client() { return window.scAuth && window.scAuth.client; }
  function session() { return window.scAuth && window.scAuth.session; }

  function setStatus(msg, bad) {
    const el = $("cloudStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = bad ? "var(--bad)" : "var(--dim)";
  }

  function currentPayload() {
    return {
      ship: curShip,
      build: build,
      pwr: { segOff: pwr.segOff, grpOff: pwr.grpOff, coolerSegs: pwr.coolerSegs, coolerOff: pwr.coolerOff, poolSel: pwr.poolSel },
      savedAt: new Date().toISOString(),
    };
  }

  async function myGroups() {
    // RLS(groups_select_member_or_admin)가 역할 근거 소속 그룹만 돌려준다.
    const { data, error } = await client()
      .from("groups")
      .select("id, name");
    if (error) return [];
    return (data || []).map((r) => ({ id: r.id, name: r.name }));
  }

  function openSaveDialog(groups) {
    const ov = document.createElement("div");
    ov.className = "modal-ov";
    const vis = groups.length
      ? '<select id="cloudVis" style="width:auto"><option value="public">공개 — 누구나 열람</option><option value="groups">그룹 지정 — 선택 그룹만 열람</option></select>'
      : '<select id="cloudVis" style="width:auto"><option value="public">공개 — 누구나 열람</option></select><div class="dim" style="font-size:11px;margin-top:4px">속한 그룹이 없어 공개로만 저장할 수 있어요.</div>';
    ov.innerHTML =
      '<div class="modal" style="width:420px">' +
      '<div class="modal-h"><b>☁️ 서버에 저장</b><button class="modal-x" id="cloudCancel">✕</button>' +
      '<div class="sub">' + escHtml(curShip) + " · 현재 부품 구성과 전력 배분을 계정에 저장합니다.</div></div>" +
      '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">' +
      '<input id="cloudName" placeholder="피팅 이름" value="' + escHtml(curShip + " " + new Date().toLocaleDateString("ko-KR")) + '">' +
      "<div>" + vis + '</div>' +
      '<div id="cloudGroupPick" style="display:none">' +
      groups.map((g) => '<label style="display:block;font-size:12px;padding:3px 0"><input type="checkbox" style="width:auto" value="' + g.id + '"> ' + escHtml(g.name) + "</label>").join("") +
      "</div>" +
      '<div class="row"><button id="cloudDoSave" style="flex:1">저장</button></div>' +
      '<div id="cloudDlgMsg" class="dim" style="font-size:12px"></div>' +
      "</div></div>";
    document.body.appendChild(ov);
    $("cloudCancel").onclick = () => ov.remove();
    const visSel = $("cloudVis");
    const pick = $("cloudGroupPick");
    const syncPick = () => { pick.style.display = visSel.value === "groups" ? "" : "none"; };
    visSel.onchange = syncPick; syncPick();
    $("cloudDoSave").onclick = async () => {
      const name = $("cloudName").value.trim();
      if (!name) { $("cloudDlgMsg").textContent = "이름을 입력하세요."; return; }
      const visibility = visSel.value;
      const gidList = [...pick.querySelectorAll("input:checked")].map((c) => c.value);
      if (visibility === "groups" && !gidList.length) { $("cloudDlgMsg").textContent = "공개할 그룹을 하나 이상 고르세요."; return; }
      $("cloudDoSave").disabled = true;
      // 저장도 fittings-api 경유: 그룹 지정은 서버가 역할을 즉시 재검증한다.
      const { data, error } = await client().functions.invoke("fittings-api", {
        body: {
          action: "save",
          ship_slug: curShip,
          name: name,
          payload: currentPayload(),
          visibility: visibility,
          group_ids: gidList,
        },
      });
      if (error || !data || !data.ok) {
        $("cloudDlgMsg").textContent = "저장 실패: " + (error ? error.message : (data && data.error) || "오류");
        $("cloudDoSave").disabled = false;
        return;
      }
      ov.remove();
      setStatus("서버에 저장됨 — " + name);
      loadCloudList();
    };
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function loadCloudList() {
    const host = $("cloudList");
    if (!host) return;
    if (!session()) { host.innerHTML = ""; return; }
    // 제한 자료는 fittings-api가 Discord 역할을 즉시 재검증한 뒤 중개한다.
    const { data, error } = await client().functions.invoke("fittings-api", { body: { action: "list_mine" } });
    if (error || !data || !data.ok) { host.innerHTML = '<div class="fit-dim">목록 실패: ' + escHtml(error ? error.message : (data && data.error) || "오류") + "</div>"; return; }
    const rows = data.fittings || [];
    if (!rows.length) { host.innerHTML = '<div class="fit-dim">서버에 저장된 피팅이 없어요.</div>'; return; }
    host.innerHTML = "";
    rows.forEach((f) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:5px 8px;margin-top:5px;font-size:12px";
      const label = document.createElement("div");
      label.style.flex = "1";
      label.innerHTML = "<b>" + escHtml(f.name) + "</b> <span class='dim'>" + escHtml(f.ship_slug) +
        " · " + (f.visibility === "public" ? "공개" : "그룹 지정") + " · " + new Date(f.created_at).toLocaleDateString("ko-KR") + "</span>";
      const loadBtn = document.createElement("button");
      loadBtn.textContent = "불러오기";
      loadBtn.style.cssText = "padding:3px 8px;font-size:11px";
      loadBtn.onclick = () => loadCloudFitting(f.id);
      const delBtn = document.createElement("button");
      delBtn.textContent = "삭제";
      delBtn.style.cssText = "padding:3px 8px;font-size:11px";
      delBtn.onclick = async () => {
        if (!confirm("서버 피팅을 삭제할까요?")) return;
        const { data: dres, error: derr } = await client().functions.invoke("fittings-api", { body: { action: "delete", id: f.id } });
        if (derr || !dres || !dres.ok) { setStatus("삭제 실패: " + (derr ? derr.message : (dres && dres.error) || "오류"), true); return; }
        loadCloudList();
      };
      row.appendChild(label); row.appendChild(loadBtn); row.appendChild(delBtn);
      host.appendChild(row);
    });
  }

  async function loadCloudFitting(id) {
    const { data, error } = await client().functions.invoke("fittings-api", { body: { action: "get", id } });
    const fit = data && data.fitting;
    if (error || !fit) { setStatus("불러오기 실패: " + (error ? error.message : "없음"), true); return; }
    const p = fit.payload || {};
    if (fit.ship_slug !== curShip) {
      await selectShip(fit.ship_slug);
    }
    build = p.build || {};
    renderSlots();
    if (p.pwr) {
      Object.assign(pwr, p.pwr);
      pwr.segOff = pwr.segOff || {}; pwr.grpOff = pwr.grpOff || {};
      pwr.coolerSegs = pwr.coolerSegs || {}; pwr.coolerOff = pwr.coolerOff || {};
    }
    renderSlots();
    updateStats();
    setStatus("서버 피팅 불러옴 — " + fit.ship_slug);
  }

  async function onSaveClick() {
    if (!session()) { setStatus("Discord 로그인 후 사용할 수 있어요.", true); return; }
    if (!curShip) { setStatus("먼저 함선을 선택하세요.", true); return; }
    const groups = await myGroups();
    openSaveDialog(groups);
  }

  function boot() {
    const btn = $("cloudSaveBtn");
    if (!btn) return;
    btn.onclick = onSaveClick;
    // 로그인 상태가 바뀌면 목록 갱신
    let last = null;
    setInterval(() => {
      const s = session();
      const key = s ? s.user.id : null;
      if (key !== last) { last = key; loadCloudList(); }
    }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
