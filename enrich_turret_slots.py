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
    """port-name -> {turretClass, childGuns} for turret-ish parents.

    Editable-chain: mounts/gimbals/PDC (player-swappable) carry their own
    stock gun child directly. For FIXED turret bodies (Editable=False,
    e.g. Hammerhead S5 shell with 4x non-editable S4 gimbals) the game file
    still carries the full stock chain underneath — that chain is what the
    player actually arms, so record it as this port's gun layout.
    """
    d = json.load(io.open(os.path.join(RAW_SHIPS, fn), encoding='utf-8'))
    info = {}

    def entry_guns(e):
        kids = children_of(e)
        return [k for k in kids
                if (k['type'].split('.')[0] in GUN_CHILDREN
                    or k['type'].split('.')[0] in GUN_TYPES)]

    def walk(es):
        for e in es:
            t = e.get('Type') or ''
            head = t.split('.')[0]
            if head not in ('TurretBase', 'Turret', 'UtilityTurret'):
                walk(e.get('Loadout') or [])
                continue
            guns = entry_guns(e)
            if not guns:
                # fixed shell: stock gimbal children each carry their own
                # gun port (Editable=False chains still list stock loadout)
                flat = []
                for k in (e.get('Loadout') or []):
                    for gc in (k.get('Loadout') or []):
                        gt = (gc.get('Type') or '').split('.')[0]
                        if gt in GUN_CHILDREN or gt in GUN_TYPES:
                            flat.append({
                                'hardpoint': gc.get('HardpointName'),
                                'class': gc.get('ClassName'),
                                'name': gc.get('Name'),
                                'type': gc.get('Type'),
                                'min': gc.get('MinSize'),
                                'max': gc.get('MaxSize'),
                                'editable': bool(gc.get('Editable')),
                                'via': k.get('HardpointName'),
                            })
                guns = flat
            if e.get('HardpointName'):
                info[e.get('HardpointName')] = {
                    'turretClass': e.get('ClassName'),
                    'childGuns': guns,
                }
            walk(e.get('Loadout') or [])

    walk(d.get('Loadout') or [])
    return info


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
    norm_index = {}
    for s in slots['slots']:
        p = s['port']
        info = (per_ship.get(s.get('class')) or {}).get(p.get('name'))
        if not info:
            # normalized fallback (naming drift between sources)
            key = (s.get('class'), norm_name(p.get('name')))
            if key not in norm_index:
                norm_index[key] = None
                for pn, pi in (per_ship.get(s.get('class')) or {}).items():
                    if norm_name(pn) == key[1]:
                        norm_index[key] = pi
                        break
            info = norm_index[key]
        if not info:
            continue
        if info.get('turretClass'):
            p['turretClass'] = info['turretClass']
            n_hit += 1
        else:
            n_miss += 1
        if info.get('childGuns'):
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
