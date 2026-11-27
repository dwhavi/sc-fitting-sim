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


  // ---- 분류 규칙 (게임 데이터의 role/career 문자열만 사용, 애매한 값은 '기타·복합') ----
  const SHIP_CATS = ['경전투기', '중형 전투기', '중전투기', '스텔스 전투기', '인터셉터·스닙', '폭격기', '건쉽·드롭쉽', '특수 전투', '함대급', '화물', '여객', '채굴', '샐비지', '탐사·여행', '지원', '레이싱', '기타·복합'];
  function shipCat(s) {
    const role = String(s.role || ''), car = String(s.career || '');
    if (/Heavy Fighter \/ Bomber/.test(role)) return '중전투기';
    if (role.includes('/')) return '기타·복합';
    if (/Light Fighter/.test(role)) return '경전투기';
    if (/Medium Fighter/.test(role)) return '중형 전투기';
    if (/Heavy Fighter/.test(role)) return '중전투기';
    if (/Stealth Fighter/.test(role)) return '스텔스 전투기';
    if (/Interceptor|Snub Fighter/.test(role)) return '인터셉터·스닙';
    if (/Bomber/.test(role)) return '폭격기';
    if (/Gunship|Dropship|Gun Ship/.test(role)) return '건쉽·드롭쉽';
    if (/Anti-Air|Anti-Vehicle|Interdiction/.test(role)) return '특수 전투';
    if (/Frigate|Corvette|Destroyer|Carrier/.test(role)) return '함대급';
    if (/Salvage/.test(role)) return '샐비지';
    if (/Mining/.test(role)) return '채굴';
    if (/Freight/.test(role)) return '화물';
    if (/Passenger|Data/.test(role)) return /Data/.test(role) ? '기타·복합' : '여객';
    if (/Expedition|Pathfinder|Touring|Generalist/.test(role)) return '탐사·여행';
    if (/Medical|Refueling|Recovery|Reporting|Science/.test(role)) return '지원';
    if (/Racing/.test(role)) return '레이싱';
    return '기타·복합';
  }
  const WTYPES = ['에너지', '실탄', '디스토션', '기타'];
  function weaponType(w) {
    const f = String(w.family || '');
    if (/Rocket Pod|Tractor/i.test(f)) return '기타';
    if (/Ballistic|Mass Driver/i.test(f)) return '실탄';
    if (/Laser|Neutron|Plasma|Tachyon/i.test(f)) return '에너지';
    if (/Distortion/i.test(f)) return '디스토션';
    const t = (w.dmgtype || [])[0];
    return t === 'Energy' ? '에너지' : t === 'Physical' ? '실탄' : t === 'Distortion' ? '디스토션' : '기타';
  }
  const CLS_KO = { Civilian: '민수', Military: '군용', Competition: '경쟁(레이싱)', Stealth: '스텔스', Industrial: '산업', '': '미분류' };
  const CLS_ORDER = ['Civilian', 'Military', 'Competition', 'Stealth', 'Industrial', ''];
  const COMP_CATS = ['shields', 'powerplants', 'coolers', 'qds', 'radars'];
  const SUB_KO = { Missile: '미사일', Torpedo: '어뢰', GroundVehicleMissile: '지상차량용', Rocket: '로켓' };
  const TRACK_KO = { Infrared: '적외선(IR)', CrossSection: '단면적(CS)', Electromagnetic: '전자기(EM)' };
  const mmeta = cls => (MMETA && MMETA.missiles && MMETA.missiles[cls]) || null;

  let SHOPS = null, shopsTried = false;
  let cat = 'ships', q = '', fSize = '', fGrade = '', fMfr = '', sort = 'name';
  let fCat = '', fType = '', fCls = '', group = 'auto';
  let SMETA = null, MMETA = null;
  // 라이선스 확인 전까지 FleetYards 유래 이미지는 숨김 (파일·코드는 보존). 복원: true 로 변경.
  const SHOW_SHIP_IMAGES = false;
  let built = false, selKey = null;

  const isPlaceholder = it => !it || !it.name || /PLACEHOLDER/i.test(it.name);

  // 제조사별 포인트 색 (기획안 4): 이름 해시로 팔레트에서 결정적으로 배정
  const MFR_PALETTE = ['#4cc2ff', '#51d88a', '#ffb454', '#ff8ab3', '#b592ff', '#ffd166', '#6ee7de', '#f08018', '#9dff57', '#ff6b6b', '#5aa9ff', '#e0aaff'];
  function mfrColor(m) { let h = 0; for (const ch of String(m)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return MFR_PALETTE[h % MFR_PALETTE.length]; }

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
        cat: shipCat(s),
        mfr: ((SMETA && SMETA.ships && SMETA.ships[s.class] && SMETA.ships[s.class].mfr) || ''),
        img: (SHOW_SHIP_IMAGES && SMETA && SMETA.ships && SMETA.ships[s.class] && SMETA.ships[s.class].img) || '',
        large: (s.size || 0) >= 5,
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
        wtype: weaponType(w),
      });
    } else if (cid === 'shields') {
      for (const s of DB.shields || []) push('shield', s, {
        sub: CLS_KO[s.cls || ''] || s.cls, ccls: s.cls || '',
        bars: [
          { k: 'HP', v: s.hp || 0 },
          { k: '재생/s', v: s.regen || 0 },
        ],
        perf: s.hp || 0,
      });
    } else if (cid === 'powerplants') {
      for (const p of DB.powerplants || []) push('power', p, {
        sub: CLS_KO[p.cls || ''] || p.cls, ccls: p.cls || '',
        bars: [{ k: '출력(핍)', v: p.pwGen != null ? p.pwGen : (p.output || 0) }],
        perf: p.pwGen != null ? p.pwGen : (p.output || 0),
      });
    } else if (cid === 'coolers') {
      for (const c of DB.coolers || []) push('cooler', c, {
        sub: CLS_KO[c.cls || ''] || c.cls, ccls: c.cls || '',
        bars: [{ k: '냉각량', v: c.rate || 0 }],
        perf: c.rate || 0,
      });
    } else if (cid === 'qds') {
      for (const d of DB.qds || []) push('qd', d, {
        ccls: d.cls || '',
        sub: `${CLS_KO[d.cls || ''] || d.cls} · 스풀 ${d.spool != null ? d.spool + 's' : '—'} · 쿨다운 ${d.cooldown != null ? d.cooldown + 's' : '—'}`,
        bars: [{ k: '속도', v: d.driveSpeed || d.speed || 0, txt: d.driveSpeed ? (d.driveSpeed / C_LIGHT * 100).toFixed(1) + '%c' : null }],
        perf: d.driveSpeed || d.speed || 0,
      });
    } else if (cid === 'missiles') {
      for (const m of DB.missiles || []) { const mm = mmeta(m.class); push('missile', m, {
        sub: (mm ? (SUB_KO[mm.sub] || mm.sub) + ' · ' + (TRACK_KO[mm.track] || mm.track || '') + (mm.cluster ? ' · 클러스터' : '') : '미사일'),
        mtype: mm ? (SUB_KO[mm.sub] || '기타') : '미확인', mtrack: mm ? (TRACK_KO[mm.track] || '미확인') : '미확인',
        bars: [{ k: '피해', v: m.damage || 0 }],
        perf: m.damage || 0,
      }); }
      for (const r of DB.racks || []) push('rack', r, {
        mtype: '랙', mtrack: '—',
        sub: `랙 · S${r.msize != null ? r.msize : '?'} 미사일`,
        bars: [{ k: '장전 수', v: r.missiles || 0 }],
        perf: r.missiles || 0,
      });
    } else if (cid === 'radars') {
      for (const r of DB.radars || []) {
        const sen = (r.detection && r.detection.Sensitivity) || {};
        const senTxt = ['IR', 'CS', 'EM', 'RS'].filter(k => sen[k] != null).map(k => `${k} ${sen[k]}`).join(' · ');
        push('radar', r, {
          ccls: r.cls || '',
          sub: (CLS_KO[r.cls || ''] || r.cls) + ' · ' + (senTxt || '탐지장비'),
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
    if (fSize !== '' && fSize !== 'large') arr = arr.filter(it => String(it.size) === fSize);
    if (fGrade !== '') arr = arr.filter(it => it.grade === fGrade);
    if (fMfr !== '') arr = arr.filter(it => it.mfr === fMfr);
    if (cat === 'ships') {
      if (fCat !== '') arr = arr.filter(it => it.cat === fCat);
      if (fSize === 'large') arr = arr.filter(it => it.large);
    }
    if (cat === 'weapons' && fType !== '') arr = arr.filter(it => it.wtype === fType);
    if (COMP_CATS.includes(cat) && fCls !== '') arr = arr.filter(it => it.ccls === (fCls === '_none' ? '' : fCls));
    if (cat === 'missiles' && fType !== '') arr = arr.filter(it => it.mtype === fType || it.mtrack === fType);
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => ((a.size ?? 99) - (b.size ?? 99)) || a.name.localeCompare(b.name),
      perf: (a, b) => (b.perf - a.perf) || a.name.localeCompare(b.name),
    }[sort] || ((a, b) => a.name.localeCompare(b.name));
    return arr.sort(by);
  }

  const opts = (arr, cur, allLabel) => `<option value="">${allLabel}</option>` + arr.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  function buildHead() {
    $('cxTabs').innerHTML = CATS.map(c => `<button class="chip${c.id === cat ? ' on' : ''}" data-cat="${c.id}">${c.label}</button>`).join('');
    $('cxTabs').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; selKey = null; fSize = ''; fGrade = ''; fMfr = ''; fCat = ''; fType = ''; fCls = ''; group = 'auto'; buildHead(); renderGrid(); closeModal(); });
    const arr = itemsOf(cat);
    const sizes = [...new Set(arr.map(it => String(it.size)))].sort((a, b) => Number(a) - Number(b));
    const grades = [...new Set(arr.map(it => it.grade).filter(g => g && g.length <= 2))].sort();
    const mfrs = [...new Set(arr.map(it => it.mfr).filter(Boolean))].sort();
    let h = `<input id="cxQ" placeholder="검색 (이름·제조사)" value="${esc(q)}">`;
    if (cat === 'ships') {
      const cnt = {}; arr.forEach(it => { cnt[it.cat] = (cnt[it.cat] || 0) + 1; });
      h += `<select id="cxCat">${opts(SHIP_CATS.filter(c => cnt[c]).map(c => [c, `${c} (${cnt[c]})`]), fCat, '카테고리 전체')}</select>`;
      h += `<select id="cxSize"><option value="">사이즈 전체</option><option value="large"${fSize === 'large' ? ' selected' : ''}>대형함 (S5 이상 · 임시 기준)</option>${sizes.map(s => `<option value="${esc(s)}"${s === fSize ? ' selected' : ''}>S${esc(s)}</option>`).join('')}</select>`;
      h += `<select id="cxGroup"><option value="auto"${group === 'auto' ? ' selected' : ''}>묶기: 자동(전체=카테고리별)</option><option value="cat"${group === 'cat' ? ' selected' : ''}>묶기: 카테고리별</option><option value="mfr"${group === 'mfr' ? ' selected' : ''}>묶기: 제조사별</option><option value="none"${group === 'none' ? ' selected' : ''}>묶지 않음</option></select>`;
    } else {
      h += `<select id="cxSize"><option value="">사이즈 전체</option>${sizes.map(s => `<option value="${esc(s)}"${s === fSize ? ' selected' : ''}>S${esc(s)}</option>`).join('')}</select>`;
    }
    if (cat === 'weapons') h += `<select id="cxType">${opts(WTYPES.map(t => [t, t === '실탄' ? '실탄(Ballistic)' : t === '에너지' ? '에너지(Energy)' : t]), fType, '무기 종류 전체')}</select>`
      + `<select id="cxGroup"><option value="none"${group !== 'type' ? ' selected' : ''}>묶지 않음</option><option value="type"${group === 'type' ? ' selected' : ''}>종류별로 묶기</option></select>`;
    if (COMP_CATS.includes(cat)) {
      const have = new Set(arr.map(it => it.ccls));
      h += `<select id="cxCls">${opts(CLS_ORDER.filter(c => have.has(c)).map(c => [c === '' ? '_none' : c, CLS_KO[c]]), fCls, '용도 전체(민수·군용·경쟁·스텔스)')}</select>`
        + `<select id="cxGroup"><option value="none"${group !== 'cls' ? ' selected' : ''}>묶지 않음</option><option value="cls"${group === 'cls' ? ' selected' : ''}>용도별로 묶기</option></select>`;
    }
    if (cat === 'missiles') {
      const ts = [...new Set(arr.map(it => it.mtype))].filter(t => t && t !== '랙'), ks = [...new Set(arr.map(it => it.mtrack))].filter(t => t && t !== '—');
      h += `<select id="cxType">${opts([...ts, ...ks].map(t => [t, t]), fType, '종류·추적방식 전체')}</select>`;
    }
    if (grades.length && cat !== 'ships') h += `<select id="cxGrade"><option value="">등급 전체</option>${grades.map(g => `<option value="${esc(g)}"${g === fGrade ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
    if (mfrs.length) h += `<select id="cxMfr"><option value="">제조사 전체</option>${mfrs.map(m => `<option value="${esc(m)}"${m === fMfr ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
    h += `<select id="cxSort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    $('cxFilters').innerHTML = h;
    $('cxQ').addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); renderGrid(); });
    const on = (id, fn) => { const el = $(id); if (el) el.onchange = e => { fn(e.target.value); renderGrid(); }; };
    on('cxSize', v => fSize = v); on('cxGrade', v => fGrade = v); on('cxMfr', v => fMfr = v); on('cxSort', v => sort = v);
    on('cxCat', v => fCat = v); on('cxType', v => fType = v); on('cxCls', v => fCls = v); on('cxGroup', v => group = v);
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
    const thumb = it.kind === 'ship' ? (it.img ? `<img class="cx-thumb" loading="lazy" src="${esc(it.img)}" alt="${esc(it.name)}">` : '<span class="cx-thumb none">이미지 준비 중</span>') : '';
    return `<button class="cx-card${selKey === it.key ? ' sel' : ''}" data-key="${esc(it.key)}">
      ${thumb}<span class="cx-top">${sz}<span class="cx-gr ${grCls}">${esc(it.grade || '—')}</span></span>
      <span class="cx-name">${esc(it.name)}</span>${it.kind === 'ship' ? `<span class="cx-cat">${esc(it.cat)}${it.large ? ' · 대형' : ''}</span>` : ''}
      <span class="cx-mfr"${it.mfr ? ` style="color:${mfrColor(it.mfr)};font-weight:700"` : ''}>${esc(it.mfr || '')}</span>
      ${it.sub ? `<span class="cx-sub">${esc(it.sub)}</span>` : ''}
      <span class="cx-bars">${bars}</span>
    </button>`;
  }

  function groupKeyOf(it) {
    if (cat === 'ships') { const g = group === 'auto' ? (fCat === '' ? 'cat' : 'none') : group; return g === 'cat' ? it.cat : g === 'mfr' ? (it.mfr || '제조사 미확인') : null; }
    if (cat === 'weapons' && group === 'type') return it.wtype;
    if (COMP_CATS.includes(cat) && group === 'cls') return CLS_KO[it.ccls];
    return null;
  }
  function renderGrid() {
    const arr = filtered();
    const maxes = barMaxFor(cat);
    const g = $('cxGrid');
    if (!arr.length) { g.innerHTML = '<div class="cx-empty">조건에 맞는 항목이 없습니다.</div>'; return; }
    const groups = new Map();
    arr.forEach(it => { const k = groupKeyOf(it); (groups.get(k) || groups.set(k, []).get(k)).push(it); });
    const order = cat === 'ships' ? (group === 'mfr' ? null : SHIP_CATS) : cat === 'weapons' ? WTYPES : null;
    let keys = [...groups.keys()];
    if (order) keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    else if (cat !== 'ships' && COMP_CATS.includes(cat)) keys.sort((a, b) => Object.values(CLS_KO).indexOf(a) - Object.values(CLS_KO).indexOf(b));
    else keys.sort((a, b) => String(a).localeCompare(String(b)));
    g.innerHTML = keys.map(k => (k == null ? '' : `<div class="cx-group-h">${esc(k)} <span>${groups.get(k).length}</span></div>`) + groups.get(k).map(it => cardHTML(it, maxes)).join('')).join('');
    g.querySelectorAll('.cx-card').forEach(c => c.onclick = () => {
      selKey = c.dataset.key;
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
      return [row('크기', 'S' + r.size), row('제조사', esc(r.mfr || '')), row('피해(합계)', fmt0(r.damage)), row('피해 유형', (() => { const mm = mmeta(r.class); return mm ? esc(Object.entries(mm.dmg).map(([k, v]) => k + ' ' + fmt0(v)).join(' + ')) : null; })())].join('');
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

  function missileInfographic(it) {
    const mm = mmeta(it.raw.class);
    if (!mm) return '<div class="cx-shop fit-dim">이 항목은 미사일 상세 원본 데이터가 없어 도식을 만들지 않았습니다.</div>';
    const dm = mm.dmg || {}, tot = Object.values(dm).reduce((a, b) => a + b, 0) || 1;
    const DM_KO = { Physical: '물리(Physical) 피해', Energy: '에너지', Distortion: '디스토션' };
    const bar = Object.entries(dm).map(([k, v]) => `<div class="mi-dm"><span>${esc(DM_KO[k] || k)}</span><span class="mi-bar"><i class="${k}" style="width:${Math.max(3, v / tot * 100)}%"></i></span><b>${fmt0(v)}</b></div>`).join('');
    const bl = mm.blast || [], pr = mm.prox;
    const bMax = bl[1] || 0, bMin = bl[0] || 0, scale = 70 / Math.max(bMax, 1);
    const svg = `<svg viewBox="0 0 320 170" class="mi-svg" role="img" aria-label="${esc(it.name)} 폭발 반경 도식">
      <rect width="320" height="170" rx="10" fill="#0b1119"/>
      <circle cx="210" cy="85" r="${(bMax * scale).toFixed(1)}" fill="#ff8a3d" fill-opacity=".15" stroke="#ff8a3d" stroke-dasharray="4 3"/>
      <circle cx="210" cy="85" r="${Math.max(2, bMin * scale).toFixed(1)}" fill="#ff5a3d" fill-opacity=".45" stroke="#ff5a3d"/>
      <circle cx="210" cy="85" r="3" fill="#fff"/>
      <path d="M20 85 H${210 - Math.max(2, bMin * scale) - 4}" stroke="#4cc2ff" stroke-width="3" marker-end="url(#ar)"/>
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#4cc2ff"/></marker></defs>
      <text x="20" y="72" fill="#4cc2ff" font-size="11">${esc(TRACK_KO[mm.track] || '추적')} 추적</text>
      <text x="20" y="108" fill="#8fa3b8" font-size="10">락 ${mm.lockT != null ? mm.lockT + 's' : '—'} · 유효 ${mm.lockR != null ? fmt0(mm.lockR) + 'm' : '—'}</text>
      <text x="210" y="${Math.min(160, 85 + bMax * scale + 14).toFixed(0)}" fill="#ffb98a" font-size="10" text-anchor="middle">폭발 반경 ${bMin}~${bMax}m</text>
    </svg>`;
    return `<div class="mi-wrap"><div class="mi-h">공격 형태 도식 <span>게임 데이터 값 기반 · 실제 체감 거동 측정 아님</span></div>${svg}
      <div class="mi-dms">${bar}</div>
      <ul class="mi-list">
        <li><b>추적 신호</b> ${esc(TRACK_KO[mm.track] || '미확인')} — 표적의 해당 신호를 따라 유도</li>
        <li><b>폭발</b> 근접 신관 ${pr != null ? pr + 'm' : '—'} · 안전거리 ${mm.safe != null ? fmt0(mm.safe) + 'm' : '—'} · 무장 ${mm.arm != null ? mm.arm + 's' : '—'}</li>
        <li><b>탄두</b> ${mm.cluster ? '클러스터(자탄 분산)' : '단일 탄두'}</li>
        <li><b>비행</b> 속도 ${mm.speed != null ? fmt0(mm.speed) + 'm/s' : '—'} · 사거리 ${mm.range != null ? fmt0(mm.range) + 'm' : '—'} · 수명 ${mm.life != null ? mm.life + 's' : '—'}</li>
      </ul></div>`;
  }

  function closeModal() { const m = $('cxModal'); if (m) m.remove(); selKey = null; document.body.classList.remove('cx-modal-open'); }
  function renderDetail(it) {
    const old = $('cxModal'); if (old) old.remove();
    if (!it) { document.body.classList.remove('cx-modal-open'); return; }
    const ssm = shipStatusMap(); const badge = it.kind === 'ship' && ssm && ssm.ships && ssm.ships[it.raw.class] && ssm.ships[it.raw.class].st === 'special'
      ? ' <span class="badge" style="color:var(--warn)">⚠ 특수</span>' : '';
    const img = it.kind === 'ship' ? (it.img ? `<img class="cx-m-img" src="${esc(it.img)}" alt="${esc(it.name)}"><div class="cx-m-cred">이미지: FleetYards</div>` : '<div class="cx-m-img none">이미지 준비 중</div>') : '';
    const extra = it.kind === 'missile' ? missileInfographic(it) : '';
    const head = it.kind === 'ship' ? `<div class="cx-d-sub"><b>${esc(it.cat)}</b>${it.large ? ' · 대형함(S5+ 임시 기준)' : ''} · ${esc(it.sub || '')}${it.mfr ? ` · <b style="color:${mfrColor(it.mfr)}">${esc(it.mfr)}</b>` : ''}</div>`
      : `<div class="cx-d-sub">${esc(it.sub || '')}${it.mfr ? ` · <b style="color:${mfrColor(it.mfr)}">${esc(it.mfr)}</b>` : ''}</div>`;
    const m = document.createElement('div');
    m.id = 'cxModal'; m.className = 'cx-modal-back';
    m.innerHTML = `<div class="cx-modal panel" role="dialog" aria-modal="true"><h3>${esc(it.name)}${badge}<button class="modal-x cx-close" id="cxClose" aria-label="닫기">✕</button></h3>${img}${head}${extra}<table class="cx-d-table">${detailRows(it)}</table>`
      + (it.kind === 'ship' ? `<button class="cx-fit-btn" id="cxFit">🛠️ 이 함선으로 피팅하기</button>` : shopHTML(it.raw.class)) + '</div>';
    document.body.appendChild(m); document.body.classList.add('cx-modal-open');
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    $('cxClose').onclick = closeModal;
    const fb = $('cxFit');
    if (fb) fb.onclick = () => {
      closeModal();
      if (window.switchView) switchView('fitting');
      if (typeof selectShip === 'function') selectShip(it.raw.slug);
    };
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  async function ensureMeta() {
    try { const r = await fetch('ship_meta.json?v=1'); if (r.ok) SMETA = await r.json(); } catch (e) { /* 이미지·제조사 없음 */ }
    try { const r = await fetch('missile_meta.json?v=1'); if (r.ok) MMETA = await r.json(); } catch (e) { /* */ }
  }
  async function build() {
    await ensureMeta();
    buildHead();
    renderGrid();
    ensureShops();
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
