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

build_db.py              db.json 생성 (scunpacked 원본 → 큐레이션)
sync_data.py             scunpacked 원본 동기화 + 패치 감지
extract_power_rn.py      전력 핍 추출 (ResourceNetwork 기반) + 검증
fetch_all_ship_slots.py  슬롯 스냅샷 생성 (FleetYards)
extend_db.py             (레거시) heat/powerBase 보강
fetch_power_units.py     (레거시) per-item 핍 크롤
integrate_power.py       (레거시) power_units.json 병합
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
npx vercel --prod                             # 배포 (public/ 에서)
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
