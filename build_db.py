"""Build curated public/db.json from the pristine scunpacked origin in data/raw/.

Origin: StarCitizenWiki/scunpacked-data  (synced by sync_data.py)
  data/raw/items.json              22 401 recs  — component stats (NEW schema)
  data/raw/ships/<file>.json       per-ship (Name/Career/Role/Size/Crew/Cargo)
  data/raw/.sync_meta.json         class -> ship file map

Run order:
    sync_data.py -> build_db.py -> extend_db.py -> extract_power_rn.py -> integrate_power.py

Safe preview (does NOT touch the live db.json):
    python3 build_db.py --out /tmp/db_new.json

History / why this was rewritten (2026-10-29)
  * it read /tmp/v2ships.json; /tmp was cleaned -> JSONDecodeError, unrunnable
  * it emitted NO turrets and NO radars while the live db.json carries
    turrets: 208 / radars: 22 (both read by app.js findComp/optionsFor) —
    running it silently deleted them
  * the dump changed schema (see references/scunpacked-schema-change-2026-10.md):
      - PowerConnection / HeatConnection / SPowerSegmentResourceUnit REMOVED
      - damage types flattened into Dps* / Alpha* scalars
      - pid/pw units now live in stdItem.ResourceNetwork

FROZEN FIELDS (decision 2026-10-29: 동결)
  `heat`, `power`, `powerBase` were deleted from the game data and cannot be
  refreshed. They are carried forward verbatim from the existing db.json,
  matched by className. `power` was only the `pw` fallback. When an item exists
  only in the old DB it is carried forward whole, so saved builds keep resolving.
  Pass --no-freeze to emit an unfrozen DB (frozen fields absent) for inspection.
"""
import argparse
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, 'data', 'raw')

GRADE = {1: 'A', 2: 'B', 3: 'C', 4: 'D'}
TURRET_TYPES = ('Turret', 'TurretBase')
DAMAGE_TYPES = ('Physical', 'Energy', 'Distortion', 'Thermal', 'Biochemical', 'Stun')
SHORT = {'Physical': 'Phys', 'Energy': 'Ener', 'Distortion': 'Dist',
         'Thermal': 'Therm', 'Biochemical': 'Bioc', 'Stun': 'Stun'}
FROZEN = ('heat', 'power', 'powerBase')


def is_test(cn):
    cn = (cn or '').lower()
    return 'test_' in cn or cn.startswith('test') or 'placeholder' in cn or 'vanduul' in cn


def mfr(si):
    m = si.get('Manufacturer')
    if isinstance(m, dict):
        return m.get('Name', '')
    return m or ''


def by_type(d, total_only_nonzero=True):
    """{'Physical': 544.0, 'Energy': 0} -> 'Phys 544' (0 은 버린다)."""
    if not isinstance(d, dict) or not d:
        return ''
    parts = ['%s %d' % (SHORT.get(k, k[:4]), round(v))
             for k, v in d.items() if not total_only_nonzero or v]
    return '+'.join(parts)


def raw_dict(d):
    if not isinstance(d, dict):
        return {}
    return {k: v for k, v in d.items() if v}          # 0 제거 필수


def fam_of(si):
    m = re.search(r'Item Type:\s*([^\n]+)', si.get('Description') or '')
    return m.group(1).strip() if m else ''


def cls_of(si):
    m = re.search(r'^Class:\s*([^\n]+)', si.get('Description') or '', re.M)
    return m.group(1).strip() if m else ''


def base(x):
    si = x.get('stdItem', {}) or {}
    return {
        'class': x['className'],
        'name': si.get('Name') or x['className'],
        'size': x.get('size'),
        'grade': GRADE.get(x.get('grade'), str(x.get('grade'))),
        'mfr': mfr(si),
        'cls': cls_of(si),
    }


def rn_power(si):
    """ResourceNetwork -> {'pw','pwMinFrac','pwGen','em','ir','pranges'} (None when absent).

    Replaces the removed SPowerSegmentResourceUnit path. Validated 892/892
    against the live db.json — see extract_power_rn.py.

    P0 (spviewer식 병행 표시용):
      pranges: States[0].PowerRanges [{Start,Modifier,RegisterRange}] 그대로.
               spviewer Qn(segments, PowerRanges) 구간 스케일의 입력.
      ir:      States[0].Signature.IR (쿨러 IR 표시용. 없으면 None).
    NOTE: spviewer 구스키마의 Consumption.UnitPerSec/Segment 분리형과 달리
    현 덤프(2026-10~)는 Rate 단일값이다. Rate==pw(핍 칸수)에 대응하며,
    UnitPerSec에 대응하는 별도 필드는 덤프에 없다. spviewer식
    nt=UnitPerSec+Segment의 완전 재현은 불가 — Qn 스케일(rt)만 이식한다.
    """
    R = (si or {}).get('ResourceNetwork') or {}
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
        elif t == 'Generation' and d.get('Rate') is not None:
            out.setdefault('pwGen', d.get('Rate'))
    sig = st.get('Signature') or {}
    if sig.get('EM') is not None:
        out['em'] = sig.get('EM')
    if sig.get('IR') is not None:
        out['ir'] = sig.get('IR')
    if 'em' not in out:
        mx = ((si or {}).get('Emission') or {}).get('Em') or {}
        if mx.get('Maximum') is not None:
            out['em'] = mx['Maximum']
    pr = st.get('PowerRanges')
    if pr:
        out['pranges'] = [{'s': p.get('Start'), 'm': p.get('Modifier'),
                           'r': p.get('RegisterRange')} for p in pr]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'db.json'))
    ap.add_argument('--freeze-from', default=os.path.join(ROOT, 'public', 'db.json'),
                    help='DB to carry the removed heat/power/powerBase values from')
    ap.add_argument('--no-freeze', action='store_true')
    a = ap.parse_args()

    items_p = os.path.join(RAW, 'items.json')
    if not os.path.exists(items_p):
        items_p = os.path.join(RAW, 'ship-items.json')
    if not os.path.exists(items_p):
        raise SystemExit('no data/raw/items.json — run sync_data.py first')
    items = json.load(io.open(items_p, encoding='utf-8'))
    smeta = json.load(io.open(os.path.join(RAW, '.sync_meta.json'), encoding='utf-8'))

    frozen = {}
    if not a.no_freeze and os.path.exists(a.freeze_from):
        old = json.load(io.open(a.freeze_from, encoding='utf-8'))
        for key in ('weapons', 'shields', 'powerplants', 'coolers', 'qds',
                    'racks', 'missiles', 'turrets', 'radars'):
            for e in old.get(key, []):
                frozen.setdefault(e['class'], {})
                for f in FROZEN:
                    if e.get(f) is not None:
                        frozen[e['class']].setdefault(f, e[f])
        print('frozen fields carried from %s: %d classes' % (a.freeze_from, len(frozen)))

    seen = set()

    def finish(e, x):
        """frozen 값 병합 + pw 계열 병합."""
        si = x.get('stdItem', {}) or {}
        e.update({k: v for k, v in rn_power(si).items() if v is not None})
        for f in FROZEN:
            if f not in e and frozen.get(e['class'], {}).get(f) is not None:
                e[f] = frozen[e['class']][f]
        seen.add(e['class'])
        return e

    # ------------------------------------------------------------ weapons
    weapons = []
    for x in items:
        if x.get('type') != 'WeaponGun' or x.get('subType') != 'Gun':
            continue
        if is_test(x.get('className', '')):
            continue
        si = x.get('stdItem', {}) or {}
        w = si.get('Weapon', {}) or {}
        modes = []
        best = None
        for m in (w.get('Modes') or []):
            dpsRaw = {t: m.get('Dps' + t) for t in DAMAGE_TYPES if m.get('Dps' + t)}
            alphaRaw = {t: m.get('Alpha' + t) for t in DAMAGE_TYPES if m.get('Alpha' + t)}
            d = m.get('DamagePerSecond') or m.get('Dps') or 0
            al = m.get('DamagePerShot') or m.get('Alpha') or 0
            md = {'name': m.get('Name'), 'rpm': m.get('RoundsPerMinute'),
                  'alpha': round(al, 1), 'alphaBy': by_type(alphaRaw),
                  'dps': round(d, 1), 'dpsBy': by_type(dpsRaw),
                  'types': list(dpsRaw)}
            modes.append(md)
            if best is None or md['dps'] > best['dps']:
                best = md
        am = si.get('Ammunition') or {}
        dmg = w.get('Damage') or {}
        cap = w.get('Capacitor') or {}
        e = base(x)
        e.update({'family': fam_of(si),
            'modes': modes,
            'dps': best['dps'] if best else 0,
            'alpha': best['alpha'] if best else 0,
            'dpsBy': best['dpsBy'] if best else '',
            'alphaBy': best['alphaBy'] if best else '',
            'dmgtype': best['types'] if best else [],
            'range': w.get('EffectiveRange') or am.get('Range'),
            'dpsRaw': {t: m.get('Dps' + t) for t in DAMAGE_TYPES
                       if m.get('Dps' + t)} if False else {},
            'alphaRaw': {},
            'rpm': best['rpm'] if best else None,
            # Erkul En()/Te() sustain inputs (2026-11-01): game Damage + Capacitor.
            #   sustain (dpsSustain): Damage.Sustained when present (182/191).
            #   capAmmo/capRegen/capCooldown: Capacitor.{MaxAmmoLoad,MaxRegenPerSec,
            #     Cooldown} for En() recompute under poolRatio (117/191).
            'sustain': dmg.get('Sustained'),
            'capAmmo': cap.get('MaxAmmoLoad'),
            'capRegen': cap.get('MaxRegenPerSec'),
            'capCooldown': cap.get('Cooldown'),
        })
        # 최적 모드의 원시 dict 재수집 (0 제거)
        for m in (w.get('Modes') or []):
            if m.get('Name') == (best or {}).get('name'):
                e['dpsRaw'] = raw_dict({t: m.get('Dps' + t) for t in DAMAGE_TYPES})
                e['alphaRaw'] = raw_dict({t: m.get('Alpha' + t) for t in DAMAGE_TYPES})
                break
        weapons.append(finish(e, x))

    # ------------------------------------------------------------ shields
    shields = []
    for x in items:
        if x.get('type') != 'Shield' or is_test(x.get('className', '')):
            continue
        si = x.get('stdItem', {}) or {}
        s = si.get('Shield', {}) or {}
        e = base(x)
        e.update({'hp': s.get('Health'), 'regen': s.get('Regeneration'),
                  'downedDelay': s.get('DownedDelay'),
                  'damagedDelay': s.get('DamagedDelay'),
                  'absorption': s.get('Absorption')})
        shields.append(finish(e, x))

    # ------------------------------------------------------------ power plants
    pps = []
    for x in items:
        if x.get('type') != 'PowerPlant' or is_test(x.get('className', '')):
            continue
        si = x.get('stdItem', {}) or {}
        if not mfr(si):
            continue
        e = base(x)
        e['output'] = (si.get('PowerPlant') or {}).get('Output')
        pps.append(finish(e, x))

    # ------------------------------------------------------------ coolers
    coolers = []
    for x in items:
        if x.get('type') != 'Cooler' or is_test(x.get('className', '')):
            continue
        si = x.get('stdItem', {}) or {}
        if not mfr(si):
            continue
        e = base(x)
        e['rate'] = (si.get('Cooler') or {}).get('Rate')
        coolers.append(finish(e, x))

    # ------------------------------------------------------------ quantum drives
    qds = []
    for x in items:
        if x.get('type') != 'QuantumDrive' or is_test(x.get('className', '')):
            continue
        si = x.get('stdItem', {}) or {}
        if not mfr(si):
            continue
        std = ((si.get('QuantumDrive') or {}).get('StandardJump')) or {}
        e = base(x)
        e.update({'speed': std.get('Speed'), 'cooldown': std.get('Cooldown'),
                  'spool': std.get('SpoolUpTime')})
        qds.append(finish(e, x))

    # ------------------------------------------------------------ missile racks
    racks = []
    for x in items:
        if x.get('type') != 'MissileLauncher' or is_test(x.get('className', '')):
            continue
        r = ((x.get('stdItem') or {}).get('MissileRack')) or {}
        e = base(x)
        e.update({'missiles': r.get('Count'), 'msize': r.get('Size')})
        racks.append(finish(e, x))

    # ------------------------------------------------------------ missiles
    missiles = []
    for x in items:
        if x.get('type') != 'Missile' or is_test(x.get('className', '')):
            continue
        m = ((x.get('stdItem') or {}).get('Missile')) or {}
        dmg = m.get('Damage') if isinstance(m.get('Damage'), dict) else {}
        e = base(x)
        e.update({'damage': sum(v for v in dmg.values() if isinstance(v, (int, float))),
                  'dmgtype': list(dmg)})
        missiles.append(finish(e, x))

    # ------------------------------------------------------------ radars
    radars = []
    for x in items:
        if x.get('type') != 'Radar' or is_test(x.get('className', '')):
            continue
        e = base(x)
        e['grade'] = x.get('grade')                     # live DB keeps raw grade
        radars.append(finish(e, x))

    # ------------------------------------------------------------ turrets
    turrets = []
    for x in items:
        if x.get('type') not in TURRET_TYPES or is_test(x.get('className', '')):
            continue
        si = x.get('stdItem', {}) or {}
        e = base(x)
        e['grade'] = x.get('grade')
        e['guns'] = ((si.get('Turret') or {}).get('Guns')) or ''
        turrets.append(finish(e, x))

    # ------------------------------------------------------------ ships
    ships, ship_missing = [], []
    for klass, fname in (smeta.get('class_to_file') or {}).items():
        p = os.path.join(RAW, 'ships', fname)
        if not os.path.exists(p):
            ship_missing.append(klass)
            continue
        s = json.load(io.open(p, encoding='utf-8'))
        # Erkul Ln() weapon pool (2026-11-01): PowerPools.WeaponGun.Size.
        # Size>0 = 핍 상한, -1 = unlimited, None = 함선 파일에 없음.
        pp = s.get('PowerPools') or {}
        pw = s.get('Power') or {}
        # P1: 함선 스톡 전력 배분 (spviewer 성능탭 대응).
        #   stockGen: GenerationSegments (스톡 발전 총합)
        #   stockUsed: UsedSegmentsGrouped (계통별 스톡 인가량)
        #   stockMax: MaxSegments (계통별 상한)
        #   sim PWR_GROUPS id로 매핑: WeaponGun->weapon, Cooler->coolers,
        #   Shield->shield, Radar->radar, LifeSupportGenerator->lifeSupport,
        #   FlightController->engine. 그 외(채굴/구난/QED 등)는 stockExtra로 원본 유지.
        _used = pw.get('UsedSegmentsGrouped') or {}
        _max = pw.get('MaxSegments') or {}
        _map = {'WeaponGun': 'weapon', 'Cooler': 'coolers', 'Shield': 'shield',
                'Radar': 'radar', 'LifeSupportGenerator': 'lifeSupport',
                'FlightController': 'engine', 'PowerPlant': 'power',
                'QuantumDrive': 'qd'}
        _su = {(_map[k] if k in _map else k): v for k, v in _used.items()}
        _sm = {(_map[k] if k in _map else k): v for k, v in _max.items()}
        _em = s.get('Emission') or {}
        _fc = s.get('FlightCharacteristics') or {}
        _ifcs = _fc.get('IFCS') or {}
        _ag = s.get('Agility') or {}
        _acc = _fc.get('Acceleration') or {}
        _prop = s.get('Propulsion') or {}
        # P2: EM + 기동 (spviewer 성능탭 대응).
        #   emGroups: 계통별 EM 기여도 (스텔스 판단용, sim 그룹 id 매핑)
        #   emTotal/irTotal: 스톡 총합 (Shields 기준 + Quantum 별도)
        #   agility: 회전 °/s, accel: 가속도, ifcs: 속도 4종, thrust: 추력
        _eg = _em.get('EmGroupsShields') or {}
        ships.append({'class': klass, 'name': s.get('Name'),
                      'slug': klass.lower().replace('_', '-'),
                      'career': s.get('Career'), 'role': s.get('Role'),
                      'size': s.get('Size'), 'crew': s.get('Crew'),
                      'cargo': s.get('Cargo'),
                      'wpool': (pp.get('WeaponGun') or {}).get('Size'),
                      'stockGen': pw.get('GenerationSegments'),
                      'stockUsed': _su or None,
                      'stockMax': _sm or None,
                      'emGroups': {(_map[k] if k in _map else k): v for k, v in _eg.items()} or None,
                      'emTotal': _em.get('EmShields'),
                      'emQuantum': _em.get('EmQuantum'),
                      'irTotal': _em.get('IrShields'),
                      'emPerSeg': _em.get('EmPerSegment'),
                      'agility': ({k: _ag[k] for k in ('Pitch', 'Yaw', 'Roll') if _ag.get(k) is not None} or None),
                      'accel': ((_acc.get('Raw') or None) or None),
                      'ifcs': ({k: _ifcs[k] for k in ('ScmSpeed', 'MaxSpeed', 'BoostSpeedForward', 'BoostSpeedBackward') if _ifcs.get(k) is not None} or None),
                      'thrust': ((_prop.get('ThrustCapacity') or None) or None)})
    ships.sort(key=lambda s: s['name'] or '')

    db = {
        'meta': {'ships': len(ships), 'weapons': len(weapons), 'shields': len(shields),
                 'powerplants': len(pps), 'coolers': len(coolers), 'qds': len(qds),
                 'racks': len(racks), 'missiles': len(missiles),
                 'turrets': len(turrets), 'radars': len(radars)},
        'ships': ships,
        'weapons': sorted(weapons, key=lambda w: (w['size'] or 0, -(w['dps'] or 0))),
        'shields': sorted(shields, key=lambda w: (w['size'] or 0, -(w['hp'] or 0))),
        'powerplants': sorted(pps, key=lambda w: (w['size'] or 0, -(w['output'] or 0))),
        'coolers': sorted(coolers, key=lambda w: (w['size'] or 0, -(w['rate'] or 0))),
        'qds': sorted(qds, key=lambda w: (w['size'] or 0, -(w['speed'] or 0))),
        'racks': sorted(racks, key=lambda w: (w['size'] or 0, -(w['missiles'] or 0))),
        'missiles': sorted(missiles, key=lambda w: (w['size'] or 0, -(w['damage'] or 0))),
        'turrets': sorted(turrets, key=lambda w: (w['size'] or 0, w['name'] or '')),
        'radars': sorted(radars, key=lambda w: (w['size'] or 0, w['name'] or '')),
    }

    if not a.no_freeze and os.path.exists(a.freeze_from):
        _old = json.load(io.open(a.freeze_from, encoding='utf-8'))
        restored = 0
        for _key in ('weapons', 'shields', 'powerplants', 'coolers', 'qds',
                     'racks', 'missiles', 'turrets', 'radars'):
            _have = {e['class'] for e in db[_key]}
            for _e in _old.get(_key, []):
                if _e.get('class') not in _have:
                    db[_key].append(_e)
                    restored += 1
            db[_key] = sorted(db[_key], key=lambda w: (w.get('size') or 0, w.get('name') or ''))
        if restored:
            print('restored %d classes missing from new dump (old DB carried)' % restored)

    json.dump(db, io.open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('wrote', a.out)
    print('meta:', db['meta'])
    print('source:', os.path.relpath(items_p, ROOT))
    if ship_missing:
        print('⚠️ 함선 파일 없음 %d척: %s' % (len(ship_missing), ship_missing[:6]))

    # 배포 전 필수 검증: 앱이 읽는 배열이 비면 안 된다
    for k in ('turrets', 'radars', 'weapons', 'shields', 'powerplants'):
        if not db[k]:
            print('❌ FATAL: %s 가 비었다 — 배포 금지' % k)
            raise SystemExit(1)
    nopw = [w['class'] for w in weapons if w.get('pw') is None]
    print('pw 없는 무기: %d (폴백 사용)' % len(nopw))
    if frozen and not a.no_freeze:
        print('동결 필드 적용: heat/power/powerBase')


if __name__ == '__main__':
    main()
