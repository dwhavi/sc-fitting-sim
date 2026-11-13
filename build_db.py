"""Build curated public/db.json from the pristine scunpacked origin in data/raw/.

Origin: StarCitizenWiki/scunpacked-data  (synced by sync_data.py)
  data/raw/items.json              22 401 recs  — component stats (NEW schema)
  data/raw/ships/<file>.json       per-ship (Name/Career/Role/Size/Crew/Cargo)
  data/raw/.sync_meta.json         class -> ship file map

Run order:
    sync_data.py -> build_db.py (단독 — extend/integrate 내장됨, 2026-11-05 검증)

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
import time

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


def first_nonnull(*vals):
    for v in vals:
        if v is not None:
            return v
    return None


def cooler_rate(si):
    # 신스키마: Cooler 블록 삭제 → ResourceNetwork에서 조달.
    #   Generation.Coolant 우선, 없으면 Conversion GeneratedRate.
    R = (si or {}).get('ResourceNetwork') or {}
    g = R.get('Generation') or {}
    if g.get('Coolant') is not None:
        return g['Coolant']
    for st in (R.get('States') or []):
        for d in (st.get('Deltas') or []):
            if (d.get('Type') == 'Conversion'
                    and d.get('GeneratedResource') == 'Coolant'
                    and d.get('GeneratedRate') is not None):
                return d['GeneratedRate']
    return None


def turret_guns(si):
    # 신스키마: Turret.Guns 키 없음 → stdItem.Ports[]에서 건포대 추출.
    #   건포대 = Types에 WeaponGun(로켓 제외) 또는 Turret.GunTurret 포함.
    #   미사일랙/트랙터/디스플레이 포트는 제외. 'S4+S4+S4+S4' 형식.
    out, seen = [], set()
    for p in ((si or {}).get('Ports') or []):
        ok = False
        for t in (p.get('Types') or []):
            if t == 'Turret.GunTurret':
                ok = True
            elif isinstance(t, str) and t.startswith('WeaponGun') \
                    and 'Rocket' not in t:
                ok = True
        if not ok:
            continue
        sz = p.get('MaxSize')
        if not sz:
            continue
        pn = p.get('PortName')
        if pn in seen:
            continue
        seen.add(pn)
        out.append('S%d' % sz)
    return '+'.join(out)


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
    # fix 2026-11-07: Unknown Manufacturer 필터가 새 덤프에서 정상 부품까지
    # 걸러내 em/pranges 누락을 만들었음 (radars 59, powerplants 21 등).
    # mfr 표기는 유지하되 필터에서는 제외한다.
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
    # Gun + Rocket (로켓포드: Jericho 등 Mustang Delta 스톡).
    weapons = []
    for x in items:
        if x.get('type') != 'WeaponGun' or x.get('subType') not in ('Gun', 'Rocket'):
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
        e.update({'hp': first_nonnull(s.get('MaxShieldHealth'), s.get('Health')),
                  'regen': first_nonnull(s.get('MaxShieldRegen'), s.get('Regeneration')),
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
        # PowerPlant 블록 삭제됨 → ResourceNetwork Generation.Power.
        e = base(x)
        e['output'] = first_nonnull(
            (si.get('PowerPlant') or {}).get('Output'),
            ((si.get('ResourceNetwork') or {}).get('Generation') or {}).get('Power'),
            ((si.get('ResourceNetwork') or {}).get('Usage') or {}).get('Power', {}).get('Maximum')
            if isinstance(((si.get('ResourceNetwork') or {}).get('Usage') or {}).get('Power'), dict) else None)
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
        e['rate'] = first_nonnull((si.get('Cooler') or {}).get('Rate'),
                                  cooler_rate(si))
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
        qd = si.get('QuantumDrive') or {}
        e = base(x)
        e.update({'speed': first_nonnull(std.get('DriveSpeed'), std.get('Speed')),
                  'driveSpeed': first_nonnull(std.get('DriveSpeed'), std.get('Speed')),
                  'cooldown': first_nonnull(std.get('CooldownTime'), std.get('Cooldown')),
                  'spool': first_nonnull(std.get('SpoolUpTime'), std.get('Spool')),
                  't10gm': first_nonnull(qd.get('TravelTime10GMSeconds')),
                  'fuelReq': first_nonnull(qd.get('FuelConsumptionSCUPerGM'))})
        qds.append(finish(e, x))

    # ------------------------------------------------------------ missile racks
    racks = []
    for x in items:
        if x.get('type') != 'MissileLauncher' or is_test(x.get('className', '')):
            continue
        r = ((x.get('stdItem') or {}).get('MissileRack')) or {}
        e = base(x)
        # 4.10 덤프는 Count/Size → MissileCount/MissileSize 로 변경됨 (2026-11-13 실측)
        e.update({'missiles': first_nonnull(r.get('Count'), r.get('MissileCount')),
                  'msize': first_nonnull(r.get('Size'), r.get('MissileSize'))})
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
        e['guns'] = first_nonnull(((si.get('Turret') or {}).get('Guns')) or None,
                                  turret_guns(si) or None) or ''
        turrets.append(finish(e, x))

    # ------------------------------------------------------------ ships
    ships, ship_missing = [], []
    # sig 2026-11-07: 부품 EM 룩업 (스톡 스냅샷용). rn_power와 동일 규칙.
    def _em_of(si):
        R = (si or {}).get('ResourceNetwork') or {}
        st = (R.get('States') or [{}])[0] or {}
        sg = st.get('Signature') or {}
        if sg.get('EM') is not None:
            return sg.get('EM')
        mx = ((si or {}).get('Emission') or {}).get('Em') or {}
        return mx.get('Maximum')
    _emBy = {}
    for _x in items:
        _emBy[_x.get('className')] = _em_of(_x.get('stdItem'))
    def _stock_sig(s):
        # 스톡 장착 부품의 EM 합산 (계통별). 중첩 Loadout 재귀 수집.
        # LifeSupport 등 고정 슬롯도 원천 Loadout에서 직접 수집 → 앱 FY 의존 없음.
        acc = {}
        def _add(gkey, cls):
            v = _emBy.get(cls)
            if v is None:
                return
            a = acc.get(gkey) or {'em': 0, 'count': 0}
            a['em'] += v
            a['count'] += 1
            acc[gkey] = a
        def _walk(entries):
            for e in (entries or []):
                t = e.get('Type') or ''
                cls = e.get('ClassName')
                if 'WeaponGun' in t:
                    _add('weapon', cls)
                elif t.startswith('Shield.') and 'Controller' not in t:
                    _add('shield', cls)
                elif t.startswith('PowerPlant.'):
                    _add('power', cls)
                elif t.startswith('Cooler.') and 'Controller' not in t:
                    _add('coolers', cls)
                elif t.startswith('Radar.'):
                    _add('radar', cls)
                elif t.startswith('QuantumDrive.'):
                    _add('qd', cls)
                elif 'LifeSupport' in t and 'Controller' not in t:
                    _add('lifeSupport', cls)
                _walk(e.get('Loadout'))
        _walk(s.get('Loadout'))
        return acc or None
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
        _wp = s.get('Weaponry') or {}
        _fw = _wp.get('FixedWeapons') or {}
        # P3: 스톡 DPS 정답지 (스톡 장착 기준 게임 산출값).
        #   stockDps/stockSus/stockAlpha = PilotDps/PilotSustainedDps/PilotAlpha
        #   turretDps/turretSus/turretAlpha = 터렛 합산 (있을 때만)
        #   mslDmg = TotalMissiles
        ships.append({'class': klass, 'name': s.get('Name'),
                      'slug': klass.lower().replace('_', '-'),
                      'career': s.get('Career'), 'role': s.get('Role'),
                      'size': s.get('Size'), 'crew': s.get('Crew'),
                      'cargo': s.get('Cargo'),
                      'wpool': (pp.get('WeaponGun') or {}).get('Size'),
                      # 2026-11-14: 실드 풀(전원 켜지는 실드 수) + 모드별 총 사용핍.
                      #   spool: PowerPools.Shield.Size (켜지는 실드 수, -1=전부)
                      #   pwShields/pwQuantum: 비행 모드/퀀텀 모드 총 사용핍 (게임 산출)
                      'spool': (pp.get('Shield') or {}).get('Size'),
                      'pwShields': pw.get('UsedSegmentsShields'),
                      'pwQuantum': pw.get('UsedSegmentsQuantum'),
                      'stockGen': pw.get('GenerationSegments'),
                      'stockUsed': _su or None,
                      'stockMax': _sm or None,
                      'emGroups': {(_map[k] if k in _map else k): v for k, v in _eg.items()} or None,
                      'emTotal': _em.get('EmShields'),
                      'emQuantum': _em.get('EmQuantum'),
                      'irTotal': _em.get('IrShields'),
                      'irQuantum': _em.get('IrQuantum'),
                      'emPerSeg': _em.get('EmPerSegment'),
                      # sig 2026-11-07: 스톡 부품 스냅샷 (피팅 연동 EM 보정용).
                      #   key: sim 그룹 id, val: {em: Σ스톡부품EM, count: 슬롯수}.
                      #   앱에서 스톡적재→실측 그룹값 비율 k=group/stockEM 을 구해
                      #   교체 부품에도 동일 k를 곱한다 (전원 끄면 그 계통 제외).
                      'stockSig': _stock_sig(s),
                      'stockDps': _wp.get('PilotDps'),
                      'stockSus': _wp.get('PilotSustainedDps'),
                      'stockAlpha': _wp.get('PilotAlpha'),
                      'turretDps': _wp.get('TurretDps'),
                      'turretSus': _wp.get('TurretSustainedDps'),
                      'turretAlpha': _wp.get('TurretAlpha'),
                      'stockMsl': _wp.get('TotalMissiles'),
                      'agility': ({k: _ag[k] for k in ('Pitch', 'Yaw', 'Roll') if _ag.get(k) is not None} or None),
                      'accel': ((_acc.get('Raw') or None) or None),
                      'ifcs': ({k: _ifcs[k] for k in ('ScmSpeed', 'MaxSpeed', 'BoostSpeedForward', 'BoostSpeedBackward') if _ifcs.get(k) is not None} or None),
                      'thrust': ((_prop.get('ThrustCapacity') or None) or None)})
    ships.sort(key=lambda s: s['name'] or '')

    db = {
        'meta': {'ships': len(ships), 'weapons': len(weapons), 'shields': len(shields),
                 'powerplants': len(pps), 'coolers': len(coolers), 'qds': len(qds),
                 'racks': len(racks), 'missiles': len(missiles),
                 'turrets': len(turrets), 'radars': len(radars),
                 # 패치 추적 (4.10.3~): scunpacked 원본 커밋/게임 버전/생성 시각.
                 'gameVersion': smeta.get('version'),
                 'sourceCommit': smeta.get('commit'),
                 'sourceDate': smeta.get('date'),
                 'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())},
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
