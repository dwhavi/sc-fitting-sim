# SC Fitting Sim

Star Citizen 함선 피팅 시뮬레이터 — 정적 SPA (vanilla JS, 빌드 도구 없음).

**https://sc-fitting-sim.vercel.app**

## 구성

```
public/                  배포 대상 (Vercel 정적 호스팅)
  index.html             앱 셸 + 스타일
  app.js                 전체 로직 (피팅 · 핍 배분 · 실드 탱킹)
  db.json                부품/함선 DB        ← build_db.py 산출물
  ship_slots.json        함선별 슬롯 스냅샷   ← fetch_all_ship_slots.py 산출물
  fit.js                 최적 피팅 템플릿(취향 프리셋) + 구매 목록 패널 (app.js 전역 사용)
  shops.json             부품 구매처·가격 스냅샷 ← fetch_shops.py 산출물 (UEX Corp API)

fetch_shops.py           shops.json 생성 (UEX Corp API 2.0, 표준 라이브러리만)
build_db.py              db.json 생성 (scunpacked 원본 → 큐레이션, 단독 실행)
sync_data.py             scunpacked 원본 동기화 + 패치 감지
extract_power_rn.py      전력 핍 추출 검증용 (build_db 내장, 교차검증 시 사용)
fetch_all_ship_slots.py  슬롯 스냅샷 생성 (FleetYards)
enrich_turret_slots.py   터렛 호환 보강 (ship_slots.json 후처리)
```

## 데이터 출처

| 대상 | 출처 |
|---|---|
| 부품 · 함선 성능 | `StarCitizenWiki/scunpacked-data` (게임 파일 덤프, 패치마다 갱신) |
| 함선 슬롯 | FleetYards API `/v1/models/{slug}/hardpoints` (`source=game_files`만) |

`data/raw/` 는 동기화된 프리스틴 원본이며 `.gitignore` 대상입니다 (`sync_data.py` 로 복구).

## 패치 갱신 절차

게임 패치로 밸런스가 바뀌면:

```bash
python3 sync_data.py --check                  # 새 패치 있는지 (커밋 SHA 비교)
python3 sync_data.py                          # 원본 동기화
python3 build_db.py --out /tmp/db_new.json    # 미리보기 (라이브 db.json 무접촉)
python3 extract_power_rn.py --verify          # 핍 검증 (MISMATCH 0 이어야 함)
python3 build_db.py                           # 반영
npx vercel --prod                             # 수동 배포 (public/ 에서)
# 2026-11-13~: Vercel 프로젝트가 GitHub 레포와 연동됨 → main 푸시 시 자동 배포
```

`build_db.py` 는 `turrets`/`radars` 등 핵심 배열이 비면 **exit 1 로 배포를 차단**합니다.

## 알아둘 함정

- **`heat` / `power` / `powerBase` 는 갱신 불가.** 게임 데이터에서
  `PowerConnection` / `HeatConnection` 블록이 삭제됨. `build_db.py` 가 이전
  `db.json` 에서 `className` 기준으로 **동결**해 이어받는다.
- **미사일 · 터렛은 전력을 쓰지 않는다.** `ResourceNetwork` 커버리지 0% 로 확인.
  미사일 랙의 `power=20`(PowerDraw 추정치)을 그대로 쓰면 무기 계통에 랙당
  20핍이 잡히므로 `NO_POWER_KINDS` 로 제외한다.
- **함선 파일명이 패치마다 바뀐다.** `RSI_Aurora_CL` → `rsi_aurora_gs_cl.json`,
  `AEGS_Idris` → `aegs_idris_m/_p`. `sync_data.py` 가 토큰 매칭 + `Name` 판별로 해결.
- **`/tmp` 에 원본을 두지 말 것.** 정리되면 파이프라인이 조용히 죽는다
  (`/tmp/v2ships.json` 의존이 그렇게 소실됐다).

## 개발

```bash
cd public && python3 -m http.server 8811     # 로컬 서버
```

## 라이선스

게임 데이터는 Cloud Imperium Games 자산입니다. 이 저장소의 코드는 팬 프로젝트입니다.

## 최적 피팅 템플릿 · 구매처 (2026-11-19~)

- **🎯 취향별 추천 피팅**: 전투 / 스텔스 / 이동 / 방어 / 균형 + 교전 거리 + 지역(스탠턴·파이로·닉스) + 예산.
  `fit.js` 가 시뮬레이터의 `fitStats()` 를 평가 함수로 재사용해 슬롯별 부품 조합을 탐색한다
  (같은 종류 슬롯 일괄 → 슬롯 개별 → 전력 쌍 이동; 다른 취향 결과도 시작점으로 사용).
  카드(마운트·터렛)는 바꾸지 않고 하위 무기만 고른다. 미사일 랙·추진부는 대상 아님.
- **EM/IR 지표**는 부품 정격값의 합(상대 비교용). 게임 내 실제 탐지 거리가 아니다.
- **구매처**: `shops.json` 은 `python3 fetch_shops.py` 로 UEX Corp API(커뮤니티 제보)에서 만든 스냅샷이다.
  db.json 부품과는 **이름+사이즈**로 매칭하고, 같은 이름의 변종 class(마운트형·NPC·AA 등)는 대표 1개에만 연결한다.
  구매처가 없는 부품은 "구매처 미확인". 패치마다 `build_db.py` 후 `fetch_shops.py` 를 다시 실행할 것.
- 현재 빌드가 전력 부족(전 계통 100% 가동 기준)이면 DPS 증가율이 과장돼 보일 수 있다 (UI에 경고 표시).

## 2026-11-20 패치 점검

- LIVE 클라이언트 핫픽스와 계산 원본 버전을 구분해 표시한다.
- Marauder 추가 및 공유 무기 풀의 선박 전력 집계를 보정했다.
- `sync_data.py`는 LIVE 버전과 전체 다운로드를 검증한 새 스냅샷만 교체한다. 기존 원본은 최초 1회 다시 동기화해야 한다.
- [분석·검증·남은 계산 제약](docs/PATCH_2026-11-20.md)
- 오프라인 회귀 테스트: `python3 -m unittest discover -s tests -v`, `node tests/test_power.cjs`


## 계산 검증 (2026-11-21)

[계산식·회귀 테스트·남은 제약](docs/CALCULATIONS_2026-11-21.md)을 참고하세요. 인게임 실측과 외부 덤프 일치를 구분합니다. 원본 갱신 뒤에는 `build_db.py`, `reconcile_slots.py`, `enrich_turret_slots.py` 순서로 실행하고 `node tests/test_power.cjs`를 통과시켜야 합니다.
