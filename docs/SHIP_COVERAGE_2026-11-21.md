# Released-ship coverage follow-up, 2026-11-21

Source snapshot: scunpacked f182b7f111279c9193df81927c9b4dbc8c4f3291, LIVE 4.10.3-LIVE.13165946.

The selectable DB now has 206 entries, compared with 144 before the missing-ship restoration. This is not a claim of complete coverage of every variant or ground vehicle. ship_manifest.json records checked release evidence and unresolved entries. Discovery reports unmanaged source files for review and does not automatically publish them.

## Starlancer TAC

The missing 403.2 turret burst DPS was two WeaponMount.WeaponControl door guns, 201.6 each. The slot generator handled Turret and TurretBase but not WeaponMount. This is fixed. The two nested missile-gimbal racks are also included using complete hardpoint paths to avoid their repeated child names colliding.

Stock TAC now has 14 guns, pilot burst 7373.6, turret burst 5312.8 and 28 missiles. The total burst, power, generation, shield and cooler values agree with the pinned extractor aggregates. This is source comparison, not a game execution test.

Reconciliation no longer assigns fixed WeaponMount control objects as selectable item components. The seven existing Valkyrie/Cutlass Steel door-gun slots remain stable on reruns without manual output repairs.

## Committed comparisons and limitations

`tests/snapshot_source.py` extracts a separate source fixture directly from the raw ship files. `tests/test_power.cjs` compares every selectable ship against it. All 206 total burst values and cooler-generation values agree. 195 ship power totals agree, with the 11 previously recorded ground-vehicle shield-draw differences remaining. All 206 generation values agree.

The deeper comparison also records unresolved differences in `tests/source_differences.json`: 31 ships have shield HP/regen differences and 12 have pilot/turret attribution differences even though total burst agrees. These are explicit regression baselines, not validated equalities. The app includes reserve shield HP; the extractor aggregate and app also differ in shield-pool regeneration convention. No shield values were changed to force a match. Hull B/C and Zeus CL/ES are among these shield differences. Do not describe all shield calculations as source-verified.

Tiburon remains pending. Its beam is a real bespoke weapon, not proven unusable merely because the mount is locked. Its 18000 component DPS cannot safely be added to ordinary ship DPS without modeling and labeling its special firing cycle. The previous unconditional test exception has been removed. Mauler, Stinger and Hyun remain unverified for selectable LIVE coverage.

## Sources

- https://github.com/StarCitizenWiki/scunpacked-data
- https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/f182b7f111279c9193df81927c9b4dbc8c4f3291/ships/misc_starlancer_tac.json
- https://starcitizen.tools/Starlancer_TAC
- https://starcitizen.tools/Tiburon
- https://starcitizen.tools/Supremacy-10T_Laser_Beam
