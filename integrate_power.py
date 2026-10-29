"""data/power_units.json 의 실제 SPowerSegmentResourceUnit.units 를 public/db.json 에 병합.

각 부품에 다음 필드를 추가한다:
  pw        : 실제 소비 핍 (SPowerSegmentResourceUnit.units)   — 파워플랜트는 None
  pwGen     : 실제 발전 핍 (파워플랜트)                        — 그 외 None
  pwMinFrac : minimumConsumptionFraction (셀 수 있는 최소 소비 비율)
  em        : EMSignature nominalSignature (실제 스캔 시그니처)

단위 주의: units 는 정수가 아닐 수 있다 (예: 무기 1.2). 핍 블럭 표시는
ceil() 로 올림하고, 총량 계산에는 raw 값을 그대로 쓴다.
"""
import io
import json

ROOT = "/Users/dwhavi/Projects/sc-fitting-sim"
DB = ROOT + "/public/db.json"
UNITS = ROOT + "/data/power_units.json"
CATS = ["weapons", "shields", "powerplants", "coolers", "qds", "radars",
        "racks", "turrets", "missiles"]

db = json.load(io.open(DB, encoding="utf-8"))
pu = json.load(io.open(UNITS, encoding="utf-8"))["units"]

stats = {}
for cat in CATS:
    hit = cons = gen = 0
    for it in db.get(cat, []):
        rec = pu.get(it.get("class"))
        # 이전 실행 잔재 제거 후 재설정
        for k in ("pw", "pwGen", "pwMinFrac", "em"):
            it.pop(k, None)
        if not rec:
            continue
        hit += 1
        if rec.get("power_consume") is not None:
            it["pw"] = rec["power_consume"]
            cons += 1
        if rec.get("power_generate") is not None:
            it["pwGen"] = rec["power_generate"]
            gen += 1
        if rec.get("minFraction") is not None:
            it["pwMinFrac"] = rec["minFraction"]
        if rec.get("em") is not None:
            it["em"] = rec["em"]
    stats[cat] = (hit, cons, gen)

db["powerMeta"] = {
    "source": "StarCitizenWiki/scunpacked-data items/*.json",
    "field": "ItemResourceComponentParams.states[].deltas[].resourceAmountPerSecond.SPowerSegmentResourceUnit.units",
    "note": "실제 게임 데이터 핍. 블럭 표시는 ceil(raw), 총량은 raw.",
}
json.dump(db, io.open(DB, "w", encoding="utf-8"), ensure_ascii=False)

print("병합 결과 (카테고리: 매칭 / 소비핍 / 발전핍)")
for cat in CATS:
    h, c, g = stats[cat]
    tot = len(db.get(cat, []))
    print("  %-12s %3d/%3d  consume=%3d generate=%3d" % (cat, h, tot, c, g))

# 함선 단위 검증: 발전 총량 vs 최대 소비 총량
pp = [i for i in db["powerplants"] if i.get("pwGen")]
if pp:
    print("\n발전핍 분포: min=%s max=%s" % (min(i["pwGen"] for i in pp), max(i["pwGen"] for i in pp)))
cons_items = [(i["name"], i["pw"]) for i in db["shields"] if i.get("pw")]
cons_items += [(i["name"], i["pw"]) for i in db["coolers"] if i.get("pw")]
cons_items += [(i["name"], i["pw"]) for i in db["qds"] if i.get("pw")]
if cons_items:
    print("소비핍 분포(실드/쿨러/QD): min=%s max=%s" % (
        min(c for _, c in cons_items), max(c for _, c in cons_items)))
w = [(i["name"], i["pw"]) for i in db["weapons"] if i.get("pw")]
if w:
    print("무기 소비핍: min=%s max=%s (샘플 %s)" % (
        min(c for _, c in w), max(c for _, c in w), w[:3]))
print("\nsaved:", DB)
