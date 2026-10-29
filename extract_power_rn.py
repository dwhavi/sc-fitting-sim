#!/usr/bin/env python3
"""Extract real power pip units from the BULK scunpacked dump via ResourceNetwork.

Replaces fetch_power_units.py's per-item crawl (~695 HTTP requests) with a single
pass over data/raw/items.json. Validated 2026-10-29: 892/892 values identical to
the live db.json (pw / pwMinFrac / pwGen / em).

Runs standalone; -h for options. Drop into the project as fetch_power_rn.py.

    python3 extract_power_rn.py                       # uses data/raw/items.json
    python3 extract_power_rn.py --bulk data/raw/items.json --out data/power_units.json
    python3 extract_power_rn.py --verify               # compare against public/db.json

Output shape matches the existing data/power_units.json contract:
    {"units": {className: {"pw":..,"pwMinFrac":..,"pwGen":..,"em":..}}, ...}
so integrate_power.py can consume it unchanged.

Why this works (schema change, see references/scunpacked-schema-change-2026-10.md):
    PowerConnection / HeatConnection and the per-item Raw tree's
    SPowerSegmentResourceUnit were REMOVED. The same quantities now live in
    stdItem.ResourceNetwork.States[0].Deltas[], present in the bulk dump.
"""
import argparse
import io
import json
import os
import sys

TYPES = ('WeaponGun', 'Shield', 'PowerPlant', 'Cooler', 'QuantumDrive',
         'Radar', 'MissileLauncher', 'Missile', 'Turret', 'TurretBase')
DAMAGE_TYPES = ('Physical', 'Energy', 'Distortion', 'Thermal', 'Biochemical', 'Stun')


def is_test(cn):
    cn = (cn or '').lower()
    return 'test_' in cn or cn.startswith('test') or 'placeholder' in cn


def rn_power(si, damage=False):
    """stdItem -> {'pw','pwMinFrac','pwGen','em'} (+ optional damage dicts).

    Only Resource == 'Power' deltas count. A component may emit several
    (Power consumption + Coolant consumption + Power->Shield conversion);
    Conversion is how shields/coolers draw, so it maps to pw/pwMinFrac too.
    """
    si = si or {}
    R = si.get('ResourceNetwork') or {}
    st = (R.get('States') or [{}])[0]
    out = {}
    for d in (st.get('Deltas') or []):
        if (d.get('Resource') or '') != 'Power':
            continue
        t = d.get('Type')
        if t in ('Consumption', 'Conversion'):
            if d.get('Rate') is not None:
                out.setdefault('pw', d.get('Rate'))
            if d.get('MinimumFraction') is not None:
                out.setdefault('pwMinFrac', d.get('MinimumFraction'))
            if t == 'Conversion' and d.get('GeneratedRate') is not None:
                out.setdefault('gen', d.get('GeneratedRate'))
        elif t == 'Generation' and d.get('Rate') is not None:
            out.setdefault('pwGen', d.get('Rate'))

    sig = st.get('Signature') or {}
    if sig.get('EM') is not None:
        out['em'] = sig.get('EM')
    if 'em' not in out:
        mx = ((si.get('Emission') or {}).get('Em') or {}).get('Maximum')
        if mx is not None:
            out['em'] = mx

    # coolant consumption — candidate input for a rebuilt heat model
    for d in (st.get('Deltas') or []):
        if (d.get('Resource') or '') == 'Coolant' and d.get('Rate') is not None:
            out.setdefault('coolant', d.get('Rate'))
            break

    if damage:
        D = ((si.get('Weapon') or {}).get('Damage')) or {}
        if D:
            out['dpsRaw'] = {t: D['Dps'][t] for t in DAMAGE_TYPES
                             if isinstance(D.get('Dps'), dict) and D['Dps'].get(t)}
            out['alphaRaw'] = {t: D['Alpha'][t] for t in DAMAGE_TYPES
                               if isinstance(D.get('Alpha'), dict) and D['Alpha'].get(t)}
            out['dpsTotal'] = D.get('DpsTotal') or D.get('Burst')
            out['alphaTotal'] = D.get('AlphaTotal')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bulk', default='data/raw/items.json')
    ap.add_argument('--out', default='data/power_units_rn.json')
    ap.add_argument('--verify', action='store_true',
                    help='compare against public/db.json instead of writing')
    ap.add_argument('--damage', action='store_true',
                    help='also emit dpsRaw/alphaRaw per weapon')
    a = ap.parse_args()

    if not os.path.exists(a.bulk):
        sys.exit('bulk dump not found: %s  (run sync_data.py first)' % a.bulk)
    items = json.load(io.open(a.bulk, encoding='utf-8'))

    units, stats, missing = {}, {}, []
    for x in items:
        t = x.get('type')
        if t not in TYPES or is_test(x.get('className')):
            continue
        cn = x['className']
        r = rn_power(x.get('stdItem'), damage=a.damage)
        stats.setdefault(t, [0, 0])
        stats[t][1] += 1
        if r.get('pw') is not None or r.get('pwGen') is not None:
            stats[t][0] += 1
            units[cn] = r
        else:
            missing.append(cn)

    print('=== ResourceNetwork coverage (test excluded) ===')
    for t in TYPES:
        if t in stats:
            got, tot = stats[t]
            print('  %-16s %4d/%4d  %3.0f%%' % (t, got, tot, 100.0 * got / max(tot, 1)))
    print('\nunits resolved: %d | no ResourceNetwork: %d' % (len(units), len(missing)))
    if missing[:5]:
        print('  e.g.', missing[:5])

    if a.verify:
        dbp = 'public/db.json'
        if not os.path.exists(dbp):
            sys.exit('no %s to verify against' % dbp)
        db = json.load(io.open(dbp, encoding='utf-8'))
        ok = bad = nosrc = 0
        examples = []
        for key, fields in [('weapons', ('pw', 'pwMinFrac', 'em')),
                            ('shields', ('pw', 'pwMinFrac')),
                            ('coolers', ('pw', 'pwMinFrac')),
                            ('qds', ('pw', 'pwMinFrac')),
                            ('powerplants', ('pwGen',)),
                            ('radars', ('pw', 'pwMinFrac', 'em'))]:
            for e in db.get(key, []):
                r = units.get(e.get('class'))
                for f in fields:
                    if e.get(f) is None:
                        continue
                    if not r or r.get(f) is None:
                        nosrc += 1
                        continue
                    if abs(float(e[f]) - float(r[f])) < 1e-6:
                        ok += 1
                    else:
                        bad += 1
                        if len(examples) < 8:
                            examples.append((key, e['class'], f, e[f], r[f]))
        print('\n=== verify vs public/db.json ===')
        print('  match %d | MISMATCH %d | no new-dump source %d' % (ok, bad, nosrc))
        for e in examples:
            print('   %-12s %-38s %-10s db=%s rn=%s' % e)
        if bad:
            sys.exit('\nMISMATCHES — do not trust this extraction')
        return

    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    json.dump({'source': 'scunpacked-data items.json ResourceNetwork',
               'units': units, 'missing': missing, 'coverage': stats},
              io.open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nwrote %s' % a.out)


if __name__ == '__main__':
    main()
