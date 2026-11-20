import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

class PipelineTests(unittest.TestCase):
    def test_sync_snapshot(self):
        for mode in ('success', 'failure', 'ptu', 'unknown', 'unresolved'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as td:
                m = module('sync_data')
                raw = Path(td) / 'raw'
                raw.mkdir()
                (raw / 'marker').write_text('original')
                m.RAW = str(raw)
                m.META = str(raw / '.sync_meta.json')
                m.FILELIST = str(raw / 'ship_files.json')
                version = '5.0.0-PTU.1' if mode == 'ptu' else '4.10.3-LIVE.1'
                m.remote_sha = lambda: (None, None, None) if mode == 'unknown' else ('a'*40, '2026-11-20', version)
                m.api = lambda url: {'tree': [{'path': 'ships/ship.json'}]}
                m.load_manifest = lambda: {}
                m.db_ships = lambda: [{'class': 'unknown' if mode == 'unresolved' else 'ship', 'name': 'Ship'}]
                def get(remote, dest, rebuild=False):
                    self.assertIn('a'*40, m.BASE)
                    if mode == 'failure' and remote.startswith('ships/'):
                        return 'fail'
                    Path(dest).parent.mkdir(parents=True, exist_ok=True)
                    Path(dest).write_text('{}')
                    return 'ok'
                m.get = get
                with patch('sys.argv', ['sync_data.py']), contextlib.redirect_stdout(io.StringIO()):
                    if mode == 'success':
                        m.main()
                        meta = json.loads((raw / '.sync_meta.json').read_text())
                        self.assertTrue(meta['complete'])
                        self.assertEqual(meta['ships_ok'], 1)
                        self.assertFalse((raw / 'marker').exists())
                    else:
                        with self.assertRaises((SystemExit, RuntimeError)):
                            m.main()
                        self.assertEqual((raw / 'marker').read_text(), 'original')
    def test_builder_refuses_unverified_snapshot_without_touching_output(self):
        for metadata in ({'version': '4.10.3-LIVE.1'}, {'version': '5.0.0-PTU.1', 'complete': True},
                         {'version': '4.10.3-LIVE.1', 'complete': True, 'ships_failed': ['x']}):
            with self.subTest(metadata=metadata), tempfile.TemporaryDirectory() as td:
                m = module('build_db')
                m.RAW = td
                Path(td, 'items.json').write_text('[]')
                Path(td, '.sync_meta.json').write_text(json.dumps(metadata))
                output = Path(td, 'output.json')
                output.write_text('original')
                with patch('sys.argv', ['build_db.py', '--out', str(output)]), self.assertRaises(SystemExit):
                    m.main()
                self.assertEqual(output.read_text(), 'original')

if __name__ == '__main__':
    unittest.main()
