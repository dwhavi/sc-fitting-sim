"""scunpacked 개별 아이템 파일에서 실제 Power 핍(units) 추출 → data/power_units.json

소스: StarCitizenWiki/scunpacked-data  items/<classname_lower>.json
경로: Raw.Entity.Components.ItemResourceComponentParams.states.ItemResourceState

주의(함정):
- ItemResourceState / deltas 가 dict 인 아이템과 **list 인 아이템이 섞여 있음**
  → 반드시 양쪽 모두 처리해야 한다 (초기 수집에서 75건이 이 때문에 실패).
- Power 단위는 SPowerSegmentResourceUnit.units (= 핍). Coolant/Shield 쪽은
  SStandardResourceUnit 이므로 값의 의미가 다르다.
- 발전(generation Power)은 파워플랜트, 소비(consumption Power)는 그 외 부품.

사용: python3 fetch_power_units.py            # 기존 파일에 증분 보강
      python3 fetch_power_units.py --rebuild  # 전체 재수집
"""
import argparse
import concurrent.futures as cf
import io
import json
import os
import subprocess
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "public", "db.json")
OUT = os.path.join(ROOT, "data", "power_units.json")
BASE = ("https://raw.githubusercontent.com/StarCitizenWiki/"
        "scunpacked-data/master/items/{}.json")
UA = "Mozilla/5.0 sc-fitting-sim/0.1"


def as_list(v):
    """dict/list 어느 쪽이든 리스트로 정규화."""
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def u_units(r):
    if not isinstance(r, dict):
        return None
    for v in (r.get("resourceAmountPerSecond") or {}).values():
        if isinstance(v, dict):
            if "units" in v:
                return v["units"]
            if "standardResourceUnits" in v:
                return v["standardResourceUnits"]
    return None


def parse(d):
    comps = (((d.get("Raw") or {}).get("Entity") or {}).get("Components") or {})
    res = comps.get("ItemResourceComponentParams") or {}
    # states 는 세 형태가 모두 존재한다 (함정):
    #   1) {"ItemResourceState": {...}}          -> 단일 상태 dict
    #   2) {"ItemResourceState": [{...}, {...}]} -> 복수 상태
    #   3) [{...}, {...}]                        -> states 자체가 리스트
    raw_states = res.get("states")
    if isinstance(raw_states, dict):
        states = as_list(raw_states.get("ItemResourceState"))
    else:
        states = as_list(raw_states)

    rec = {"power_consume": None, "power_generate": None, "minFraction": None,
           "em": None, "priority": res.get("defaultPriority"),
           "states": [s.get("name") for s in states if isinstance(s, dict)]}

    for st in states:
        if not isinstance(st, dict):
            continue
        for dv in as_list(st.get("deltas")):
            if not isinstance(dv, dict):
                continue
            cons = dv.get("consumption") or {}
            gen = dv.get("generation") or {}
            if cons.get("resource") == "Power" and rec["power_consume"] is None:
                u = u_units(cons)
                if u is not None:
                    rec["power_consume"] = u
                    if dv.get("minimumConsumptionFraction") is not None:
                        rec["minFraction"] = dv["minimumConsumptionFraction"]
            if gen.get("resource") == "Power" and rec["power_generate"] is None:
                u = u_units(gen)
                if u is not None:
                    rec["power_generate"] = u
        sp = st.get("signatureParams") or {}
        em = (sp.get("EMSignature") or {}).get("nominalSignature")
        if em is not None and rec["em"] is None:
            rec["em"] = em
    return rec


def fetch_curl(cn):
    url = BASE.format(cn.lower())
    r = subprocess.run(["curl", "-sL", "-A", UA, "--max-time", "25",
                        "-w", chr(10) + "%{http_code}", url],
                       capture_output=True, text=True)
    parts = r.stdout.rsplit(chr(10), 1)
    if len(parts) != 2:
        return cn, None, "bad-out"
    body, code = parts[0], parts[1].strip()
    if code == "404":
        return cn, None, "404"
    if code != "200" or not body.strip().startswith("{"):
        return cn, None, "http" + code
    try:
        return cn, parse(json.loads(body)), None
    except Exception as e:
        return cn, None, "parse:" + type(e).__name__


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    db = json.load(io.open(DB, encoding="utf-8"))
    targets = []
    for key in ["weapons", "shields", "powerplants", "coolers", "qds", "radars",
                "racks", "turrets", "missiles"]:
        for it in db.get(key, []):
            if it.get("class"):
                targets.append(it["class"])
    targets = sorted(set(targets))
    print("대상 클래스:", len(targets))

    if os.path.exists(OUT) and not args.rebuild:
        data = json.load(io.open(OUT, encoding="utf-8"))
    else:
        data = {"units": {}, "missing": [], "failed": []}

    todo = [c for c in targets if c not in data["units"] and c not in data["missing"]]
    if data.get("failed"):
        todo = sorted(set(todo) | set(data["failed"]))
    print("수집 대상:", len(todo), "(기보유", len(data["units"]), ")")

    t0 = time.time()
    added = 0
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for i, (cn, rec, err) in enumerate(ex.map(fetch_curl, todo)):
            if rec:
                data["units"][cn] = rec
                added += 1
                if cn in data.get("failed", []):
                    data["failed"].remove(cn)
            elif err == "404":
                if cn not in data["missing"]:
                    data["missing"].append(cn)
            else:
                if cn not in data["failed"]:
                    data["failed"].append(cn)
            if (i + 1) % 100 == 0:
                print(f"  {i+1}/{len(todo)}  added={added}  ({time.time()-t0:.0f}s)", flush=True)

    data["missing"] = sorted(set(data["missing"]))
    data["failed"] = sorted(set(data["failed"]))
    data["meta"] = {"source": "StarCitizenWiki/scunpacked-data items/*.json",
                    "field": "ItemResourceComponentParams.states.ItemResourceState",
                    "unit": "SPowerSegmentResourceUnit.units",
                    "updated": time.strftime("%Y-%m-%d")}
    json.dump(data, io.open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    u = data["units"]
    print("DONE units=%d consume=%d generate=%d | 404=%d fail=%d | %.0fs" % (
        len(u),
        sum(1 for v in u.values() if v["power_consume"] is not None),
        sum(1 for v in u.values() if v["power_generate"] is not None),
        len(data["missing"]), len(data["failed"]), time.time() - t0))
    if data["failed"]:
        print("실패 예시:", data["failed"][:8])
    print("saved:", OUT)


if __name__ == "__main__":
    main()
