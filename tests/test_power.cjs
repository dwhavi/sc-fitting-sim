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
function stats(ship, state = {}) {
  ctx.__ship = ship.slug;
  ctx.__slots = slots.filter(s=>s.slug===ship.slug).map(s=>s.port);
  ctx.__state = state;
  return vm.runInContext(`curShip=__ship; FY=__slots; build={};
    pwr=Object.assign({segOff:{},grpOff:{},coolerSegs:{},coolerOff:{},poolSel:null},__state);
    fitStats()`,ctx);
}
let matched=0;
for (const ship of db.ships) {
  const s=stats(ship);
  assert.ok(Number.isFinite(s.dps)&&Number.isFinite(s.power),ship.name);
  if (ship.pwShields!=null&&Math.abs(ship.pwShields-s.power)<1e-6) matched++;
}
assert.ok(matched>=128,`only ${matched} source total matches`);
const marauder=db.ships.find(s=>s.class==='DRAK_Marauder');
let s=stats(marauder);
assert.equal(s.power,21); assert.equal(s.output,16); assert.equal(s.guns.length,7);
assert.equal(s.perGroup.weapon.units,4);assert.equal(s.perGroup.weapon.maxUnits,4);
assert.ok(Math.abs(s.pilotBurst-3819.2)<0.1);
s=stats(marauder,{segOff:{weapon:2}});
assert.equal(s.perGroup.weapon.units,2);assert.ok(Math.abs(s.pilotBurst-1909.6)<0.1);
s=stats(marauder,{grpOff:{weapon:true}});
assert.equal(s.perGroup.weapon.units,0);assert.equal(s.perGroup.weapon.maxUnits,4);
console.log(`${db.ships.length} ships finite; ${matched} exact stock total power matches; Marauder shared pool, partial power and OFF passed.`);
