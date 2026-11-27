#!/usr/bin/env python3
"""star-citizen.wiki API -> public/personal.json (개인 화기).
필드: n 이름, m 제조사, k 분류(pistol/smg/rifle/sniper/lmg/knife/other), a 탄종(b실탄/e에너지),
sub 소스 Item Type, d 발당 피해(damage_per_shot, 샷건은 소스가 펠릿 합산), r rpm(소스 top-level),
c 탄창, mag 탄창당 피해(d*c), dpm 분당 피해(d*r, 재장전 제외 이론값), t 탄창 소진 시간(초, c/r*60).
재장전 시간은 API에 없으므로 분당 피해는 재장전 제외."""
import json, urllib.request, os
URL = "https://api.star-citizen.wiki/api/weapons?page%5Bsize%5D=100&page%5Bnumber%5D="
def fetch():
    out, n = [], 1
    while True:
        r = urllib.request.Request(URL + str(n), headers={'User-Agent': 'Mozilla/5.0'})
        d = json.load(urllib.request.urlopen(r, timeout=60))['data']
        out += d
        if len(d) < 100: return out
        n += 1
KIND = {'Pistol': 'pistol', 'SMG': 'smg', 'Assault Rifle': 'rifle', 'Rifle': 'rifle', 'Sniper Rifle': 'sniper', 'LMG': 'lmg'}
OTHER = {'Shotgun', 'HMG', 'Railgun', 'Grenade Launcher', 'Missile Launcher', 'Launcher', 'Crossbow', 'Frag Pistol'}
def build(L):
    items = []
    for x in L:
        pw = x.get('personal_weapon') or {}
        ty = pw.get('type')
        knife = x.get('classification') == 'FPS.Weapon.Knife'
        if not (knife or ty in KIND or ty in OTHER): continue
        if 'reference' in (x.get('class_name') or '').lower(): continue  # 개발용 더미(탄창 99999)
        it = {'n': x['name'], 'cn': x.get('class_name') or '', 'm': (x.get('manufacturer') or {}).get('name') or ''}
        if knife:
            it['k'] = 'knife'; items.append(it); continue
        it['k'] = KIND.get(ty, 'other'); it['a'] = {'Ballistic': 'b', 'Energy': 'e'}.get(pw.get('class'), '')
        it['sub'] = ty
        d, r, c = pw.get('damage_per_shot'), pw.get('rpm'), pw.get('magazine_size') or pw.get('capacity')
        if d: it['d'] = d
        if r: it['r'] = r
        if c: it['c'] = c
        if d and c: it['mag'] = round(d * c, 1)
        if d and r and not (c and c <= 1): it['dpm'] = round(d * r, 1)  # 탄창 1발(재장전식)은 분당 생략
        if r and c and c > 1: it['t'] = round(c / r * 60, 1)
        items.append(it)
    return items
if __name__ == '__main__':
    L = fetch()
    items = build(L)
    ver = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'public', 'personal.json')))['meta']['version']
    meta = {'source': 'star-citizen.wiki API (api.star-citizen.wiki/api/weapons)', 'version': ver, 'count': len(items)}
    json.dump({'meta': meta, 'items': items}, open(os.path.join(os.path.dirname(__file__), '..', 'public', 'personal.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(len(items))
