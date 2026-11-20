import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m
class SlotTests(unittest.TestCase):
    def test_real_stock_placeholder_is_not_dropped(self):
        m=load('build_db')
        cls='SHLD_BANU_S02_Placeholder_SCItem'
        self.assertTrue(m.is_test(cls))
        m.STOCK_CLASSES.add(cls.lower())
        self.assertFalse(m.is_test(cls))
        self.assertTrue(m.is_test('test_placeholder_dummy'))
    def test_mixed_direct_and_nested_guns_are_both_preserved(self):
        m=load('enrich_turret_slots')
        gun=lambda name: {'HardpointName':name,'ClassName':name,'Type':'WeaponGun.Gun','MaxSize':3,'MinSize':3}
        data={'Loadout':[{'HardpointName':'turret','ClassName':'test_turret','Type':'TurretBase.MannedTurret','Loadout':[
            gun('direct'),{'HardpointName':'gimbal','Type':'Turret.GunTurret','Loadout':[gun('nested')]}]}]}
        with tempfile.TemporaryDirectory() as td, patch.object(m,'RAW_SHIPS',td):
            Path(td,'test.json').write_text(json.dumps(data))
            out=m.extract('test.json')['turret']['childGuns']
        self.assertEqual([x['stock'] for x in out],['direct','nested'])
    def test_suffix_match_is_unique_and_excludes_seats(self):
        m=load('enrich_turret_slots')
        info={'turret_rear': {'gun':'one'}}
        self.assertEqual(m.match_info({'name':'wing-turret_rear','category':'weapon_mounts'},info), {'gun':'one'})
        self.assertIsNone(m.match_info({'name':'hardpoint_seat_access_turret_rear','category':'unknown'},info))
        self.assertIsNone(m.match_info({'name':'wing_turret_rear','category':'weapon_mounts'},
                                      {'turret_rear':1,'rear':2}))
if __name__=='__main__':unittest.main()
