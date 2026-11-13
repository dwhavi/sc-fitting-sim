# Alpha 4.10.3 "Vanduul Incursion" 반영 수정안

- 게임 빌드: `4.10.3-LIVE.13165946` (2026-11-12 라이브)
- 데이터 원본: `StarCitizenWiki/scunpacked-data` 커밋 `f182b7f1` (2026-11-13)
- 슬롯 원본: FleetYards `/v1/models/{slug}/hardpoints` (`source=game_files`만)
- 공식 패치노트: https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21429-Star-Citizen-Alpha-4103

## 패치 주요 변경점 (피팅 시뮬 관련)

| 항목 | 내용 |
|---|---|
| 신규 함선 | **RSI Galaxy** (대형 모듈식, 카고/메디컬 모듈), **Anvil Liberator** (중형 캐리어) 비행 가능 |
| 레이더 | Carrack, Perseus, Starlancer, Starlancer TAC, Hammerhead, Tiburon 의 레이더가 **S2 → S3** (기본 장착도 교체) |
| 신규 무기 | BEHR 레이저 캐논 S1/S2/S3 (InterSec 미션 보상 블루프린트) |
| 폭탄 랙 | S1/S3 폭탄 랙 게임 내 판매 시작 (Crusader Showroom) |
| 미사일/어뢰 | S5·S7 어뢰 최소 안전거리 700m로 상향 |
| 살베지 | Reclaimer 등 5척 hull munching 용량 상향 (피팅 수치 영향 없음) |
| FPS | LBCO Skarnov 소총 추가 (시뮬 범위 밖) |

## 적용한 수정

1. **원본 동기화**: `sync_data.py` → scunpacked `f182b7f1` (4.10.3)
2. **신규 함선 2척 추가**: `RSI_Galaxy`, `ANVL_Liberator` (141 → **143척**)
   - Galaxy: 사이즈5, 승무원 6, 화물 64 SCU(기본), 스톡 DPS 7,364
   - Liberator: 사이즈6, 승무원 2, 화물 400 SCU
3. **부품 갱신**: 무기 199→202 (BEHR 캐논 3종), 랙 151→153, 터렛 455→464
4. **함선 수치 갱신**: Hammerhead 화물 40→64·승무원 9→8, Carrack 계열 EM 상승(S3 레이더) 등 22건
5. **슬롯 스냅샷 재생성**: FleetYards 전체 재수집 (9,256슬롯) + 터렛 호환 보강
   - Carrack Expedition 등 S3 레이더 슬롯 반영 확인
6. **DB 메타에 버전 기록** (신규): `gameVersion`, `sourceCommit`, `sourceDate`, `generated`
7. **캐시 무력화**: `app.js` 의 `?v=141` → `?v=143`

## 파이프라인 개선

- `sync_data.py`: 원본 커밋 메시지에서 게임 버전(`4.10.3-LIVE.13165946`)을 추출해 `.sync_meta.json` 에 기록
- `build_db.py`: meta 에 버전/커밋/생성시각 포함
- `fetch_all_ship_slots.py`: 경로 하드코딩 제거(레포 기준 상대경로), `public/fy_map.json` 선택화,
  출력 필드 축약 형식 복원, 생성시각 자동 기록, 부분 실행(FETCH_START/END/ONLY/MERGE) 지원
- `public/fy_map.json` 신규: FY slug 이 db slug 와 다른 47척 매핑 (Hornet/Aurora/Constellation 계열 등)

## 검증

- `extract_power_rn.py --verify`: **MISMATCH 0** (match 1302)
- 핵심 배열(turrets/radars 등) 비어있음 차단 가드 통과
- 슬롯: 143/143척 보유 (F8A Lightning, Heartseeker Mk II 는 FY 미지원 → 이전 스냅샷 유지)
- Avenger Stalker 등 기존 함선 슬롯 수 동일 (회귀 없음)

## 남은 제약 (기존과 동일)

- `heat`/`power`/`powerBase` 는 게임 데이터에서 삭제된 필드라 기존 DB 값을 동결 유지
- Erkul 은 수동 비교 전용 (자동 수집 안 함)
- F8A/Heartseeker Mk II 슬롯은 4.10.2 스냅샷 (FY 가 game_files 를 제공하지 않음)
