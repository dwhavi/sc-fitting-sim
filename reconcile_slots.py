#!/usr/bin/env python3
"""Refresh existing slot defaults from the same pinned LIVE snapshot as db.json.

Keeps FleetYards IDs (saved-build keys) and categories. Match a complete loadout
path first, then a unique hardpoint name/suffix. Ambiguous names are never guessed.
"""
import json
from pathlib import Path
from enrich_turret_slots import norm_name
ROOT = Path(__file__).resolve().parent

def indexes(entries):
    paths, names = {}, {}
    def walk(es, parents=()):
        for e in es or []:
            name = e.get('HardpointName') or ''
            path = parents + (name,)
            paths[norm_name(''.join(path))] = e
            names.setdefault(norm_name(name), []).append(e)
            walk(e.get('Loadout'), path)
    walk(entries)
    return paths, names

def main():
    raw = ROOT / 'data/raw'
    meta = json.loads((raw / '.sync_meta.json').read_text())
    if not meta.get('complete') or '-LIVE.' not in meta.get('version', ''):
        raise SystemExit('Requires a verified LIVE snapshot')
    slots_path = ROOT / 'public/ship_slots.json'
    slots = json.loads(slots_path.read_text())
    ix = {c: indexes(json.loads((raw / 'ships' / f).read_text()).get('Loadout'))
          for c, f in meta['class_to_file'].items()}
    changed = []
    for slot in slots['slots']:
        p = slot['port']
        if p.get('source') != 'game_files' or slot['class'] not in ix:
            continue
        # Do not rewrite unrelated rooms, seats, doors, fuel or control objects.
        if p.get('category') not in ('weapon_mounts', 'weapons', 'turret', 'missile_racks',
                                    'shieldgenerator', 'powerplant', 'cooler',
                                    'quantumdrive', 'radar', 'lifesupport'):
            continue
        # Existing rack defaults are intentionally preserved (missile estimates
        # have separate semantics); fill only missing rack component defaults.
        if p.get('category') == 'missile_racks' and p.get('component'):
            continue
        paths, names = ix[slot['class']]
        key = norm_name(p.get('name'))
        e = paths.get(key)
        if e is None:
            matches = names.get(key, [])
            if len(matches) == 1:
                e = matches[0]
        if e is None:
            continue
        cls = e.get('ClassName')
        if not cls:
            continue
        # WeaponMount.WeaponControl is a fixed control object, not a selectable
        # item card. Its stock gun leaves are supplied by enrich_turret_slots.
        if (e.get('Type') or '').split('.')[0] == 'WeaponMount':
            p.pop('component', None)
            continue
        old = (p.get('component') or {}).get('scKey', '').lower()
        if old != cls.lower():
            changed.append({'ship': slot['class'], 'port': p['name'], 'old': old, 'new': cls})
        p['component'] = {'scKey': cls.lower(), 'name': e.get('Name') or cls}
        if e.get('MaxSize') is not None:
            p['maxSize'] = e['MaxSize']
    slots['sourceCommit'] = meta['commit']
    slots_path.write_text(json.dumps(slots, ensure_ascii=False))
    print(json.dumps({'changed': changed}, ensure_ascii=False, indent=2))
if __name__ == '__main__':
    main()
