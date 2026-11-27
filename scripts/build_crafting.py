#!/usr/bin/env python3
"""연구 import(JSON, api.star-citizen.wiki /api/blueprints 기반) -> public/crafting.json (className 키).
슬롯별 품질(0-1000) 보정 구간만 저장. Q500=기준 스탯은 문서화되지 않은 추정이므로 meta.inferred에 명시."""
import json, sys, os
src = sys.argv[1]
d = json.load(open(src))
out = {}
for it in d['items']:
    slots = []
    for s in it['slots']:
        mods = []
        for m in s['mods']:
            mods.append([m['stat'], m['atQ0'], m['atQ1000'], m['segments'] or 0, m['label']])
        slots.append({'n': s['slot'], 'm': [[x['name'], x['scu']] for x in s['materials']], 'x': mods})
    out[it['className']] = {'u': it['sourceUrl'], 's': slots}
meta = dict(d['meta']); meta['count'] = len(out)
json.dump({'meta': meta, 'items': out}, open(os.path.join(os.path.dirname(__file__), '..', 'public', 'crafting.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out))
