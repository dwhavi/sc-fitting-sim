"""Enrich public/db.json with power/heat accuracy fields from data/items.json.

Idempotent: safe to re-run (raw dump is source of truth, values overwritten).
Backup: public/db.json.bak created once if absent.

Adds (on-disk build_db.py is stale and does not emit these):
  - heat (ThermalEnergyDraw) + powerBase (PowerConnection.PowerBase) for every
    category entry (weapons/shields/powerplants/coolers/qds/racks/turrets)
  - radars array (Radar type, test/placeholder excluded)
  - shields: downedDelay / damagedDelay / absorption
  - turrets: grade (when present in raw)
Already present in db.json, untouched: weapon regen/costPerShot/cooldown/
ammoLoad/family, dps/alpha, cooler rate, PP output.
"""
import json
import os

BASE = 'public/db.json'
RAW = 'data/items.json'

db = json.load(open(BASE))
if not os.path.exists(BASE + '.bak'):
    json.dump(db, open(BASE + '.bak', 'w'))
    print('backup ->', BASE + '.bak')

items = json.load(open(RAW))
by_cn = {x['className']: x for x in items}


def heat_of(x):
    return ((x.get('stdItem', {}) or {}).get('HeatConnection') or {}).get('ThermalEnergyDraw')


def pbase_of(x):
    return ((x.get('stdItem', {}) or {}).get('PowerConnection') or {}).get('PowerBase')


def mfr_of(si):
    m = si.get('Manufacturer')
    if isinstance(m, dict):
        return m.get('Name', '')
    return m or ''


def enrich_list(arr, label):
    n = 0
    for e in arr:
        x = by_cn.get(e.get('class'))
        if not x:
            continue
        h = heat_of(x)
        if h is not None:
            e['heat'] = h
            n += 1
        pb = pbase_of(x)
        if pb is not None:
            e['powerBase'] = pb
        g = x.get('grade')
        if g is not None and 'grade' not in e:
            e['grade'] = g
    print(f'{label}: heat/powerBase set on {n}/{len(arr)}')


for key in ['weapons', 'shields', 'powerplants', 'coolers', 'qds', 'racks', 'turrets', 'missiles']:
    if key in db:
        enrich_list(db[key], key)

# --- shields: delays + absorption ---
n_sh = 0
for e in db.get('shields', []):
    x = by_cn.get(e.get('class'))
    if not x:
        continue
    s = (x.get('stdItem', {}) or {}).get('Shield', {}) or {}
    if s.get('DownedDelay') is not None:
        e['downedDelay'] = s.get('DownedDelay')
    if s.get('DamagedDelay') is not None:
        e['damagedDelay'] = s.get('DamagedDelay')
    if s.get('Absorption') is not None:
        e['absorption'] = s.get('Absorption')
    n_sh += 1
print(f'shields: delays/absorption set on {n_sh}')

# --- radars (new array) ---
def is_test(cn):
    cn = cn.lower()
    return 'test_' in cn or cn.startswith('test') or 'placeholder' in cn or 'vanduul' in cn


radars = []
for x in items:
    if x.get('type') != 'Radar':
        continue
    if is_test(x.get('className', '')):
        continue
    si = x.get('stdItem', {}) or {}
    radars.append({
        'class': x['className'],
        'name': si.get('Name') or x['className'],
        'size': x.get('size'),
        'grade': x.get('grade'),
        'mfr': mfr_of(si),
        'power': ((si.get('PowerConnection') or {}).get('PowerDraw') or 0),
        'powerBase': ((si.get('PowerConnection') or {}).get('PowerBase')),
        'heat': ((si.get('HeatConnection') or {}).get('ThermalEnergyDraw')),
    })
radars.sort(key=lambda r: ((r['size'] or 0), r['name'] or ''))
db['radars'] = radars
db['meta']['radars'] = len(radars)
print(f'radars: {len(radars)}')

json.dump(db, open(BASE, 'w'), ensure_ascii=False)
print('wrote', BASE, '| meta:', db['meta'])
