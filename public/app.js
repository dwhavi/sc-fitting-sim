// SC Fitting Sim MVP — db.json + FleetYards live hardpoints
let DB = null, FY = [];
let curShip = '';
let build = {}; // slotId -> component class
// PWR state: Erkul-style — per-group pip blocks + weapon pool + ON/OFF
// Erkul model (NQEKEKTP Ln/U + Qr, main IF pips):
//  계통핍(segOff/grpOff) = 전력 on/off. 무기 풀(poolSel) = 무기 출력, 별도 분리.
//  Ln(): poolRatio=min(1,selected/consumption) — 에너지 무기에만 적용.
//  탄도는 풀 영향 없음. poolSize = 함선 PowerPools.WeaponGun.Size (-1=무제한).
//  blocks from item resource flows Power units; weapon = poolSize cap;
//  coolers individually selectable; click = block on/off, icon = whole group power.
//  PowerDraw(⚡) is display-only; pips are the allocation unit.
// coolerOff: 쿨러 슬롯별 개별 ON/OFF (Erkul 은 쿨러마다 독립 컬럼/pool 을 준다)
// 파워는 항상 100% 사용한다. 조절은 계통 핍 블럭(segOff/grpOff/coolerSegs/coolerOff)만으로.
// 칸 클릭 = 그 칸까지 직접 배분 / 아이콘 클릭 = 계통 전체 ON·OFF. 미사일은 전력 계통 없음.
// 인게임 캐패시터 삼각형은 '전력이 부족할 때만' 작동하는데, 여기서는 핍을 직접 빼는 방식이
// 그 역할을 대신하므로 스로틀·삼각형 UI 는 두지 않는다.
// 무기 풀: Erkul U()/Ln() — selected=min(poolSize, poolSel), poolRatio=min(1,selected/소모).
let pwr = { segOff: {}, grpOff: {}, coolerSegs: {}, coolerOff: {}, poolSel: null };
const PWR_GROUPS = [
  { id: 'weapon', icon: '🔫', label: '무기', kinds: ['weapon', 'turret', 'turretbase', 'mount'] },
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
  $('shipBtn').addEventListener('click', openShipModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('saveBtn').onclick = saveBuild; $('loadBtn').onclick = loadBuild; $('resetBtn').onclick = resetBuild;
}

const CAREER_ICON = {'Combat':'⚔️','Ground':'🛞','Industrial':'⛏️','Competition':'🏁','Transporter':'🚚','Exploration':'🔭','Support':'🛟','Multi-Role':'🔀','Personal Transport':'🚐','Starter':'🌱'};
function shipSuper(career){ if(career==='Combat'||career==='Ground') return {t:'군사',i:'⚔️'}; if(career==='Industrial') return {t:'산업',i:'⛏️'}; if(career==='Competition') return {t:'경기',i:'🏁'}; return {t:'민간',i:'🛸'}; }
function shipBadge(s){ const sp=shipSuper(s.career||''); const ic=CAREER_ICON[s.career]||sp.i; return `<span class="badge">${sp.i} ${sp.t}</span><span class="badge">${ic} ${s.career||'?'}</span><span class="badge">S${s.size}</span>`; }
function closeModal(){ $('modalRoot').innerHTML=''; }
function shipCurHTML(s){ const sp=shipSuper(s.career||''); const ic=CAREER_ICON[s.career]||sp.i; return `${ic} <b>${s.name}</b><br><span style="color:var(--dim)">${sp.t} · ${s.career||''}${s.role?' · '+s.role:''} · S${s.size} · 👥 ${s.crew??'—'} · 📦 ${s.cargo??'—'}</span>`; }
let shipFGroup='ALL', shipFQ='';
function openShipModal(){
  shipFGroup='ALL'; shipFQ='';
  $('modalRoot').innerHTML=`<div class="modal-ov" id="mov"><div class="modal">
    <div class="modal-h"><b>🚀 함선 선택</b><span class="sub">${DB.ships.length}종 · 분류 뱃지</span><button class="modal-x" id="mx">✕</button></div>
    <div class="modal-search"><input id="mShipQ" placeholder="함선 검색 (예: avenger, cutlass…)"></div>
    <div class="chips" id="mShipChips"></div>
    <div class="modal-list" id="mShipList"></div></div></div>`;
  $('mx').onclick=closeModal;
  $('mov').addEventListener('click',e=>{ if(e.target.id==='mov') closeModal(); });
  $('mShipQ').addEventListener('input',e=>{ shipFQ=e.target.value.toLowerCase().trim(); renderShipModalList(); });
  $('mShipQ').focus();
  renderShipModalList();
}
function renderShipModalList(){
  const groups=[['ALL','전체'],['military','⚔️ 군사'],['industrial','⛏️ 산업'],['racing','🏁 경기'],['civilian','🛸 민간']];
  const gmap={military:'군사',industrial:'산업',racing:'경기',civilian:'민간'};
  const cnt=g=>g==='ALL'?DB.ships.length:DB.ships.filter(s=>shipSuper(s.career||'').t===gmap[g]).length;
  $('mShipChips').innerHTML=groups.map(([k,t])=>`<button class="chip${shipFGroup===k?' on':''}" data-g="${k}">${t} ${cnt(k)}</button>`).join('');
  document.querySelectorAll('#mShipChips .chip').forEach(c=>c.onclick=()=>{ shipFGroup=c.dataset.g; renderShipModalList(); });
  const list=DB.ships.filter(s=>{
    if(shipFGroup!=='ALL'&&shipSuper(s.career||'').t!==gmap[shipFGroup]) return false;
    if(shipFQ&&!(s.name+' '+s.class+' '+(s.role||'')).toLowerCase().includes(shipFQ)) return false;
    return true;
  });
  $('mShipList').innerHTML=(list.length?list.map(s=>{ const sp=shipSuper(s.career||''); const ic=CAREER_ICON[s.career]||sp.i;
    return `<button class="ship-card${s.slug===curShip?' sel':''}" data-slug="${s.slug}"><span class="ic">${ic}</span><span><span class="nm">${s.name}</span><div class="mt">${sp.t} · ${s.career||''}${s.role?' · '+s.role:''} · S${s.size} · 👥 ${s.crew??'—'} · 📦 ${s.cargo??'—'}</div></span></button>`; }).join(''):'<p style="color:var(--dim)">검색 결과 없음</p>');
  document.querySelectorAll('#mShipList .ship-card').forEach(b=>b.onclick=()=>{ closeModal(); selectShip(b.dataset.slug); });
}
function emFmt(c){ return c.em!=null?` · EM ${fmt(c.em)}`:''; }
function pipFmt(c){ if(c.pw!=null) return `${fmt(Math.ceil(c.pw))}핍`; if(c.power!=null) return `~${fmt(Math.ceil(c.power))}핍?`; return ''; }
function compShort(kind,c){
  if(!c) return '';
  const cb=clsBadge(c.cls);
  if(kind==='weapon'){ const fam=c.family?` · ${c.family}`:''; const ft=fireBadge(c); return `${cb}${c.name}${fam} · ${fmt(c.dps)} DPS${susFmt(c)}${ft} · ${pipFmt(c)}${emFmt(c)}`; }
  if(kind==='shield') return `${cb}${c.name} · HP ${fmt(c.hp)} · ${pipFmt(c)}${emFmt(c)}`;
  if(kind==='power') return `${cb}${c.name} · ${fmt(c.pwGen!=null?c.pwGen:c.output)}p${emFmt(c)}`;
  if(kind==='cooler') return `${cb}${c.name} · ${fmt(c.rate)} · ${pipFmt(c)}${emFmt(c)}`;
  if(kind==='qd') return `${cb}${c.name} · ${(c.speed/1e6).toFixed(0)}M m/s · ${pipFmt(c)}${emFmt(c)}`;
  if(kind==='missile') return `${cb}${c.name} · ${c.missiles}xS${c.msize}`;
  if(kind==='radar') return `${cb}${c.name} · ${pipFmt(c)}${emFmt(c)}`;
  if(kind==='mount'||kind==='turret'||kind==='turretbase'){ const lay=isGimbalCard(c)?('S'+c.size+' 짐벌'):((c.guns?' · '+c.guns:'')); return `${c.name}${lay}`; }
  return (c.cls?clsBadge(c.cls):'')+c.name;
}
const CLS_META={'Military':['⚔️','군사'],'Civilian':['🛸','민간'],'Industrial':['⛏️','산업'],'Competition':['🏁','경기'],'Stealth':['👤','스텔스']};
function clsBadge(cls){ const m=CLS_META[cls||'']; return m?`<span class="badge">${m[0]} ${m[1]}</span>`:'<span class="badge">— 미분류</span>'; }
// 발사방식 뱃지 (2026-11-01): Erkul fireKind. charged 풀차지/beam 지속 구분.
function fireBadge(c){
  if(!c || !c.fireType) return '';
  const ft = c.fireType;
  if (ft === 'charged') return ' · ⚡풀차지';
  if (ft === 'beam') return ' · 🔆지속빔';
  if (ft === 'burst') return ' · 💥점사';
  if (ft === 'rapid') return ' · 🔥연사';
  return '';
}
// sustain 표시: 게임 Damage.Sustained (Erkul En()/ye() 대응).
function susFmt(c){
  if (c.sustain == null) return '';
  return ` (지속 ${fmt(c.sustain)})`;
}
function openCompModal(slotId, kind, opts){
  opts=opts||{};
  const h=(FY||[]).find(x=>x.id===slotId);
  const maxSize=opts.gunSize||(h?h.maxSize:0);
  let list, cur;
  if(opts.card){ const narrowed=h?compatCards(h,kind):null; list=narrowed||optionsFor(kind,maxSize); cur=(slotId in build)?build[slotId]:matchDefault(kind,h?h.component:null); }
  else if(opts.gunSize){ list=optionsFor('weapon',opts.gunSize); cur=build[slotId]||stockGunFor(slotId)||''; }
  else { list=optionsFor(kind,maxSize); cur=(slotId in build)?build[slotId]:(h&&h.component?matchDefault(kind,h.component):''); }
  const title=opts.title||(h?shortName(h.name):slotId);
  const defName=h&&h.component?h.component.name:'';
  $('modalRoot').innerHTML=`<div class="modal-ov" id="mov"><div class="modal">
    <div class="modal-h"><b>${title}</b><span class="sub">S${maxSize}${defName?' · 기본: '+defName:''} · ${list.length}종</span><button class="modal-x" id="mx">✕</button></div>
    <div class="modal-search"><input id="mCompQ" placeholder="부품 검색 (이름·제조사·계열…)"><select id="mCompSort" class="modal-sort"></select></div>
    <div class="chips" id="mCompChips"></div>
    <div class="modal-count" id="mCompCount"></div>
    <div class="modal-list" id="mCompList"></div></div></div>`;
  $('mx').onclick=closeModal;
  $('mov').addEventListener('click',e=>{ if(e.target.id==='mov') closeModal(); });
  let compFCls='ALL', compFSz='ALL', compFGr='ALL', compSort='';
  const SORTS={
    '':['기본 순서',()=>0],
    perf:['성능 높은 순',(a,b)=>{
      const pv={weapon:c=>c.dps||0,shield:c=>c.hp||0,power:c=>(c.pwGen!=null?c.pwGen:c.output)||0,cooler:c=>c.rate||0,qd:c=>c.speed||0,missile:c=>(c.missiles||0)*10+(c.msize||0),radar:()=>0}[opts.gunSize?'weapon':kind]||(()=>0);
      return (pv(b)-pv(a))||((a.name||'').localeCompare(b.name||''));
    }],
    pipAsc:['핍 적은 순',(a,b)=>(((a.pw==null?1e9:a.pw))-((b.pw==null?1e9:b.pw)))],
    emAsc:['EM 낮은 순',(a,b)=>(((a.em==null?1e9:a.em))-((b.em==null?1e9:b.em)))],
    name:['이름 순',(a,b)=>(a.name||'').localeCompare(b.name||'')]
  };
  $('mCompSort').innerHTML=Object.entries(SORTS).map(([k,[t]])=>`<option value="${k}">${t}</option>`).join('');
  $('mCompSort').addEventListener('change',e=>{ compSort=e.target.value; redraw(); });
  const hasCls=list.some(c=>c.cls);
  const sizes=[...new Set(list.map(c=>c.size).filter(v=>v!=null))].sort((a,b)=>a-b);
  const grades=[...new Set(list.map(c=>String(c.grade??'')).filter(v=>v))].sort();
  const drawChips=()=>{
    let html='';
    if(hasCls){
      const keys=['ALL','Military','Civilian','Industrial','Competition','Stealth'];
      const lbl={ALL:'전체',Military:'⚔️ 군사',Civilian:'🛸 민간',Industrial:'⛏️ 산업',Competition:'🏁 경기',Stealth:'👤 스텔스'};
      html+=`<span class="grp-lbl">분류</span>`+keys.map(k=>{
        const n=k==='ALL'?list.length:list.filter(c=>(c.cls||'')===k).length;
        return n?`<button class="chip${compFCls===k?' on':''}" data-g="cls" data-c="${k}">${lbl[k]} ${n}</button>`:'';
      }).join('');
    }
    if(sizes.length>1){
      html+=`<span class="grp-lbl">사이즈</span><button class="chip sz${compFSz==='ALL'?' on':''}" data-g="sz" data-c="ALL">전체</button>`+sizes.map(s=>`<button class="chip sz${String(compFSz)===String(s)?' on':''}" data-g="sz" data-c="${s}">S${s}</button>`).join('');
    }
    if(grades.length>1){
      html+=`<span class="grp-lbl">등급</span><button class="chip gr${compFGr==='ALL'?' on':''}" data-g="gr" data-c="ALL">전체</button>`+grades.map(g=>`<button class="chip gr${compFGr===g?' on':''}" data-g="gr" data-c="${g}">${g}</button>`).join('');
    }
    $('mCompChips').innerHTML=html;
    document.querySelectorAll('#mCompChips .chip').forEach(b=>b.onclick=()=>{ const g=b.dataset.g; if(g==='cls')compFCls=b.dataset.c; else if(g==='sz')compFSz=b.dataset.c; else compFGr=b.dataset.c; drawChips(); redraw(); });
  };
  drawChips();
  const redraw=()=>draw(($('mCompQ').value||'').toLowerCase().trim());
  const specMini=(kk,c)=>{
    if(kk==='weapon') return `<span class="spec-mini">${fmt(c.dps)} DPS${c.sustain!=null?` (지속 ${fmt(c.sustain)})`:''}</span><span class="spec-mini">${pipFmt(c)||'—'}</span>${c.em!=null?`<span class="spec-mini">EM ${fmt(c.em)}</span>`:''}`;
    if(kk==='shield') return `<span class="spec-mini">HP ${fmt(c.hp)}</span><span class="spec-mini">${pipFmt(c)||'—'}</span>${c.em!=null?`<span class="spec-mini">EM ${fmt(c.em)}</span>`:''}`;
    if(kk==='power') return `<span class="spec-mini">${fmt(c.pwGen!=null?c.pwGen:c.output)}p</span>${c.em!=null?`<span class="spec-mini">EM ${fmt(c.em)}</span>`:''}`;
    if(kk==='cooler') return `<span class="spec-mini">${fmt(c.rate)}</span><span class="spec-mini">${pipFmt(c)||'—'}</span>${c.em!=null?`<span class="spec-mini">EM ${fmt(c.em)}</span>`:''}`;
    if(kk==='qd') return `<span class="spec-mini">${(c.speed/1e6).toFixed(0)}M m/s</span><span class="spec-mini">${pipFmt(c)||'—'}</span>${c.em!=null?`<span class="spec-mini">EM ${fmt(c.em)}</span>`:''}`;
    if(kk==='missile') return `<span class="spec-mini">${c.missiles}xS${c.msize}</span>`;
    return '';
  };
  const draw=q=>{
    let flt=list.filter(c=>(compFCls==='ALL'||(c.cls||'')===compFCls)&&(compFSz==='ALL'||String(c.size)===String(compFSz))&&(compFGr==='ALL'||String(c.grade??'')===String(compFGr))&&((labelFor(opts.gunSize?'weapon':kind,c)+' '+(c.mfr||'')).toLowerCase().includes(q)));
    if(compSort&&SORTS[compSort]) flt=[...flt].sort(SORTS[compSort][1]);
    const rows=[{empty:true}].concat(flt);
    $('mCompCount').textContent=`${flt.length} / ${list.length}종 표시중`;
    $('mCompList').innerHTML=rows.map(r=>{
      if(r.empty) return `<button class="comp-row${!cur?' sel':''}" data-cls=""><span><span class="nm">— 미장착</span><div class="mt">슬롯 비우기</div></span></button>`;
      const c=r, cc=c.class, kk=opts.gunSize?'weapon':kind;
      return `<button class="comp-row${cc===cur?' sel':''}" data-cls="${cc}"><span><span class="nm">${compShort(kk,c)}</span><div class="mt">${specMini(kk,c)}${labelFor(kk,c)}${c.mfr?' · '+c.mfr:''}</div></span></button>`;
    }).join('');
    document.querySelectorAll('#mCompList .comp-row').forEach(b=>b.onclick=()=>{
      const v=b.dataset.cls||null;
      build[slotId]=v;
      if(opts.card) Object.keys(build).filter(k=>k.startsWith(slotId+':')).forEach(k=>delete build[k]);
      closeModal(); renderSlots(); updateStats();
    });
  };
  $('mCompQ').addEventListener('input',e=>draw(e.target.value.toLowerCase().trim()));
  $('mCompQ').focus();
  draw('');
}
function renderShipList(ships) {
  $('shipSel').innerHTML = `<option value="">함선을 선택해주세요</option>` + ships.map(s => {
    return `<option value="${s.slug}">${s.name}</option>`;
  }).join('');
}

async function selectShip(slug) {
  curShip = slug;
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
  try { $('shipSel').value = slug; } catch(_){}
  const _s = DB.ships.find(x => x.slug === slug);
  if (_s) $('shipCur').innerHTML = shipCurHTML(_s);
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
  if (cat.includes('weapon_mount')) return 'mount';    // 마운트·터렛 카드 (교체 가능, 무기는 하위 선택)
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
    mount: w => (w.guns ? w.guns.split('+').length : 0),
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
    mount: [...(DB.turrets || []).filter(w => w.size === size)].sort(byPerf),
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
  if (kind === 'mount' || kind === 'turret' || kind === 'turretbase') {
    const layout = isGimbalCard(c) ? ('S' + c.size + ' 짐벌 (3.23+ 동일 사이즈 · 하위 호환)') : (c.guns ? '무기 ' + c.guns : '무기 없음');
    return `${c.name} [S${c.size}] ${c.mfr || ''} — ${layout}`;
  }
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

function subWeaponHTML(subId, gunSize, idx) {
  // turret/mount guns[i] -> same-size weapon button + modal
  const opts = optionsFor('weapon', gunSize);
  const cur = build[subId] || stockGunFor(subId) || '';
  const c = cur ? findComp('weapon', cur) : null;
  const disp = c ? compShort('weapon', c) : `<span class="ph">— 미장착 (${opts.length}) — 선택</span>`;
  if (!opts.length)
    return `<div class="slot" style="margin-left:14px" title="${subId} (S${gunSize} 무기 DB 없음)"><div class="meta"><span class="sz">S${gunSize}</span><b>↳ 무기 ${idx + 1}</b></div>`
      + `<div style="flex:1;font-size:11px;color:var(--dim)">DB 미지원</div></div>`;
  return `<div class="slot" style="margin-left:14px" title="${subId} · S${gunSize} 무기 선택"><div class="meta"><span class="sz">S${gunSize}</span><b>↳ 무기 ${idx + 1}</b></div>`
    + `<button class="comp-btn" data-cslot="${subId}" data-gsize="${gunSize}">${disp}</button></div>`;
}
function stockGunFor(subId) {
  // 고정 껍데기 하위 무기 순정값: 'portId:w{i}' -> childGuns[i].class
  const m = String(subId).match(/^(.*):w(\d+)$/);
  if (!m) return '';
  const port = (FY || []).find(x => x.id === m[1]);
  const g = port && port.childGuns && port.childGuns[parseInt(m[2], 10)];
  return (g && g.class) || '';
}
function cardSlotHTML(h, cardKind) {
  // layer 1: mount/turret card (replaceable). layer 2: guns[i] weapon dropdowns.
  // 호환 카드가 식별되면 선택지를 그 범위로 좁힌다 (순정 먼저).
  const narrowed = compatCards(h, cardKind);
  const cards = narrowed || optionsFor(cardKind, h.maxSize);
  const narrowedNote = narrowed ? ` · 호환 ${narrowed.length}종` : '';
  const comp = h.component || {};
  const defName = comp.name || '';
  const title = `${h.name}${defName ? ' · 기본: ' + defName : ''}`;
  const raw = (h.id in build) ? build[h.id] : matchDefault(cardKind, comp);
  const cur = raw || '';
  let selObj = (cards.find(c => c.class === cur)) || ((DB.turrets || []).find(c => c.class === cur)) || null;
  if (!selObj) selObj = findTurret(comp.scKey, comp.name);
  if ((h.id in build) && !build[h.id]) selObj = null; // user explicitly cleared
  let subs = '';
  if (selObj && (selObj.guns || isGimbalCard(selObj))) {
    subs = cardGuns(selObj).map((gs, i) => subWeaponHTML(h.id + ':w' + i, gs, i)).join('');
  } else if (!selObj && h.childGuns && h.childGuns.length) {
    // 고정 껍데기(FY 카드 미매칭): 체인의 순정 무기 행을 직접 표시.
    subs = h.childGuns.filter(g => g.max > 0).map((g, i) =>
      subWeaponHTML(h.id + ':w' + i, g.max, i)).join('');
  }
  const selCard = cur ? ((cards.find(c => c.class === cur)) || ((DB.turrets || []).find(c => c.class === cur)) || null) : null;
  const cardSel = cards.length
    ? `<button class="comp-btn" data-cslot="${h.id}" data-card="${cardKind}">${selCard ? compShort(cardKind, selCard) : `— 미장착 (${cards.length}) — 선택`}</button>`
    : `<div style="flex:1;font-size:11px;color:var(--dim)">고정${narrowedNote} · DB 미지원</div>`;
  const compatTag = narrowedNote ? `<div style="font-size:10px;color:var(--acc)">호환 ${cards.length}종 표시 중</div>` : '';
  return `<div style="margin-bottom:8px"><div class="slot" title="${title}${narrowedNote}"><div class="meta"><span class="sz">S${h.maxSize}</span><b>${shortName(h.name)}</b>${defName ? '<br>기본: ' + defName : ''}</div>`
    + cardSel + `</div>${compatTag}${subs}</div>`;
}
function renderSlots() {
  const wslots = FY.filter(h => slotKind(h) === 'weapon');
  const mounts = FY.filter(h => slotKind(h) === 'mount');
  const tslots = FY.filter(h => slotKind(h) === 'turret');
  const tbase = FY.filter(h => slotKind(h) === 'turretbase');
  const mslots = FY.filter(h => slotKind(h) === 'missile');
  const sys = FY.filter(h => ['shield', 'power', 'cooler', 'qd', 'radar', 'life'].includes(slotKind(h)));
  $('weaponSlots').innerHTML =
    (mounts.length ? '<div class="sec-h">마운트·짐벌 (카드 교체 → 무기 하위 선택)</div>' + mounts.map(h => cardSlotHTML(h, 'mount')).join('') : '')
    + (wslots.length ? '<div class="sec-h">주포 직결 (3.23+ 동일 사이즈)</div><div class="slots-grid">' + wslots.map(h => slotHTML(h, 'weapon')).join('') + '</div>' : '')
    + (tslots.length ? '<div class="sec-h">터렛 (카드 교체 → 무기 하위 선택)</div>' + tslots.map(h => cardSlotHTML(h, 'turret')).join('') : '')
    + (tbase.length ? '<div class="sec-h">터렛 베이스·특수</div><div class="slots-grid">' + tbase.map(h => slotHTML(h, 'turretbase')).join('') + '</div>' : '')
    + (mslots.length ? '<div class="sec-h">미사일 랙</div><div class="slots-grid">' + mslots.map(h => slotHTML(h, 'missile')).join('') + '</div>' : '')
    || '<p>무장 슬롯 없음</p>';
  const engSlots = FY.filter(h => slotKind(h) === 'engine');
  $('sysSlots').innerHTML = `<div class="slots-grid">${sys.map(h => slotHTML(h, slotKind(h))).join('')}</div>`
    + (engSlots.length ? `<div class="sec-h">추진부 (고정 슬롯 · 게임 덤프에 전력치 없음)</div><div style="font-size:11px;color:var(--dim)">${engSummary(engSlots)}</div>` : '')
    || '<p>시스템 슬롯 없음</p>';
  document.querySelectorAll('button.comp-btn[data-cslot]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.cslot;
      if (btn.dataset.card) openCompModal(slot, btn.dataset.card, { card: true, title: shortName((FY.find(x => x.id === slot) || {}).name || slot) });
      else if (btn.dataset.gsize) openCompModal(slot, 'weapon', { gunSize: parseInt(btn.dataset.gsize, 10), title: '↳ 무기' });
      else {
        const h = (FY || []).find(x => x.id === slot);
        openCompModal(slot, slotKind(h), { title: shortName(h.name) });
      }
    });
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
  const rawCur = (h.id in build) ? build[h.id] : (h.component ? matchDefault(kind, h.component) : '');
  const selObj = rawCur ? (opts.find(c => c.class === rawCur) || null) : null;
  return `<div class="slot" title="${title}"><div class="meta"><span class="sz">S${h.maxSize}</span><b>${shortName(h.name)}</b>${defName ? '<br>기본: ' + defName : ''}</div>
  <button class="comp-btn" data-cslot="${h.id}">${selObj ? compShort(kind, selObj) : `— 미장착 (${opts.length}) — 선택`}</button></div>`;
}

function normCls(s) {
  // ship slots carry lowercase scKeys with occasional _gs_ infix
  // (aegs_hammerhead_gs_scitem_...) vs DB class (AEGS_Hammerhead_SCItem_...)
  return (s || '').toLowerCase().replace(/_gs_/g, '_');
}
function findTurret(scKey, name) {
  const pool = DB.turrets || [];
  if (scKey) {
    let hit = pool.find(c => (c.class || '').toLowerCase() === String(scKey).toLowerCase());
    if (hit) return hit;
    const n = normCls(scKey);
    hit = pool.find(c => normCls(c.class) === n);
    if (hit) return hit;
  }
  if (name) {
    const hit = pool.find(c => (c.name || '') === name);
    if (hit) return hit;
  }
  return null;
}
function turretCompat(h) {
  // 이 포트에 달리는 카드만: 순정 turretClass + 호환 childGuns[].class.
  // 게임 파일 체인에서 추출 (enrich_turret_slots.py). 정보 없으면 null = 구동작.
  const tc = h.turretClass || null;
  const kids = h.childGuns || [];
  if (!tc && !kids.length) return null;
  const set = new Set();
  if (tc) set.add(String(tc).toLowerCase());
  for (const k of kids) if (k.class) set.add(String(k.class).toLowerCase());
  return set;
}
function compatCards(h, cardKind) {
  // 포트 호환 카드만 좁힌다. 없으면 null (호출자가 구동작 유지).
  const set = turretCompat(h);
  if (!set) return null;
  const pool = DB.turrets || [];
  const sameSize = pool.filter(c => c.size === h.maxSize);
  const hit = sameSize.filter(c => set.has(String(c.class).toLowerCase()));
  if (!hit.length) return null;
  return hit.sort((a, b) => {
    const aStock = a.class && h.turretClass &&
      String(a.class).toLowerCase() === String(h.turretClass).toLowerCase() ? 0 : 1;
    const bStock = b.class && h.turretClass &&
      String(b.class).toLowerCase() === String(h.turretClass).toLowerCase() ? 0 : 1;
    return (aStock - bStock) || ((a.name || '').localeCompare(b.name || ''));
  });
}
function parseGuns(g) {
  // 'S4 + S4 + S4 + S4' -> [4,4,4,4]
  return (String(g || '').match(/S(\d+)/g) || []).map(x => parseInt(x.slice(1), 10));
}
function isGimbalCard(c) {
  // VariPuck 계열 + Gilroy 짐벌: 3.23+ 동일 사이즈 규칙 적용 대상
  const cls = c.class || '', nm = c.name || '';
  return cls.startsWith('Mount_Gimbal_') || /varipuck|gimbal/i.test(nm);
}
function cardGuns(card) {
  // 짐벌: S(n) 카드 → S(n) 무기, 하위 호환 (optionsFor가 동일 사이즈 우선·하위 사이즈 뒤로 정렬)
  // 고정 마운트·터렛: DB guns 그대로 (멀티건 레이아웃 유지)
  if (isGimbalCard(card)) return [card.size];
  return parseGuns(card.guns);
}
function matchDefault(kind, comp) {
  // try to preselect stock component if in DB
  comp = comp || {};
  if (kind === 'mount' || kind === 'turret' || kind === 'turretbase') {
    const hit = findTurret(comp.scKey, comp.name);
    return hit ? hit.class : '';
  }
  const pool = { weapon: DB.weapons, shield: DB.shields, power: DB.powerplants, cooler: DB.coolers, qd: DB.qds, radar: DB.radars || [] }[kind] || [];
  const hit = pool.find(c => c.class === comp.scKey || c.name === comp.name);
  return hit ? hit.class : '';
}

function findComp(kind, cls) {
  const pool = { weapon: DB.weapons, turret: DB.turrets, turretbase: DB.turrets, mount: DB.turrets, shield: DB.shields, power: DB.powerplants, cooler: DB.coolers, qd: DB.qds, missile: DB.racks, radar: DB.radars || [] }[kind] || [];
  return pool.find(c => c.class === cls);
}
// 동사이즈 대표 미사일 (2026-11-01): 최고 damage 1종. 랙 합산 추정치용.
function bestMissile(size) {
  const list = (DB.missiles || []).filter(m => m.size === size);
  if (!list.length) return null;
  return list.reduce((a, b) => ((b.damage || 0) > (a.damage || 0) ? b : a));
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
  const poolItems = []; // 에너지 무기 풀 스케일 대상 {c, sus, ratio}
  const perGroup = {};
  for (const g of PWR_GROUPS) perGroup[g.id] = { power: 0, heat: 0, units: 0, maxUnits: 0 };
  const items = [];
  const coolerList = [];
  const effVal = (h, kind) => ((h.id in build) ? build[h.id] : (h.component ? matchDefault(kind, h.component) : ''));
  const pushWeaponSub = (slotId, cls) => {
    if (!cls) return;
    const c = findComp('weapon', cls);
    if (!c) return;
    const grp = kindToGroup('weapon');
    if (pwr.grpOff[grp]) return;
    const real = c.pw != null;
    const pwRaw = real ? c.pw : (c.power || 0);
    const maxU = Math.max(1, Math.ceil(pwRaw));
    items.push({ slotId, c, kind: 'weapon', grp, maxU, real, pwRaw });
  };
  for (const h of (FY || [])) {
    const kind = slotKind(h);
    if (!kind || kind === 'engine') continue; // 추진부 고정 슬롯은 전력 집계 제외
    if (kind === 'mount' || kind === 'turret') {
      // 카드 구조물 자체는 전력 없음 — 하위 무기만 집계
      const cardCls = effVal(h, kind);
      let selObj = cardCls ? (((DB.turrets || []).find(c => c.class === cardCls)) || null) : findTurret((h.component || {}).scKey, (h.component || {}).name);
      if (cardCls && !selObj) selObj = null;
      if ((h.id in build) && !build[h.id]) selObj = null;
      if (selObj && (selObj.guns || isGimbalCard(selObj))) {
        cardGuns(selObj).forEach((gs, i) => pushWeaponSub(h.id + ':w' + i, (h.id + ':w' + i in build) ? build[h.id + ':w' + i] : stockGunFor(h.id + ':w' + i)));
      } else if (!selObj && h.childGuns && h.childGuns.length) {
        h.childGuns.filter(g => g.max > 0).forEach((g, i) => pushWeaponSub(h.id + ':w' + i, (h.id + ':w' + i in build) ? build[h.id + ':w' + i] : stockGunFor(h.id + ':w' + i)));
      }
      continue;
    }
    const val = effVal(h, kind);
    if (!val) continue;
    const c = findComp(kind, val);
    if (!c) continue;
    if (kind === 'power') {
      // 실제 발전핍(pwGen=SPowerSegmentResourceUnit.units). 없으면 구형 추정치.
      s.output += (c.pwGen != null ? c.pwGen : (c.output || 0));
      s.ppPips = (s.ppPips || 0) + (c.pwGen != null ? c.pwGen : (c.output || 0));
      continue;
    }
    // 미사일 랙 합산 (Erkul fn() 대응 2026-11-01): capacity × 동사이즈 대표 미사일.
    // 랙에 개별 미사일 장착 UI가 없으므로 동일 S 최고 damage 미사일로 추정치 계산.
    if (kind === 'missile') {
      const cap = c.capacity || c.missiles || 0;
      const rep = bestMissile(c.msize);
      const dmg = rep ? (rep.damage || 0) : 0;
      s.mslCount = (s.mslCount || 0) + cap;
      s.mslDmg = (s.mslDmg || 0) + dmg * cap;
      if (rep) {
        const key = rep.seeker || '미사일';
        s.mslBy = s.mslBy || {};
        s.mslBy[key] = (s.mslBy[key] || 0) + dmg * cap;
        if (!s.mslRep || dmg > (s.mslRep.damage || 0)) s.mslRep = rep;
      }
      continue;
    }
    if (NO_POWER_KINDS.has(kind)) continue; // 미사일 등: 전력 배분 대상 아님 (핍·열·추정 모두 제외)
    const grp = kindToGroup(kind);
    if (pwr.grpOff[grp]) continue; // 그룹 전체 OFF (Erkul powerToggle)
    // 핍 = 실제 게임값 pw(SPowerSegmentResourceUnit.units).
    // 없을 때만 PowerDraw 기반 추정치로 폴백하고 real=false 로 표시한다.
    const real = c.pw != null;
    const pwRaw = real ? c.pw : (c.power || 0);
    const maxU = Math.max(1, Math.ceil(pwRaw));
    items.push({ slotId: h.id, c, kind, grp, maxU, real, pwRaw });
  }
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
    const slotId = it.slotId;
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
      // Erkul 풀 분리 (2026-11-01): 계통핍 ratio = 전력 on/off, poolRatio = 무기 출력.
      //   탄도: 풀 영향 없음 (burst 그대로). 에너지: sustain × poolRatio.
      //   En() 재계산: ammo=round(capAmmo*poolRatio), regen=capRegen*poolRatio.
      //   Ln(): poolSize=함선 풀 상한(-1=무제한), selected=poolSel(기본 풀사이즈),
      //         consumption=Σ무기소모(pw), poolRatio=min(1,selected/consumption).
      const c = it.c;
      const ratio = it.maxU > 0 ? units / it.maxU : 1;
      const isEnergy = (c.dmgtype || []).includes('Energy');
      s.dpsBurst = (s.dpsBurst || 0) + (c.dps || 0) * ratio;
      s.alpha += (c.alpha || 0) * ratio; s.guns++;
      s.wregen += (c.regen || 0) * ratio;
      guns.push(c);
      // 에너지 무기의 타입별 DPS는 2차 패스에서 sustain 비례로 넣는다 (1차 skip).
      if (!isEnergy) {
        for (const [k, v] of Object.entries(c.dpsRaw || {})) typeDps[k] = (typeDps[k] || 0) + v * ratio;
      }
      // 에너지 무기는 풀 스케일 대상 → 2차 패스에서 poolRatio 확정 후 적용.
      if (isEnergy) {
        let sus = null;
        if (c.sustain != null) sus = c.sustain;
        poolItems.push({ c, sus, ratio });
        if (sus != null || (c.capAmmo || 0) > 0) s.hasSustain = true;
      } else {
        s.dps += (c.dps || 0) * ratio;
      }
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
    if (it.kind === 'qd') { s.qdspeed = Math.max(s.qdspeed, it.c.speed || 0); if (!s.qd || (it.c.speed || 0) > (s.qd.speed || 0)) s.qd = it.c; }
  } // end for (FY slots)
  // ---- 2차 패스: Erkul Ln() 무기 풀 (2026-11-01) ----
  // poolSize = 함선 PowerPools.WeaponGun.Size (-1=무제한, null=정보없음→풀없음).
  // consumption = Σ장착 에너지무기 pw(계통핍 배분 후 실소모).
  // selected = poolSel(사용자 선택, 기본 poolSize) → poolRatio=min(1,selected/consumption).
  // 에너지 sustain에만 × poolRatio. 탄도는 이미 1차에서 burst 그대로 합산됨.
  {
    const ship = (DB.ships || []).find(x => (x.slug === curShip || x.class === curShip)) || {};
    const poolSize = ship.wpool;
    let consumption = 0;
    for (const p of poolItems) consumption += (p.c.pw != null ? p.c.pw : (p.c.power || 0)) * p.ratio;
    const unlimited = poolSize === -1;
    const hasPool = poolSize != null && (unlimited || poolSize > 0);
    const selected = hasPool
      ? (unlimited ? consumption : Math.min(poolSize, pwr.poolSel != null ? pwr.poolSel : poolSize))
      : consumption;
    const poolRatio = !hasPool ? 1 : (consumption > 0 ? Math.min(1, selected / consumption) : 1);
    s.pool = hasPool
      ? { size: unlimited ? -1 : poolSize, selected, consumption, ratio: poolRatio }
      : null;
    for (const p of poolItems) {
      const c = p.c;
      let sus = p.sus;
      // sustain 게임값이 없으면 En() 재계산 (capAmmo 경로).
      if (sus == null && (c.capAmmo || 0) > 0 && (c.capRegen || 0) > 0 && (c.rpm || 0) > 0) {
        const pr = hasPool ? poolRatio : 1;
        const ammo = Math.round((c.capAmmo || 0) * pr);
        const regen = (c.capRegen || 0) * pr;
        const cd = c.capCooldown || 0;
        const rateHz = (c.rpm || 0) / 60;
        if (ammo > 0 && regen > 0 && rateHz > 0) {
          sus = ammo * (c.alpha || 0) / ((cd + ammo / regen) + ammo / rateHz);
        }
      }
      const base = sus != null ? sus : (c.dps || 0);
      // 1차에서 계통핍 ratio 이미 반영 → 풀은 poolRatio만 곱한다.
      // sustain 게임값은 풀 100% 기준이므로 En()처럼 poolRatio 스케일 적용.
      const scaled = hasPool ? base * (sus != null ? poolRatio : 1) : base;
      s.dps += scaled * p.ratio;
      // 타입별 DPS: 1차에서 skip했으므로 sustain 비례로 전량 반영.
      {
        const val = scaled * p.ratio;
        const tot = Object.values(c.dpsRaw || {}).reduce((a, b) => a + b, 0);
        if (tot > 0) {
          for (const [k, v] of Object.entries(c.dpsRaw || {})) typeDps[k] = (typeDps[k] || 0) + val * v / tot;
        } else if (val > 0) {
          typeDps['Energy'] = (typeDps['Energy'] || 0) + val;
        }
      }
    }
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
  // 빈 계통(maxU=0)은 컬럼 자체를 숨긴다 — 아이콘 자리 차지 방지.
  const famCols = PWR_GROUPS.filter(g => g.id !== 'coolers').filter(g => (f.perGroup[g.id].maxUnits || 0) > 0).map(g => {
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

  // 무기 풀 컬럼 (Erkul Ln/U): 에너지 무기가 있을 때만 표시.
  // 칸 클릭 = 풀에 k핍 배분 (poolSel), 풀 상한 = 함선 PowerPools.WeaponGun.Size.
  const poolCol = (() => {
    const pool = f.pool;
    if (!pool || pool.size == null) return '';
    if (pool.size === -1) return ''; // 무제한 풀은 컬럼 불필요
    const maxU = pool.size;
    const units = Math.round(pool.selected);
    const blocks = pipCells(maxU, units, '');
    const num = `<div class="pip-num">${units}</div>`;
    const pct = pool.consumption > 0 ? Math.round(pool.ratio * 100) : 100;
    const tip = `무기 풀: 에너지 무기 출력 비율 ${pct}% (선택 ${units}/${maxU}핍). 칸 클릭=그 칸까지 배분, 아이콘=풀 최대치로 복원`;
    return `<div class="pwr-col" data-grp="__pool" title="${tip}">`
      + `<div class="pips">${num}${blocks}</div>`
      + `<div class="pwr-ico" data-ico="__pool">🔋</div>`
      + `<div class="pwr-w">${pct}%</div></div>`;
  })();

  $('pwrBlocks').innerHTML = famCols + poolCol + coolerCols;
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
      if (grp === '__pool') { // 무기 풀 컬럼: Erkul U()/Ln()
        const pool = fitStats().pool;
        if (!pool || pool.size == null || pool.size === -1) return;
        if (e.target.closest('.pwr-ico')) pwr.poolSel = null; // 아이콘 = 풀 최대치로 복원
        else if (!isNaN(k)) {
          const cur = Math.round(pool.selected);
          pwr.poolSel = (cur === k) ? Math.max(0, k - 1) : Math.max(0, Math.min(pool.size, k));
        } else return;
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

function qdLine(f) {
  // 양자 항행 (Erkul kn/cr 대응 2026-11-01): 장착 QD 스펙 + 함선 QuantumTravel.
  // 10Gm 이동시간(t10gm 우선, 없으면 driveSpeed 추정) + PO→ArcCorp 왕복 기준.
  const qd = f.qd || null;
  const ship = (DB.ships || []).find(x => (x.slug === curShip || x.class === curShip)) || {};
  const qt = ship.qt || null;
  if (!qd && !qt) return { v: '—', k: '양자항행 (QD 미장착)' };
  const spd = qd ? (qd.driveSpeed || qd.speed || 0) : 0;
  // 10Gm(=1e10m) 이동시간: 게임값 우선
  let t10 = qd && qd.t10gm != null ? qd.t10gm : (spd > 0 ? 1e10 / spd : null);
  const fuelReq = qd && qd.fuelReq != null ? qd.fuelReq : null; // SCU/Gm
  const spool = qd && qd.spool != null ? qd.spool : (qd && qd.cdSpool != null ? qd.cdSpool : null);
  const v = t10 != null ? `${Math.round(t10)}s/10Gm` : '—';
  const parts = [];
  if (spool != null) parts.push(`스풀 ${spool}s`);
  if (fuelReq != null) parts.push(`${fuelReq} SCU/Gm`);
  if (qt && qt.PortOlisarToArcCorpTime) parts.push(`PO→Arc ${qt.PortOlisarToArcCorpTime}s`);
  return { v, k: parts.length ? '양자항행 · ' + parts.join(' · ') : '양자항행' };
}

function renderMissiles(f) {
  // 미사일 합산 (Erkul fn() 대응 2026-11-01): 랙 capacity × 동사이즈 대표 미사일 추정치.
  // seeker/lockTime/speed/rangeMax는 대표 미사일(최고 damage) 기준.
  const el = $('mslPanel');
  if (!el) return;
  if (!f.mslCount) { el.innerHTML = '<div style="font-size:12px;color:var(--dim)">미사일 랙 없음</div>'; return; }
  const r = f.mslRep || {};
  const by = Object.entries(f.mslBy || {}).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ');
  el.innerHTML = `<div class="stat"><div class="v">${fmt(f.mslDmg)}</div>`
    + `<div class="k">미사일 총 피해 (추정 · ${f.mslCount}발)</div>`
    + `<div class="k" style="margin-top:2px">${by || '—'}</div></div>`
    + (r && r.name ? `<div style="font-size:11px;color:var(--dim);margin-top:6px;grid-column:1/-1">`
      + `대표: ${r.name} · 락 ${r.lockTime != null ? r.lockTime + 's' : '—'}`
      + ` · 속도 ${r.speed ? fmt(r.speed) + 'm/s' : '—'}`
      + ` · 사거리 ${r.rangeMax ? fmt(r.rangeMax) + 'm' : '—'}</div>` : '');
}

function updateStats() {
  const f = fitStats();
  renderPwrBlocks();
  renderShieldTank(f);
  renderMissiles(f);
  const typeLine = ['Energy', 'Physical', 'Distortion'].filter(t => f.typeDps[t] > 0)
    .map(t => `${t.slice(0, 4)} ${fmt(f.typeDps[t])}`).join(' · ') || '—';
  // 가용 = 발전핍(스로틀 없음). 부족분 있으면 경고.
  const pct = f.avail > 0 ? Math.min(100, f.power / f.avail * 100) : 0;
  const pcls = f.short > 0 ? 'bad' : pct > 85 ? 'warn' : 'ok';
  const hpct = f.cooling > 0 ? Math.min(100, f.heat / f.cooling * 100) : 0;
  const hcls = f.cooling === 0 ? '' : hpct > 100 ? 'bad' : hpct > 85 ? 'warn' : 'ok';
  $('stats').innerHTML = `
    <div class="stat"><div class="v">${fmt(f.dps)}</div><div class="k">${f.hasSustain ? '지속 DPS · 버스트 ' + fmt(f.dpsBurst || 0) : '총 DPS'} · α ${fmt(f.alpha)} (${f.guns.length}문)</div><div class="k" style="margin-top:2px">${typeLine}</div></div>
    <div class="stat"><div class="v">${fmt(f.power)} / ${fmt(f.avail)}</div><div class="k">전력 소모 / 가용 핍 (발전 ${fmt(f.output)}핍)</div></div>
    <div class="stat"><div class="v">${fmt(f.heat)} / ${fmt(f.cooling)}</div><div class="k">열 부하 / 냉각</div></div>
    <div class="stat"><div class="v">${fmt(f.hp)}</div><div class="k">실드 HP 합계</div></div>
    <div class="stat"><div class="v">${fmt(f.regen)}/s</div><div class="k">실드 재생/s</div></div>
    <div class="stat"><div class="v">${f.qdspeed ? (f.qdspeed / 299792458 * 100).toFixed(1) + '% c' : '—'}</div><div class="k">양자항행 속도</div></div>
    <div class="stat"><div class="v">${qdLine(f).v}</div><div class="k">${qdLine(f).k}</div></div>`;
  $('powerBar').innerHTML = (f.avail > 0
    ? `<div style="font-size:12px" class="${pcls}">전력 사용률 ${pct.toFixed(0)}% ${f.short > 0 ? `⚠️ ${fmt(f.short)}핍 부족 — 핍 블럭을 끄세요` : ''}</div><div class="bar"><i style="width:${Math.min(100, pct)}%;background:${f.short > 0 ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--ok)'}"></i></div>`
    : '<div style="font-size:12px;color:var(--dim)">파워플랜트를 장착하세요</div>')
    + (f.cooling > 0
    ? `<div style="font-size:12px;margin-top:6px" class="${hcls}">열 부하율 ${hpct.toFixed(0)}% ${hpct > 100 ? '⚠️ 과열! 쿨러 부족' : ''}</div><div class="bar"><i style="width:${Math.min(100, hpct)}%;background:${hpct > 100 ? 'var(--bad)' : hpct > 85 ? 'var(--warn)' : 'var(--ok)'}"></i></div>`
    : '<div style="font-size:12px;color:var(--dim);margin-top:6px">쿨러를 장착하세요</div>');
}

function saveBuild() {
  const ship = curShip || $('shipSel').value;
  const data = { ship, build, pwr: { segOff: pwr.segOff, grpOff: pwr.grpOff, coolerSegs: pwr.coolerSegs, coolerOff: pwr.coolerOff, poolSel: pwr.poolSel }, savedAt: new Date().toISOString() };
  localStorage.setItem('scfit:' + ship, JSON.stringify(data));
  $('saveStatus').textContent = `저장됨 — ${ship} (${Object.keys(build).filter(k => build[k]).length}개 슬롯)`;
}
function loadBuild() {
  const ship = curShip || $('shipSel').value;
  const raw = localStorage.getItem('scfit:' + ship);
  if (!raw) { $('saveStatus').textContent = '저장된 빌드 없음'; return; }
  const saved = JSON.parse(raw);
  build = saved.build || {};
  renderSlots(); // 카드 확정 후 하위 무기 슬롯 재생성 (reapply에서 값 일괄 반영)
  if (saved.pwr) {
    // 구버전 저장본의 throttle/triW/S/E 키는 무시된다 (해당 UI 제거됨).
    Object.assign(pwr, saved.pwr);
    pwr.segOff = pwr.segOff || {}; pwr.grpOff = pwr.grpOff || {};
    pwr.coolerSegs = pwr.coolerSegs || {}; pwr.coolerOff = pwr.coolerOff || {};
  }
  renderSlots();
  updateStats();
  $('saveStatus').textContent = '불러옴 — ' + ship;
}
function resetBuild() {
  build = {};
  pwr = { segOff: {}, grpOff: {}, coolerSegs: {}, coolerOff: {}, poolSel: null };
  renderSlots(); updateStats();
}

init();
