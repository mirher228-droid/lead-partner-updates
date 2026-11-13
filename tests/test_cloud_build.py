import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_common', ROOT / 'tools/build_common.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CloudBuildTests(unittest.TestCase):
    def test_deterministic_inventory_and_changed_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source = root / 'source'
            source.mkdir()
            (source / 'manifest.json').write_text(json.dumps({'version':'1.2.51'}))
            (source / 'a.txt').write_bytes(b'first')
            package = module.build(source, root / 'out')
            first = package.read_bytes()
            self.assertEqual(first, module.build(source, root / 'out').read_bytes())
            (source / 'a.txt').write_bytes(b'changed')
            package = module.build(source, root / 'out')
            self.assertNotEqual(first, package.read_bytes())
            with zipfile.ZipFile(package) as archive:
                inventory = json.loads(archive.read('Lead-Partner-Common/ROOTRELEASE_FILES.json'))
                for entry in inventory['files']:
                    self.assertEqual(entry['sha256'], hashlib.sha256(archive.read('Lead-Partner-Common/' + entry['path'])).hexdigest())

    def test_missing_resource_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            (root / 'manifest.json').write_text(json.dumps({'version':'1.2.51', 'background':{'service_worker':'missing.js'}}))
            with self.assertRaisesRegex(ValueError, 'Missing manifest resource'):
                module.build(root, root / 'out')

if __name__ == '__main__':
    unittest.main()
