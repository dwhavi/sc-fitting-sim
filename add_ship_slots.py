#!/usr/bin/env python3
"""Add FleetYards slot snapshots for ships that are in db.json but have no slots yet.

Existing slots are never touched (saved-build keys stay stable).
FleetYards slug lookup: public/fy_map.json, then FleetYards model scIdentifier
(= game class name, lower case), then the db slug.

Usage (after build_db.py wrote public/db.json):
  python3 add_ship_slots.py
  python3 enrich_turret_slots.py && python3 reconcile_slots.py
"""
import io, json, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
P = ROOT + '/public/'
KEEP_PORT = ('id', 'name', 'category', 'group', 'source', 'maxSize')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'curl/8'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def trim_port(h):
    p = {k: h.get(k) for k in KEEP_PORT if h.get(k) is not None}
    comp = h.get('component')
    if isinstance(comp, dict):
        p['component'] = {k: comp.get(k) for k in ('name', 'scKey') if comp.get(k) is not None}
    return p


def fy_models():
    out, page = {}, 1
    while True:
        d = get('https://api.fleetyards.net/v1/models?' + urllib.parse.urlencode({'perPage': 200, 'page': page}))
        items = d['items'] if isinstance(d, dict) else d
        if not items:
            break
        for m in items:
            if m.get('scIdentifier'):
                out[m['scIdentifier'].lower()] = m['slug']
        if len(items) < 200:
            break
        page += 1
    return out


def main():
    db = json.load(io.open(P + 'db.json', encoding='utf-8'))
    slots = json.load(io.open(P + 'ship_slots.json', encoding='utf-8'))
    fymap = json.load(io.open(P + 'fy_map.json', encoding='utf-8'))
    have = {s['slug'] for s in slots['slots']}
    todo = [s for s in db['ships'] if s['slug'] not in have]
    print(f'슬롯 없는 함선 {len(todo)}척')
    if not todo:
        return
    lim = int(os.environ.get('ADD_SLOTS_LIMIT', '0'))
    if lim:
        todo = todo[:lim]
    sc = fy_models()
    failed = []
    for s in todo:
        fy = fymap.get(s['class'].lower()) or sc.get(s['class'].lower()) or s['slug']
        try:
            data = get(f'https://api.fleetyards.net/v1/models/{fy}/hardpoints')
            n = 0
            for h in data:
                if h.get('source') == 'game_files':
                    slots['slots'].append({'slug': s['slug'], 'class': s['class'], 'name': s['name'], 'port': trim_port(h)})
                    n += 1
            print(f"{s['name']} ({fy}): {n}")
            if n == 0:
                failed.append({'slug': s['slug'], 'name': s['name'], 'error': 'no game_files hardpoints'})
        except Exception as e:
            print(f"{s['name']} ({fy}): FAIL {e}")
            failed.append({'slug': s['slug'], 'name': s['name'], 'error': str(e)})
        time.sleep(0.1)
    slots['slots'].sort(key=lambda x: (x['name'] or '', x['port'].get('name') or ''))
    slots['ships'] = len({x['slug'] for x in slots['slots']})
    slots['failed'] = failed
    slots['generated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with io.open(P + 'ship_slots.json', 'w', encoding='utf-8') as f:
        json.dump(slots, f, ensure_ascii=False, indent=2)
    print(f'완료. 실패 {len(failed)}')


if __name__ == '__main__':
    main()
