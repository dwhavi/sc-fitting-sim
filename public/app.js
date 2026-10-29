// SC Fitting Sim MVP — db.json + FleetYards live hardpoints
let DB = null, FY = [];
let build = {}; // slotId -> component class
// PWR state: Erkul-style — per-group pip blocks + weapon pool + ON/OFF
// Erkul model (chunk-IMLNKAMY Te + C3CGNGPP ue/ce, icons _N in main):
//  families: weapon(pool) engine shield qdrive miningLaser tractorBeam towingbeam
//            salvage emp qed radar lifeSupport + coolers(each own column)
//  blocks from item resource flows Power units; weapon = poolSize cap;
//  coolers individually selectable; click = block on/off, icon = whole group power.
//  PowerDraw(⚡) is display-only; pips are the allocation unit.
// coolerOff: 쿨러 슬롯별 개별 ON/OFF (Erkul 은 쿨러마다 독립 컬럼/pool 을 준다)
// 파워는 항상 100% 사용한다. 조절은 계통 핍 블럭(segOff/grpOff/coolerSegs/coolerOff)만으로.
// 칸 클릭 = 그 칸까지 직접 배분 / 아이콘 클릭 = 계통 전체 ON·OFF. 미사일은 전력 계통 없음.
// 인게임 캐패시터 삼각형은 '전력이 부족할 때만' 작동하는데, 여기서는 핍을 직접 빼는 방식이
// 그 역할을 대신하므로 스로틀·삼각형 UI 는 두지 않는다.
let pwr = { segOff: {}, grpOff: {}, coolerSegs: {}, coolerOff: {} };
const PWR_GROUPS = [
  { id: 'weapon', icon: '🔫', label: '무기', kinds: ['weapon', 'turret', 'turretbase'] },
  { id: 'engine', icon: '🚀', label: '추진', kinds: ['engine'] },
  { id: 'shield', icon: '🛡️', label: '실드', kinds: ['shield'] },
  { id: 'qdrive', icon: '🌀', label: '퀀텀', kinds: ['qd'] },
  { id: 'radar', icon: '📡', label: '레이더', kinds: ['radar'] },
  { id: 'lifeSupport', icon: '💨', label: '생명유지', kinds: ['life'] },
  { id: 'coolers', icon: '❄️', label: '쿨러', kinds: ['cooler'] },
  { id: 'utility', icon: '⚙️', label: '유틸', kinds: [] },
];
function kindToGroup(kind) {
  for (const g of PWR_GROUPS) if (g.kinds.includes(kind)) return g.id;
  return 'utility';
}
// 미사일은 전력을 소비하지 않는다 — 인게임 PWR 패널에도 미사일 계통이 없다.
// db.json 의 랙 power=20 은 PowerDraw 추정치(실제 SPowerSegmentResourceUnit 없음)라
// 그대로 쓰면 무기 계통에 랙당 20핍이 잡혀 핍 배분이 망가진다 → 계통 자체에서 제외.
const NO_POWER_KINDS = new Set(['missile']);
// 핍 출처: data/power_units.json → db.json(pw/pwGen), scunpacked items/*.json 원본.
// blocks = ceil(pw), min 1 if fitted — selectable per block, icon toggles group.
// pw 미보유 부품만 PowerDraw 추정치로 폴백(estCount 로 집계).

const $ = id => document.getElementById(id);
const fmt = n => n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-US');

async function init() {
  $('status').textContent = 'DB 로딩 중…';
  const r = await fetch('db.json');
  DB = await r.json();
  const ships = DB.ships;
  renderShipList(ships);
  $('status').textContent = `DB 로드 완료 — 함선 ${DB.meta.ships} · 무기 ${DB.meta.weapons} · 실드 ${DB.meta.shields} · 파워 ${DB.meta.powerplants}`;
  $('shipSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = DB.ships.filter(s => (s.name + ' ' + s.class).toLowerCase().includes(q));
    renderShipList(filtered);
    // auto-select first match for quick keyboard flow
    if (filtered.length > 0) {
      $('shipSel').selectedIndex = 0;
      selectShip(filtered[0].slug);
    }
  });
  $('shipSel').addEventListener('change', e => selectShip(e.target.value));
  $('saveBtn').onclick = saveBuild; $('loadBtn').onclick = loadBuild; $('resetBtn').onclick = resetBuild;
}

function renderShipList(ships) {
  $('shipSel').innerHTML = ships.map(s => {
    return `<option value="${s.slug}">${s.name}</option>`;
  }).join('');
}

async function selectShip(slug) {
  build = {};
  pwr.segOff = {}; pwr.grpOff = {}; pwr.coolerSegs = {}; pwr.coolerOff = {}; // 함선 변경 시 핍 배분 리셋
  
  // Load ship slots from local snapshot
  if (!window.SHIP_SLOTS) {
    try {
      const response = await fetch('ship_slots.json');
      const data = await response.json();
      window.SHIP_SLOTS = data;
      console.log('Loaded ship slots:', data.ships.length, 'ships,', data.slots.length, 'slots');
    } catch (e) {
      $('status').textContent = '슬롯 데이터 로드 실패: ' + e;
      return;
    }
  }
  
  const shipSlots = window.SHIP_SLOTS.slots.filter(s => s.slug === slug);
  FY = shipSlots.map(s => s.port);
  
  $('status').textContent = `${slug} — 슬롯 ${FY.length}개 (로컬 스냅샷)`;
  renderSlots();
  updateStats();
}

function slotKind(h) {
  if (h.source !== 'game_files') return null; // ship_matrix 큐레이션 중복 제외
  const cat = (h.category || '').toLowerCase();
  const grp = (h.group || '').toLowerCase();
  const nm = (h.name || '').toLowerCase();
  // 터렛 마운트 베이스는 별도 섹션
  if (cat === 'turret' && grp === 'auxiliary') return 'turretbase';
  if (cat === 'turret' && (grp === 'weapon')) return 'turret';
  if (cat.includes('weapon_mount')) return 'weapon';   // hardpoint_gun_* (S(n)→S(n) 무기 직접, 3.23+ 짐벌 페널티 없음)
  if (cat === 'weapons') return 'weapon';                    // VariPuck 등 실제 장착 무기
  if (cat.includes('missile') && nm.startsWith('hardpoint_')) return 'missile'; // 하드포인트만 (장착된 랙 중복 제외)
  if (cat.includes('shieldgenerator')) return 'shield';
  if (cat.includes('powerplant')) return 'power';
  if (cat === 'cooler') return 'cooler';
  if (cat.includes('quantumdrive')) return 'qd';
  if (cat === 'radar') return 'radar';
  if (cat.includes('lifesupport')) return 'life';
  if (cat.includes('thruster')) return 'engine'; // 추진부: 교체 불가 고정 슬롯 (전력치 덤프 없음)
  return null;
}

function optionsFor(kind, size) {
  // sort: exact-size match first (by perf desc), then smaller sizes
  const perf = {
    weapon: w => w.dps || 0,
    turret: w => 0, turretbase: w => 0,
    shield: w => w.hp || 0,
    power: w => w.output || 0,
    cooler: w => w.rate || 0,
    qd: w => w.speed || 0,
    radar: w => 0,
    missile: w => (w.missiles || 0) * 10 + (w.msize || 0),
  }[kind] || (w => 0);
  const byPerf = (a, b) => (perf(b) - perf(a)) || ((a.name || '').localeCompare(b.name || ''));
  const f = {
    weapon: [...DB.weapons.filter(w => w.size === size).sort(byPerf),
             ...DB.weapons.filter(w => (w.size || 0) < size).sort((a, b) => (b.size - a.size) || byPerf(a, b))],
    turret: (DB.turrets || []).filter(w => w.size === size),
    turretbase: (DB.turrets || []).filter(w => w.size === size),
    shield: DB.shields.filter(w => w.size === size).sort(byPerf),
    power: DB.powerplants.filter(w => w.size === size).sort(byPerf),
    cooler: DB.coolers.filter(w => w.size === size).sort(byPerf),
    qd: DB.qds.filter(w => w.size === size).sort(byPerf),
    radar: [...(DB.radars || []).filter(w => w.size === size).sort(byPerf),
            ...(DB.radars || []).filter(w => (w.size || 0) < size).sort((a, b) => (b.size - a.size) || byPerf(a, b))],
    missile: DB.racks.filter(w => w.size === size).sort(byPerf),
  }[kind] || [];
  return f;
}

function labelFor(kind, c) {
  if (kind === 'weapon') {
    const fam = c.family ? ` · ${c.family}` : '';
    const dt = (c.dmgtype && c.dmgtype.length) ? ` [${c.dmgtype.join('+')}]` : '';
    return `${c.name} [S${c.size}·${c.grade}]${fam} — α ${fmt(c.alpha)} / ${fmt(c.dps)} DPS${dt}`;
  }
  if (kind === 'turret' || kind === 'turretbase')
    return `${c.name} [S${c.size}] ${c.mfr || ''} — ${c.guns || ''}`;
  if (kind === 'shield') return `${c.name} [S${c.size}·${c.grade}] ${c.mfr} — HP ${fmt(c.hp)} / ${fmt(c.regen)}/s`;
  if (kind === 'power') return `${c.name} [S${c.size}·${c.grade}] ${c.mfr} — ${fmt(c.output)} 출력`;
  if (kind === 'cooler') return `${c.name} [S${c.size}·${c.grade}] ${c.mfr} — ${fmt(c.rate)} 냉각`;
  if (kind === 'qd') return `${c.name} [S${c.size}·${c.grade}] ${c.mfr} — ${(c.speed / 1e6).toFixed(0)}M m/s`;
  if (kind === 'missile') return `${c.name} [S${c.size}] ${c.mfr} — ${c.missiles}xS${c.msize}`;
  if (kind === 'radar') return `${c.name} [S${c.size}] ${c.mfr || '—'} — 탐지장비`;
  return c.name;
}

function shortName(n) {
  return (n || '').replace(/^hardpoint_/, '').replace(/_/g, ' ').replace(/^(weapon|controller|missile|power|cooler|shield|quantum|radar|fuel)\s+/, '');
}

function engSummary(slots) {
  // 추진부는 함선 고정 부품이라 교체 대상이 아님 — 이름·사이즈별 개수만 요약
  const by = {};
  for (const h of slots) {
    const nm = (h.component && h.component.name) || h.name || 'Thruster';
    const key = `${nm} S${h.maxSize}`;
    by[key] = (by[key] || 0) + 1;
  }
  return Object.entries(by).map(([k, v]) => `${k} ×${v}`).join(' · ');
}

function renderSlots() {
  const wslots = FY.filter(h => slotKind(h) === 'weapon');
  const mslots = FY.filter(h => slotKind(h) === 'missile');
  const tslots = FY.filter(h => slotKind(h) === 'turret' || slotKind(h) === 'turretbase');
  const sys = FY.filter(h => ['shield', 'power', 'cooler', 'qd', 'radar', 'life'].includes(slotKind(h)));
  $('weaponSlots').innerHTML =
    (wslots.length ? '<div class="sec-h">주포 (고정·짐벌 동일 사이즈, 3.23+)</div><div class="slots-grid">' + wslots.map(h => slotHTML(h, 'weapon')).join('') + '</div>' : '')
    + (tslots.length ? '<div class="sec-h">터렛</div><div class="slots-grid">' + tslots.map(h => slotHTML(h, slotKind(h))).join('') + '</div>' : '')
    + (mslots.length ? '<div class="sec-h">미사일 랙</div><div class="slots-grid">' + mslots.map(h => slotHTML(h, 'missile')).join('') + '</div>' : '')
    || '<p>무장 슬롯 없음</p>';
  const engSlots = FY.filter(h => slotKind(h) === 'engine');
  $('sysSlots').innerHTML = `<div class="slots-grid">${sys.map(h => slotHTML(h, slotKind(h))).join('')}</div>`
    + (engSlots.length ? `<div class="sec-h">추진부 (고정 슬롯 · 게임 덤프에 전력치 없음)</div><div style="font-size:11px;color:var(--dim)">${engSummary(engSlots)}</div>` : '')
    || '<p>시스템 슬롯 없음</p>';
  document.querySelectorAll('select.slot-sel').forEach(sel => {
    sel.addEventListener('change', e => { build[e.target.dataset.slot] = e.target.value || null; updateStats(); });
  });
}

function slotHTML(h, kind) {
  const opts = optionsFor(kind, h.maxSize);
  const defName = h.component ? h.component.name : '';
  const title = `${h.name}${defName ? ' · 기본: ' + defName : ''}`;
  if (!opts.length) {
    // 고정 슬롯 (추진부·생명유지 등): 교체 불가, FY 기본값 표시のみ
    return `<div class="slot" title="${title} (고정 슬롯 — 교체 불가)"><div class="meta"><span class="sz">S${h.maxSize}</span><b>${shortName(h.name)}</b>${defName ? '<br>기본: ' + defName : ''}</div>`
      + `<div style="flex:1;font-size:11px;color:var(--dim)">고정 · DB 미지원</div></div>`;
  }
  const cur = build[h.id] || (h.component ? matchDefault(kind, h.component) : '');
  return `<div class="slot" title="${title}"><div class="meta"><span class="sz">S${h.maxSize}</span><b>${shortName(h.name)}</b>${defName ? '<br>기본: ' + defName : ''}</div>
  <select class="slot-sel" data-slot="${h.id}" data-kind="${kind}">
  <option value="">— 미장착 (${opts.length}) —</option>
  ${opts.map(c => `<option value="${c.class}" ${c.class === cur ? 'selected' : ''}>${labelFor(kind, c)}</option>`).join('')}
  </select></div>`;
}

function matchDefault(kind, comp) {
  // try to preselect stock component if in DB
  const pool = { weapon: DB.weapons, shield: DB.shields, power: DB.powerplants, cooler: DB.coolers, qd: DB.qds, radar: DB.radars || [] }[kind] || [];
  const hit = pool.find(c => c.class === comp.scKey || c.name === comp.name);
  return hit ? hit.class : '';
}

function findComp(kind, cls) {
  const pool = { weapon: DB.weapons, turret: DB.turrets, turretbase: DB.turrets, shield: DB.shields, power: DB.powerplants, cooler: DB.coolers, qd: DB.qds, missile: DB.racks, radar: DB.radars || [] }[kind] || [];
  return pool.find(c => c.class === cls);
}

function fitStats() {
  // Erkul-style: 2-pass. 1차: 그룹별 장착품 수집 → 2차: segOff(끈 핍 수) 분배.
  // 핍 = 실제 게임값 data/power_units.json 반영(db.json의 pw/pwGen).
  //   pw     : 소비 SPowerSegmentResourceUnit.units (실드1 Shimmer=1, 무기 1.2 등)
  //   pwGen  : 발전 SPowerSegmentResourceUnit.units (파워플랜트 10~25)
  //   블럭 수 = ceil(raw), 총량 계산은 raw. 값이 없으면 PowerDraw 추정 + estCount++.
  const s = { dps: 0, alpha: 0, power: 0, output: 0, powerBase: 0, heat: 0, cooling: 0, hp: 0, regen: 0, guns: 0, qdspeed: 0, wregen: 0, avail: 0, short: 0, ppPips: 0, estCount: 0, shieldAbs: {}, downedDelay: 0, damagedDelay: 0 };
  const typeDps = {};
  const guns = [];
  const perGroup = {};
  for (const g of PWR_GROUPS) perGroup[g.id] = { power: 0, heat: 0, units: 0, maxUnits: 0 };
  const items = [];
  const coolerList = [];
  document.querySelectorAll('select.slot-sel').forEach(sel => {
    if (!sel.value) return;
    const c = findComp(sel.dataset.kind, sel.value);
    if (!c) return;
    const kind = sel.dataset.kind;
    if (kind === 'power') {
      // 실제 발전핍(pwGen=SPowerSegmentResourceUnit.units). 없으면 구형 추정치.
      s.output += (c.pwGen != null ? c.pwGen : (c.output || 0));
      s.ppPips = (s.ppPips || 0) + (c.pwGen != null ? c.pwGen : (c.output || 0));
      return;
    }
    if (NO_POWER_KINDS.has(kind)) return; // 미사일 등: 전력 배분 대상 아님 (핍·열·추정 모두 제외)
    const grp = kindToGroup(kind);
    if (pwr.grpOff[grp]) return; // 그룹 전체 OFF (Erkul powerToggle)
    // 핍 = 실제 게임값 pw(SPowerSegmentResourceUnit.units).
    // 없을 때만 PowerDraw 기반 추정치로 폴백하고 real=false 로 표시한다.
    const real = c.pw != null;
    const pwRaw = real ? c.pw : (c.power || 0);
    const maxU = Math.max(1, Math.ceil(pwRaw));
    items.push({ sel, c, kind, grp, maxU, real, pwRaw });
  });
  // 그룹별 총 핍 → 목표 배분량.
  //  segOff = 그룹에서 꺼진 핍 수 이므로 목표 = 총량 - off.
  //  아이템별 비례 반올림으로 나누면 총량이 목표와 어긋난다
  //  (예: 무기 2문×2핍=4핍 그룹에서 off=3 → round(1.5)=2 씩 깎여 총 0핍).
  //  슬롯 순서대로 목표량까지 채워 총량을 정확히 맞춘다.
  const grpMax = {}, grpLeft = {};
  for (const it of items) grpMax[it.grp] = (grpMax[it.grp] || 0) + it.maxU;
  for (const gid of Object.keys(grpMax)) {
    const off = Math.max(0, Math.min(pwr.segOff[gid] || 0, grpMax[gid]));
    grpLeft[gid] = grpMax[gid] - off;
  }
  for (const it of items) {
    let units = it.maxU;
    const slotId = it.sel.dataset.slot;
    if (it.kind === 'cooler') {
      // 쿨러는 그룹이 아니라 슬롯 단위로 관리 (Erkul: 쿨러마다 독립 컬럼)
      if (pwr.coolerOff[slotId]) units = 0;
      else if (pwr.coolerSegs[slotId] != null) units = Math.max(0, Math.min(it.maxU, pwr.coolerSegs[slotId]));
      else units = it.maxU;
    } else {
      const take = Math.max(0, Math.min(it.maxU, grpLeft[it.grp] || 0));
      grpLeft[it.grp] = (grpLeft[it.grp] || 0) - take;
      units = take;
    }
    const eff = it.maxU > 0 ? it.pwRaw * units / it.maxU : 0;
    s.power += eff; s.powerBase += it.c.powerBase || 0;
    if (!it.real) s.estCount = (s.estCount || 0) + 1;
    s.heat += it.c.heat || 0;
    perGroup[it.grp].power += eff;
    perGroup[it.grp].heat += it.c.heat || 0;
    perGroup[it.grp].units += units;
    perGroup[it.grp].maxUnits += it.maxU;
    if (it.kind === 'cooler') {
      s.cooling += (it.c.rate || 0) * units / it.maxU;
      coolerList.push({ slotId, name: it.c.name || '', units, maxUnits: it.maxU, pwRaw: it.pwRaw, off: !!pwr.coolerOff[slotId] });
    }
    if (it.kind === 'weapon') {
      const ratio = it.maxU > 0 ? units / it.maxU : 1;
      s.dps += (it.c.dps || 0) * ratio; s.alpha += (it.c.alpha || 0) * ratio; s.guns++;
      s.wregen += (it.c.regen || 0) * ratio;
      guns.push(it.c);
      for (const [k, v] of Object.entries(it.c.dpsRaw || {})) typeDps[k] = (typeDps[k] || 0) + v * ratio;
    }
    if (it.kind === 'shield') {
      s.hp += it.c.hp || 0; s.regen += it.c.regen || 0;
      // 실효 탱킹용: 흡수율(absorption) + 재생 지연 수집.
      // absorption[t] = 피격 피해 중 실드가 흡수(경감)하는 비율.
      // 남은 (1-avg) 는 실드를 관통해 선체로 들어간다(탄도 관통 특성).
      const ab = it.c.absorption || {};
      for (const t of ['Physical', 'Energy', 'Distortion']) {
        const v = ab[t];
        if (!v) continue;
        const lo = v.Minimum != null ? v.Minimum : 1;
        const hi = v.Maximum != null ? v.Maximum : 1;
        const a = s.shieldAbs[t] || (s.shieldAbs[t] = { sum: 0, n: 0, min: 1, max: 0, lo: 1, hi: 1 });
        a.sum += (lo + hi) / 2; a.n++; a.min = Math.min(a.min, lo); a.max = Math.max(a.max, hi);
      }
      if (it.c.downedDelay != null) s.downedDelay = Math.max(s.downedDelay, it.c.downedDelay);
      if (it.c.damagedDelay != null) s.damagedDelay = Math.max(s.damagedDelay, it.c.damagedDelay);
    }
    if (it.kind === 'qd') s.qdspeed = Math.max(s.qdspeed, it.c.speed || 0);
  }
  s.avail = s.output;   // 스로틀 없음: 발전핍을 100% 사용
  s.short = Math.max(0, s.power - s.avail);
  s.typeDps = typeDps; s.guns = guns; s.perGroup = perGroup; s.perCooler = coolerList;
  return s;
}

function pipCells(maxU, units, extraCls) {
  // 셀은 아래→위로 센다: 가장 아래 칸이 1핍. data-pip = 그 칸을 눌렀을 때의 배분 핍 수.
  const shown = Math.min(maxU, 24);
  const onN = Math.min(units, shown);
  const emptyN = Math.max(0, shown - onN);
  let html = '';
  for (let i = 0; i < emptyN; i++) html += `<div class="pip" data-pip="${shown - i}"></div>`;
  for (let i = 0; i < onN; i++) html += `<div class="pip on${extraCls}" data-pip="${onN - i}"></div>`;
  return html;
}

function renderPwrBlocks() {
  // Erkul-style 8 power columns: stacked pip blocks + group icon toggle.
  // 칸 클릭 = 그 칸까지만 배분 (아래에서 센 수). 같은 칸 다시 클릭 = 1핍 감소.
  // 아이콘 클릭 = 그룹 전체 OFF/ON. 쿨러는 슬롯별 개별 컬럼. 핍=실제 게임값 ceil(pw).
  const f = fitStats();
  // Erkul 컬럼 순서: weapon → engine → shield → qdrive → radar → lifeSupport,
  // 그리고 쿨러는 집계하지 않고 **슬롯마다 개별 컬럼**으로 마지막에 붙인다.
  const famCols = PWR_GROUPS.filter(g => g.id !== 'coolers').map(g => {
    const pg = f.perGroup[g.id];
    const maxU = pg.maxUnits, units = pg.units;
    const off = !!pwr.grpOff[g.id];
    const blocks = pipCells(maxU, units, off ? ' grp-off' : '');
    const num = maxU > 0 ? `<div class="pip-num">${off ? 0 : units}</div>` : '';
    const noData = maxU === 0;
    const sub = noData ? '<div class="pwr-w">—</div>'
      : `<div class="pwr-w">${off ? 'OFF' : fmt(pg.power) + 'p'}</div>`;
    const tip = noData
      ? `${g.label}: 이 함선에 해당 슬롯이 없거나 전력 데이터가 게임 덤프에 없음`
      : `${g.label}: 칸 클릭=그 칸까지 배분(아래부터), 같은 칸 재클릭=1핍 감소, 아이콘=계통 전체 ON/OFF`;
    return `<div class="pwr-col${off ? ' off' : ''}${noData ? ' nodata' : ''}" data-grp="${g.id}" title="${tip}">`
      + `<div class="pips">${num}${blocks}</div>`
      + `<div class="pwr-ico" data-ico="${g.id}">${g.icon}</div>`
      + sub + `</div>`;
  }).join('');

  const coolerCols = (f.perCooler || []).map(cc => {
    const off = !!pwr.coolerOff[cc.slotId];
    const units = off ? 0 : cc.units;
    const maxU = cc.maxUnits;
    const blocks = pipCells(maxU, units, off ? ' grp-off' : '');
    const num = maxU > 0 ? `<div class="pip-num">${off ? 0 : units}</div>` : '';
    const draw = maxU > 0 ? cc.pwRaw * units / maxU : 0;
    const sub = `<div class="pwr-w">${off ? 'OFF' : fmt(draw) + 'p'}</div>`;
    const key = 'cooler:' + cc.slotId;
    return `<div class="pwr-col${off ? ' off' : ''}" data-grp="${key}" title="쿨러 ${cc.name}: 칸 클릭=그 칸까지 배분(아래부터), 같은 칸 재클릭=1핍 감소, 아이콘=개별 ON/OFF">`
      + `<div class="pips">${num}${blocks}</div>`
      + `<div class="pwr-ico" data-ico="coolers">❄️</div>`
      + sub + `</div>`;
  }).join('');

  $('pwrBlocks').innerHTML = famCols + coolerCols;
  document.querySelectorAll('.pwr-col').forEach(el => {
    el.addEventListener('click', e => {
      const grp = el.dataset.grp;
      const pip = e.target.closest('.pip');
      const k = pip ? parseInt(pip.dataset.pip, 10) : NaN;
      if (grp.startsWith('cooler:')) { // 쿨러는 슬롯 단위 컬럼
        const slotId = grp.slice(7);
        if (e.target.closest('.pwr-ico')) pwr.coolerOff[slotId] = !pwr.coolerOff[slotId];
        else if (!isNaN(k)) setCoolerUnits(slotId, k);
        else return; // 핍·아이콘 밖 클릭은 무시
        updateStats();
        return;
      }
      if (e.target.closest('.pwr-ico')) {
        pwr.grpOff[grp] = !pwr.grpOff[grp]; // 아이콘 = 그룹 전체 토글 (Erkul powerToggle)
      } else if (!isNaN(k)) {
        setGroupUnits(grp, k); // 칸 클릭 = 그 칸까지 직접 배분
      } else {
        return;
      }
      updateStats();
    });
  });
}

function setGroupUnits(grp, k) {
  // 칸 클릭: 계통에 k핍을 배분한다 (아래에서 k번째 칸).
  // 같은 수를 다시 누르면 1핍 줄여 토글처럼 느껴지게 한다 (인게임 감각).
  // 꺼져 있던 계통을 칸 클릭으로 되살릴 때는 '같은 값 감소' 규칙을 적용하지 않는다
  // (OFF 상태에서는 units 가 총량으로 보이므로 클릭이 곧 0핍이 되어버림).
  const wasOff = !!pwr.grpOff[grp];
  pwr.grpOff[grp] = false;
  const pg = fitStats().perGroup[grp];
  const maxU = pg.maxUnits;
  if (!maxU) return;
  let next = Math.max(0, Math.min(maxU, k));
  if (!wasOff && pg.units === next) next = Math.max(0, next - 1);
  pwr.segOff[grp] = maxU - next; // segOff = 꺼진 핍 수 (그룹 총량 기준)
}

function setCoolerUnits(slotId, k) {
  // 쿨러 슬롯도 같은 규칙: k핍 배분, 같은 수 재클릭 시 1핍 감소.
  const wasOff = !!pwr.coolerOff[slotId];
  pwr.coolerOff[slotId] = false;
  const cc = (fitStats().perCooler || []).find(x => x.slotId === slotId);
  if (!cc) return;
  let next = Math.max(0, Math.min(cc.maxUnits, k));
  if (!wasOff && cc.units === next) next = Math.max(0, next - 1);
  pwr.coolerSegs[slotId] = next;
}

function renderShieldTank(f) {
  // 실드 지연 기반 실효 탱킹.
  //  실효HP(원시 피해 기준) = Σ실드HP ÷ 흡수율
  //  지속 흡수 DPS          = Σ재생/s ÷ 흡수율
  //  흡수율은 XML 의 Physical/Energy/Distortion Min·Max 평균.
  //  재생 지연(damagedDelay) 동안은 재생이 멈추므로 지속값은 상한이다.
  const el = $('shieldTank');
  if (!el) return;
  if (!f.hp) { el.innerHTML = '<div style="font-size:12px;color:var(--dim)">실드를 장착하세요</div>'; return; }
  const rows = [];
  for (const t of ['Physical', 'Energy', 'Distortion']) {
    const a = f.shieldAbs[t];
    if (!a || !a.n) continue;
    const avg = a.sum / a.n;
    const effHP = avg > 0 ? f.hp / avg : f.hp;
    const sustain = avg > 0 ? f.regen / avg : f.regen;
    const bypass = (1 - avg) * 100;
    const rng = a.min !== a.max ? ` <span style="color:var(--dim)">(${(a.min*100).toFixed(0)}~${(a.max*100).toFixed(0)}%)</span>` : '';
    rows.push(`<div class="stat"><div class="v">${fmt(effHP)}</div>`
      + `<div class="k">${t} 실효HP · 흡수 ${(avg*100).toFixed(0)}%${rng} · 관통 ${bypass.toFixed(0)}%</div>`
      + `<div class="k" style="margin-top:2px">지속 흡수 ${fmt(sustain)} DPS</div></div>`);
  }
  el.innerHTML = rows.join('')
    + `<div style="font-size:11px;color:var(--dim);margin-top:6px;grid-column:1/-1">`
    + `재생 지연: 피격 후 <b>${fmt(f.damagedDelay)}s</b> 정지 · 다운 후 <b>${fmt(f.downedDelay)}s</b>`
    + ` — 지연 동안 재생이 완전히 멈추므로 연속 버스트에 취약.<br>`
    + `실효HP = Σ실드HP ÷ 흡수율 (그 피해로 실드가 깨질 때까지의 <i>원시</i> 피해량). 관통분은 선체로 직행.</div>`;
}

function updateStats() {
  const f = fitStats();
  renderPwrBlocks();
  renderShieldTank(f);
  const typeLine = ['Energy', 'Physical', 'Distortion'].filter(t => f.typeDps[t] > 0)
    .map(t => `${t.slice(0, 4)} ${fmt(f.typeDps[t])}`).join(' · ') || '—';
  // 가용 = 발전핍(스로틀 없음). 부족분 있으면 경고.
  const pct = f.avail > 0 ? Math.min(100, f.power / f.avail * 100) : 0;
  const pcls = f.short > 0 ? 'bad' : pct > 85 ? 'warn' : 'ok';
  const hpct = f.cooling > 0 ? Math.min(100, f.heat / f.cooling * 100) : 0;
  const hcls = f.cooling === 0 ? '' : hpct > 100 ? 'bad' : hpct > 85 ? 'warn' : 'ok';
  $('stats').innerHTML = `
    <div class="stat"><div class="v">${fmt(f.dps)}</div><div class="k">총 DPS · α ${fmt(f.alpha)} (${f.guns.length}문)</div><div class="k" style="margin-top:2px">${typeLine}</div></div>
    <div class="stat"><div class="v">${fmt(f.power)} / ${fmt(f.avail)}</div><div class="k">전력 소모 / 가용 핍 (발전 ${fmt(f.output)}핍)</div></div>
    <div class="stat"><div class="v">${fmt(f.heat)} / ${fmt(f.cooling)}</div><div class="k">열 부하 / 냉각</div></div>
    <div class="stat"><div class="v">${fmt(f.hp)}</div><div class="k">실드 HP 합계</div></div>
    <div class="stat"><div class="v">${fmt(f.regen)}/s</div><div class="k">실드 재생/s</div></div>
    <div class="stat"><div class="v">${f.qdspeed ? (f.qdspeed / 299792458 * 100).toFixed(1) + '% c' : '—'}</div><div class="k">양자항행 속도</div></div>`;
  $('powerBar').innerHTML = (f.avail > 0
    ? `<div style="font-size:12px" class="${pcls}">전력 사용률 ${pct.toFixed(0)}% ${f.short > 0 ? `⚠️ ${fmt(f.short)}핍 부족 — 핍 블럭을 끄세요` : ''}</div><div class="bar"><i style="width:${Math.min(100, pct)}%;background:${f.short > 0 ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--ok)'}"></i></div>`
    : '<div style="font-size:12px;color:var(--dim)">파워플랜트를 장착하세요</div>')
    + (f.cooling > 0
    ? `<div style="font-size:12px;margin-top:6px" class="${hcls}">열 부하율 ${hpct.toFixed(0)}% ${hpct > 100 ? '⚠️ 과열! 쿨러 부족' : ''}</div><div class="bar"><i style="width:${Math.min(100, hpct)}%;background:${hpct > 100 ? 'var(--bad)' : hpct > 85 ? 'var(--warn)' : 'var(--ok)'}"></i></div>`
    : '<div style="font-size:12px;color:var(--dim);margin-top:6px">쿨러를 장착하세요</div>');
}

function saveBuild() {
  const ship = $('shipSel').value;
  const data = { ship, build, pwr: { segOff: pwr.segOff, grpOff: pwr.grpOff, coolerSegs: pwr.coolerSegs, coolerOff: pwr.coolerOff }, savedAt: new Date().toISOString() };
  localStorage.setItem('scfit:' + ship, JSON.stringify(data));
  $('saveStatus').textContent = `저장됨 — ${ship} (${Object.keys(build).filter(k => build[k]).length}개 슬롯)`;
}
function loadBuild() {
  const ship = $('shipSel').value;
  const raw = localStorage.getItem('scfit:' + ship);
  if (!raw) { $('saveStatus').textContent = '저장된 빌드 없음'; return; }
  const saved = JSON.parse(raw);
  build = saved.build || {};
  if (saved.pwr) {
    // 구버전 저장본의 throttle/triW/S/E 키는 무시된다 (해당 UI 제거됨).
    Object.assign(pwr, saved.pwr);
    pwr.segOff = pwr.segOff || {}; pwr.grpOff = pwr.grpOff || {};
    pwr.coolerSegs = pwr.coolerSegs || {}; pwr.coolerOff = pwr.coolerOff || {};
  }
  renderSlots();
  // reapply
  document.querySelectorAll('select.slot-sel').forEach(sel => {
    if (build[sel.dataset.slot]) sel.value = build[sel.dataset.slot];
  });
  updateStats();
  $('saveStatus').textContent = '불러옴 — ' + ship;
}
function resetBuild() {
  build = {};
  pwr.segOff = {}; pwr.grpOff = {}; pwr.coolerSegs = {}; pwr.coolerOff = {};
  renderSlots(); updateStats();
}

init();
