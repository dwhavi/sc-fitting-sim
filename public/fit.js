// SC Fitting Sim — 최적 피팅 템플릿 + 구매처 (app.js 뒤에 로드, app.js 전역을 사용)
// - 취향(전투/스텔스/이동/방어/균형) 프리셋 -> 부품 조합 탐색 (fitStats 를 평가 함수로 재사용)
// - 구매처: shops.json (fetch_shops.py 가 UEX Corp API 에서 생성한 스냅샷, 커뮤니티 제보 기반)
(function () {
  'use strict';
  const $q = id => document.getElementById(id);
  const nf = n => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('en-US');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- 옵션 (지역 · 예산 · 구매 가능만) ----------
  const SYS_KO = { Stanton: '스탠턴', Pyro: '파이로', Nyx: '닉스' };
  const ALL = 'ALL';
  const sysLabel = s => s === ALL ? '전체' : (SYS_KO[s] || s);
  const OPT_KEY = 'scfit:opts';
  const opt = (() => {
    const d = { sys: ['Stanton'], onlyBuy: true, budget: 0, preset: 'combat', range: 'mid', lock: [] };
    try { Object.assign(d, JSON.parse(localStorage.getItem(OPT_KEY) || '{}')); } catch (e) { /* ignore */ }
    return d;
  })();
  const saveOpt = () => { try { localStorage.setItem(OPT_KEY, JSON.stringify(opt)); } catch (e) { /* ignore */ } };

  // ---------- 상점 데이터 ----------
  let SHOPS = null; // null=로딩전, false=실패
  async function loadShops() {
    if (SHOPS !== null) return SHOPS;
    try { const r = await fetch('shops.json?v=3', { cache: 'no-store' }); SHOPS = await r.json(); }
    catch (e) { SHOPS = false; }
    return SHOPS;
  }
  const sysOK = t => opt.sys.includes(ALL) || opt.sys.includes(SHOPS.terms[t].sys);
  // 허용 지역 내 판매처 [[termIdx, price]] (가격 오름차순)
  function offers(cls) {
    if (!SHOPS || !SHOPS.items[cls]) return [];
    return SHOPS.items[cls].filter(o => sysOK(o[0]));
  }
  function minPrice(cls) { const o = offers(cls); return o.length ? o[0][1] : null; }
  function anyPrice(cls) { return SHOPS && SHOPS.items[cls] ? SHOPS.items[cls][0][1] : null; }

  // ---------- 슬롯 열거 ----------
  const STOCK_KINDS = ['weapon', 'shield', 'power', 'cooler', 'qd', 'radar'];
  const KIND_KO = { weapon: '무기', shield: '실드', power: '파워플랜트', cooler: '쿨러', qd: '퀀텀드라이브', radar: '레이더', mount: '마운트', turret: '터렛', turretbase: '터렛' };
  const WORD_KO = { turret: '터렛', side: '측면', front: '앞', back: '뒤', left: '좌', right: '우', top: '상단', bottom: '하단', rear: '후방', nose: '기수', wing: '날개', center: '중앙', centre: '중앙', gun: '주포', remote: '원격', manned: '유인', chin: '턱', belly: '하부', tail: '후미' };
  const pretty = n => String(n || '').split(/\s+/).map(w => WORD_KO[w.toLowerCase()] || w).join(' ');
  const okName = c => c && !/PLACEHOLDER/i.test(c.name || '');
  function enumSlots() {
    const out = [];
    const mk = (id, kind, size, label, src, stock) => {
      let opts = optionsFor(kind, size).filter(okName);
      if (!opts.length) return;
      out.push({ id, kind, size, label, src, stock: stock || '', opts, key: kind + '|' + size + '|' + src });
    };
    for (const h of (FY || [])) {
      const kind = slotKind(h);
      if (!kind) continue;
      if (STOCK_KINDS.includes(kind)) {
        mk(h.id, kind, h.maxSize, `${KIND_KO[kind]} S${h.maxSize}`, 'pilot', matchDefault(kind, h.component));
      } else if (kind === 'mount' || kind === 'turret') {
        const raw = (h.id in build) ? build[h.id] : matchDefault(kind, h.component || {});
        let selObj = raw ? ((DB.turrets || []).find(c => c.class === raw) || null) : findTurret((h.component || {}).scKey, (h.component || {}).name);
        if ((h.id in build) && !build[h.id]) selObj = null;
        const sizes = weaponLayout(h, selObj);
        sizes.forEach((gs, i) => {
          const sid = h.id + ':w' + i;
          mk(sid, 'weapon', gs, `${pretty(shortName(h.name))} ↳ 무기 ${i + 1} S${gs}`, h.weaponControl || (kind === 'turret' ? 'turret' : 'pilot'), stockGunFor(sid));
        });
      }
    }
    return out;
  }
  const curOf = (s, asg) => (s.id in asg) ? asg[s.id] : s.stock;

  const RANGE_T = { short: 1000, mid: 1800, long: 2600, any: 0 };
  const RANGE_KO = { short: '근거리 (~1km)', mid: '중거리 (~1.8km)', long: '원거리 (2.6km~)', any: '상관없음' };
  // ---------- 평가 ----------
  const freshPwr = () => ({ segOff: {}, grpOff: {}, coolerSegs: {}, coolerOff: {}, poolSel: null });
  function evalAsg(slots, asg, baseBuild) {
    const sb = build, sp = pwr;
    build = Object.assign({}, baseBuild, asg); pwr = freshPwr();
    let f;
    try { f = fitStats(); } finally { build = sb; pwr = sp; }
    let em = 0, ir = 0;
    for (const s of slots) {
      const c = findComp(s.kind, curOf(s, asg));
      if (!c) continue;
      em += c.em || 0; ir += c.ir || 0;
    }
    const pilot = f.pilotDps || 0, tur = f.turretDps || 0;
    let dpsEff = (pilot + tur) > 0 ? pilot + 0.5 * tur : f.dps;
    // 교전 거리 취향: 사거리가 목표보다 짧은 무기는 DPS 를 깎아서 본다 (스캐터건 편중 방지)
    const tgt = RANGE_T[opt.range || 'mid'];
    if (tgt && f.guns && f.guns.length) {
      let a = 0, b = 0;
      for (const g of f.guns) { const w = g.dps || 0; b += w; a += w * Math.min(1, Math.pow((g.range || tgt) / tgt, 1.5)); }
      if (b > 0) dpsEff *= a / b;
    }
    const qd = f.qd || null;
    const t10 = qd ? (qd.t10gm != null ? qd.t10gm : (qd.driveSpeed || qd.speed ? 1e10 / (qd.driveSpeed || qd.speed) : null)) : null;
    return {
      dps: f.dps || 0, dpsEff, alpha: f.alpha || 0, hp: f.hp || 0, regen: f.regen || 0,
      D: (f.hp || 0) + 10 * (f.regen || 0), em, ir, short: f.short || 0,
      qdspeed: f.qdspeed || 0, t10, spool: qd && qd.spool != null ? qd.spool : null,
      fuel: qd && qd.fuelReq != null ? qd.fuelReq : null, power: f.power || 0, avail: f.avail || 0
    };
  }
  function costOf(slots, asg) {
    let sum = 0, unknown = 0;
    for (const s of slots) {
      const cur = curOf(s, asg);
      if (!cur || cur === s.stock) continue;
      const p = minPrice(cur);
      if (p == null) unknown++; else sum += p;
    }
    return { sum, unknown };
  }

  // ---------- 프리셋 ----------
  const R = (a, b) => Math.log(Math.max(a, 1e-9) / Math.max(b, 1e-9));
  const PRESETS = {
    combat: { ico: '⚔️', t: '전투', d: '최상위 탐지 레이더 우선, 지속 DPS·실드', f: (m, b) => 1.0 * R(m.dpsEff, b.dpsEff) + 0.5 * R(m.D, b.D) - 0.15 * m.short },
    stealth: { ico: '🥷', t: '스텔스', d: 'EM·IR 신호 최소, 전투력은 유지', f: (m, b) => -1.2 * R(m.em, b.em) - 0.6 * R(m.ir, b.ir) + 0.25 * R(m.dpsEff, b.dpsEff) + 0.1 * R(m.D, b.D) - 0.15 * m.short },
    travel: { ico: '🚀', t: '이동', d: '퀀텀 속도·스풀 우선, 방어는 보통', f: (m, b) => 1.5 * R(m.qdspeed, b.qdspeed) - 0.4 * R(m.spool == null ? 1 : m.spool, b.spool == null ? 1 : b.spool) - 0.3 * R(m.fuel == null ? 1 : m.fuel, b.fuel == null ? 1 : b.fuel) + 0.2 * R(m.D, b.D) + 0.15 * R(m.dpsEff, b.dpsEff) - 0.1 * R(m.em, b.em) - 0.15 * m.short },
    tank: { ico: '🛡️', t: '방어', d: '실드 HP·재생 최대', f: (m, b) => 1.2 * R(m.D, b.D) + 0.3 * R(m.dpsEff, b.dpsEff) - 0.05 * R(m.em, b.em) - 0.15 * m.short },
    balanced: { ico: '⚖️', t: '균형', d: 'DPS·방어·이동·신호 고루', f: (m, b) => 0.5 * R(m.dpsEff, b.dpsEff) + 0.5 * R(m.D, b.D) + 0.25 * R(m.qdspeed, b.qdspeed) - 0.25 * R(m.em, b.em) - 0.15 * m.short }
  };

  // 동률 처리: 성능이 사실상 같으면 EM 이 낮은 쪽 (모든 프리셋 공통). 남는 전력은 점수에 없으므로 전력이 충분할 땐 낮은 EM 이 이김.
  const TIE_EM = 0.004;
  // ---------- 최적화 ----------
  function groupsOf(slots) {
    const g = {};
    for (const s of slots) (g[s.key] = g[s.key] || []).push(s);
    return Object.values(g);
  }
  const locked = k => (opt.lock || []).includes(k);
  const pinsOf = () => ((opt.pins = opt.pins || {})[curShip] = (opt.pins[curShip] || []));
  const pinned = s => pinsOf().includes(s.id);
  const allowed = (s, cls) => cls === s.stock || !opt.onlyBuy || minPrice(cls) != null;

  // Combat radar is a hard detection-tier constraint, not a weighted score.
  // Pareto dominance avoids inventing exchange rates between signature types.
  function radarVector(c) {
    const d = c && c.detection;
    if (!d || !d.Sensitivity || !d.Piercing || !Array.isArray(d.SignatureDetection) || !Number.isFinite(d.Cooldown)) return null;
    const v = [];
    for (const key of ['Sensitivity', 'Piercing', 'GroundVehicleDetectionSensitivity']) {
      if (!d[key]) return null;
      for (const sig of ['IR', 'CS', 'EM', 'RS', 'dB']) {
        if (!Number.isFinite(d[key][sig])) return null;
        v.push(d[key][sig]);
      }
    }
    for (const sig of d.SignatureDetection) for (const key of ['Sensitivity', 'Piercing', 'PermitPassiveDetection', 'PermitActiveDetection']) {
      if (!Number.isFinite(sig[key])) return null;
      v.push(sig[key]);
    }
    v.push(-d.Cooldown);
    return v;
  }
  const dominatesRadar = (a, b) => a.length === b.length && a.every((v, i) => v >= b[i]) && a.some((v, i) => v > b[i]);
  function topRadars(s, baseAsg) {
    // Stock/current equipment can stay on its own hull. Bespoke variants must
    // not leak to unrelated hulls just because their nominal size matches.
    const current = curOf(s, baseAsg);
    const candidates = s.opts.filter(c => !c.radarStockOnly || c.class === s.stock || c.class === current);
    if (!candidates.length || candidates.some(c => !radarVector(c))) return { top: [], unknown: true };
    return { top: candidates.filter(c => !candidates.some(b => dominatesRadar(radarVector(b), radarVector(c)))), unknown: false };
  }
  function combatRadarRules(slots, baseAsg) {
    return slots.filter(s => s.kind === 'radar').map(s => {
      const rank = topRadars(s, baseAsg);
      const fixed = locked('radar') || pinned(s);
      return { s, ...rank, fixed, candidates: fixed ? [] : rank.top.filter(c => allowed(s, c.class)) };
    });
  }
  function radarNoteHTML(slots, asg, baseAsg) {
    const rules = combatRadarRules(slots, baseAsg);
    if (!rules.length) return '<div class="fit-note">📡 전투 레이더: 교체 가능한 레이더 슬롯 없음.</div>';
    return rules.map(r => {
      const c = findComp('radar', curOf(r.s, asg));
      const satisfied = r.top.some(t => t.class === (c && c.class));
      const vectors = new Set(r.top.map(t => JSON.stringify(radarVector(t))));
      let status = r.unknown ? '⚠️ 탐지 원본 누락: 최상위 판정 불가, 현재 장착 유지.'
        : !satisfied ? `⚠️ 최상위 탐지 조건 미충족: ${r.fixed ? '레이더 잠금 유지' : '구매 지역/구매 가능 조건 충돌'}.`
        : `최상위 탐지군 ${r.top.length}종 중 선택${r.top.length > 1 ? (vectors.size > 1 ? ' (항목별 우열이 달라 단일 1위 없음)' : ' (탐지 성능 동률, 기존 효율·저EM 기준 유지)') : ''}.`;
      const d = c && c.detection;
      return `<div class="fit-note">📡 <b>전투 레이더 S${r.s.size}: ${esc(c ? c.name : '미장착')}</b><br>${status}${d ? `<br>원본 감도 IR/CS/EM/RS: ${['IR','CS','EM','RS'].map(k => esc(d.Sensitivity[k])).join('/')} · 원본 Cooldown ${esc(d.Cooldown)}s` : ''}<br>감도·관통·탐지 허용·원본 Cooldown 원본값 비교. 등급/가격/조준 보조 거리는 탐지 거리로 환산하지 않음. 실제 게임 탐지 거리 실측 아님.</div>`;
    }).join('');
  }

  function optimize(slots, preset, baseBuild, base0, baseAsg, extra) {
    const radarRules = preset === 'combat' ? combatRadarRules(slots, baseAsg) : [];
    const ruleFor = s => radarRules.find(r => r.s.id === s.id);
    const eligible = (s, cls) => {
      const r = ruleFor(s);
      if (!r) return allowed(s, cls);
      if (r.fixed || !r.candidates.length) return cls === curOf(s, baseAsg);
      return r.candidates.some(c => c.class === cls);
    };
    const normalize = asg => {
      const n = Object.assign({}, asg);
      for (const r of radarRules) {
        if (r.fixed || !r.candidates.length) n[r.s.id] = curOf(r.s, baseAsg);
        else if (!eligible(r.s, curOf(r.s, n))) {
          const best = r.candidates.slice().sort((a, b) => (a.em ?? Infinity) - (b.em ?? Infinity) || (minPrice(a.class) ?? 0) - (minPrice(b.class) ?? 0))[0];
          n[r.s.id] = best.class;
        }
      }
      return n;
    };
    const seed = normalize(baseAsg);
    const free = slots.filter(s => !pinned(s));
    const groups = preset === 'combat' ? groupsOf(free.filter(s => s.kind !== 'radar')).concat(free.filter(s => s.kind === 'radar').map(s => [s])) : groupsOf(free);
    const feasible = asg => { if (!opt.budget) return true; return costOf(slots, asg).sum <= opt.budget; };
    const memo = new Map();
    const score = asg => {
      const k = slots.map(s => curOf(s, asg)).join('|');
      let v = memo.get(k);
      if (v === undefined) { const mm = evalAsg(slots, asg, baseBuild); v = PRESETS[preset].f(mm, base0) - TIE_EM * R(mm.em, base0.em); memo.set(k, v); }
      return v;
    };
    const withGroup = (asg, g, cls) => { const n = Object.assign({}, asg); for (const s of g) n[s.id] = (cls === '__stock' ? s.stock : cls); return n; };
    const candsOf = g => {
      if (locked(g[0].kind)) return [];
      const set = new Set();
      if (g.every(s => eligible(s, s.stock))) set.add('__stock');
      for (const c of g[0].opts) if (g.every(s => eligible(s, c.class))) set.add(c.class);
      return [...set];
    };
    const descend = start => {
      let cur = start, curS = feasible(cur) ? score(cur) : -1e9;
      for (let pass = 0; pass < 6; pass++) {
        let improved = false;
        for (const g of groups) {
          let bestA = null, bestS = curS;
          for (const c of candsOf(g)) {
            const a = withGroup(cur, g, c); if (!feasible(a)) continue;
            const sc = score(a); if (sc > bestS + 1e-9) { bestS = sc; bestA = a; }
          }
          if (bestA) { cur = bestA; curS = bestS; improved = true; }
        }
        // 슬롯 단위 정제 (같은 그룹 안에서 개별 선택)
        if (!improved) for (const s of slots) {
          if (locked(s.kind) || pinned(s)) continue;
          let bestA = null, bestS = curS;
          for (const c of s.opts) {
            if (!eligible(s, c.class)) continue;
            const a = Object.assign({}, cur, { [s.id]: c.class }); if (!feasible(a)) continue;
            const sc = score(a); if (sc > bestS + 1e-9) { bestS = sc; bestA = a; }
          }
          if (bestA) { cur = bestA; curS = bestS; improved = true; }
        }
        if (!improved) {
          // 쌍 이동: 파워플랜트/실드/쿨러/무기 사이의 상호작용 (전력 균형). 단일 이동이 막혔을 때만.
          const topC = (g, k) => candsOf(g).map(c => [c, feasible(withGroup(cur, g, c)) ? score(withGroup(cur, g, c)) : -1e9]).sort((x, y) => y[1] - x[1]).slice(0, k).map(x => x[0]);
          const tops = groups.map(g => topC(g, 8));
          for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
            const ki = groups[i][0].kind, kj = groups[j][0].kind;
            if (!(ki === 'power' || kj === 'power' || (ki === 'shield' && kj === 'cooler') || (ki === 'cooler' && kj === 'shield'))) continue;
            let bestA = null, bestS = curS;
            for (const a of tops[i]) for (const b of tops[j]) {
              const n = withGroup(withGroup(cur, groups[i], a), groups[j], b); if (!feasible(n)) continue;
              const sc = score(n); if (sc > bestS + 1e-9) { bestS = sc; bestA = n; }
            }
            if (bestA) { cur = bestA; curS = bestS; improved = true; }
          }
        }
        if (!improved) break;
      }
      return { asg: cur, score: curS };
    };
    // 시작점: 현재 / 부품별 최고 성능 / 부품별 최저 EM
    const key = { weapon: c => c.dps || 0, shield: c => (c.hp || 0) + 10 * (c.regen || 0), power: c => (c.pwGen != null ? c.pwGen : c.output) || 0, cooler: c => c.rate || 0, qd: c => c.speed || 0, radar: c => 0 };
    const startBy = fn => {
      let a = Object.assign({}, seed);
      for (const g of groups) {
        const ok = g[0].opts.filter(c => g.every(s => eligible(s, c.class)));
        if (!ok.length || locked(g[0].kind)) continue;
        const best = ok.reduce((x, y) => fn(g[0].kind, y) > fn(g[0].kind, x) ? y : x);
        a = withGroup(a, g, best.class);
      }
      return a;
    };
    const starts = [seed, startBy((k, c) => key[k](c))];
    if (preset === 'stealth' || preset === 'balanced') starts.push(startBy((k, c) => -(c.em == null ? 1e9 : c.em)));
    for (const e of (extra || [])) starts.push(normalize(e));
    let best = null;
    for (const st of starts) {
      const r = descend(feasible(st) ? st : seed);
      if (!best || r.score > best.score) best = r;
    }
    return best.asg;
  }

  // ---------- 구매 계획 (스테이션별 묶음) ----------
  function buildPlan(items) {
    // items: [{cls,name,qty,kind}] -> stops 그리디 커버
    const left = items.filter(i => offers(i.cls).length);
    const missing = items.filter(i => !offers(i.cls).length);
    const stops = [];
    let rest = left.slice();
    while (rest.length) {
      const cov = {};
      for (const it of rest) for (const [t, p] of offers(it.cls)) {
        const e = cov[t] = cov[t] || { n: 0, sum: 0 }; e.n++; e.sum += p * it.qty;
      }
      const best = Object.entries(cov).sort((a, b) => (b[1].n - a[1].n) || (a[1].sum - b[1].sum))[0];
      const t = +best[0];
      const got = rest.filter(it => offers(it.cls).some(o => o[0] === t));
      const lines = got.map(it => {
        const price = offers(it.cls).find(o => o[0] === t)[1];
        return Object.assign({}, it, { price, min: offers(it.cls)[0][1] });
      });
      stops.push({ t, lines, sub: lines.reduce((a, l) => a + l.price * l.qty, 0) });
      rest = rest.filter(it => !got.includes(it));
    }
    const total = stops.reduce((a, s) => a + s.sub, 0);
    const minTotal = left.reduce((a, it) => a + offers(it.cls)[0][1] * it.qty, 0);
    return { stops, missing, total, minTotal };
  }
  function itemsFromAsg(slots, asg) {
    const by = {};
    for (const s of slots) {
      const cur = curOf(s, asg);
      if (!cur || cur === s.stock) continue;
      const c = findComp(s.kind, cur);
      if (!c) continue;
      const e = by[cur] = by[cur] || { cls: cur, name: c.name, qty: 0, kind: s.kind, size: c.size };
      e.qty++;
    }
    return Object.values(by);
  }
  const lineSort = (a, b) => (((a.size || 0) - (b.size || 0)) || String(a.name || '').localeCompare(b.name || '', 'ko'));
  function planHTML(plan, opts) {
    opts = opts || {};
    const stopName = t => { const T = SHOPS.terms[t]; const src = T.src === 'C' ? 'UIF' : T.src === 'U' ? 'UEX' : ''; return `<b>${esc(T.n)}</b><span class="fit-dim"> · ${esc(SYS_KO[T.sys] || T.sys)} · ${esc(T.loc)}${src ? ` · ${src} 제보` : ''}</span>`; };
    let h = '';
    plan.stops.forEach((st, i) => {
      h += `<div class="fit-stop"><div class="fit-stop-h">${i + 1}. ${stopName(st.t)}<span class="fit-sub">${nf(st.sub)} aUEC</span></div>`
        + st.lines.slice().sort(lineSort).map(l => `<div class="fit-line"><span>${esc(l.name)}${l.qty > 1 ? ' ×' + l.qty : ''} <span class="fit-dim">${KIND_KO[l.kind] || l.kind} S${l.size}</span></span><span>${nf(l.price * l.qty)}${l.price > l.min * 1.05 ? `<span class="fit-dim"> (최저 ${nf(l.min)})</span>` : ''}</span></div>`).join('')
        + '</div>';
    });
    if (plan.missing.length) {
      h += `<div class="fit-stop fit-miss"><div class="fit-stop-h">⚠️ 구매처 미확인 (선택 지역 ${opt.sys.map(sysLabel).join('/')} 기준)</div>`
        + plan.missing.slice().sort(lineSort).map(m => { const p = anyPrice(m.cls); const ns = SHOPS.notSold && SHOPS.notSold.includes(m.cls); return `<div class="fit-line"><span>${esc(m.name)}${m.qty > 1 ? ' ×' + m.qty : ''}</span><span class="fit-dim">${p != null ? '다른 지역에는 있음 (지역 칩 확인)' : (ns ? '양쪽 제보 데이터 모두 판매처 없음 — 상점 미판매 가능성' : '데이터 없음 · 인게임 확인 필요')}</span></div>`; }).join('') + '</div>';
    }
    if (plan.stops.length) h += `<div class="fit-total">합계 ${nf(plan.total)} aUEC <span class="fit-dim">(스테이션 묶음 기준${plan.minTotal < plan.total ? ' · 품목별 최저가 합 ' + nf(plan.minTotal) : ''})</span></div>`;
    return h;
  }
  const shopNote = () => SHOPS ? `가격·판매처: UEX Corp + Cornerstone UIF (둘 다 커뮤니티 제보 기반) · 최신 제보 ${esc(SHOPS.meta.newestReport)} (게임 ${esc(Object.keys(SHOPS.meta.reportVersions).sort().join('/'))}). 3.20 이후 게임 파일에 상점 재고가 없어 모든 사이트가 제보 기반이라 실제와 다를 수 있음 — 구매 전 인게임에서 확인.` : '구매처 데이터를 불러오지 못했습니다.';

  // ---------- 지역 칩 ----------
  function sysChipsHTML(idAttr) {
    return `<span class="grp-lbl">지역</span>` + `<button class="chip${opt.sys.includes(ALL) ? ' on' : ''}" ${idAttr}="${ALL}">전체</button>`
      + Object.keys(SYS_KO).map(k => `<button class="chip${opt.sys.includes(k) ? ' on' : ''}" ${idAttr}="${k}">${SYS_KO[k]}</button>`).join('');
  }
  function bindSysChips(sel, after) {
    document.querySelectorAll(sel).forEach(b => b.onclick = () => {
      const k = b.dataset.fitsys;
      if (k === ALL) opt.sys = [ALL];
      else if (opt.sys.includes(ALL)) opt.sys = [k];
      else { const i = opt.sys.indexOf(k); if (i >= 0) { if (opt.sys.length > 1) opt.sys.splice(i, 1); } else opt.sys.push(k); }
      saveOpt(); after();
    });
  }

  // ---------- 메인 페이지: 구매 목록 패널 ----------
  function renderShopPanel() {
    const el = $q('shopPanel'); if (!el) return;
    if (!SHOPS) { el.innerHTML = `<div class="fit-dim">${SHOPS === false ? '구매처 데이터를 불러오지 못했습니다.' : '구매처 데이터 로딩 중…'}</div>`; return; }
    if (!curShip || !DB) { el.innerHTML = '<div class="fit-dim">함선을 선택하세요.</div>'; return; }
    const slots = enumSlots();
    const asg = {}; for (const s of slots) asg[s.id] = (s.id in build) ? build[s.id] : s.stock;
    const items = itemsFromAsg(slots, asg);
    // 마운트·터렛 카드 교체도 구매 대상에 포함 (enumSlots 는 하위 무기 슬롯만 본다)
    for (const h2 of (FY || [])) {
      const kind = slotKind(h2);
      if (kind !== 'mount' && kind !== 'turret') continue;
      const stockCls = matchDefault(kind, h2.component || {});
      const cur = (h2.id in build) ? build[h2.id] : stockCls;
      if (!cur || cur === stockCls) continue;
      const c = findComp(kind, cur);
      if (!c) continue;
      items.push({ cls: cur, name: c.name, qty: 1, kind, size: c.size });
    }
    let h = `<div class="chips" style="padding:0 0 8px" id="shopChips">${sysChipsHTML('data-fitsys')}</div>`;
    if (!items.length) h += '<div class="fit-dim">스톡 부품 그대로예요 — 새로 살 부품이 없습니다. 부품을 바꾸면 여기에 파는 곳이 나와요.</div>';
    else h += planHTML(buildPlan(items));
    h += `<div class="fit-note">${shopNote()}</div>`;
    el.innerHTML = h;
    bindSysChips('#shopChips .chip', renderShopPanel);
  }

  // 부품 선택 목록에 최저가 표시
  const _cs = compShort;
  compShort = function (kind, c) {
    const base = _cs(kind, c);
    if (!SHOPS || !c || !c.class) return base;
    const p = minPrice(c.class);
    return base + (p != null ? ` <span class="spec-mini price">💰 ${nf(p)}</span>` : '');
  };
  const _us = updateStats;
  updateStats = function () { _us(); renderShopPanel(); updateFitBtn(); };

  // ---------- 추천 모달 ----------
  let RES = null; // {slots, baseAsg, baseBuild, base0, results:{preset:{asg,m,cost,plan,changes}}, sel}
  const fitContextKey = () => JSON.stringify({ ship: curShip, build, sys: opt.sys, budget: opt.budget, range: opt.range, onlyBuy: opt.onlyBuy, lock: opt.lock, pins: pinsOf() });
  const combatResultStale = () => !!RES && RES.contextKey !== fitContextKey();
  function updateFitBtn() {
    const b = $q('fitBtn'); if (!b) return;
    b.disabled = !curShip;
    const u = $q('fitUndo'); if (u) u.style.display = window._fitUndo && window._fitUndo.ship === curShip ? '' : 'none';
    renderTplPanel();
  }
  function openFitModal() {
    if (!curShip) return;
    $q('modalRoot').innerHTML = `<div class="modal-ov" id="mov"><div class="modal fit-modal">
      <div class="modal-h"><b>🎯 최적 피팅 템플릿</b><span class="sub">${esc((DB.ships.find(s => s.slug === curShip) || {}).name || curShip)}</span><button class="modal-x" id="mx">✕</button></div>
      <div class="fit-body" id="fitBody"></div></div></div>`;
    $q('mx').onclick = closeModal;
    drawFitForm();
  }
  function pinListHTML() {
    const slots = enumSlots(); const pins = pinsOf();
    const n = slots.filter(x => pins.includes(x.id)).length;
    const rows = slots.map(x => {
      const cur = (x.id in build) ? build[x.id] : x.stock; const c = cur ? findComp(x.kind, cur) : null;
      const on = pins.includes(x.id);
      return `<button class="pin-row${on ? ' on' : ''}" data-pin="${esc(x.id)}"><span class="pin-ic">${on ? '🔒' : '🔓'}</span><span class="pin-t"><span class="fit-dim">${esc(x.label)}</span><br>${esc(c ? c.name : '— 비어 있음')}</span></button>`;
    }).join('');
    return `<details class="pin-box"${n ? ' open' : ''}><summary>📌 슬롯 하나만 고정하기 <b>${n ? n + '개 고정됨' : '(선택)'}</b></summary><div class="fit-dim" style="padding:4px 0">원하는 무기/모듈을 먼저 장착한 뒤, 아래에서 그 슬롯을 눌러 🔒로 만드세요. 그 슬롯은 그대로 두고 나머지를 추천해요.</div><div class="pin-list">${rows}</div></details>`;
  }
  function drawFitForm() {
    const body = $q('fitBody');
    const cards = Object.entries(PRESETS).map(([k, p]) => `<button class="fit-card${opt.preset === k ? ' on' : ''}" data-p="${k}"><span class="ic">${p.ico}</span><b>${p.t}</b><span class="fit-dim">${p.d}</span></button>`).join('');
    const bud = [0, 50000, 200000, 500000, 1000000].map(v => `<button class="chip${opt.budget === v ? ' on' : ''}" data-b="${v}">${v ? nf(v / 1000) + 'k' : '무제한'}</button>`).join('');
    body.innerHTML = `
      <div class="sec-h">1. 어떤 취향으로 맞출까요?</div>
      <div class="fit-cards">${cards}</div>
      <div class="sec-h">2. 구매 조건</div>
      <div class="chips" style="padding:0">${sysChipsHTML('data-fitsys')}</div>
      <div class="chips" style="padding:8px 0 0"><span class="grp-lbl">예산</span>${bud}<input id="fitBud" type="number" min="0" step="10000" placeholder="직접 입력 (aUEC)" value="${opt.budget && ![50000, 200000, 500000, 1000000].includes(opt.budget) ? opt.budget : ''}" style="width:160px"></div>
      <div class="chips" style="padding:8px 0 0"><span class="grp-lbl">교전 거리</span>${Object.keys(RANGE_KO).map(k => `<button class="chip${opt.range === k ? ' on' : ''}" data-r="${k}">${RANGE_KO[k]}</button>`).join('')}</div>
      <div class="fit-lock"><div class="fit-lock-h">🔒 이 부품은 그대로 두기</div><div class="fit-dim">누른 종류는 지금 장착한 부품을 바꾸지 않고, 나머지만 추천해요. (켜짐 = 🔒)</div><div class="chips" style="padding:6px 0 0">${['weapon', 'shield', 'power', 'cooler', 'qd', 'radar'].map(k => { const on = (opt.lock || []).includes(k); return `<button class="chip lk${on ? ' on' : ''}" data-lk="${k}">${on ? '🔒 ' : ''}${KIND_KO[k]}</button>`; }).join('')}</div>${pinListHTML()}</div>
      <label class="fit-chk"><input type="checkbox" id="fitBuy" ${opt.onlyBuy ? 'checked' : ''}> 선택한 지역에서 살 수 있는 부품만 (끄면 구매처 없는 부품도 후보)</label>
      <div class="fit-dim" style="margin-top:4px">예산 = 현재 장착을 스톡으로 보고 새로 사야 하는 부품의 합계(품목별 최저가). 스톡 부품은 이미 보유한 걸로 계산.</div>
      <div style="margin-top:12px"><button id="fitGo" class="fit-go">🎯 추천 만들기</button></div>
      <div id="fitRes"></div>`;
    body.querySelectorAll('.fit-card').forEach(b => b.onclick = () => { opt.preset = b.dataset.p; saveOpt(); body.querySelectorAll('.fit-card').forEach(x => x.classList.toggle('on', x === b)); if (RES) { RES.sel = opt.preset; drawResult(); } });
    bindSysChips('#fitBody [data-fitsys]', drawFitForm);
    body.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { opt.budget = +b.dataset.b; saveOpt(); drawFitForm(); });
    body.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => { const a = pinsOf(); const i = a.indexOf(b.dataset.pin); if (i >= 0) a.splice(i, 1); else a.push(b.dataset.pin); saveOpt(); drawFitForm(); const d = body.querySelector('.pin-box'); if (d) d.open = true; });
    body.querySelectorAll('[data-lk]').forEach(b => b.onclick = () => { const a = opt.lock = opt.lock || []; const i = a.indexOf(b.dataset.lk); if (i >= 0) a.splice(i, 1); else a.push(b.dataset.lk); saveOpt(); drawFitForm(); });
    body.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { opt.range = b.dataset.r; saveOpt(); drawFitForm(); });
    $q('fitBud').onchange = e => { opt.budget = Math.max(0, +e.target.value || 0); saveOpt(); drawFitForm(); };
    $q('fitBuy').onchange = e => { opt.onlyBuy = e.target.checked; saveOpt(); if (RES) drawResult(); };
    $q('fitGo').onclick = runFit;
    if (RES && RES.ship === curShip) drawResult();
  }
  async function runFit() {
    const go = $q('fitGo'); go.disabled = true; go.textContent = '계산 중…';
    await loadShops();
    await new Promise(r => setTimeout(r, 30));
    if (!SHOPS) { $q('fitRes').innerHTML = '<div class="fit-dim">구매처 데이터를 불러오지 못해 구매 조건 없이 계산합니다.</div>'; opt.onlyBuy = false; }
    const contextKey = fitContextKey();
    const slots = enumSlots();
    const baseBuild = Object.assign({}, build);
    const baseAsg = {}; for (const s of slots) baseAsg[s.id] = (s.id in build) ? build[s.id] : s.stock;
    const base0 = evalAsg(slots, baseAsg, baseBuild);
    const stockAsg = {}; for (const s of slots) stockAsg[s.id] = s.stock;
    const results = {};
    const t0 = performance.now();
    let done = 0;
    const keys = Object.keys(PRESETS), first = {};
    for (const k of keys) {
      go.textContent = `계산 중… (${++done}/${keys.length * 2})`;
      await new Promise(r => setTimeout(r, 0));
      first[k] = optimize(slots, k, baseBuild, base0, baseAsg);
    }
    for (const k of keys) {
      go.textContent = `다듬는 중… (${++done}/${keys.length * 2})`;
      await new Promise(r => setTimeout(r, 0));
      // 다른 취향의 결과도 시작점으로 써서 지역 최적에서 벗어난다
      const asg = optimize(slots, k, baseBuild, base0, baseAsg, keys.filter(x => x !== k).map(x => first[x]));
      const m = evalAsg(slots, asg, baseBuild);
      const items = itemsFromAsg(slots, asg);
      const plan = SHOPS ? buildPlan(items) : { stops: [], missing: items, total: 0, minTotal: 0 };
      const changes = slots.filter(s => curOf(s, asg) !== curOf(s, baseAsg)).map(s => ({ s, from: curOf(s, baseAsg), to: curOf(s, asg) }));
      results[k] = { asg, m, plan, changes, cost: costOf(slots, asg) };
    }
    RES = { ship: curShip, contextKey, slots, baseAsg, baseBuild, base0, results, sel: opt.preset, ms: performance.now() - t0 };
    go.disabled = false; go.textContent = '🎯 다시 만들기';
    drawResult();
  }
  // Color tracks numeric direction only, not whether a metric's value is desirable.
  const dir = { dps: 1, dpsEff: 1, hp: 1, regen: 1, em: 1, ir: 1, t10: 1, short: 1 };
  function deltaCell(k, a, b, fmtFn) {
    fmtFn = fmtFn || nf;
    if (a == null || b == null) return `<td>${b == null ? '—' : fmtFn(b)}</td>`;
    const d = b - a, rel = a ? d / a : 0;
    let cls = '';
    if (Math.abs(rel) > 0.005 && dir[k]) cls = d > 0 ? 'delta-up' : 'delta-down';
    return `<td class="${cls}">${fmtFn(b)}${Math.abs(rel) > 0.005 ? `<span class="fit-dim"> ${rel > 0 ? '+' : ''}${(rel * 100).toFixed(0)}%</span>` : ''}</td>`;
  }
  function drawResult() {
    const el = $q('fitRes'); if (!el || !RES) return;
    const { slots, base0, results, sel } = RES;
    const r = results[sel];
    const stale = sel === 'combat' && combatResultStale();
    const rows = [
      ['지속 DPS (시뮬 합계)', 'dps', m => m.dps, nf], ['거리 보정 DPS ★', 'dpsEff', m => m.dpsEff, nf], ['실드 HP', 'hp', m => m.hp, nf], ['실드 재생/s', 'regen', m => m.regen, nf],
      ['EM 지표', 'em', m => m.em, nf], ['IR 지표', 'ir', m => m.ir, nf],
      ['퀀텀 10Gm', 't10', m => m.t10, v => v == null ? '—' : Math.round(v) + 's'], ['전력 부족(핍)', 'short', m => m.short, v => (Math.round(v * 10) / 10).toString()]
    ];
    const tabs = Object.entries(PRESETS).map(([k, p]) => `<button class="chip${sel === k ? ' on' : ''}" data-t="${k}">${p.ico} ${p.t}</button>`).join('');
    const cmp = rows.map(([lbl, k, g, f]) => `<tr><td>${lbl}</td><td>${f(g(base0))}</td>${deltaCell(k, g(base0), g(r.m), f)}</tr>`).join('');
    const chg = r.changes.length ? r.changes.slice().sort((a, b) => {
      // 변경 리스트 오름차순: 부품 사이즈 → 이름
      const ca = findComp(a.s.kind, a.to), cb = findComp(b.s.kind, b.to);
      return (((ca && ca.size) || 0) - ((cb && cb.size) || 0)) || String((ca && ca.name) || '').localeCompare((cb && cb.name) || '', 'ko');
    }).map(c => {
      const a = findComp(c.s.kind, c.from), b = findComp(c.s.kind, c.to);
      const p = minPrice(c.to);
      return `<div class="fit-line"><span><span class="fit-dim">${esc(c.s.label)}</span><br>${esc(a ? a.name : '— 없음')} → <b>${esc(b ? b.name : '— 없음')}</b></span><span>${c.to === c.s.stock ? '<span class="fit-dim">스톡 복귀</span>' : (p != null ? '💰 ' + nf(p) : '<span class="warn">구매처 미확인</span>')}</span></div>`;
    }).join('') : '<div class="fit-dim">현재 장착이 이 취향에서 이미 최적입니다 (조건 안에서).</div>';
    const pc = (a, b) => (a > 0 ? Math.round((b - a) / a * 100) : 0);
    const sg = n => (n > 0 ? '+' : '') + n + '%';
    const qdp = (base0.t10 && r.m.t10) ? Math.round((base0.t10 - r.m.t10) / base0.t10 * 100) : null;
    let hl = [`DPS ${sg(pc(base0.dpsEff, r.m.dpsEff))}`, `실드 ${sg(pc(base0.D, r.m.D))}`, `EM ${sg(pc(base0.em, r.m.em))}`, `IR ${sg(pc(base0.ir, r.m.ir))}`];
    if (qdp != null) hl = sel === 'travel' ? [`퀀텀 ${qdp >= 0 ? sg(qdp) + ' 빠름' : sg(-qdp) + ' 느림'}`].concat(hl) : hl.concat([`퀀텀 ${qdp >= 0 ? sg(qdp) + ' 빠름' : sg(-qdp) + ' 느림'}`]);
    const headline = `<div class="fit-head">${PRESETS[sel].ico} <b>${PRESETS[sel].t}</b> 추천 — 현재 대비 ${hl.slice(0, 5).join(' · ')} · 💰 ${nf(r.cost.sum)} aUEC${r.cost.unknown ? ` (+구매처 미확인 ${r.cost.unknown}개)` : ''}</div>`;
    el.innerHTML = `
      <div class="sec-h" style="margin-top:16px">3. 결과 <span class="fit-dim">(${Object.keys(PRESETS).length}개 취향 계산 ${Math.round(RES.ms)}ms)</span></div>
      <div class="chips" style="padding:0 0 8px">${tabs}</div>
      ${headline}
      ${stale ? '<div class="fit-note warn">⚠️ 장착/잠금/구매 조건이 바뀌었습니다. 이전 전투 결과는 적용하거나 저장할 수 없습니다. 추천을 다시 만드세요.</div>' : ''}
      ${sel === 'combat' ? radarNoteHTML(slots, r.asg, RES.baseAsg) : ''}
      ${sel === 'combat' && opt.budget && r.cost.sum > opt.budget ? '<div class="fit-note warn">⚠️ 예산 조건 미충족. 최상위 레이더를 낮은 탐지군으로 바꾸지 않았습니다. 예산 또는 잠금 조건을 바꾼 뒤 다시 만드세요.</div>' : ''}
      <table class="fit-cmp"><tr><th></th><th>현재</th><th>${PRESETS[sel].ico} ${PRESETS[sel].t} 추천</th></tr>${cmp}</table>
      ${base0.short > 0.5 ? `<div class="fit-dim warn" style="margin:4px 0 0">현재 빌드는 전력이 ${(Math.round(base0.short * 10) / 10)}핍 부족해요(전 계통 100% 가동 기준). 그래서 DPS 증가율이 크게 나올 수 있어요.</div>` : ''}
      <div class="fit-dim" style="margin:4px 0 0">EM·IR 지표는 장착 부품 정격값의 합(상대 비교용, 게임 내 실제 탐지 거리가 아님). ★ 최적화 기준 DPS: 파일럿 무기 + 터렛 절반 가중, 선택한 교전 거리보다 사거리가 짧은 무기는 깎아서 계산.</div>
      <div class="sec-h">바뀌는 부품 ${r.changes.length}개</div>
      <div class="fit-list">${chg}</div>
      <div class="sec-h">🛒 어디서 살까</div>
      <div class="fit-list">${r.plan.stops.length || r.plan.missing.length ? planHTML(r.plan) : '<div class="fit-dim">새로 살 부품 없음.</div>'}</div>
      <div class="fit-note">${shopNote()}${opt.budget && r.plan.minTotal > opt.budget ? '<br><span class="warn">⚠️ 묶음 구매 합계가 예산을 넘을 수 있어요 (최적화는 품목별 최저가 기준).</span>' : ''}</div>
      <div class="fit-foot"><button id="fitApply" class="fit-go">✅ 이 빌드 적용</button><button id="fitCopy">📋 쇼핑 리스트 복사</button><button id="fitTpl">💾 템플릿 저장</button></div>`;
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { RES.sel = b.dataset.t; opt.preset = b.dataset.t; saveOpt(); drawResult(); document.querySelectorAll('.fit-card').forEach(x => x.classList.toggle('on', x.dataset.p === opt.preset)); });
    $q('fitApply').disabled = stale || !!(sel === 'combat' && opt.budget && r.cost.sum > opt.budget);
    $q('fitTpl').disabled = stale;
    $q('fitCopy').disabled = stale;
    $q('fitApply').onclick = () => applyFit(r);
    $q('fitCopy').onclick = () => copyList(r);
    $q('fitTpl').onclick = () => {
      const n = prompt('템플릿 이름', `${(DB.ships.find(x => x.slug === curShip) || {}).name || curShip} ${PRESETS[RES.sel].t}`);
      if (n !== null) { saveTpl(n, Object.assign({}, RES.baseBuild, r.asg)); $q('fitTpl').textContent = '✅ 저장됨'; }
    };
  }
  function applyFit(r) {
    if (RES.sel === 'combat' && (combatResultStale() || (opt.budget && r.cost.sum > opt.budget))) return;
    window._fitUndo = { ship: curShip, build: Object.assign({}, build), pwr: JSON.parse(JSON.stringify(pwr)) };
    build = Object.assign({}, RES.baseBuild, r.asg);
    pwr = freshPwr();
    closeModal(); renderSlots(); updateStats();
    const st = $q('saveStatus'); if (st) st.textContent = `추천 빌드 적용됨 (${PRESETS[RES.sel].t}) — 💾 저장하면 보관돼요`;
  }
  function undoFit() {
    const u = window._fitUndo; if (!u || u.ship !== curShip) return;
    build = u.build; pwr = u.pwr; window._fitUndo = null;
    renderSlots(); updateStats();
    const st = $q('saveStatus'); if (st) st.textContent = '추천 적용을 되돌렸어요';
  }
  function copyList(r) {
    const ship = (DB.ships.find(s => s.slug === curShip) || {}).name || curShip;
    const L = [`[${ship}] ${PRESETS[RES.sel].t} 피팅 — 구매 목록`];
    const ls = (a, b) => (((a.size || 0) - (b.size || 0)) || String(a.name || '').localeCompare(b.name || '', 'ko'));
    r.plan.stops.forEach((st, i) => { const T = SHOPS.terms[st.t]; L.push(`${i + 1}) ${T.n} (${T.sys} · ${T.loc}) ${nf(st.sub)} aUEC`); st.lines.slice().sort(ls).forEach(l => L.push(`   - ${l.name}${l.qty > 1 ? ' x' + l.qty : ''} ${nf(l.price * l.qty)}`)); });
    r.plan.missing.slice().sort(ls).forEach(m => L.push(`? ${m.name} x${m.qty} (구매처 미확인)`));
    L.push(`합계 ${nf(r.plan.total)} aUEC · 출처 UEX(${SHOPS.meta.newestReport})`);
    const txt = L.join('\n');
    const done = () => { $q('fitCopy').textContent = '✅ 복사됨'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => { prompt('복사하세요', txt); });
    else prompt('복사하세요', txt);
  }

  // ---------- 내 템플릿 (이름 붙여 저장) ----------
  const TPL_KEY = 'scfit:tpls';
  const tplAll = () => { try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch (e) { return []; } };
  const tplWrite = a => { try { localStorage.setItem(TPL_KEY, JSON.stringify(a)); } catch (e) { /* ignore */ } };
  function saveTpl(name, b) {
    const ship = (DB.ships.find(x => x.slug === curShip) || {}).name || curShip;
    name = (name || '').trim() || `${ship} ${new Date().toISOString().slice(5, 10)}`;
    const a = tplAll(); a.push({ id: Date.now(), name, ship: curShip, build: b, savedAt: new Date().toISOString() });
    tplWrite(a); renderTplPanel();
    return name;
  }
  function renderTplPanel() {
    const el = $q('tplPanel'); if (!el) return;
    const mine = tplAll().filter(t => t.ship === curShip);
    el.innerHTML = (mine.length ? mine.map(t => `<div class="fit-line"><button class="chip" data-tapply="${t.id}" style="text-align:left;flex:1">📂 ${esc(t.name)}</button><button class="chip" data-tdel="${t.id}" title="삭제">✕</button></div>`).join('') : '<div class="fit-dim">저장된 템플릿 없음</div>')
      + `<button id="tplSave" style="width:100%;margin-top:6px" ${curShip ? '' : 'disabled'}>➕ 현재 빌드를 템플릿으로 저장</button>`;
    el.querySelectorAll('[data-tapply]').forEach(b => b.onclick = () => {
      const t = tplAll().find(x => String(x.id) === b.dataset.tapply); if (!t) return;
      window._fitUndo = { ship: curShip, build: Object.assign({}, build), pwr: JSON.parse(JSON.stringify(pwr)) };
      build = Object.assign({}, t.build); pwr = freshPwr(); renderSlots(); updateStats();
      const st = $q('saveStatus'); if (st) st.textContent = `템플릿 적용: ${t.name}`;
    });
    el.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { tplWrite(tplAll().filter(x => String(x.id) !== b.dataset.tdel)); renderTplPanel(); });
    const sv = $q('tplSave'); if (sv) sv.onclick = () => { const n = prompt('템플릿 이름', ''); if (n !== null) saveTpl(n, Object.assign({}, build)); };
  }

  // ---------- 초기화 ----------
  function boot() {
    const b = $q('fitBtn'); if (!b) return;
    b.onclick = openFitModal;
    const u = $q('fitUndo'); if (u) u.onclick = undoFit;
    loadShops().then(() => { renderShopPanel(); });
    updateFitBtn();
  }
  window.SCFIT = { enumSlots, evalAsg, optimize, fitContextKey, radarVector, topRadars, combatRadarRules, radarNoteHTML, PRESETS, opt, loadShops, offers, buildPlan, openFitModal, get RES() { return RES; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
