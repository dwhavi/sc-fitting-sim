// node tests/test_power.cjs, no dependencies or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'public/db.json')));
const slots = JSON.parse(fs.readFileSync(path.join(root, 'public/ship_slots.json'))).slots;
const ctx = vm.createContext({console, window:{}, document:{getElementById:()=>null}, __db:db});
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\binit\(\);\s*$/, '');
vm.runInContext(app, ctx);
vm.runInContext('DB = __db', ctx);
function stats(ship, state = {}, build = {}) {
  ctx.__ship = ship.slug;
  ctx.__slots = slots.filter(s=>s.slug===ship.slug).map(s=>s.port);
  ctx.__state = state; ctx.__build = build;
  return vm.runInContext(`curShip=__ship; FY=__slots; build=__build;
    pwr=Object.assign({segOff:{},grpOff:{},coolerSegs:{},coolerOff:{},poolSel:null},__state);
    fitStats()`,ctx);
}
const ship = klass => db.ships.find(s=>s.class===klass);
const near = (a,b,t=1e-6) => assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
let matched=0, gen=0, burst=0;
const residual=[];
for (const hull of db.ships) {
  const s=stats(hull);
  for(const field of ['dps','power','output','regen','cooling']) assert.ok(Number.isFinite(s[field]),hull.name+field);
  if (hull.pwShields!=null&&Math.abs(hull.pwShields-s.power)<1e-6) matched++;
  else {
    residual.push(hull.class);
    // The extractor's vehicle aggregate omits its installed shield draw.
    near(s.power-hull.pwShields,s.perGroup.shield.power);
    assert.equal(hull.spool,-1);
  }
  if(s.output===hull.stockGen)gen++;
  near(s.dpsBurst||0,(hull.stockDps||0)+(hull.turretDps||0));burst++;
}
assert.equal(burst,144);assert.equal(matched,133); assert.equal(gen,144); assert.equal(residual.length,11);
const marauder=ship('DRAK_Marauder');
let s=stats(marauder);
assert.equal(s.power,21); assert.equal(s.output,16); assert.equal(s.guns.length,7);
assert.equal(s.perGroup.weapon.units,4);assert.equal(s.perGroup.weapon.maxUnits,4);
near(s.pilotBurst,3819.2,.1);near(s.dps,1428.6317506342875);
assert.equal(s.weaponCycles[0].ammo,43);
near(s.weaponCycles[0].fire,3.44);
near(s.weaponCycles[0].refill,5.756666666666667);
const full=s;
s=stats(marauder,{segOff:{weapon:2}});
assert.equal(s.perGroup.weapon.units,2);near(s.pilotBurst,full.pilotBurst);
assert.ok(s.dps<full.dps&&s.dps>0); assert.equal(s.power,19);
const partial=s;
s=stats(marauder,{poolSel:2});near(s.dps,partial.dps);near(s.power,partial.power);
s=stats(marauder,{poolSel:0});assert.equal(s.dps,0);assert.equal(s.dpsBurst,0);assert.equal(s.power,17);
s=stats(marauder,{grpOff:{weapon:true}});assert.equal(s.dps,0);
assert.equal(s.perGroup.weapon.units,0);assert.equal(s.perGroup.weapon.maxUnits,4);
// No stale pool slider may stop a later pip click increasing allocation.
stats(marauder,{poolSel:1});vm.runInContext('setGroupUnits("weapon",4)',ctx);
near(vm.runInContext('fitStats().pool.selected',ctx),4);
// Missing stock equipment and nested wing chains.
s=stats(ship('AEGS_Javelin'));assert.equal(s.guns.length,22);
s=stats(ship('AEGS_Vanguard_Harbinger'));assert.equal(s.guns.length,7);
s=stats(ship('AEGS_Hammerhead'));assert.equal(s.guns.length,24);
s=stats(ship('AEGS_Retaliator'));assert.equal(s.guns.length,10);
s=stats(ship('BANU_Defender'));near(s.power,26);near(s.hp,7680);near(s.regen,1459);
s=stats(ship('KRIG_P52_Merlin'));assert.equal(s.guns.length,3);near(s.power,15);
s=stats(ship('KRIG_P72_Archimedes'));assert.equal(s.guns.length,4);near(s.power,16.8);
s=stats(ship('ANVL_Valkyrie'));assert.equal(s.guns.length,10);near(s.power,36);near(s.pilotBurst,2727,.2);
s=stats(ship('DRAK_Cutlass_Steel'));assert.equal(s.guns.length,13);near(s.power,32.9);near(s.pilotBurst,3454,.2);
const card=slots.find(s=>s.class==='DRAK_Marauder'&&s.port.childGuns?.length).port;
s=stats(marauder,{}, {[card.id]:''});assert.equal(s.guns.length,6);
// Partial shield power affects regeneration, not the installed HP pool.
const defender=ship('BANU_Defender');const shieldFull=stats(defender);
s=stats(defender,{segOff:{shield:3}});near(s.hp,shieldFull.hp);near(s.regen,1459*.25*.7);
s=stats(defender,{segOff:{shield:4}});assert.equal(s.regen,0);
s=stats(defender,{grpOff:{shield:true}});assert.equal(s.hp,0);assert.equal(s.regen,0);
// Extra installed shields contribute reserve HP but not extra active regen.
const valk=stats(ship('ANVL_Valkyrie'));const valkShields=slots.filter(s=>s.class==='ANVL_Valkyrie'&&s.port.category==='shieldgenerator');
assert.equal(valkShields.length,4);
const shield=db.shields.find(s=>s.class.toLowerCase()===valkShields[0].port.component.scKey);
near(valk.regen,2*shield.regen);
// Verify every capacitor-bearing weapon over a power-ratio grid.
let cycles=0;
for(const c of db.weapons.filter(c=>c.capAmmo>0&&c.capRegen>0&&c.rpm>0)){
  let previous=0;ctx.__weapon=c;
  for(const ratio of [0,.1,.25,.5,.75,1]){
    ctx.__ratio=ratio;const out=vm.runInContext('capacitorCycle(__weapon,__ratio)',ctx);
    assert.ok(Number.isFinite(out.dps)&&out.dps>=previous-1e-8,c.class);
    assert.ok(out.dps<=c.dps+1,c.class);previous=out.dps;cycles++;
  }
}
console.log(`${db.ships.length} finite fits, ${matched} source power matches, ${gen} generation matches, ${cycles} capacitor cases; partial/OFF, shield regen, slot repairs passed.`);
