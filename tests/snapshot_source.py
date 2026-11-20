"""Rebuild independent source fixture after sync_data.py; review differences before commit."""
import json
from pathlib import Path
r=Path(__file__).resolve().parents[1]; meta=json.loads((r/'data/raw/.sync_meta.json').read_text()); rows={}
for c,f in meta['class_to_file'].items():
 s=json.loads((r/'data/raw/ships'/f).read_text());w=s.get('Weaponry') or {};sh=s.get('ShieldsTotal') or {};cool=s.get('Cooling') or {}
 rows[c]={'file':f,'pilotBurst':w.get('PilotDps') or 0,'turretBurst':w.get('TurretDps') or 0,'hp':sh.get('Hp') or 0,'regen':sh.get('Regen') or 0,'cooling':cool.get('GenerationSegments') or 0}
(r/'tests/source_stock.json').write_text(json.dumps({'sourceCommit':meta['commit'],'version':meta['version'],'ships':rows},indent=2)+'\n')
