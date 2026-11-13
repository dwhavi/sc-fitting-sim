#!/usr/bin/env python3
"""
Fetch all ship hardpoints from FleetYards and save to local snapshot.
Replaces API dependency with static file.

Usage:
  python3 fetch_all_ship_slots.py
  # Generates public/ship_slots.json (FY hardpoints for all ships, game_files only)

출력 port 필드는 앱이 쓰는 것만 남긴다 (2026-11-13 축약 형식 복원):
  id, name, category, group, source, maxSize, component{name, scKey}
후처리: python3 enrich_turret_slots.py (터렛 호환 키 추가)
"""
import json, io, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
P = ROOT + "/"

# Load ship list from local db
try:
    DB = json.load(io.open(P + "public/db.json", encoding="utf-8"))
    ships = DB["ships"]
    print(f"Found {len(ships)} ships in db.json")
except Exception as e:
    print(f"❌ Cannot load db.json: {e}")
    sys.exit(1)

# FYMAP mapping (선택 — 없으면 db slug 그대로 사용)
FYMAP = {}
try:
    FYMAP = json.load(io.open(P + "public/fy_map.json", encoding="utf-8"))
    print(f"FYMAP: {len(FYMAP)} mappings")
except Exception:
    print("FYMAP 없음 — db slug fallback 사용")

KEEP_PORT = ("id", "name", "category", "group", "source", "maxSize")


def trim_port(h):
    p = {k: h.get(k) for k in KEEP_PORT if h.get(k) is not None}
    comp = h.get("component")
    if isinstance(comp, dict):
        p["component"] = {k: comp.get(k) for k in ("name", "scKey")
                          if comp.get(k) is not None}
    return p


all_slots = []
failed = []

# 부분 실행: FETCH_START/FETCH_END (0-based, end exclusive). 두 값 모두 없으면 전체.
# FETCH_MERGE=1: 가져오기 없이 data/raw/.slots_part_*.json 만 병합해 저장.
if os.environ.get('FETCH_MERGE'):
    _s, _e, ships = 0, 0, []
elif os.environ.get('FETCH_ONLY'):
    _only = set(os.environ['FETCH_ONLY'].split(','))
    _s, _e = 0, len(ships)
    ships = [s for s in ships if s['slug'] in _only]
    print(f'지정 실행: {len(ships)}척')
else:
    _s = int(os.environ.get('FETCH_START', '0'))
    _e = int(os.environ.get('FETCH_END', str(len(ships))))
    ships = ships[_s:_e]
if _s or _e:
    print(f'부분 실행: {_s}..{_e} ({len(ships)}척)')

for ship in ships:
    slug = ship["slug"]
    fy = FYMAP.get(ship["class"].lower(), ship["slug"])  # fallback to original slug

    try:
        print(f"Fetching {ship['name']} ({slug}) ...", end="", flush=True)
        url = f"https://api.fleetyards.net/v1/models/{fy}/hardpoints"
        req = urllib.request.Request(url, headers={'User-Agent': 'curl/8'})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.load(resp)

        # Filter and save only game_files sources (same as app.js does)
        n = 0
        for h in data:
            if h.get("source") == "game_files":
                all_slots.append({
                    "slug": slug,
                    "class": ship["class"],
                    "name": ship["name"],
                    "port": trim_port(h),
                })
                n += 1

        print(f" ✓ {len(data)} ports ({n} game_files)")
        time.sleep(0.1)  # Avoid rate limits

    except Exception as e:
        print(f" ❌ {e}")
        failed.append({"slug": slug, "name": ship["name"], "error": str(e)})

if not os.environ.get('FETCH_MERGE') and (_s or _e != len(DB["ships"])):
    # 부분 실행: 파트만 저장. 전체 실행(또는 수동 병합)으로 마무리.
    part = os.path.join(ROOT, 'data', 'raw', f'.slots_part_{_s}_{_e}.json')
    os.makedirs(os.path.dirname(part), exist_ok=True)
    json.dump({"slots": all_slots, "failed": failed},
              io.open(part, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"📁 part 저장: {part} ({len(all_slots)} slots)")
    sys.exit(0)

# 이전 부분 실행 파트가 있으면 병합 (순서대로 덮어쓰기)
import glob as _glob
_parts = sorted(_glob.glob(os.path.join(ROOT, 'data', 'raw', '.slots_part_*.json')))
if _parts:
    merged, mfailed = {}, []
    for pp in _parts:
        d = json.load(io.open(pp, encoding="utf-8"))
        for s in d["slots"]:
            merged.setdefault(s["slug"], []).append(s)
        mfailed.extend(d["failed"])
    have = {s["slug"] for s in all_slots}
    for slug, lst in merged.items():
        if slug not in have:
            all_slots.extend(lst)
    all_slots.sort(key=lambda s: (s["name"] or "", s["port"].get("name") or ""))
    if not failed:
        failed = mfailed
    print(f'파트 병합: {len(_parts)}개 → 총 {len(all_slots)} slots')

# Save all slots
with io.open(P + "public/ship_slots.json", "w", encoding="utf-8") as f:
    json.dump({
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "FleetYards /v1/models/{slug}/hardpoints (game_files only), trimmed",
        "note": "필드 축약: id,name,category,group,source,maxSize,component{name,scKey}",
        "ships": DB["ships"],
        "slots": all_slots,
        "failed": failed,
    }, f, ensure_ascii=False, indent=2)

print(f"\n✓ Total slots captured: {len(all_slots)}")
print(f"✗ Failed ships: {len(failed)}")
if failed:
    print("Failures:")
    for f_ in failed[:5]:
        print(f"  {f_['name']}: {f_['error']}")
    if len(failed) > 5:
        print(f"  ... and {len(failed)-5} more")

print(f"\n📁 Saved to: public/ship_slots.json")
print(f"📊 Ships with slots: {len(set(s['slug'] for s in all_slots))}/{len(ships)}")
