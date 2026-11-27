# 함선 무기 중복 정리 (2026-11-28)

사용자 요청: "함선 무기도 중복이 있는데 이것도 정리해줘봐" — 개인 화기 병합(2026-11-27, 376→62)과 같은 규칙을 함선 무기에 적용.

## 결과

- 무기 DB **202 → 177종** (25종 병합).
- 선택지(피팅 선택/최적 피팅 후보)에서 같은 표시명 중복 0 (소스 원명 그대로인
  `<= PLACEHOLDER =>` 5종 제외 — 기존 동작 유지).

## 규칙 (weapon_variants.py)

1. **병합 (MERGE)**: 같은 모델·같은 사이즈·성능 동일한 닉네임/스킨/내부 장착 변형 → 대표 1종.
   - 스킨: Sharkmouth Edition 3종, Defense Division/Raider Camo 6종, Hazard-Zone 3종.
   - 내부 변형: Mounted/LowPoly/Collector/SecurityNetwork/Turret(동성능) 13종.
   - 대표 항목에 `vn`(변형 표시명)·`ac`(별칭 클래스) 유지.
   - `ac`는 app.js `weaponByClass()` 가 해석 — 구 저장 빌드와 순정 장착(scKey, 소문자 포함) 매칭 유지.
2. **유지 (RETAIN)**: 성능이 다른 같은 이름 변형은 병합하지 않고 구분 접미어 부기.
   접미어는 클래스 식별자·제조사 필드에서 근거를 댄 것만 사용하고,
   원본 소스(scunpacked) 표시명은 바꾸지 않는다. 가용성 재분류(specialWeapon 추가)도 하지 않는다.
   - 터렛 전용(M8A/M9A/Attrition-4), Idris-M 전용, PDC/ATLS 전용, FPS 밸런스 내부 버전,
     저사양 내부 모델, 더미, 약화 버전, Bengal 탑재 2종, Gen2 Vanduul, AA 포탑 전용.
   - Javelin 전용 캐논(BEHR_JavelinBallisticCannon_S7 계열)은 소스 이름이 'M9A Cannon' —
     그대로 두고 ' (Javelin 전용)' 등 접미어만 부기.
   - FSKI 9x S3 로켓포드는 소스 이름이 HRST 18x S1과 같은 'Jericho XL' —
     제조사 필드(FireStorm Kinetics) 근거로 ' (FireStorm)' 접미어만 부기.

## 빌드 파이프라인

- `build_db.py` 가 동결 복원(freeze restore) **뒤** `weapon_variants.apply()` 호출.
  복원 단계가 별칭 클래스를 되살리므로 순서가 중요하다.
- 기존 db.json 단독 적용: `python3 weapon_variants.py public/db.json` (멱등).

## 검증

- `tests/test_weapon_variants.cjs`: 별칭 25종 해석(대소문자 포함), 선택지 중복 0(플레이스홀더 원명 제외), meta 일치.
- `tests/test_power.cjs` 전체 통과 (207척 버스트/발전 소스 대조 변화 없음).
- 회귀 주의: `weaponByClass`는 별칭 맵을 지연 생성한다 — `init()` 미경유 컨텍스트(테스트)에서도 동작.
