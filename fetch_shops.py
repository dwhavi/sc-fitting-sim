#!/usr/bin/env python3
"""구매처(상점) 스냅샷 생성: UEX Corp + Cornerstone UIF -> public/shops.json

출처 1: https://api.uexcorp.uk/2.0  (items, items_prices; 커뮤니티 제보 기반 가격/재고)
출처 2: https://finder.cstone.space (Universal Item Finder; 커뮤니티 제보 기반 상점 목록)
  - 3.20 이후 게임 파일에 상점 인벤토리가 없어 모든 사이트가 제보 기반임.
  - 두 소스를 합쳐 커버리지를 높이고, 둘 다 없으면 '판매처 제보 없음'으로 표시.
매칭: db.json 부품 이름(정규화) + 사이즈. Cornerstone 는 품목 페이지의 SIZE 로 변종 구분.
실행: python3 fetch_shops.py   (표준 라이브러리만 사용)
"""
import json, re, sys, time, urllib.request, datetime, os, html
from concurrent.futures import ThreadPoolExecutor

API = "https://api.uexcorp.uk/2.0"
CSTONE = "https://finder.cstone.space"
UA = {"User-Agent": "sc-fitting-sim/1.0"}
UA_HTML = {"User-Agent": "Mozilla/5.0 (compatible; sc-fitting-sim/1.0)"}
# db.json 풀 이름 -> UEX 카테고리 id
CATS = {"coolers": 19, "powerplants": 21, "qds": 22, "shields": 23,
        "weapons": 32, "racks": 33, "missiles": 34, "turrets": 35, "radars": 83}
HERE = os.path.dirname(os.path.abspath(__file__))

def get(path):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, headers=UA), timeout=60) as r:
                return json.load(r)["data"]
        except Exception as e:
            print("retry", path, e, file=sys.stderr); time.sleep(2)
    raise SystemExit("UEX fetch failed: " + path)

CACHE = "/tmp/cstone_cache"
os.makedirs(CACHE, exist_ok=True)

def get_html(url):
    key = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9]", "_", url)[-150:] + ".html")
    if os.path.exists(key):
        h = open(key, encoding="utf-8").read()
        final = h.split("\n", 1)[0][9:]
        return final, h.split("\n", 1)[1]
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA_HTML), timeout=60) as r:
                final, body = r.url, r.read().decode("utf-8", "replace")
            open(key, "w", encoding="utf-8").write("<!--URL: " + final + "\n" + body)
            return final, body
        except Exception as e:
            print("retry", url, e, file=sys.stderr); time.sleep(2)
    return None, None

def norm(s): return re.sub(r"[^a-z0-9]", "", (s or "").lower())
def strip_paren(s): return re.sub(r"\([^)]*\)", "", s or "").strip()

# 같은 이름·사이즈의 변종 class(마운트형/NPC/AA/스킨 등)는 상점 품목이 아니다 -> 대표 1개에만 구매처 연결
VARIANT = re.compile(r"_Mounted|FakeHologram|fps_balance|_ATLS|_PDC|AAgun|_TE$|_SM_|Piercing|Template|Unmanned|_CC_|Ground", re.I)
# 상점에서 살 수 없는 구조물/내부 부품 이름: Cornerstone 매칭에서 제외
GENERIC = re.compile(r"^(turret|manned turret|remote turret|radar|fuel tank|data drive|power relay|cooling units|mount|tractor beam|tail cap|missile rack)$", re.I)

def canon_classes(db):
    """pool -> (canonical class 목록, class -> 부품 dict)"""
    out = {}
    for pool in CATS:
        groups = {}
        for c in db[pool]:
            if "PLACEHOLDER" in (c.get("name") or ""): continue
            groups.setdefault((norm(strip_paren(c["name"])), str(c.get("size"))), []).append(c)
        canon = {}
        for lst in groups.values():
            best = min(lst, key=lambda c: (bool(VARIANT.search(c["class"])), len(c["class"])))
            canon[best["class"]] = best
        out[pool] = canon
    return out

# ---------- UEX ----------
def fetch_uex(db, canon, terms, tidx):
    out, versions, newest, matched = {}, {}, 0, {}
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
        matched[pool] = 0
        for c in canon[pool].values():
            cand = by_name.get(norm(c["name"]), [])
            if len(cand) > 1:
                sized = [x for x in cand if str(x.get("size")) == str(c.get("size"))]
                cand = sized or cand[:1]
            if not cand: continue
            it = cand[0]
            if it["id"] not in rows: continue
            lst = out.setdefault(c["class"], [])
            for p in rows[it["id"]]:
                key = ("U", p["id_terminal"])
                if key not in tidx:
                    place = p.get("city_name") or p.get("space_station_name") or p.get("outpost_name") or p.get("orbit_name") or ""
                    body = p.get("planet_name") or p.get("moon_name") or ""
                    tidx[key] = len(terms)
                    terms.append({"n": p.get("terminal_name"), "sys": p.get("star_system_name"),
                                  "loc": " / ".join(x for x in dict.fromkeys([body, place]) if x), "src": "U"})
                lst.append([tidx[key], p["price_buy"], "U"])
            matched[pool] += 1
    meta = {"versions": versions,
            "newest": datetime.datetime.utcfromtimestamp(newest).strftime("%Y-%m-%d") if newest else "?"}
    return out, matched, meta

# ---------- Cornerstone UIF ----------
SIZE_RE = re.compile(r">\s*SIZE\s*</td>\s*<td[^>]*>\s*(\d+)\s*</td>", re.I)
ROW_RE = re.compile(r'<tr>\s*<td[^>]*>\s*<a[^>]*href="/Location1/([^"]+)"[^>]*>(.*?)</a>\s*</td>\s*<td[^>]*>\s*([\d\s,.]+)\s*</td>', re.S)
SYS_OK = {"Stanton", "Pyro", "Nyx"}

def cstone_page(entry):
    """품목 페이지 -> (카테고리 경로, size, [(sys, shop, loc, price), ...])"""
    url, h = get_html(CSTONE + "/Search/" + entry["id"])
    if not h or not url: return None
    path = re.sub(r"https?://[^/]+", "", url)
    if not path.startswith("/Ship"): return (path, None, [])
    m = SIZE_RE.search(h)
    size = int(m.group(1)) if m else None
    rows = []
    for loc_url, loc_txt, price in ROW_RE.findall(h):
        parts = [html.unescape(x).strip() for x in html.unescape(loc_txt).split(" - ")]
        parts = [p for p in parts if p]
        if len(parts) < 2 or parts[0] not in SYS_OK: continue
        pr = re.sub(r"[^\d]", "", price)
        if not pr: continue
        rows.append((parts[0], parts[-1], " / ".join(parts[1:-1]), int(pr)))
    return (path, size, rows)

def fetch_cstone(db, canon, terms, tidx):
    url, h = get_html(CSTONE + "/GetSearch")
    index = json.loads(h)
    by_name = {}
    for e in index: by_name.setdefault(norm(e["name"]), []).append(e)
    by_name_sp = {}
    for e in index: by_name_sp.setdefault(norm(strip_paren(e["name"])), []).append(e)

    # 풀별로 페이지를 가져올 (class, 부품, 후보 목록) 수집
    jobs = {}
    for pool in CATS:
        for c in canon[pool].values():
            if GENERIC.match(strip_paren(c["name"] or "")): continue
            cand = by_name.get(norm(c["name"])) or by_name_sp.get(norm(strip_paren(c["name"]))) or []
            # 함선 부품 페이지만 쓰기 위해 후보가 많으면 일단 전부 확인
            if cand: jobs[c["class"]] = (c, cand)

    results = {}
    def work(cls_c_cand):
        cls, (c, cand) = cls_c_cand
        got = []
        for e in cand[:4]:
            pg = cstone_page(e)
            time.sleep(0.05)
            if not pg: continue
            path, size, rows = pg
            if not path.startswith("/Ship"): continue
            if size is not None and str(size) != str(c.get("size")): continue
            got.append((e, rows))
        return cls, got

    with ThreadPoolExecutor(max_workers=8) as ex:
        for cls, got in ex.map(work, jobs.items()):
            results[cls] = got

    out, matched, sold_flag = {}, {}, {}
    for pool in CATS:
        matched[pool] = 0
        for c in canon[pool].values():
            cls = c["class"]
            if cls in jobs: sold_flag[cls] = any(e.get("Sold") for e, _ in results.get(cls, [])) or any(e.get("Sold") for e in (by_name.get(norm(c["name"])) or []))
            lst = []
            for e, rows in results.get(cls, []):
                for sys_, shop, loc, price in rows:
                    key = ("C", sys_, shop, loc)
                    if key not in tidx:
                        tidx[key] = len(terms)
                        terms.append({"n": shop, "sys": sys_, "loc": loc, "src": "C"})
                    lst.append([tidx[key], price, "C"])
            if lst:
                out[cls] = lst
                matched[pool] += 1
    return out, matched, sold_flag

def main():
    db = json.load(open(os.path.join(HERE, "public/db.json")))
    canon = canon_classes(db)
    terms, tidx = [], {}

    uex, uex_matched, uex_meta = fetch_uex(db, canon, terms, tidx)
    print("UEX matched:", json.dumps(uex_matched), file=sys.stderr)

    cstone, cs_matched, sold_flag = fetch_cstone(db, canon, terms, tidx)
    print("Cornerstone matched:", json.dumps(cs_matched), file=sys.stderr)

    # 병합: 같은 class 의 제안을 합치고 가격순 정렬
    items, matched, total = {}, {}, {}
    not_sold = []
    for pool in CATS:
        matched[pool] = total[pool] = 0
        for cls, c in canon[pool].items():
            total[pool] += 1
            offers = list(uex.get(cls, [])) + list(cstone.get(cls, []))
            if offers:
                seen = set()
                dedup = []
                for o in sorted(offers, key=lambda x: x[1]):
                    k = (o[0], o[1])
                    if k in seen: continue
                    seen.add(k); dedup.append(o)
                items[cls] = dedup
                matched[pool] += 1
            elif cls in sold_flag and not sold_flag[cls]:
                not_sold.append(cls)

    meta = {"source": "UEX Corp + Cornerstone UIF (커뮤니티 제보 기반)",
            "fetched": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"),
            "newestReport": uex_meta["newest"],
            "reportVersions": uex_meta["versions"],
            "matched": matched, "total": total,
            "matchedUEX": uex_matched, "matchedCStone": cs_matched,
            "notSold": len(not_sold)}
    json.dump({"meta": meta, "terms": terms, "items": items, "notSold": not_sold},
              open(os.path.join(HERE, "public/shops.json"), "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(meta, ensure_ascii=False))

if __name__ == "__main__": main()
