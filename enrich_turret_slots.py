#!/usr/bin/env python3
"""Enrich public/ship_slots.json ports with turret compat from data/raw/ships/*.json.

Game Loadout chains carry the truth this fixes:
  parent turret slot (Type TurretBase.MannedTurret / NoseMounted / ...)
    -> child gun ports (Type Turret.GunTurret / BallTurret / NoseMounted ...,
       each with MinSize/MaxSize + stock ClassName)

Emits per port:
  turretClass : stock card ClassName on this port (exact DB match key)
  childGuns   : ordered [{type, min, max, stock}] for weapon-bearing children
                (WeaponGun.Gun / Mining / Salvage / Tractor... gun children;
                 MFD/Screen/Room/SeatAccess excluded)
  gunPorts    : flattened gun sizes for UI rows when child is a gimbal card
                whose own stock gun port is known (same-size 3.23+ rule)

Idempotent: re-run overwrites the same keys. Backs up ship_slots.json once.
"""
import json, io, os, glob, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW_SHIPS = os.path.join(ROOT, 'data', 'raw', 'ships')
META = os.path.join(ROOT, 'data', 'raw', '.sync_meta.json')
SLOTS = os.path.join(ROOT, 'public', 'ship_slots.json')

GUN_TYPES = ('WeaponGun', 'WeaponMining', 'WeaponSalvage',
             'TractorBeam', 'WeaponDefensive')
NOISE = ('Display', 'Room', 'SeatAccess', 'WeaponAttachment')
TURRET_PARENTS = ('TurretBase', 'Turret', 'UtilityTurret')
GUN_CHILDREN = ('Turret', 'WeaponGun', 'WeaponMining', 'WeaponSalvage',
                'TractorBeam', 'WeaponDefensive')


def ship_class_of(fn, mapping):
    for klass, f in (mapping or {}).items():
        if f == fn:
            return klass
    return None


def children_of(entry):
    out = []
    for k in (entry.get('Loadout') or []):
        t = k.get('Type') or ''
        head = t.split('.')[0]
        if head in ('Display', 'Room', 'SeatAccess', 'WeaponAttachment', ''):
            continue
        out.append({
            'hardpoint': k.get('HardpointName'),
            'class': k.get('ClassName'),
            'name': k.get('Name'),
            'type': t,
            'min': k.get('MinSize'),
            'max': k.get('MaxSize'),
            'editable': bool(k.get('Editable')),
        })
    return out


def norm_name(n):
    import re
    # side_backleft == side_back_left (FleetYards vs game-file naming)
    return re.sub(r'[^a-z0-9]', '', (n or '').lower())


def extract(fn):
    """Flatten stock weapon leaves without dropping mixed direct/gimbal children."""
    d = json.load(io.open(os.path.join(RAW_SHIPS, fn), encoding='utf-8'))
    info = {}
    def leaves(entries):
        out = []
        for child in entries or []:
            head = (child.get('Type') or '').split('.')[0]
            if head in GUN_TYPES:
                out.append({'hardpoint': child.get('HardpointName'),
                            'class': child.get('ClassName'), 'name': child.get('Name'),
                            'type': child.get('Type'), 'min': child.get('MinSize'),
                            'max': child.get('MaxSize'), 'editable': bool(child.get('Editable')),
                            'stock': child.get('ClassName')})
            else:
                out.extend(leaves(child.get('Loadout')))
        return out
    top = {e.get('HardpointName') for e in (d.get('Loadout') or [])}
    def walk(entries, depth=0):
        for e in entries or []:
            head = (e.get('Type') or '').split('.')[0]
            # A nested port that reuses a top-level hardpoint name (e.g. a turret's
            # hardpoint_weapon_left) must not overwrite the top-level one.
            if head in ('TurretBase', 'Turret', 'UtilityTurret', 'WeaponMount') and not (
                    depth > 0 and e.get('HardpointName') in top):
                info[e.get('HardpointName')] = {
                    'turretClass': e.get('ClassName'),
                    'weaponControl': 'turret' if head in ('TurretBase', 'WeaponMount') else 'pilot',
                    'childGuns': leaves(e.get('Loadout'))}
            walk(e.get('Loadout'), depth + 1)
    walk(d.get('Loadout'))
    return info


def match_info(port, info):
    name = port.get('name') or ''
    if name in info:
        return info[name]
    key = norm_name(name)
    exact = [v for k, v in info.items() if norm_name(k) == key]
    if len(exact) == 1:
        return exact[0]
    if port.get('category') not in ('weapon_mounts', 'turret'):
        return None
    suffix = [v for k, v in info.items() if key.endswith(norm_name(k))]
    return suffix[0] if len(suffix) == 1 else None


def main():
    mapping = {}
    if os.path.exists(META):
        mapping = json.load(io.open(META, encoding='utf-8')).get('class_to_file', {})
    slots = json.load(io.open(SLOTS, encoding='utf-8'))
    per_ship = {}
    files = sorted(glob.glob(os.path.join(RAW_SHIPS, '*.json')))
    print(f'raw ship files: {len(files)}')
    for f in files:
        fn = os.path.basename(f)
        klass = ship_class_of(fn, mapping)
        if not klass:
            continue
        try:
            per_ship[klass] = extract(fn)
        except Exception as e:
            print(f'  !! {fn}: {e}')
    print(f'ships with turret info: {len(per_ship)}')

    n_hit = n_miss = n_gun = 0
    for s in slots['slots']:
        p = s['port']
        info = match_info(p, per_ship.get(s.get('class')) or {})
        if not info:
            continue
        p['weaponControl'] = info.get('weaponControl')
        if info.get('turretClass'):
            p['turretClass'] = info['turretClass']
            n_hit += 1
        else:
            n_miss += 1
        if info.get('childGuns'):
            if p.get('category') not in ('turret', 'weapon_mounts'):
                p['category'] = 'weapon_mounts'
                p['group'] = 'weapon'
            p['childGuns'] = info['childGuns']
            n_gun += 1
    bak = SLOTS + '.bak'
    if not os.path.exists(bak):
        shutil.copy2(SLOTS, bak)
        print(f'backup: {bak}')
    json.dump(slots, io.open(SLOTS, 'w', encoding='utf-8'),
              ensure_ascii=False)
    print(f'ports turretClass: {n_hit}, no-stock-class: {n_miss}, '
          f'with childGuns: {n_gun}')
    print(f'wrote {SLOTS} ({os.path.getsize(SLOTS)}B)')


if __name__ == '__main__':
    main()
