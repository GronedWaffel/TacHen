# SPDX-License-Identifier: GPL-3.0-or-later
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('review_packager', ROOT / 'scripts/package-review.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ArtifactChecks(unittest.TestCase):
    def test_source_and_artifact_mismatches_cannot_be_packaged(self):
        with tempfile.TemporaryDirectory(prefix='review-test-', dir=ROOT / 'build') as temp:
            root = Path(temp).resolve()
            self.assertTrue(root.is_relative_to((ROOT / 'build').resolve()))
            (root / 'build').mkdir()
            payloads = {'tachen-runtime.elf': b'local fixture runtime', 'tachen.elf': b'local fixture launcher',
                        'tachen-update.tachen': b'local fixture update'}
            for name, data in payloads.items(): (root / 'build' / name).write_bytes(data)
            def info(name):
                data = payloads[name]
                return {'file': name, 'bytes': len(data), 'sha256': module.digest(data)}
            manifest = dict(info('tachen-runtime.elf'), buildIdentity={'source': 'a'*64},
                            launcher=info('tachen.elf'), updatePackage=info('tachen-update.tachen'),
                            hardwareVerified=False, completeHen=False)
            self.assertEqual(module.read_payloads(root, manifest, 'a'*64), payloads)
            with self.assertRaisesRegex(RuntimeError, 'stale'): module.read_payloads(root, manifest, 'b'*64)
            for flag in ['hardwareVerified', 'completeHen']:
                forged = copy.deepcopy(manifest); forged[flag] = True
                with self.assertRaisesRegex(RuntimeError, 'unverified'): module.read_payloads(root, forged, 'a'*64)
            forged = copy.deepcopy(manifest); forged['launcher']['file'] = '../private.elf'
            with self.assertRaisesRegex(RuntimeError, 'filename'): module.read_payloads(root, forged, 'a'*64)
            for name in payloads:
                path = root / 'build' / name
                for bad in [payloads[name][:-1], bytes([payloads[name][0]^1])+payloads[name][1:]]:
                    path.write_bytes(bad)
                    with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'): module.read_payloads(root, manifest, 'a'*64)
                path.write_bytes(payloads[name])
            self.assertEqual(module.read_payloads(root, manifest, 'a'*64), payloads)

if __name__ == '__main__': unittest.main()
