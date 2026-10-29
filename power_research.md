# SC 전력 배분(파워 트라이앵글/캐패시터) 수치 근거 조사 — 2026-10-28

## 0. 결론 (TL;DR)
- **위키(starcitizen.tools)에 `Power management / Capacitor / Power triangle` 전용 페이지 없음** (MediaWiki API로 missing 확인).
- **인게임 라벨(게임 텍스트 덤프)에서 PWR pane 설명 원문 확보** — G1=무기/G2=실드/G3=엔진, 파워 스로틀/EM 시그니처 언급. **단, "% 몇 증가" 같은 수치 없음.**
- **scunpacked 덤프(`data/items.json`)에 함선 단위 캐패시터 풀 수치 없음**: `RegenPool`, `WeaponCapacitor`, `"Pool"` 키 0건. 캐패시터 수치는 **무기 개별 `Consumption` + 실드 `Regeneration`**에만 존재.
- **FleetYards `CapacitorAssignmentController`의 typeData = null** (Avenger Titan 실측). 파워 삼각형 배율의 외부 근거 없음.
- **파워/쿨러 계산식의 재료는 이미 덤프에 있음** (아래 §4). 단, 파워플랜트 `PowerDraw == Output` 함정에 주의.

## 1. 인게임 파워 관리 UI 실제 효과 수치
출처: `data/labels.json` (게임 내 텍스트 덤프, curl/API 아님·로컬 덤프 직접 grep)
- `dfm_ui_PowerPane`: "…power allocation triangle allows you to quickly distribute power to specific
  groups … (generally G1 weapons, G2 shields, G3 engines, user-definable). … Reducing Power Throttle
  reduces power to all components … drastically reduce EM signature, but leave you vulnerable."
  리셋 키: `spaceship_power|v_power_reset_focus`, 진입 키: `spaceship_hud|v_hud_open_tab3`.
- `hud_PowerContext_Allocation_HelpText`: "**only active when there is insufficient power** to cover
  all systems" — 즉 배분은 전력 부족 시에만 의미 있음(인게임 문구 기준).
- `ui_CG_Capacitor_Assignment` = "Vehicles - Power Triangle Assignment"(키바인딩 명칭일 뿐 수치 없음).
- **재생률 +% 같은 수치는 라벨·위키 어디에도 없음.** 삼각형 배율은 게임 코드 하드코딩으로 보이며,
  외부 데이터 소스(위키/FleetYards/scunpacked 아이템 덤프)에 노출 안 됨.

## 2. 위키(starcitizen.tools) — curl MediaWiki API 직접 확인
- missing(페이지 없음): `Capacitor`, `Power triangle`, `Power management`, `Weapon capacitor`,
  `Ship power`, `Power distribution`, `Power`.
- 존재: `Power plant`(731자 — 발전량 표 링크가 Erkul), `Cooler`(633자), `Ship components`,
  `Shield generator`, `Ship emissions`, `Gun`, `Quantum drive`. 모두 개념 설명 수준, 배분 % 수치 없음.
- 관련 수치성 서술:
  - `Ship emissions`: EM 주범 = 에너지 무기·실드·파워플랜트. "Power management will be critical
    adjusting a ship's EM signature."
  - `Shield generator`: 클래스별 특성 서술(Civilian 평균 / Competition 고리젠·저HP / Industrial 고HP·저리젠 /
    Military 고HP·고리젠 / Stealth 저HP·저리젠·빠른 재부팅). 수치는 정성 서술のみ.
- RSI 설계노트(2014, Design Notes: Shields & Management, http 200 확보):
  구(舊) 설계 스탯 = **MSP**(실드 포인트 풀) / **RGN**(pip당 재생량) / **REC**(다운 후 회복 지연),
  + Hardening(앞면 강화)/Boost(리젠 촉진, 플랜트에서 직접 전력 소모). **현행 수치 아님**, 참고용.

## 3. scunpacked 데이터에서 캐패시터 수치 위치
로컬 덤프: `data/items.json` (9,188건), `data/labels.json` (63,375키), `data/ships.json` (156척 메타のみ).
- **무기** (`WeaponGun/Gun`, 133건): `stdItem.Weapon.Consumption` — 키셋 100% 고정 4종:
  `RequestedRegenPerSec` / `CostPerBullet` / `Cooldown` / `RequestedAmmoLoad`.
  예) Omnisky III S1: 1700 / 43발 / 0.75s / 10200. S2: 2016.67/55, S3: 2500/75.
  → 무기 캐패시터 소모율 = `RequestedRegenPerSec`(초당 요구 리젠), 탄당 `CostPerBullet`.
- **실드** (65건): `stdItem.Shield` = `Health` / `Regeneration`(초당) / `DownedDelay` / `DamagedDelay`(둘 다 5.0s 예시) /
  `Absorption{Physical/Energy/…}{Min,Max}`. 예) ASAS Mirage S1A: HP 1725 / 리젠 450/s.
- **함선 단위 풀(WeaponRegenPool/ShieldRegen 등)은 덤프에 없음** — `capacit|RegenPool|WeaponCapacitor|"Pool"`
  전수 grep 결과, 아이템 의미 있는 히트 0건(incapacitate 등 오탐のみ). 함선 풀은 아이템 XML이 아니라
  함선 entity XML 쪽에 있을 가능성 → 현 덤프(`ships.json`은 이름/경력/역할/크기/제원 메타のみ)로는 불가.
- **FleetYards 하드포인트**(Avenger Titan 67슬롯 실측, `/tmp/fy_hp.json`):
  `CapacitorAssignmentController` 존재하나 `typeData: null`. `EnergyController`(POWER)도 null.
  수치 있는 컨트롤러는 `ShieldController`(faceType bubble, maxReallocation 1.0, reconfigurationCooldown 2.5s,
  powerRanges 전부 modifier 1.0 — 사실상 더미)와 `FlightController`의 `boostCapacitor`
  (capacity 20, regenPerSecond 0.75, regenDelay 0.2 — **부스트 연료용, 무기/실드와 별개**).
- 파워 배분 프리셋·pip당 배율 같은 필드는 FleetYards 모델/하드포인트 API에도 없음.

## 4. 쿨러/파워 출력 대비 실제 소모 계산식 (덤프 필드 기준)
- **전력 수지**: `Σ PowerPlant.Output − Σ 장착품 PowerConnection.PowerDraw ≥ 0`
  ⚠️ 함정: 파워플랜트 자신의 `PowerConnection.PowerDraw` = `Output`과 동일값(예: LumaCore S1A 출력
  1472.45 / draw 1472.45). **PP의 PowerDraw를 부하에 더하면 안 됨.** `build_db.py`도 현재 `power`를
  draw로만 저장하므로, 시뮬레이터에 출력/부하 구분 필드 추가 필요.
- **열 수지**: `Σ Cooler.Rate ≥ Σ 장착품 HeatConnection.ThermalEnergyDraw`
  ⚠️ 단위 주의: Cooler Rate ~2.3e5(S1) vs 부품 ThermalEnergyDraw 수천~수만(PP LumaCore 16500,
  StarHeart 33307; 실드 5~6천). 단순 합산 비교는 가능하나 실효 냉각 효율식(heat pool 기반)은 미공개.
- **무기 지속사격**: 탄당 `CostPerBullet` + `RequestedRegenPerSec`(캐패시터 요구량). 함선 풀 총량이
  덤프에 없으므로 현재 구현 가능한 근사 = Σ 무기 요구리젠 vs (파워 여유분) 비교, 또는 Erkul식 역산.
- **실드 실효 탱킹**: `Health / Regeneration` → 완충 시간 = Health/Regen (예: Mirage 1725/450 ≈ 3.8s).
  `DownedDelay/DamagedDelay` 5.0s는 피격 후 리젠 개시 지연.
- 참고 — 현재 `build_db.py`가 저장하는 것: 무기 modes(dps/alpha/rpm), 실드 hp/regen, PP output,
  cooler rate, QD speed/cooldown/spool. **Consumption/Cooldown/CostPerBullet, Absorption,
  PowerBase, ThermalEnergyDraw, DownedDelay는 미추출** → 시뮬레이터 고도화 시 추가 추출 권장.

## 5. 다음 단계 제안
1. Erkul 계산기(`erkul.games/calculator`, SPA) JS 번들에서 캐패시터/배분 상수 역추적.
2. scunpacked 원본 함선 entity XML(아이템 덤프가 아닌 vehicle XML)에서 capacitor pool 필드 탐색.
3. Spectrum 패치노트(3.14 power management v2, 4.x MFD 변경점)에서 배율 언급 검색 — 위키 검색에서
   "power management v2" 언급 확인됨(Constellation 항목).
4. 인게임 실측(동일 함선·삼각형 위치별 실드 리젠 시간/무기 연사 sustain 측정)이 최종 ground truth.
5. 데이터 품질: `data/ports.json`이 nginx 404 HTML임(다운로드 실패 잔재). `build_db.py`는
   `/tmp/v2ships.json` 의존 — 재현 위해 데이터 출처 고정 권장.
