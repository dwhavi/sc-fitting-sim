// 스타도감 (기획안 3·4) — 함선/무기/부품 도감. db.json 값만 표시, 없으면 '없음', 추정 안 함.
// 1차는 텍스트·배지 카드 (repo에 함선 이미지/아이콘 없음).
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = n => n == null ? '없음' : (Math.round(n * 10) / 10).toLocaleString('en-US');
  const fmt0 = n => n == null ? '없음' : Math.round(n).toLocaleString('en-US');
  const C_LIGHT = 299792458;

  const CATS = [
    { id: 'ships', label: '🚀 함선' },
    { id: 'weapons', label: '🔫 무기' },
    { id: 'shields', label: '🛡️ 실드' },
    { id: 'powerplants', label: '⚡ 파워플랜트' },
    { id: 'coolers', label: '❄️ 쿨러' },
    { id: 'qds', label: '🌀 양자드라이브' },
    { id: 'missiles', label: '💥 미사일·랙' },
    { id: 'radars', label: '📡 레이더' },
  ];
  const SORTS = { name: '이름순', size: '사이즈순', perf: '주요 수치순' };
  const CAREER_ICON = { 'Combat': '⚔️', 'Ground': '🛞', 'Industrial': '⛏️', 'Competition': '🏁', 'Transporter': '🚚', 'Exploration': '🔭', 'Support': '🛟', 'Multi-Role': '🔀', 'Personal Transport': '🚐', 'Starter': '🌱' };

  let SHOPS = null, shopsTried = false;
  let cat = 'ships', q = '', fSize = '', fGrade = '', fMfr = '', sort = 'name';
  let built = false, selKey = null;

  const isPlaceholder = it => !it || !it.name || /PLACEHOLDER/i.test(it.name);

  // ---- 카테고리별 정규화: {key, name, size, grade, mfr, sub, bars:[{k,v,txt}], raw, kind} ----
  function itemsOf(cid) {
    if (!dbOk()) return [];
    const out = [];
    const push = (kind, it, o) => { if (!isPlaceholder(it)) out.push(Object.assign({ key: kind + ':' + it.class, kind, raw: it, name: it.name, size: it.size, grade: String(it.grade || ''), mfr: it.mfr || '', sub: '', bars: [] }, o)); };
    if (cid === 'ships') {
      for (const s of DB.ships || []) push('ship', s, {
        grade: (CAREER_ICON[s.career] || '🛸') + ' ' + (s.role || s.career || ''),
        sub: `👥 승무원 ${s.crew ?? '—'} · 📦 ${s.cargo ?? '—'}${s.career ? ' · ' + s.career : ''}`,
        bars: [
          { k: '버스트 DPS', v: s.stockDps || 0 },
          { k: '지속 DPS', v: s.stockSus || 0 },
          { k: '미사일', v: s.stockMsl || 0 },
          { k: '스톡 전력', v: s.stockGen || 0 },
        ],
        perf: s.stockDps || 0,
      });
    } else if (cid === 'weapons') {
      for (const w of DB.weapons || []) push('weapon', w, {
        sub: `${w.family || ''}${(w.dmgtype || []).length ? ' [' + w.dmgtype.join('+') + ']' : ''}${w.rpm ? ' · ' + w.rpm + 'rpm' : ''}`,
        bars: [
          { k: 'DPS', v: w.dps || 0 },
          { k: '알파', v: w.alpha || 0 },
          { k: '사거리', v: w.range || 0, txt: w.range != null ? fmt0(w.range) + 'm' : null },
          { k: '탄속', v: w.speed || 0, txt: w.speed != null ? fmt0(w.speed) + 'm/s' : null },
        ],
        perf: w.dps || 0,
      });
    } else if (cid === 'shields') {
      for (const s of DB.shields || []) push('shield', s, {
        sub: s.cls || '',
        bars: [
          { k: 'HP', v: s.hp || 0 },
          { k: '재생/s', v: s.regen || 0 },
        ],
        perf: s.hp || 0,
      });
    } else if (cid === 'powerplants') {
      for (const p of DB.powerplants || []) push('power', p, {
        sub: p.cls || '',
        bars: [{ k: '출력(핍)', v: p.pwGen != null ? p.pwGen : (p.output || 0) }],
        perf: p.pwGen != null ? p.pwGen : (p.output || 0),
      });
    } else if (cid === 'coolers') {
      for (const c of DB.coolers || []) push('cooler', c, {
        sub: c.cls || '',
        bars: [{ k: '냉각량', v: c.rate || 0 }],
        perf: c.rate || 0,
      });
    } else if (cid === 'qds') {
      for (const d of DB.qds || []) push('qd', d, {
        sub: `스풀 ${d.spool != null ? d.spool + 's' : '—'} · 쿨다운 ${d.cooldown != null ? d.cooldown + 's' : '—'}`,
        bars: [{ k: '속도', v: d.driveSpeed || d.speed || 0, txt: d.driveSpeed ? (d.driveSpeed / C_LIGHT * 100).toFixed(1) + '%c' : null }],
        perf: d.driveSpeed || d.speed || 0,
      });
    } else if (cid === 'missiles') {
      for (const m of DB.missiles || []) push('missile', m, {
        sub: '미사일' + ((m.dmgtype || []).length ? ' [' + m.dmgtype.join('+') + ']' : ''),
        bars: [{ k: '피해', v: m.damage || 0 }],
        perf: m.damage || 0,
      });
      for (const r of DB.racks || []) push('rack', r, {
        sub: `랙 · S${r.msize != null ? r.msize : '?'} 미사일`,
        bars: [{ k: '장전 수', v: r.missiles || 0 }],
        perf: r.missiles || 0,
      });
    } else if (cid === 'radars') {
      for (const r of DB.radars || []) {
        const sen = (r.detection && r.detection.Sensitivity) || {};
        const senTxt = ['IR', 'CS', 'EM', 'RS'].filter(k => sen[k] != null).map(k => `${k} ${sen[k]}`).join(' · ');
        push('radar', r, {
          sub: senTxt || '탐지장비',
          bars: [{ k: '최대 감도', v: Math.max(0, ...['IR', 'CS', 'EM', 'RS'].map(k => sen[k] || 0)) }],
          perf: Math.max(0, ...['IR', 'CS', 'EM', 'RS'].map(k => sen[k] || 0)),
        });
      }
    }
    return out;
  }

  // 막대 정규화 기준: 카테고리 전체(필터 전) 최대값 — 한 번만 계산
  const barMax = {};
  function barMaxFor(cid) {
    if (barMax[cid]) return barMax[cid];
    const m = [];
    for (const it of itemsOf(cid)) it.bars.forEach((b, i) => { m[i] = Math.max(m[i] || 0, b.v || 0); });
    barMax[cid] = m;
    return m;
  }

  function filtered() {
    let arr = itemsOf(cat);
    if (q) arr = arr.filter(it => (it.name + ' ' + it.mfr + ' ' + (it.raw.family || '')).toLowerCase().includes(q));
    if (fSize !== '') arr = arr.filter(it => String(it.size) === fSize);
    if (fGrade !== '') arr = arr.filter(it => it.grade === fGrade);
    if (fMfr !== '') arr = arr.filter(it => it.mfr === fMfr);
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => ((a.size ?? 99) - (b.size ?? 99)) || a.name.localeCompare(b.name),
      perf: (a, b) => (b.perf - a.perf) || a.name.localeCompare(b.name),
    }[sort] || ((a, b) => a.name.localeCompare(b.name));
    return arr.sort(by);
  }

  function buildHead() {
    $('cxTabs').innerHTML = CATS.map(c => `<button class="chip${c.id === cat ? ' on' : ''}" data-cat="${c.id}">${c.label}</button>`).join('');
    $('cxTabs').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; selKey = null; fSize = ''; fGrade = ''; fMfr = ''; buildHead(); renderGrid(); renderDetail(null); });
    const arr = itemsOf(cat);
    const sizes = [...new Set(arr.map(it => String(it.size)))].sort((a, b) => Number(a) - Number(b));
    const grades = [...new Set(arr.map(it => it.grade).filter(g => g && g.length <= 2))].sort();
    const mfrs = [...new Set(arr.map(it => it.mfr).filter(Boolean))].sort();
    $('cxFilters').innerHTML =
      `<input id="cxQ" placeholder="검색 (이름·제조사)" value="${esc(q)}">`
      + `<select id="cxSize"><option value="">사이즈 전체</option>${sizes.map(s => `<option value="${esc(s)}"${s === fSize ? ' selected' : ''}>S${esc(s)}</option>`).join('')}</select>`
      + (grades.length ? `<select id="cxGrade"><option value="">등급 전체</option>${grades.map(g => `<option value="${esc(g)}"${g === fGrade ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select>` : '')
      + (mfrs.length ? `<select id="cxMfr"><option value="">제조사 전체</option>${mfrs.map(m => `<option value="${esc(m)}"${m === fMfr ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>` : '')
      + `<select id="cxSort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    $('cxQ').addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); renderGrid(); });
    $('cxSize').onchange = e => { fSize = e.target.value; renderGrid(); };
    const g = $('cxGrade'); if (g) g.onchange = e => { fGrade = e.target.value; renderGrid(); };
    const m = $('cxMfr'); if (m) m.onchange = e => { fMfr = e.target.value; renderGrid(); };
    $('cxSort').onchange = e => { sort = e.target.value; renderGrid(); };
  }

  function cardHTML(it, maxes) {
    const bars = it.bars.filter(b => b.v > 0).slice(0, 4).map((b, i) => {
      const bi = it.bars.indexOf(b);
      const mx = maxes[bi] || 0;
      const pct = mx > 0 ? Math.max(2, Math.min(100, b.v / mx * 100)) : 0;
      return `<div class="cx-bar-row"><span>${esc(b.k)}</span><span class="cx-bar"><i style="width:${pct}%"></i></span><span class="v">${esc(b.txt || fmt(b.v))}</span></div>`;
    }).join('');
    const sz = it.kind === 'ship' || it.size != null ? `<span class="cx-sz">S${it.size}</span>` : '<span></span>';
    const grCls = /^[ABCD]$/.test(it.grade) ? it.grade : '';
    return `<button class="cx-card${selKey === it.key ? ' sel' : ''}" data-key="${esc(it.key)}">
      <span class="cx-top">${sz}<span class="cx-gr ${grCls}">${esc(it.grade || '—')}</span></span>
      <span class="cx-name">${esc(it.name)}</span>
      <span class="cx-mfr">${esc(it.mfr || '')}</span>
      ${it.sub ? `<span class="cx-sub">${esc(it.sub)}</span>` : ''}
      <span class="cx-bars">${bars}</span>
    </button>`;
  }

  function renderGrid() {
    const arr = filtered();
    const maxes = barMaxFor(cat);
    $('cxGrid').innerHTML = arr.length
      ? arr.map(it => cardHTML(it, maxes)).join('')
      : '<div class="cx-empty">조건에 맞는 항목이 없습니다.</div>';
    $('cxGrid').querySelectorAll('.cx-card').forEach(c => c.onclick = () => {
      selKey = c.dataset.key;
      $('cxGrid').querySelectorAll('.cx-card').forEach(x => x.classList.toggle('sel', x.dataset.key === selKey));
      renderDetail(itemsOf(cat).find(it => it.key === selKey) || null);
    });
  }

  // ---- 구매처 (shops.json — UEX, 무기 89/197 매칭 등 일부만) ----
  async function ensureShops() {
    if (SHOPS || shopsTried) return;
    shopsTried = true;
    try { const r = await fetch('shops.json?v=11', { cache: 'no-store' }); if (r.ok) SHOPS = await r.json(); } catch (e) { /* 없으면 구매처 미확인 */ }
  }
  function shopHTML(cls) {
    if (!SHOPS || !SHOPS.items || !SHOPS.items[cls] || !SHOPS.items[cls].length)
      return '<div class="cx-shop fit-dim">구매처 미확인 (UEX 매칭 없음)</div>';
    const offers = SHOPS.items[cls].slice().sort((a, b) => a[1] - b[1]);
    const terms = SHOPS.terms || [];
    const rows = offers.slice(0, 5).map(([t, p]) => {
      const st = terms[t] || {};
      return `<div>· ${esc(st.n || '판매점 ' + t)} <span class="pr">${fmt0(p)} aUEC</span></div>`;
    }).join('');
    return `<div class="cx-shop"><b>구매처 (UEX ${esc((SHOPS.meta || {}).fetched || '')} 기준, 최저가 순 ${offers.length}곳 중 상위)</b>${rows}</div>`;
  }

  const row = (k, v) => `<tr><td>${esc(k)}</td><td>${v == null || v === '' ? '없음' : v}</td></tr>`;
  const pct = v => v == null ? null : (v * 100).toFixed(0) + '%';

  function detailRows(it) {
    const r = it.raw;
    if (it.kind === 'ship') {
      const ss = shipStatusMap(); const st = (ss && ss.ships && ss.ships[r.class]) || null;
      const ag = r.agility || {}, ac = r.accel || {}, ifcs = r.ifcs || {};
      return [
        row('분류', `${esc(r.career || '')}${r.role ? ' · ' + esc(r.role) : ''}`),
        row('크기', 'S' + r.size), row('승무원', r.crew ?? null), row('화물', r.cargo ?? null),
        row('스톡 버스트 DPS', fmt(r.stockDps)),
        row('스톡 지속 DPS', fmt(r.stockSus)),
        row('스톡 알파', fmt(r.stockAlpha)),
        r.turretDps != null ? row('터렛 버스트 DPS', fmt(r.turretDps)) : '',
        row('미사일 합산 피해', r.stockMsl != null ? fmt0(r.stockMsl) : null),
        row('회전 °/s', ag.Pitch != null ? `P ${ag.Pitch}° · Y ${ag.Yaw}° · R ${ag.Roll}°` : null),
        row('가속 m/s²', ac.Main != null ? `Main ${fmt(ac.Main)} · Maneuver ${fmt(ac.Maneuver)}` : null),
        row('속도 m/s', ifcs.ScmSpeed != null ? `SCM ${ifcs.ScmSpeed} · MAX ${ifcs.MaxSpeed ?? '—'} · BST ${ifcs.BoostSpeedForward ?? '—'}` : null),
        row('EM 시그니처', r.emTotal != null ? `${fmt0(r.emTotal)} (QD시 ${fmt0(r.emQuantum)})` : null),
        row('IR 시그니처', fmt0(r.irTotal)),
        row('스톡 발전', r.stockGen != null ? r.stockGen + '핍' : null),
        row('패치 상태', st ? (st.st === 'special' ? `<span style="color:var(--warn)">⚠ 특수 — ${esc(st.note || '획득 경로 제한')}</span>` : esc(st.st)) : '없음'),
      ].join('');
    }
    if (it.kind === 'weapon') {
      const modes = (r.modes || []).map(m => `${m.name} ${m.rpm}rpm`).join(' · ');
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('종류', esc(r.family || '') + (r.cls ? ' · ' + esc(r.cls) : '')),
        row('DPS', fmt(r.dps)), row('지속 DPS', fmt(r.sustain)), row('알파', fmt(r.alpha)),
        row('발사 모드', esc(modes)),
        row('사거리', r.range != null ? fmt0(r.range) + 'm' : null),
        row('탄속', r.speed != null ? fmt0(r.speed) + 'm/s' : null),
        row('분당 발사', r.rpm != null ? r.rpm + 'rpm' : null),
        row('피해 유형', esc((r.dmgtype || []).join(' + '))),
      ].join('');
    }
    if (it.kind === 'shield') {
      const ab = r.absorption || {};
      const absAvg = t => { const v = ab[t]; if (!v) return null; const lo = v.Minimum != null ? v.Minimum : 1, hi = v.Maximum != null ? v.Maximum : 1; return pct((lo + hi) / 2) + (lo !== hi ? ` (${pct(lo)}~${pct(hi)})` : ''); };
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('HP', fmt0(r.hp)), row('재생/s', fmt(r.regen)),
        row('피격 후 재생 지연', r.damagedDelay != null ? r.damagedDelay + 's' : null),
        row('다운 후 지연', r.downedDelay != null ? r.downedDelay + 's' : null),
        row('흡수율 Physical', absAvg('Physical')),
        row('흡수율 Energy', absAvg('Energy')),
        row('흡수율 Distortion', absAvg('Distortion')),
      ].join('');
    }
    if (it.kind === 'power')
      return [row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')), row('출력', (r.pwGen != null ? r.pwGen : r.output) + '핍')].join('');
    if (it.kind === 'cooler')
      return [row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')), row('냉각량', fmt(r.rate))].join('');
    if (it.kind === 'qd') {
      const spd = r.driveSpeed || r.speed;
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('속도', spd != null ? `${fmt0(spd)} m/s (${(spd / C_LIGHT * 100).toFixed(1)}%c)` : null),
        row('10Gm 이동', r.t10gm != null ? Math.round(r.t10gm) + 's' : null),
        row('스풀', r.spool != null ? r.spool + 's' : null),
        row('쿨다운', r.cooldown != null ? r.cooldown + 's' : null),
        row('연료 요구량', r.fuelReq != null ? r.fuelReq + ' SCU/Gm' : null),
      ].join('');
    }
    if (it.kind === 'missile')
      return [row('크기', 'S' + r.size), row('제조사', esc(r.mfr || '')), row('피해', fmt0(r.damage)), row('피해 유형', esc((r.dmgtype || []).join(' + ')))].join('');
    if (it.kind === 'rack')
      return [row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')), row('장전 수', r.missiles), row('미사일 크기', r.msize != null ? 'S' + r.msize : null)].join('');
    if (it.kind === 'radar') {
      const det = r.detection || {};
      const sen = det.Sensitivity || {}, pier = det.Piercing || {};
      const f = o => ['IR', 'CS', 'EM', 'RS'].map(k => `${k} ${o[k] != null ? o[k] : '—'}`).join(' · ');
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('탐지 감도', esc(f(sen))), row('관통', esc(f(pier))),
      ].join('');
    }
    return '';
  }

  function renderDetail(it) {
    const el = $('cxDetail');
    if (!it) { el.classList.remove('open'); el.innerHTML = '<div class="cx-empty">항목을 선택하면 상세가 나옵니다.</div>'; return; }
    const ssm = shipStatusMap(); const badge = it.kind === 'ship' && ssm && ssm.ships && ssm.ships[it.raw.class] && ssm.ships[it.raw.class].st === 'special'
      ? ' <span class="badge" style="color:var(--warn)">⚠ 특수</span>' : '';
    el.innerHTML =
      `<h3>${esc(it.name)}${badge}<button class="modal-x cx-close" id="cxClose">✕</button></h3>`
      + `<div class="cx-d-sub">${esc(it.sub || '')}${it.mfr ? ' · ' + esc(it.mfr) : ''}</div>`
      + `<table class="cx-d-table">${detailRows(it)}</table>`
      + (it.kind === 'ship' ? `<button class="cx-fit-btn" id="cxFit">🛠️ 이 함선으로 피팅하기</button>` : shopHTML(it.raw.class));
    el.classList.add('open');
    const cb = $('cxClose'); if (cb) cb.onclick = () => el.classList.remove('open');
    const fb = $('cxFit');
    if (fb) fb.onclick = () => {
      el.classList.remove('open');
      if (window.switchView) switchView('fitting');
      if (typeof selectShip === 'function') selectShip(it.raw.slug);
    };
  }

  async function build() {
    buildHead();
    renderGrid();
    renderDetail(null);
    await ensureShops();
    if (selKey) renderDetail(itemsOf(cat).find(it => it.key === selKey) || null);
  }

  // app.js 최상위가 let 이라 window.DB 로는 못 읽는다 — 스크립트 전역 렉시컬 바인딩으로 접근.
  function dbOk() { try { return typeof DB !== 'undefined' && !!DB; } catch (e) { return false; } }
  function shipStatusMap() { try { return typeof SHIP_STATUS !== 'undefined' ? SHIP_STATUS : null; } catch (e) { return null; } }

  // app.js의 상단 메뉴가 스타도감을 열 때 호출
  window.codexShow = function () {
    if (!dbOk()) return; // DB 로드 전이면 app.js init 완료 후 다시 호출됨
    if (!built) { built = true; build(); }
  };
})();
