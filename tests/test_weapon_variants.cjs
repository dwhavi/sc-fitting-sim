// node tests/test_weapon_variants.cjs — 무기 중복 정리(2026-11-28) 회귀 테스트.
// 규칙: weapon_variants.py. 별칭 해석: app.js weaponByClass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'public/db.json')));
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\binit\(\);\s*$/, '');
const ctx = vm.createContext({ console, window: {}, document: { getElementById: () => null }, __db: db });
vm.runInContext(app, ctx);
vm.runInContext('DB = __db', ctx);

// 1) 모든 별칭 클래스(ac)가 대표 클래스로 해석된다 (대소문자 무시 — FY scKey 는 소문자).
let aliasCount = 0;
for (const w of db.weapons) {
  for (const a of (w.ac || [])) {
    aliasCount++;
    assert.equal(vm.runInContext(`weaponByClass(${JSON.stringify(a)})?.class`, ctx), w.class, a);
    assert.equal(vm.runInContext(`weaponByClass(${JSON.stringify(a.toLowerCase())})?.class`, ctx), w.class, a + ' lowercase');
  }
}
assert.ok(aliasCount >= 25, 'alias count regressed: ' + aliasCount);

// 2) 병합된 클래스는 무기 목록에 남아 있지 않는다.
const classes = new Set(db.weapons.map(w => w.class));
for (const w of db.weapons) for (const a of (w.ac || [])) assert.ok(!classes.has(a), 'alias still listed: ' + a);

// 3) 선택지(일반 피팅 풀)에 같은 표시명 중복이 없다.
//    '<= PLACEHOLDER =>' 5종은 소스 원명 그대로이며(중복 정리 범위 밖, 기존 동작 유지) 제외하고 검사.
for (let s = 1; s <= 12; s++) {
  const opts = db.weapons.filter(w => w.size === s && !w.specialWeapon && !/PLACEHOLDER/i.test(w.name));
  const names = opts.map(o => o.name);
  assert.equal(new Set(names).size, names.length, `picker dup at size ${s}`);
}

// 4) meta.weapons 가 실제 수와 일치한다.
assert.equal(db.meta.weapons, db.weapons.length);

console.log(`weapon variants OK: ${aliasCount} aliases resolve, no picker duplicates, meta=${db.meta.weapons}`);
