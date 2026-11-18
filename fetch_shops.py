#!/usr/bin/env python3
"""구매처(상점) 스냅샷 생성: UEX Corp API 2.0 -> public/shops.json

출처: https://api.uexcorp.uk/2.0  (items, items_prices; 커뮤니티 제보 기반 가격/재고)
매칭: db.json 부품 이름(정규화) + 사이즈. 매칭 안 되는 부품은 '구매처 미확인'.
실행: python3 fetch_shops.py   (표준 라이브러리만 사용)
"""
import json, re, sys, time, urllib.request, datetime, os

API = "https://api.uexcorp.uk/2.0"
# db.json 풀 이름 -> UEX 카테고리 id
CATS = {"coolers": 19, "powerplants": 21, "qds": 22, "shields": 23,
        "weapons": 32, "racks": 33, "missiles": 34, "turrets": 35, "radars": 83}
HERE = os.path.dirname(os.path.abspath(__file__))

def get(path):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, headers={"User-Agent": "sc-fitting-sim/1.0"}), timeout=60) as r:
                return json.load(r)["data"]
        except Exception as e:
            print("retry", path, e, file=sys.stderr); time.sleep(2)
    raise SystemExit("UEX fetch failed: " + path)

def norm(s): return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def main():
    db = json.load(open(os.path.join(HERE, "public/db.json")))
    terms, tidx, out = [], {}, {}
    versions, newest, matched, total = {}, 0, {}, {}
    for pool, cid in CATS.items():
        items = get(f"/items?id_category={cid}")
        prices = get(f"/items_prices?id_category={cid}")
        by_name = {}
        for it in items: by_name.setdefault(norm(it["name"]), []).append(it)
        rows = {}
        for p in prices:
            if not (p.get("price_buy") or 0) > 0 or p.get("terminal_is_player_owned"): continue
            rows.setdefault(p["id_item"], []).append(p)
            versions[p.get("game_version")] = versions.get(p.get("game_version"), 0) + 1
            newest = max(newest, p.get("date_modified") or 0)
        matched[pool] = total[pool] = 0
        # 같은 이름·사이즈의 변종 class(마운트형/NPC/AA/스킨 등)는 상점 품목이 아니다 -> 대표 1개에만 구매처 연결
        VARIANT = re.compile(r"_Mounted|FakeHologram|fps_balance|_ATLS|_PDC|AAgun|_TE$|_SM_|Piercing|Template|Unmanned|_CC_|Ground", re.I)
        groups = {}
        for c in db[pool]:
            if "PLACEHOLDER" in (c.get("name") or ""): continue
            groups.setdefault((norm(c["name"]), str(c.get("size"))), []).append(c)
        canon = set()
        for lst in groups.values():
            canon.add(min(lst, key=lambda c: (bool(VARIANT.search(c["class"])), len(c["class"])))["class"])
        for c in db[pool]:
            if "PLACEHOLDER" in (c.get("name") or ""): continue
            total[pool] += 1
            if c["class"] not in canon: continue
            cand = by_name.get(norm(c["name"]), [])
            if len(cand) > 1:
                sized = [x for x in cand if str(x.get("size")) == str(c.get("size"))]
                cand = sized or cand[:1]
            if not cand: continue
            it = cand[0]
            if it["id"] not in rows: continue
            lst = out.setdefault(c["class"], {})
            for p in rows[it["id"]]:
                key = p["id_terminal"]
                if key not in tidx:
                    place = p.get("city_name") or p.get("space_station_name") or p.get("outpost_name") or p.get("orbit_name") or ""
                    body = p.get("planet_name") or p.get("moon_name") or ""
                    tidx[key] = len(terms)
                    terms.append({"n": p.get("terminal_name"), "sys": p.get("star_system_name"),
                                  "loc": " / ".join(x for x in dict.fromkeys([body, place]) if x)})
                lst[tidx[key]] = p["price_buy"]
            matched[pool] += 1
    items = {k: sorted([[t, pr] for t, pr in v.items()], key=lambda x: x[1]) for k, v in out.items()}
    meta = {"source": "UEX Corp API 2.0 (api.uexcorp.uk/2.0, community-reported)",
            "fetched": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"),
            "newestReport": datetime.datetime.utcfromtimestamp(newest).strftime("%Y-%m-%d"),
            "reportVersions": versions, "matched": matched, "total": total}
    json.dump({"meta": meta, "terms": terms, "items": items}, open(os.path.join(HERE, "public/shops.json"), "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(meta, ensure_ascii=False))

if __name__ == "__main__": main()
