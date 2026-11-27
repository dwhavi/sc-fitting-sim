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
        it['k'] = KIND.get(ty, 'other'); cl = pw.get('class') or ''
        it['a'] = 'b' if cl == 'Ballistic' else ('e' if cl.startswith('Energy') or cl in ('Electron', 'Laser') else '')
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
import re, collections
def stem(cn):
    m = re.match(r'^(.*?_\d\d)(?:_|$)', cn); return m.group(1) if m else cn
def merge(items, craft):
    """닉네임·스킨 변형 병합: 제조사/분류/탄종/발당/rpm/탄창 동일 + 모델명 첫 단어 동일 + 제작 청사진 보정 동일일 때만.
    나이프는 수치가 없어 닉네임 제거 후 이름이 같은 것만 병합. '(Modified)' 표기는 병합하지 않음. 대표 = 청사진 있는 것 > 따옴표 없는 것 > 짧은 이름."""
    groups = collections.OrderedDict()
    base = lambda n: re.sub(r'\s+', ' ', re.sub(r'\s*(["\'])[^"\']*\1\s*', ' ', n)).strip()
    tok = lambda n: re.sub(r'[^a-z0-9]', '', base(n).split(' ')[0].lower())
    for it in items:
        if '(Modified)' in it['n']: key = ('solo', it['cn'])
        elif it['k'] == 'knife': key = ('knife', base(it['n']))
        else: key = (it['m'], it['k'], it.get('a'), it.get('sub'), it.get('d'), it.get('r'), it.get('c'), tok(it['n']))
        groups.setdefault(key, []).append(it)
    out, report = [], []
    for key, g in groups.items():
        crafts = {json.dumps(craft[i['cn']]['s'], sort_keys=True) for i in g if i['cn'] in craft}
        if len(crafts) > 1:  # 보정이 다르면 병합하지 않음
            for i in g: out.append(dict(i)); report.append(('craft-diff', i['n']))
            continue
        quoted = lambda n: bool(re.search(r'["\']', n))
        rep = sorted(g, key=lambda i: (i['cn'] not in craft, quoted(i['n']), len(i['n'])))[0]
        r = dict(rep)
        if quoted(r['n']):  # 대표명은 닉네임(따옴표 부분) 제거
            r['n'] = re.sub(r'\s+', ' ', re.sub(r'\s*(["\'])[^"\']*\1\s*', ' ', r['n'])).strip()
        if crafts: r['cn'] = next(i['cn'] for i in g if i['cn'] in craft)
        names = sorted(i['n'] for i in g if i is not rep)
        if names: r['vn'] = names
        out.append(r)
    return out, report
if __name__ == '__main__':
    L = fetch()
    items = build(L)
    cp = os.path.join(os.path.dirname(__file__), '..', 'public', 'crafting.json')
    craft = json.load(open(cp))['items'] if os.path.exists(cp) else {}
    raw = len(items)
    items, rep = merge(items, craft)
    print('raw', raw, 'merged', len(items), 'exceptions', rep)
    ver = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'public', 'personal.json')))['meta']['version']
    meta = {'source': 'star-citizen.wiki API (api.star-citizen.wiki/api/weapons)', 'version': ver, 'count': len(items)}
    json.dump({'meta': meta, 'items': items}, open(os.path.join(os.path.dirname(__file__), '..', 'public', 'personal.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(len(items))
