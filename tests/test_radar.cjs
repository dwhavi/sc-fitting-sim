// node tests/test_radar.cjs. Offline optimizer regression tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'public/db.json')));
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'radar_source.json')));
for (const c of db.radars) {
  const raw = source.radars.find(x => x.className === c.class).stdItem.Radar;
  for (const k of Object.keys(c.detection)) assert.deepEqual(c.detection[k], raw[k], c.class + k);
}
const ctx = vm.createContext({console, window:{}, document:{getElementById:()=>null, readyState:'loading',addEventListener:()=>{}}, localStorage:{getItem:()=>null},
  DB:db, FY:[], curShip:'test', build:{}, pwr:{}, compShort:()=>'', updateStats:()=>{},
  fitStats:()=>({dps:100,hp:100,regen:10,short:0}),
  findComp:(kind,cls)=>db.radars.find(c=>c.class===cls)});
vm.runInContext(fs.readFileSync(path.join(root,'public/fit.js'),'utf8'),ctx);
const fit = ctx.window.SCFIT;
fit.opt.onlyBuy = false;
const keyBefore = fit.fitContextKey(); fit.opt.lock=['radar']; assert.notEqual(fit.fitContextKey(),keyBefore); fit.opt.lock=[];
const ordinary = db.radars.filter(c=>c.size===1 && c.cls && !c.radarStockOnly && !/PLACEHOLDER/.test(c.name));
const stock = ordinary.find(c=>c.name==='Observer-Lite');
let slots = [{id:'r',kind:'radar',size:1,key:'radar|1|pilot',stock:stock.class,opts:ordinary}];
const base = {r:stock.class};
const m = fit.evalAsg(slots, base, {});
const optimize = (preset='combat', extra=[]) => fit.optimize(slots,preset,{},m,base,extra);
let rank = fit.topRadars(slots[0],base);
assert.ok(rank.top.length > 1, 'No invented unique winner among equal detection radars');
assert.ok(!rank.top.some(c=>c.class===stock.class), 'Lower RS sensitivity is dominated');
let result = optimize();
assert.ok(rank.top.some(c=>c.class===result.r), 'Combat must use top detection even if EM increases');
assert.ok(rank.top.some(c=>c.class===optimize('combat',[base]).r), 'Cross-preset seeds cannot bypass top radar');
for (const preset of ['stealth','travel','tank','balanced']) {
  const r = optimize(preset);
  assert.ok(ordinary.some(c=>c.class===r.r));
}
fit.opt.lock=['radar'];
assert.equal(optimize('combat',[{r:rank.top[0].class}]).r,base.r);
assert.match(fit.radarNoteHTML(slots,base,base),/레이더 잠금 유지/);
fit.opt.lock=[]; fit.opt.pins={test:['r']};
assert.equal(optimize('combat',[{r:rank.top[0].class}]).r,base.r);
fit.opt.pins={};fit.opt.onlyBuy=true;
assert.equal(optimize().r,base.r, 'No market data: preserve current, do not invent availability');
assert.match(fit.radarNoteHTML(slots,base,base),/조건 미충족/);
fit.opt.onlyBuy=false;
const unknown=JSON.parse(JSON.stringify(ordinary[0])); delete unknown.detection;
slots=[{...slots[0],opts:[...ordinary,unknown]}];
assert.equal(optimize().r,base.r);
assert.match(fit.radarNoteHTML(slots,base,base),/최상위 판정 불가/);
// An incomparable vector is retained, not reduced to an arbitrary sum.
const a=JSON.parse(JSON.stringify(ordinary[0])), b=JSON.parse(JSON.stringify(ordinary[0]));
a.class='a';b.class='b';a.detection.Sensitivity.IR=1.1;b.detection.Sensitivity.CS=1.1;
assert.equal(fit.topRadars({...slots[0],opts:[a,b]},base).top.length,2);
// Special variant is stock-only, not a universal sensitivity upgrade.
const special=db.radars.find(c=>/_Piercing/.test(c.class));
assert.ok(special.radarStockOnly);
assert.ok(!fit.topRadars({...slots[0],opts:[...ordinary,special]},base).top.some(c=>c.class===special.class));
const own={...slots[0],stock:special.class,opts:[...ordinary,special]};
assert.ok(fit.topRadars(own,{r:special.class}).top.some(c=>c.class===special.class));
// Budget conflict must retain the detection tier, never quietly downgrade.
ctx.fetch=async()=>({json:async()=>({terms:[{sys:'Stanton'}],items:Object.fromEntries(ordinary.map(c=>[c.class,[[0,1000]]]))})});
fit.loadShops().then(()=>{
  slots=[{...slots[0],opts:ordinary}]; fit.opt.budget=1;
  const r=optimize();
  assert.ok(fit.topRadars(slots[0],base).top.some(c=>c.class===r.r));
  console.log('Impossible budget retains top radar for explicit conflict display, not a lower-tier substitute.');
}).catch(e=>{console.error(e);process.exitCode=1;});
console.log(`${db.radars.length} raw radar attribute matches; dominance/ties/incomparability, combat hard tier, locks/pins, seed normalization, missing source and availability conflicts passed.`);
