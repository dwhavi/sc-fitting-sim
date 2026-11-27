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

  // 서버 요청 중에는 상태줄에 진행 표시를 보여 준다 (요청 하나가 5~15초 걸릴 수 있음).
  let pending = 0;
  async function inv(name, opts) {
    const st = $("cloudStatus");
    const prev = st ? st.textContent : "";
    const prevColor = st ? st.style.color : "";
    pending++;
    if (st) { st.textContent = "⏳ 서버에서 확인 중… (최대 15초 걸릴 수 있어요)"; st.style.color = "var(--dim)"; }
    try { return await client().functions.invoke(name, opts); }
    finally { pending--; if (!pending && st && st.textContent.startsWith("⏳")) { st.textContent = prev.startsWith("⏳") ? "" : prev; st.style.color = prevColor; } }
  }
  function shipName(slug) {
    const sh = (window.DB && DB.ships || (typeof DB !== "undefined" && DB.ships) || []).find((x) => x.slug === slug || x.class === slug);
    return (sh && sh.name) || slug;
  }

  function currentPayload() {
    return {
      ship: curShip,
      build: build,
      pwr: { segOff: pwr.segOff, grpOff: pwr.grpOff, coolerSegs: pwr.coolerSegs, coolerOff: pwr.coolerOff, poolSel: pwr.poolSel },
      savedAt: new Date().toISOString(),
    };
  }

  const GRADE_NAMES = ["함장", "1등급 (항해사·전투원·상인)", "2등급 (베테랑 탐사원)", "3등급 (탐사원)", "4등급 (등급 미부여)"];
  function visLabel(f) {
    if (f.visibility === "public") return "일반";
    const ag = (f.allowed_grades || [0, 1, 2, 3]).slice().sort();
    return "보안 · " + (ag.length === 4 ? "0~3등급 모두 열람" : ag.join("·") + "등급만 열람");
  }

  // 서버가 Discord 역할을 즉시 재검증해 계산한 등급. 화면 표시용이며 권한은 서버가 다시 판단한다.
  const GRADE_SHORT = ["0등급 · 함장", "1등급 · 항해사·전투원·상인", "2등급 · 베테랑 탐사원", "3등급 · 탐사원"];
  // 열람 등급 체크박스: 0~3 개별 선택 (비연속 가능). 4등급은 보안 자료를 볼 수 없어 선택지에 없다.
  function gradeBoxes(name, sel) {
    const cur = sel || [0, 1, 2, 3];
    return '<div class="gradeboxes" data-gb="' + name + '" style="display:flex;flex-direction:column;gap:3px;font-size:12px">' +
      GRADE_SHORT.map((l, g) => '<label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" value="' + g + '"' + (cur.includes(g) ? " checked" : "") + ' style="width:auto"> ' + l + "</label>").join("") + "</div>";
  }
  function readBoxes(root) { return [...root.querySelectorAll("input[type=checkbox]:checked")].map((c) => Number(c.value)).sort(); }

  let myMe = null;
  async function loadMe() {
    const el = $("cloudGrade");
    if (!session()) { myMe = null; if (el) el.textContent = ""; return null; }
    let { data } = await inv("fittings-api", { body: { action: "me" } });
    myMe = data && data.ok ? data : null;
    // 로그인 직후엔 프로필(Discord ID) 기록이 늦어 첫 확인이 실패할 수 있다. 서버는 fail-closed(4등급)라
    // 권한은 안전하지만 표시가 남지 않도록, 미확인이면 잠시 뒤 몇 번 다시 확인하고 목록도 새로 불러온다.
    if (myMe && !myMe.verified && !loadMe._retrying) {
      loadMe._retrying = true;
      (async () => {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 2500));
          if (!session()) break;
          const r2 = await inv("fittings-api", { body: { action: "me" } });
          if (r2.data && r2.data.ok && r2.data.verified) {
            myMe = r2.data;
            if (el) el.textContent = "내 등급: " + GRADE_NAMES[myMe.grade];
            loadCloudList(); loadBrowse();
            break;
          }
        }
        loadMe._retrying = false;
      })();
    }
    if (el) el.textContent = myMe ? "내 등급: " + (myMe.verified ? GRADE_NAMES[myMe.grade] : "확인 중 · 4등급으로 취급") : "";
    return myMe;
  }

  let myFits = [];
  function openSaveDialog(me) {
    const ov = document.createElement("div");
    ov.className = "modal-ov";
    const vis = '<select id="cloudVis" style="width:auto"><option value="public">일반 — 누구나 열람</option>' +
      (me.can_create_security ? '<option value="security">보안 — 기본 0~3등급 열람</option>' : "") + "</select>" +
      (me.can_create_security ? "" : '<div class="dim" style="font-size:11px;margin-top:4px">보안 자료는 3등급 이상(0~3등급)만 만들 수 있어요.</div>');
    const expo = me.can_restrict
      ? '<div id="cloudMax"><div class="dim" style="font-size:11px;margin-bottom:4px">열람할 수 있는 등급 (기본: 모두)</div>' + gradeBoxes("save", [0, 1, 2, 3]) + '</div>'
      : "";
    ov.innerHTML =
      '<div class="modal" style="width:420px">' +
      '<div class="modal-h"><b>☁️ 서버에 저장</b><button class="modal-x" id="cloudCancel">✕</button>' +
      '<div class="sub">' + escHtml(curShip) + " · 현재 부품 구성과 전력 배분을 계정에 저장합니다.</div></div>" +
      '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">' +
      (myFits.length ? '<select id="cloudTarget" style="width:auto"><option value="">새 피팅으로 저장</option>' +
        myFits.map((f) => '<option value="' + escHtml(f.id) + '">덮어쓰기 · ' + escHtml(f.name) + ' (' + escHtml(shipName(f.ship_slug)) + ')</option>').join("") + "</select>" : "") +
      '<label class="dim" style="font-size:11px">저장명</label>' +
      '<input id="cloudName" maxlength="100" placeholder="저장명 (피팅 이름)" value="' + escHtml(shipName(curShip) + " " + new Date().toLocaleDateString("ko-KR")) + '">' +
      '<label class="dim" style="font-size:11px">메모 (선택)</label>' +
      '<textarea id="cloudMemo" maxlength="500" rows="3" placeholder="간단한 메모 (최대 500자)" style="width:100%;resize:vertical;box-sizing:border-box"></textarea>' +
      "<div>" + vis + '</div>' +
      '<div id="cloudExpoPick" style="display:none">' + expo + "</div>" +
      '<div class="row"><button id="cloudDoSave" style="flex:1">저장</button></div>' +
      '<div id="cloudDlgMsg" class="dim" style="font-size:12px"></div>' +
      "</div></div>";
    document.body.appendChild(ov);
    $("cloudCancel").onclick = () => ov.remove();
    const visSel = $("cloudVis");
    const pick = $("cloudExpoPick");
    const tgt = $("cloudTarget");
    if (tgt) tgt.onchange = () => {
      const f = myFits.find((x) => x.id === tgt.value);
      if (f) { $("cloudName").value = f.name; $("cloudMemo").value = f.memo || ""; visSel.value = f.visibility === "security" && me.can_create_security ? "security" : "public"; if ($("cloudMax")) { const ag = f.allowed_grades || [0, 1, 2, 3]; $("cloudMax").querySelectorAll("input").forEach((c) => { c.checked = ag.includes(Number(c.value)); }); } syncPick(); }
    };
    const syncPick = () => { pick.style.display = visSel.value === "security" ? "" : "none"; };
    visSel.onchange = syncPick; syncPick();
    $("cloudDoSave").onclick = async () => {
      const name = $("cloudName").value.trim();
      if (!name) { $("cloudDlgMsg").textContent = "이름을 입력하세요."; return; }
      const visibility = visSel.value;
      const maxSel = $("cloudMax");
      const maxGrade = visibility === "security" && maxSel ? readBoxes(maxSel) : undefined;
      if (maxGrade && !maxGrade.length) { $("cloudDlgMsg").textContent = "열람할 등급을 하나 이상 고르세요."; return; }
      if (maxGrade && me.grade != null && !maxGrade.includes(me.grade) && !confirm("내 등급(" + me.grade + ")이 열람 범위 밖이에요. 저장 후 나도 이 자료를 볼 수 없어요. 계속할까요?")) return;
      $("cloudDoSave").disabled = true;
      // 저장도 fittings-api 경유: 그룹 지정은 서버가 역할을 즉시 재검증한다.
      const { data, error } = await inv("fittings-api", {
        body: {
          action: "save",
          id: ($("cloudTarget") && $("cloudTarget").value) || undefined,
          ship_slug: curShip,
          name: name,
          memo: $("cloudMemo").value.trim(),
          payload: currentPayload(),
          visibility: visibility,
          allowed_grades: maxGrade,
        },
      });
      if (error || !data || !data.ok) {
        $("cloudDlgMsg").textContent = "저장 실패: " + (error ? error.message : (data && data.error) || "오류");
        $("cloudDoSave").disabled = false;
        return;
      }
      const wasOverwrite = body_id_used();
      ov.remove();
      setStatus((wasOverwrite ? "덮어쓰기 완료 — " : "서버에 저장됨 — ") + name);
      const ml = $("cloudList");
      if (ml) ml.innerHTML = '<div class="fit-dim">목록 불러오는 중…</div>';
      loadCloudList();
      loadBrowse();
    };
  }

  function body_id_used() { return !!($("cloudTarget") && $("cloudTarget").value); }
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
    const { data, error } = await inv("fittings-api", { body: { action: "list_mine" } });
    if (error || !data || !data.ok) { host.innerHTML = '<div class="fit-dim">목록 실패: ' + escHtml(error ? error.message : (data && data.error) || "오류") + "</div>"; return; }
    const rows = data.fittings || [];
    myFits = rows;
    if (!rows.length) { host.innerHTML = '<div class="fit-dim">서버에 저장된 피팅이 없어요.</div>'; return; }
    host.innerHTML = "";
    rows.forEach((f) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:5px 8px;margin-top:5px;font-size:12px";
      const label = document.createElement("div");
      label.style.flex = "1";
      label.innerHTML = "<b>" + escHtml(f.name) + "</b> <span class='dim'>" + escHtml(shipName(f.ship_slug)) +
        " · " + visLabel(f) + (f.author_name ? " · 작성 " + escHtml(f.author_name) : "") + " · " + new Date(f.created_at).toLocaleDateString("ko-KR") + "</span>" +
        (f.memo ? "<div class='dim' style='white-space:pre-wrap;margin-top:2px'>" + escHtml(f.memo) + "</div>" : "");
      const loadBtn = document.createElement("button");
      loadBtn.textContent = "불러오기";
      loadBtn.style.cssText = "padding:3px 8px;font-size:11px";
      loadBtn.onclick = () => loadCloudFitting(f.id);
      const delBtn = document.createElement("button");
      delBtn.textContent = "삭제";
      delBtn.style.cssText = "padding:3px 8px;font-size:11px";
      delBtn.onclick = async () => {
        if (!confirm("서버 피팅을 삭제할까요?")) return;
        const { data: dres, error: derr } = await inv("fittings-api", { body: { action: "delete", id: f.id } });
        if (derr || !dres || !dres.ok) { setStatus("삭제 실패: " + (derr ? derr.message : (dres && dres.error) || "오류"), true); return; }
        loadCloudList();
        loadBrowse();
      };
      const cmtBtn = document.createElement("button");
      cmtBtn.textContent = "💬";
      cmtBtn.title = "댓글 · 테스트 기록";
      cmtBtn.style.cssText = "padding:3px 8px;font-size:11px";
      cmtBtn.onclick = () => openDiscussion(f.id);
      row.appendChild(label); row.appendChild(loadBtn); row.appendChild(shareBtn(f)); row.appendChild(cmtBtn); row.appendChild(delBtn);
      host.appendChild(row);
    });
  }

  function shareBtn(f) {
    const b = document.createElement("button");
    b.textContent = "🔗";
    b.title = "공유 링크 복사";
    b.style.cssText = "padding:3px 8px;font-size:11px";
    b.onclick = async () => {
      const url = location.origin + location.pathname + "?fit=" + f.id;
      try { await navigator.clipboard.writeText(url); setStatus("링크를 복사했어요. 보안 자료는 열람 등급이 되는 로그인 사용자에게만 보여요."); }
      catch (e) { prompt("링크를 복사하세요", url); }
    };
    return b;
  }

  // ---- 댓글 · 테스트 기록 패널 (4단계) ----
  // 읽기·쓰기 모두 fittings-api get/comment_*/test_* 경유: 그룹 지정 피팅은
  // 서버가 요청마다 Discord 역할을 재검증한다. 클라이언트는 표시만 담당.
  async function openDiscussion(fittingId) {
    const { data, error } = await inv("fittings-api", { body: { action: "get", id: fittingId } });
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
    const recSection = fit.visibility === "security"
      ? "<h3 style='margin:14px 0 6px;font-size:13px'>테스트 기록</h3><div id='discRecs'>" + recHtml + "</div>" +
        "<div style='margin-top:8px;display:flex;flex-direction:column;gap:6px'>" +
        "<input id='discRecCond' placeholder='측정 조건 (예: 지역, 상태)' style='font-size:12px'>" +
        "<input id='discRecVals' placeholder='수치 (예: top_speed=1234, dps=456)' style='font-size:12px'>" +
        "<div class='row' style='gap:6px'><input id='discRecPatch' placeholder='패치 버전 (예: 4.10.3)' style='font-size:12px;flex:1'><input id='discRecMemo' placeholder='메모 (선택)' style='font-size:12px;flex:2'></div>" +
        "<div class='row'><button id='discRecAdd' style='flex:1'>기록 추가</button></div></div>"
      : "";
    const expoCtl = (me.can_restrict && fit.visibility === "security")
      ? "<div id='discExpoBox' style='margin:0 0 10px;font-size:12px'><b>열람 등급</b>" + gradeBoxes("expo", fit.allowed_grades) +
        "<button id='discExpoApply' style='margin-top:6px;padding:3px 10px;font-size:11px'>열람 등급 적용</button></div>"
      : "";
    ov.innerHTML =
      '<div class="modal" style="width:520px;max-height:80vh;overflow-y:auto">' +
      '<div class="modal-h"><b>💬 ' + escHtml(fit.name) + "</b><button class='modal-x' id='discClose'>✕</button>" +
      "<div class='sub'>" + escHtml(shipName(fit.ship_slug)) + " · " + visLabel(fit) + "</div></div>" +
      "<div style='padding:12px 14px'>" + expoCtl +
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
    const expoApply = $("discExpoApply");
    if (expoApply) expoApply.onclick = async () => {
      const sel = readBoxes($("discExpoBox"));
      if (!sel.length) { $("discMsg").textContent = "열람할 등급을 하나 이상 고르세요."; return; }
      if (me.grade != null && !sel.includes(me.grade) && !confirm("내 등급(" + me.grade + ")이 열람 범위 밖이 돼요. 이 자료는 나도 더 이상 볼 수 없게 됩니다. 계속할까요?")) return;
      expoApply.disabled = true;
      const { data: r, error: e } = await inv("fittings-api", { body: { action: "set_exposure", id: fittingId, allowed_grades: sel } });
      if (e || !r || !r.ok) { $("discMsg").textContent = "열람 등급 변경 실패: " + (e ? e.message : (r && r.error) || "오류"); expoApply.disabled = false; return; }
      reload(); loadCloudList(); loadBrowse();
    };
    const cmtAdd = $("discCmtAdd");
    if (cmtAdd) cmtAdd.onclick = async () => {
      const text = $("discCmtIn").value.trim();
      if (!text) return;
      cmtAdd.disabled = true;
      const { data: r, error: e } = await inv("fittings-api", { body: { action: "comment_add", id: fittingId, body: text } });
      if (e || !r || !r.ok) { $("discMsg").textContent = "댓글 실패: " + (e ? e.message : (r && r.error) || "오류"); cmtAdd.disabled = false; return; }
      reload();
    };
    ov.querySelectorAll("[data-ce]").forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        const cur = ((fit.comments || []).find((c) => c.id === a.dataset.ce) || {}).body || "";
        const text = prompt("댓글 수정", cur);
        if (!text || !text.trim()) return;
        await inv("fittings-api", { body: { action: "comment_edit", comment_id: a.dataset.ce, body: text.trim() } });
        reload();
      };
    });
    ov.querySelectorAll("[data-cd]").forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        if (!confirm("댓글을 삭제할까요?")) return;
        await inv("fittings-api", { body: { action: "comment_delete", comment_id: a.dataset.cd } });
        reload();
      };
    });
    ov.querySelectorAll("[data-rd]").forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        if (!confirm("테스트 기록을 삭제할까요?")) return;
        await inv("fittings-api", { body: { action: "test_delete", record_id: a.dataset.rd } });
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
      const { data: r, error: e } = await inv("fittings-api", { body: {
        action: "test_add", id: fittingId, conditions, values,
        patch_version: $("discRecPatch").value.trim(), memo: $("discRecMemo").value.trim(),
      } });
      if (e || !r || !r.ok) { $("discMsg").textContent = "기록 실패: " + (e ? e.message : (r && r.error) || "오류"); recAdd.disabled = false; return; }
      reload();
    };
  }

  async function loadCloudFitting(id) {
    const { data, error } = await inv("fittings-api", { body: { action: "get", id } });
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
    if (window.deltaSetBaseline) window.deltaSetBaseline('서버 피팅: ' + (fit.name || fit.ship_slug)); // 변화량 비교 기준 = 불러온 피팅
    setStatus("서버 피팅 불러옴 — " + fit.ship_slug);
  }

  async function onSaveClick() {
    if (!session()) { setStatus("Discord 로그인 후 사용할 수 있어요.", true); return; }
    if (!curShip) { setStatus("먼저 함선을 선택하세요.", true); return; }
    const me = await loadMe();
    if (!me) { setStatus("등급을 확인하지 못했어요. 잠시 뒤 다시 시도하세요.", true); return; }
    openSaveDialog(me);
  }

  // ---- 피팅 둘러보기 (공개 + 로그인 시 허용 그룹) ----
  // 목록은 fittings-api browse: 비로그인은 공개만, 로그인은 허용 그룹 포함.
  // 비공개 피팅은 목록·검색·직접 URL 어디에도 메타데이터가 나오지 않는다
  // (서버가 존재 자체를 숨긴다 — get도 not_found).
  let browseRows = [];
  async function loadBrowse() {
    const host = $("browseList");
    if (!host) return;
    const { data, error } = await inv("fittings-api", { body: { action: "browse" } });
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
      label.innerHTML = "<b>" + escHtml(f.name) + "</b> <span class='dim'>" + escHtml(shipName(f.ship_slug)) +
        " · " + visLabel(f) + (f.author_name ? " · 작성 " + escHtml(f.author_name) : "") + " · " + new Date(f.created_at).toLocaleDateString("ko-KR") + "</span>" +
        (f.memo ? "<div class='dim' style='white-space:pre-wrap;margin-top:2px'>" + escHtml(f.memo) + "</div>" : "");
      const loadBtn = document.createElement("button");
      loadBtn.textContent = "불러오기";
      loadBtn.style.cssText = "padding:3px 8px;font-size:11px";
      loadBtn.onclick = () => loadCloudFitting(f.id);
      const cmtBtn = document.createElement("button");
      cmtBtn.textContent = "💬";
      cmtBtn.title = "댓글 · 테스트 기록";
      cmtBtn.style.cssText = "padding:3px 8px;font-size:11px";
      cmtBtn.onclick = () => openDiscussion(f.id);
      row.appendChild(label); row.appendChild(loadBtn); row.appendChild(shareBtn(f)); row.appendChild(cmtBtn);
      host.appendChild(row);
    });
  }

  // 직접 URL (?fit=<id>): 보이는 피팅만 불러온다. 보이지 않으면
  // 메타데이터 없이 "없다"는 메시지만 표시한다.
  async function loadFromUrl() {
    const id = new URLSearchParams(location.search).get("fit");
    if (!id) return;
    const { data, error } = await inv("fittings-api", { body: { action: "get", id } });
    if (error || !data || !data.fitting) { setStatus(session() ? "피팅을 찾을 수 없거나 열람 등급이 맞지 않아요." : "피팅을 찾을 수 없어요. 보안 자료라면 Discord로 로그인하면 보일 수 있어요.", true); return; }
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
      if (key !== last) { last = key; loadMe(); loadCloudList(); loadBrowse(); }
    }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
