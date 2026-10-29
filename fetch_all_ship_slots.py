#!/usr/bin/env python3
"""
Fetch all ship hardpoints from FleetYards and save to local snapshot.
Replaces API dependency with static file.

Usage:
  python3 fetch_all_ship_slots.py
  # Generates public/ship_slots.json (FY hardpoints for all ships)
"""
import json, io, urllib.request, sys, time

P = "/Users/dwhavi/Projects/sc-fitting-sim/"

# Load ship list from local db
try:
    DB = json.load(io.open(P + "public/db.json"))
    ships = DB["ships"]
    print(f"Found {len(ships)} ships in db.json")
except Exception as e:
    print(f"❌ Cannot load db.json: {e}")
    sys.exit(1)

# FYMAP mapping
try:
    FYMAP = json.load(io.open(P + "public/fy_map.json"))
    print(f"FYMAP: {len(FYMAP)} mappings")
except Exception as e:
    print(f"❌ Cannot load fy_map.json: {e}")
    sys.exit(1)

all_slots = []
failed = []

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
        for h in data:
            if h.get("source") == "game_files":
                all_slots.append({
                    "slug": slug,
                    "class": ship["class"],
                    "name": ship["name"],
                    "port": h
                })
        
        print(f" ✓ {len(data)} ports ({len([h for h in data if h.get('source')=='game_files'])} game_files)")
        time.sleep(0.1)  # Avoid rate limits
        
    except Exception as e:
        print(f" ❌ {e}")
        failed.append({"slug": slug, "name": ship["name"], "error": str(e)})

# Save all slots
with io.open(P + "public/ship_slots.json", "w", encoding="utf-8") as f:
    json.dump({
        "ships": ships,
        "slots": all_slots,
        "failed": failed,
        "generated": "2026-10-29T15:00:00Z"
    }, f, ensure_ascii=False, indent=2)

print(f"\n✓ Total slots captured: {len(all_slots)}")
print(f"✗ Failed ships: {len(failed)}")
if failed:
    print("Failures:")
    for f in failed[:5]:
        print(f"  {f['name']}: {f['error']}")
    if len(failed) > 5:
        print(f"  ... and {len(failed)-5} more")

print(f"\n📁 Saved to: public/ship_slots.json")
print(f"📊 Ships with slots: {len(set(s['slug'] for s in all_slots))}/{len(ships)}")

# Quick sample check
sample_slug = list(set(s['slug'] for s in all_slots))[:3]
for slug in sample_slug:
    ports = [s for s in all_slots if s['slug'] == slug]
    print(f"  {slug}: {len(ports)} ports")
    for p in ports[:2]:
        print(f"    - {p['port']['name']} ({p['port'].get('category')})")