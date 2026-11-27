"""함선 무기 변형 병합 규칙 (2026-11-28, 사용자 요청 '함선 무기 중복 정리').

개인 화기 병합(2026-11-27, 376->62)과 같은 규칙:
  - 같은 모델·같은 사이즈·같은 성능 = 닉네임/스킨/내부 장착 변형 → 대표 1종으로 병합.
    대표 항목에 vn(변형 표시명)·ac(별칭 클래스)를 남긴다.
    ac 덕분에 구 저장 빌드·순정 장착(scKey) 매칭이 끊기지 않는다 (app.js weaponByClass).
  - 성능이 다른 변형(터렛 전용/전함 전용/내부 밸런스/저사양 모델)은 병합하지 않는다.
    대신 구분 접미어를 붙이고, 구매 불가·내부 전용은 specialWeapon=True 로
    일반 선택지·최적 피팅 후보에서 제외한다 (순정 장착 해석에는 영향 없음).

build_db.py 에서 동결 복원(freeze restore) 뒤 apply() 가 호출되고,
기존 db.json 에도 같은 규칙을 적용하기 위해 단독 실행이 가능하다:

    python3 weapon_variants.py public/db.json
"""

# 대표 클래스 -> 병합해 없앨 별칭 클래스 (성능 동일 대조 완료, 2026-11-28)
MERGE = {
    # 내부 장착 변형 (같은 이름·같은 성능)
    'GATS_BallisticGatling_S1': [
        'GATS_BallisticGatling_Mounted_S1',
        'GATS_BallisticGatling_Mounted_S1_DRAK_Cutlass_Steel',
        'GATS_BallisticGatling_Mounted_S1_FakeHologram',
    ],
    'APAR_BallisticGatling_S4': ['APAR_BallisticGatling_S4_LowPoly'],
    'BEHR_BallisticGatling_S7': ['BEHR_BallisticGatling_S7_Collector'],
    'BEHR_LaserCannon_S6': ['BEHR_LaserCannon_S6_SecurityNetwork'],
    'BEHR_LaserCannon_SF7E_S7': ['BEHR_LaserCannon_SF7E_S7_Collector'],
    'KLWE_LaserRepeater_S4': ['KLWE_LaserRepeater_S4_LowPoly'],
    'KLWE_LaserRepeater_S5': ['KLWE_LaserRepeater_S5_LowPoly',
                              'KLWE_LaserRepeater_S5_Turret'],
    'KLWE_LaserRepeater_S6': ['KLWE_LaserRepeater_S6_LowPoly'],
    'BEHR_LaserRepeater_S10': ['BEHR_LaserRepeater_S10_SecurityNetwork'],
    'KLWE_MassDriver_S10': ['KLWE_MassDriver_S10_LowPoly'],
    # 스킨 변형 (Sharkmouth Edition)
    'APAR_BallisticScatterGun_S1': ['APAR_BallisticScatterGun_S1_Shark'],
    'APAR_BallisticScatterGun_S2': ['APAR_BallisticScatterGun_S2_Shark'],
    'APAR_BallisticScatterGun_S3': ['APAR_BallisticScatterGun_S3_Shark'],
    # 스킨 변형 (Defense Division / Raider Camo)
    'BEHR_LaserCannon_S1': ['BEHR_LaserCannon_S1_CleanAir',
                            'BEHR_LaserCannon_S1_mr02'],
    'BEHR_LaserCannon_S2': ['BEHR_LaserCannon_S2_CleanAir',
                            'BEHR_LaserCannon_S2_mr02'],
    'BEHR_LaserCannon_S3': ['BEHR_LaserCannon_S3_CleanAir',
                            'BEHR_LaserCannon_S3_mr02'],
    # 스킨 변형 (Hazard-Zone)
    'KLWE_LaserRepeater_S1': ['KLWE_LaserRepeater_S1_mr01'],
    'KLWE_LaserRepeater_S2': ['KLWE_LaserRepeater_S2_mr01'],
    'KLWE_LaserRepeater_S3': ['KLWE_LaserRepeater_S3_mr01'],
}

# 병합하지 않고 유지하는 같은 이름 변형 (성능 상이).
#   suffix: 표시명 뒤에 붙일 구분자 / name: 표시명 교체 / special: 일반 선택지 숨김
RETAIN = {
    'GATS_BallisticGatling_Mounted_S1_fps_balance':
        {'suffix': ' (FPS 밸런스 내부 버전)', 'special': True},
    'KLWE_LaserRepeater_S1_ATLS': {'suffix': ' (ATLS 전용)', 'special': True},
    'KLWE_LaserRepeater_PDC_S2': {'suffix': ' (PDC 전용)', 'special': True},
    'HRST_LaserRepeater_S4_Turret': {'suffix': ' (터렛 전용)', 'special': True},
    'KLWE_LaserRepeater_S5_Idris_M': {'suffix': ' (Idris-M 전용)', 'special': True},
    'BEHR_LaserRepeater_S10_SecurityNetwork_Weak':
        {'suffix': ' (약화 버전)', 'special': True},
    'BEHR_LaserCannon_S6_Turret': {'suffix': ' (터렛 전용)', 'special': True},
    'BEHR_LaserCannon_S7_Turret': {'suffix': ' (터렛 전용)', 'special': True},
    'BEHR_LaserCannon_S7_Idris_M': {'suffix': ' (Idris-M 전용)', 'special': True},
    'BEHR_LaserCannon_S7_Idris_M_Dummy': {'suffix': ' (Idris-M 더미)', 'special': True},
    'BEHR_LaserCannon_S7_LowPoly': {'suffix': ' (저사양 내부 모델)', 'special': True},
    'BEHR_LaserCannon_S9_LowPoly': {'suffix': ' (저사양 내부 모델)', 'special': True},
    'Bengal_BallisticGatling_S6': {'suffix': ' (Bengal 탑재)', 'special': True},
    # 이름이 'M9A Cannon' 으로 잘못 달려 있던 Javelin 전용 실탄 캐논 — 실제 클래스명으로 교정
    'BEHR_JavelinBallisticCannon_S7':
        {'name': 'Javelin Ballistic Cannon (Javelin 전용)', 'special': True},
    'BEHR_JavelinBallisticCannon_S7_LowPoly':
        {'name': 'Javelin Ballistic Cannon (저사양 내부 모델)', 'special': True},
    'BEHR_JavelinBallisticCannon_S7_Dummy':
        {'name': 'Javelin Ballistic Cannon (더미)', 'special': True},
    # Gen2 Vanduul — 성능이 미세하게 달라(810 vs 808.3 DPS) 병합하지 않고 구분만
    'VNCL_Gen2_PlasmaCannon_S5': {'suffix': ' (Gen2)'},
    # 이름만 같고 실제로는 다른 전용 무기
    'AMRS_AAgun_CC_S3': {'suffix': ' (AA 포탑 전용)', 'special': True},
    'Bengal_Turret_BallisticCannon_S8': {'suffix': ' (Bengal 탑재)', 'special': True},
    # FSKI 9x S3 로켓포드가 'Jericho XL'(HRST)로 잘못 명명 — 시리즈 규칙(Yebira I=3x, II=6x)으로 교정
    'RPOD_S3_FSKI_9x_S3': {'name': 'Yebira III'},
}


def apply(weapons, log=print):
    """weapons 리스트에 MERGE/RETAIN 규칙을 적용한다 (in-place). (merged, retained) 반환."""
    by_class = {w['class']: w for w in weapons if w.get('class')}
    drop = set()
    merged = 0
    for rep_cls, aliases in MERGE.items():
        rep = by_class.get(rep_cls)
        if not rep:
            log('⚠️  대표 무기 없음: %s' % rep_cls)
            continue
        for al in aliases:
            src = by_class.get(al)
            if not src:
                continue  # 이미 병합됨(멱등)
            if src.get('name') and src['name'] != rep.get('name'):
                rep.setdefault('vn', [])
                if src['name'] not in rep['vn']:
                    rep['vn'].append(src['name'])
            rep.setdefault('ac', [])
            if al not in rep['ac']:
                rep['ac'].append(al)
            drop.add(al)
            merged += 1
    # 이름 없는 플레이스홀더('<= PLACEHOLDER =>')는 일반 선택지에서 숨긴다
    # (도감은 isPlaceholder 로 이미 숨김). 순정 장착 해석(findComp)에는 영향 없음.
    ph = 0
    for w in weapons:
        if 'PLACEHOLDER' in str(w.get('name', '')).upper() and not w.get('specialWeapon'):
            w['specialWeapon'] = True
            ph += 1
    if ph:
        log('플레이스홀더 숨김: %d' % ph)
    retained = 0
    for cls, rule in RETAIN.items():
        w = by_class.get(cls)
        if not w or cls in drop:
            continue
        if rule.get('special'):
            w['specialWeapon'] = True
        if rule.get('name'):
            if w.get('name') != rule['name']:
                w['name'] = rule['name']
                retained += 1
        elif rule.get('suffix') and rule['suffix'].strip() not in str(w.get('name', '')):
            w['name'] = str(w.get('name', '')) + rule['suffix']
            retained += 1
    if drop:
        weapons[:] = [w for w in weapons if w.get('class') not in drop]
    return merged, retained


if __name__ == '__main__':
    import io
    import json
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else 'public/db.json'
    db = json.load(io.open(path, encoding='utf-8'))
    before = len(db['weapons'])
    m, r = apply(db['weapons'])
    db['meta']['weapons'] = len(db['weapons'])
    json.dump(db, io.open(path, 'w', encoding='utf-8'), ensure_ascii=False)
    print('%s: 무기 %d -> %d (병합 %d, 구분 표기 %d)' % (path, before, len(db['weapons']), m, r))
