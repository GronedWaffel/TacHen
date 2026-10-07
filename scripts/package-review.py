# SPDX-License-Identifier: GPL-3.0-or-later
"""Create a local, untested review archive. Does not load, install or publish it."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, encoding='utf-8').strip()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_payloads(root, manifest, fingerprint):
    if fingerprint != manifest['buildIdentity']['source']:
        raise RuntimeError('The build is stale. Run node scripts/build.mjs before packaging.')
    if manifest.get('hardwareVerified') is not False or manifest.get('completeHen') is not False:
        raise RuntimeError('This packager only produces explicitly unverified development review bundles.')
    files = [('tachen-runtime.elf', manifest), ('tachen.elf', manifest['launcher']),
             ('tachen-update.tachen', manifest['updatePackage'])]
    payloads = {}
    for name, info in files:
        if info.get('file', name) != name:
            raise RuntimeError('Unexpected artifact filename in build manifest.')
        data = (root / 'build' / name).read_bytes()
        if len(data) != info['bytes'] or digest(data) != info['sha256']:
            raise RuntimeError('Artifact size/checksum mismatch: ' + name)
        payloads[name] = data
    return payloads

def main():
    if command('git', 'status', '--porcelain', '--untracked-files=normal'):
        raise RuntimeError('Commit or preserve pending changes before creating a source-bound review bundle.')
    commit = command('git', 'rev-parse', 'HEAD')
    manifest_bytes = (ROOT / 'build/manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    fingerprint = command('node', '--input-type=module', '-e',
        "import {sourceFingerprint} from './scripts/source-fingerprint.mjs';console.log(await sourceFingerprint(process.cwd()));")
    payloads = read_payloads(ROOT, manifest, fingerprint)
    docs = ['README.md', 'NOTICE.md', 'LICENSE', 'docs/HARDWARE-ACCEPTANCE.md',
            'docs/SUPPORT-CAPTURES.md', 'docs/CHEAT-COMPATIBILITY.md', 'docs/PACKAGE-ABI-REVIEW.md']
    records = {name: {'bytes': len(data), 'sha256': digest(data)} for name, data in payloads.items()}
    outdir = ROOT / 'build/review'
    outdir.mkdir(exist_ok=True)
    destination = outdir / ('TacHen-review-' + commit[:12] + '.zip')
    if destination.exists():
        raise RuntimeError('This commit already has a review archive; existing archive retained.')
    temporary = []
    try:
        fd, source_name = tempfile.mkstemp(prefix='source-', suffix='.tar', dir=outdir)
        os.close(fd); source = Path(source_name); temporary.append(source)
        subprocess.run(['git', 'archive', '--format=tar', '--output=' + str(source), commit], cwd=ROOT, check=True)
        source_bytes = source.read_bytes()
        records['source.tar'] = {'bytes': len(source_bytes), 'sha256': digest(source_bytes)}
        review = {'kind': 'local-development-review', 'sourceCommit': commit, 'sourceFingerprint': fingerprint,
                  'completeHen': False, 'hardwareVerified': False, 'consoleTesting': 'deferred',
                  'packageInstallFirmware': manifest['packageInstaller']['firmware'], 'files': records}
        fd, zip_name = tempfile.mkstemp(prefix='review-', suffix='.partial', dir=outdir)
        os.close(fd); partial = Path(zip_name); temporary.append(partial)
        with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, data in payloads.items(): archive.writestr(name, data)
            archive.writestr('build-manifest.json', manifest_bytes)
            archive.writestr('review.json', json.dumps(review, indent=2) + '\n')
            archive.writestr('source.tar', source_bytes)
            for name in docs: archive.write(ROOT / name, name)
        with zipfile.ZipFile(partial) as archive:
            if archive.testzip() is not None: raise RuntimeError('Review archive failed CRC verification.')
            for name, info in records.items():
                data = archive.read(name)
                if len(data) != info['bytes'] or digest(data) != info['sha256']:
                    raise RuntimeError('Review archive readback mismatch: ' + name)
        if command('git', 'rev-parse', 'HEAD') != commit or command('git', 'status', '--porcelain', '--untracked-files=normal'):
            raise RuntimeError('Source changed while preparing the review archive; nothing was published.')
        current = command('node', '--input-type=module', '-e',
            "import {sourceFingerprint} from './scripts/source-fingerprint.mjs';console.log(await sourceFingerprint(process.cwd()));")
        if current != fingerprint:
            raise RuntimeError('Build inputs changed while preparing the review archive.')
        # Publish a fully read-back file without replacing any existing archive.
        os.link(partial, destination)
        print(json.dumps({'archive': str(destination), 'bytes': destination.stat().st_size,
                          'sha256': digest(destination.read_bytes()), 'sourceCommit': commit,
                          'hardwareVerified': False}))
    finally:
        for item in temporary: item.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
