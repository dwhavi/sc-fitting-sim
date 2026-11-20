import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ShipStatusTests(unittest.TestCase):
    """public/ship_status.json — 인게임 구현 감사 결과가 DB 전체 함선을 덮는지 검증.

    새 함선이 db.json에 추가됐는데 감사 항목이 없으면 실패한다.
    (미검증 함선이 조용히 선택 목록에 들어가는 것을 막기 위함)
    """

    @classmethod
    def setUpClass(cls):
        cls.db = json.loads((ROOT / 'public' / 'db.json').read_text(encoding='utf-8'))
        cls.status = json.loads((ROOT / 'public' / 'ship_status.json').read_text(encoding='utf-8'))

    def test_meta_present(self):
        meta = self.status.get('meta', {})
        self.assertTrue(meta.get('checkedAt'), '감사일 누락')
        self.assertTrue(meta.get('sources'), '감사 출처 누락')

    def test_every_ship_audited(self):
        audited = self.status['ships']
        missing = [s['class'] for s in self.db['ships'] if s['class'] not in audited]
        self.assertEqual(missing, [], f'감사 항목 없는 함선: {missing}')

    def test_no_stale_entries(self):
        live = {s['class'] for s in self.db['ships']}
        stale = [c for c in self.status['ships'] if c not in live]
        self.assertEqual(stale, [], f'DB에 없는 감사 항목: {stale}')

    def test_status_values(self):
        for klass, ent in self.status['ships'].items():
            self.assertIn(ent.get('st'), ('live', 'special'), f'{klass}: 잘못된 상태')
            self.assertTrue(ent.get('src'), f'{klass}: 출처 누락')
            if ent['st'] == 'special':
                self.assertTrue(ent.get('note'), f'{klass}: 특수 함선인데 설명 누락')


if __name__ == '__main__':
    unittest.main()
