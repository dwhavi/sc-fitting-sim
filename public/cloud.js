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
      const ml = $("cloudList");
      if (ml) ml.innerHTML = '<div class="fit-dim">목록 불러오는 중…</div>';
      loadCloudList();
      loadBrowse();
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
        loadBrowse();
      };
      const cmtBtn = document.createElement("button");
      cmtBtn.textContent = "💬";
      cmtBtn.title = "댓글 · 테스트 기록";
      cmtBtn.style.cssText = "padding:3px 8px;font-size:11px";
      cmtBtn.onclick = () => openDiscussion(f.id);
      row.appendChild(label); row.appendChild(loadBtn); row.appendChild(cmtBtn); row.appendChild(delBtn);
      host.appendChild(row);
    });
  }

  // ---- 댓글 · 테스트 기록 패널 (4단계) ----
  // 읽기·쓰기 모두 fittings-api get/comment_*/test_* 경유: 그룹 지정 피팅은
  // 서버가 요청마다 Discord 역할을 재검증한다. 클라이언트는 표시만 담당.
  async function openDiscussion(fittingId) {
    const { data, error } = await client().functions.invoke("fittings-api", { body: { action: "get", id: fittingId } });
    const fit = data && data.fitting;
    if (error || !fit) { setStatus("열기 실패: " + (error ? error.message : "없음"), true); return; }
    const me = (data && data.me) || {};
    const ov = document.createElement("div");
    ov.className = "modal-ov";
    const fmt = (t) => new Date(t).toLocaleString("ko-KR");
    const cmtHtml = (fit.comments || []).map((c) => {
      const own = c.author_id === me.id;
      const acts = (own ? " <a href='#' data-ce='" + c.id + "'>수정</a>" : "") +
        ((own || me.admin) ? " <a href='#' data-cd='" + c.id + "' style='color:var(--bad)'>삭제</a>" : "");
      return "<div style='border-bottom:1px solid var(--line);padding:6px 0;font-size:12px'>" +
        "<b>" + escHtml(c.author_name || "회원") + "</b> <span class='dim'>" + fmt(c.created_at) +
        (c.updated_at !== c.created_at ? " (수정됨)" : "") + "</span>" + acts +
        "<div style='margin-top:2px;white-space:pre-wrap'>" + escHtml(c.body) + "</div></div>";
    }).join("") || "<div class='dim' style='font-size:12px'>댓글이 없어요.</div>";
    const recHtml = (fit.test_records || []).map((r) => {
      const vals = Object.entries(r.values || {}).map(([k, v]) => escHtml(k) + ": " + escHtml(String(v))).join(", ");
      const acts = ((r.author_id === me.id || me.admin) ? " <a href='#' data-rd='" + r.id + "' style='color:var(--bad)'>삭제</a>" : "");
      return "<div style='border-bottom:1px solid var(--line);padding:6px 0;font-size:12px'>" +
        "<b>" + escHtml(r.author_name || "회원") + "</b> <span class='dim'>" + fmt(r.created_at) + "</span>" + acts +
        "<div style='margin-top:2px'><b>조건</b> " + escHtml(r.conditions) + "</div>" +
        (vals ? "<div><b>수치</b> " + vals + "</div>" : "") +
        (r.patch_version ? "<div><b>패치</b> " + escHtml(r.patch_version) + "</div>" : "") +
        (r.memo ? "<div class='dim'>" + escHtml(r.memo) + "</div>" : "") + "</div>";
    }).join("") || "<div class='dim' style='font-size:12px'>기록이 없어요.</div>";
    const recSection = fit.visibility === "groups"
      ? "<h3 style='margin:14px 0 6px;font-size:13px'>테스트 기록</h3><div id='discRecs'>" + recHtml + "</div>" +
        "<div style='margin-top:8px;display:flex;flex-direction:column;gap:6px'>" +
        "<input id='discRecCond' placeholder='측정 조건 (예: 지역, 상태)' style='font-size:12px'>" +
        "<input id='discRecVals' placeholder='수치 (예: top_speed=1234, dps=456)' style='font-size:12px'>" +
        "<div class='row' style='gap:6px'><input id='discRecPatch' placeholder='패치 버전 (예: 4.10.3)' style='font-size:12px;flex:1'><input id='discRecMemo' placeholder='메모 (선택)' style='font-size:12px;flex:2'></div>" +
        "<div class='row'><button id='discRecAdd' style='flex:1'>기록 추가</button></div></div>"
      : "";
    ov.innerHTML =
      '<div class="modal" style="width:520px;max-height:80vh;overflow-y:auto">' +
      '<div class="modal-h"><b>💬 ' + escHtml(fit.name) + "</b><button class='modal-x' id='discClose'>✕</button>" +
      "<div class='sub'>" + escHtml(fit.ship_slug) + " · " + (fit.visibility === "public" ? "공개" : "그룹 지정") + "</div></div>" +
      "<div style='padding:12px 14px'>" +
      "<h3 style='margin:0 0 6px;font-size:13px'>댓글</h3><div id='discCmts'>" + cmtHtml + "</div>" +
      (session()
        ? "<div class='row' style='margin-top:8px;gap:6px'><input id='discCmtIn' placeholder='댓글 입력' style='flex:1;font-size:12px'><button id='discCmtAdd'>등록</button></div>"
        : "<div class='dim' style='font-size:12px;margin-top:8px'>Discord 로그인 후 댓글을 쓸 수 있어요.</div>") +
      recSection +
      '<div id="discMsg" class="dim" style="font-size:12px;margin-top:8px"></div>' +
      "</div></div>";
    document.body.appendChild(ov);
    const close = () => ov.remove();
    $("discClose").onclick = close;
    // 재랜더링: 겹친 패널이 남지 않게 모든 모달 오버레이를 닫고 다시 연다.
    // (모든 핸들러가 공유하도록 함수 최상위 범위에 둔다)
    const reload = () => { document.querySelectorAll(".modal-ov").forEach((o) => o.remove()); openDiscussion(fittingId); };
    const cmtAdd = $("discCmtAdd");
    if (cmtAdd) cmtAdd.onclick = async () => {
      const text = $("discCmtIn").value.trim();
      if (!text) return;
      cmtAdd.disabled = true;
      const { data: r, error: e } = await client().functions.invoke("fittings-api", { body: { action: "comment_add", id: fittingId, body: text } });
      if (e || !r || !r.ok) { $("discMsg").textContent = "댓글 실패: " + (e ? e.message : (r && r.error) || "오류"); cmtAdd.disabled = false; return; }
      reload();
    };
    ov.querySelectorAll("[data-ce]").forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        const text = prompt("댓글 수정");
        if (!text || !text.trim()) return;
        await client().functions.invoke("fittings-api", { body: { action: "comment_edit", comment_id: a.dataset.ce, body: text.trim() } });
        reload();
      };
    });
    ov.querySelectorAll("[data-cd]").forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        if (!confirm("댓글을 삭제할까요?")) return;
        await client().functions.invoke("fittings-api", { body: { action: "comment_delete", comment_id: a.dataset.cd } });
        reload();
      };
    });
    ov.querySelectorAll("[data-rd]").forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        if (!confirm("테스트 기록을 삭제할까요?")) return;
        await client().functions.invoke("fittings-api", { body: { action: "test_delete", record_id: a.dataset.rd } });
        reload();
      };
    });
    const recAdd = $("discRecAdd");
    if (recAdd) recAdd.onclick = async () => {
      const conditions = $("discRecCond").value.trim();
      if (!conditions) { $("discMsg").textContent = "측정 조건을 입력하세요."; return; }
      const values = {};
      $("discRecVals").value.split(",").forEach((kv) => {
        const m = kv.split("=");
        if (m.length === 2 && m[0].trim()) {
          const num = Number(m[1].trim());
          values[m[0].trim()] = isNaN(num) ? m[1].trim() : num;
        }
      });
      recAdd.disabled = true;
      const { data: r, error: e } = await client().functions.invoke("fittings-api", { body: {
        action: "test_add", id: fittingId, conditions, values,
        patch_version: $("discRecPatch").value.trim(), memo: $("discRecMemo").value.trim(),
      } });
      if (e || !r || !r.ok) { $("discMsg").textContent = "기록 실패: " + (e ? e.message : (r && r.error) || "오류"); recAdd.disabled = false; return; }
      reload();
    };
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

  // ---- 피팅 둘러보기 (공개 + 로그인 시 허용 그룹) ----
  // 목록은 fittings-api browse: 비로그인은 공개만, 로그인은 허용 그룹 포함.
  // 비공개 피팅은 목록·검색·직접 URL 어디에도 메타데이터가 나오지 않는다
  // (서버가 존재 자체를 숨긴다 — get도 not_found).
  let browseRows = [];
  async function loadBrowse() {
    const host = $("browseList");
    if (!host) return;
    const { data, error } = await client().functions.invoke("fittings-api", { body: { action: "browse" } });
    if (error || !data || !data.ok) { host.innerHTML = '<div class="fit-dim">목록 실패: ' + escHtml(error ? error.message : (data && data.error) || "오류") + "</div>"; return; }
    browseRows = data.fittings || [];
    renderBrowse();
  }

  function renderBrowse() {
    const host = $("browseList");
    if (!host) return;
    const q = ($("browseSearch") && $("browseSearch").value || "").trim().toLowerCase();
    const rows = browseRows.filter((f) => !q || f.name.toLowerCase().includes(q) || f.ship_slug.toLowerCase().includes(q));
    if (!rows.length) { host.innerHTML = '<div class="fit-dim">표시할 피팅이 없어요.</div>'; return; }
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
      const cmtBtn = document.createElement("button");
      cmtBtn.textContent = "💬";
      cmtBtn.title = "댓글 · 테스트 기록";
      cmtBtn.style.cssText = "padding:3px 8px;font-size:11px";
      cmtBtn.onclick = () => openDiscussion(f.id);
      row.appendChild(label); row.appendChild(loadBtn); row.appendChild(cmtBtn);
      host.appendChild(row);
    });
  }

  // 직접 URL (?fit=<id>): 보이는 피팅만 불러온다. 보이지 않으면
  // 메타데이터 없이 "없다"는 메시지만 표시한다.
  async function loadFromUrl() {
    const id = new URLSearchParams(location.search).get("fit");
    if (!id) return;
    const { data, error } = await client().functions.invoke("fittings-api", { body: { action: "get", id } });
    if (error || !data || !data.fitting) { setStatus("피팅을 찾을 수 없어요.", true); return; }
    await loadCloudFitting(id);
  }

  function boot() {
    const btn = $("cloudSaveBtn");
    if (!btn) return;
    const bs = $("browseSearch");
    if (bs) bs.oninput = renderBrowse;
    loadBrowse();
    loadFromUrl();
    btn.onclick = onSaveClick;
    // 로그인 상태가 바뀌면 목록 갱신
    let last = null;
    setInterval(() => {
      const s = session();
      const key = s ? s.user.id : null;
      if (key !== last) { last = key; loadCloudList(); loadBrowse(); }
    }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
