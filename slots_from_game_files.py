#!/usr/bin/env python3
"""Build ship_slots.json entries straight from the pinned game files (data/raw/ships).

Use for ships whose FleetYards hardpoints are missing or wrong (FleetYards is a
third-party mirror). Only the slot kinds app.js uses are created: weapon mounts,
turrets, fixed guns, missile racks, power plant, shield, cooler, quantum drive,
radar, life support. enrich_turret_slots.py then adds turretClass / childGuns /
component from the same files.

Usage:
  python3 slots_from_game_files.py DRAK_Command_Module AEGS_Tiburon ...
  python3 enrich_turret_slots.py && python3 reconcile_slots.py
Replaces all slots of the named ships. Other ships are untouched.
"""
import io, json, os, sys, time, uuid

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, 'data', 'raw')
SLOTS = os.path.join(ROOT, 'public', 'ship_slots.json')
SIMPLE = {'PowerPlant': ('powerplant', 'system'), 'Shield': ('shieldgenerator', 'system'),
          'Cooler': ('cooler', 'system'), 'QuantumDrive': ('quantumdrive', 'propulsion'),
          'Radar': ('radar', 'avionic'), 'LifeSupportGenerator': ('lifesupport', 'system')}


def kids_types(e):
    out = []
    def w(es):
        for k in es or []:
            out.append(k.get('Type') or '')
            w(k.get('Loadout'))
    w(e.get('Loadout'))
    return out


def classify(e):
    t = e.get('Type') or ''
    head = t.split('.')[0]
    if 'Controller' in t:
        return None
    if head in SIMPLE:
        return SIMPLE[head]
    if head == 'MissileLauncher':
        return ('missile_racks', 'weapon')
    if head == 'WeaponGun':
        return ('weapons', 'weapon')
    if head in ('Turret', 'TurretBase', 'NoseMounted', 'WeaponMount'):
        ks = ' '.join(kids_types(e))
        cls = (e.get('ClassName') or '').lower()
        if 'TractorBeam' in ks and 'WeaponGun' not in ks:
            return ('turret', 'auxiliary')
        if 'WeaponMining' in ks:
            return ('turret', 'mining')
        if 'WeaponSalvage' in ks:
            return ('turret', 'salvage')
        if 'WeaponGun' not in ks:
            return None
        if t.endswith('NoseMounted') or 'gimbal' in cls or cls.startswith('mount_') or cls.startswith('weaponmount'):
            return ('weapon_mounts', 'weapon')
        return ('turret', 'weapon')
    return None


def main():
    classes = sys.argv[1:]
    meta = json.load(io.open(os.path.join(RAW, '.sync_meta.json'), encoding='utf-8'))['class_to_file']
    db = {s['class']: s for s in json.load(io.open(os.path.join(ROOT, 'public', 'db.json'), encoding='utf-8'))['ships']}
    data = json.load(io.open(SLOTS, encoding='utf-8'))
    for c in classes:
        ship = db[c]
        src = json.load(io.open(os.path.join(RAW, 'ships', meta[c]), encoding='utf-8'))
        new = []
        for e in src.get('Loadout') or []:
            k = classify(e)
            if not k:
                continue
            name = e.get('HardpointName')
            new.append({'slug': ship['slug'], 'class': c, 'name': ship['name'], 'port': {
                'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'sc-fitting-sim/%s/%s' % (ship['slug'], name))),
                'name': name, 'category': k[0], 'group': k[1], 'source': 'game_files',
                'maxSize': e.get('MaxSize') or e.get('MinSize') or 1}})
        # Systems and missile racks can sit below body or missile-gimbal parents.
        def walk(es, parents=()):
            for e in es or []:
                h = (e.get('Type') or '').split('.')[0]
                if h in SIMPLE and 'Controller' not in (e.get('Type') or '') and e.get('HardpointName') not in {n['port']['name'] for n in new}:
                    k = SIMPLE[h]
                    new.append({'slug': ship['slug'], 'class': c, 'name': ship['name'], 'port': {
                        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'sc-fitting-sim/%s/%s' % (ship['slug'], e['HardpointName']))),
                        'name': e['HardpointName'], 'category': k[0], 'group': k[1], 'source': 'game_files',
                        'maxSize': e.get('MaxSize') or e.get('MinSize') or 1}})
                if h == 'MissileLauncher' and parents:
                    name = ''.join(parents + (e['HardpointName'],))
                    new.append({'slug': ship['slug'], 'class': c, 'name': ship['name'], 'port': {
                        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'sc-fitting-sim/%s/%s' % (ship['slug'], name))),
                        'name': name, 'category': 'missile_racks', 'group': 'weapon',
                        'source': 'game_files', 'maxSize': e.get('MaxSize') or 1}})
                walk(e.get('Loadout'), parents + (e.get('HardpointName') or '',))
        walk(src.get('Loadout'))
        data['slots'] = [s for s in data['slots'] if s['slug'] != ship['slug']] + new
        print(c, len(new), 'slots from game files')
    data['slots'].sort(key=lambda x: (x['name'] or '', x['port'].get('name') or ''))
    data['ships'] = len({s['slug'] for s in data['slots']})
    note = ' | Slots rebuilt from game files (FleetYards data wrong or missing): ' + ', '.join(classes)
    if classes and note not in data.get('note', ''):
        data['note'] = data.get('note', '') + note
    data['generated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    json.dump(data, io.open(SLOTS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
