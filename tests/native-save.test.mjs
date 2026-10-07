// SPDX-License-Identifier: GPL-3.0-or-later
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/native-save-test.exe');
before(async () => {
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const r = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-Iplatform/native', '-Iplatform/loader',
    'tests/native-save-runner.c', 'platform/native/save-core.c', 'platform/native/save-flow.c', 'platform/loader/sha256.c', '-o', exe],
  { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  const fail = spawnSync(exe, ['--fail-check'], { encoding: 'utf8' }); assert.equal(fail.status, 90);
});
function run(args) { const r = spawnSync(exe, args, { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; }
async function archive(t, mode = []) {
  const dir = await fs.mkdtemp(path.join(root, 'build/save-native-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'save.tar'); run([file, ...mode]); return file;
}
function python(code, file) {
  const r = spawnSync('python', ['-c', code, file], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}
test('save requests bind platform, sealed-key identity and destination; archive paths reject ambiguous encodings', () => {
  assert.match(run(['--validate']), /passed/);
});
test('an independent tar reader recovers native save archive directories, long paths and binary bytes', async t => {
  const file = await archive(t);
  const actual = python('import sys,tarfile,json\nwith tarfile.open(sys.argv[1]) as t:\n print(json.dumps([{ "name":m.name,"directory":m.isdir(),"data":None if m.isdir() else t.extractfile(m).read().hex()} for m in t]))', file);
  assert.deepEqual(actual.slice(0, 3), [
    { name: 'files', directory: true, data: null }, { name: 'files/empty', directory: true, data: null },
    { name: 'files/日本.bin', directory: false, data: '000102ff0a' }
  ]);
  assert.deepEqual(actual[3], { name: `files/${'x'.repeat(220)}/data.bin`, directory: false, data: '' });
});
test('save archives encode files above the ustar eight-GiB limit without truncating their size', async t => {
  const file = await archive(t, ['--large']);
  const actual = python('import sys,tarfile,json\nwith tarfile.open(sys.argv[1]) as t:\n m=t.next();print(json.dumps({"name":m.name,"size":m.size}))', file);
  assert.equal(actual.size, 9000000000); assert.equal(actual.name, `files/${'x'.repeat(220)}/data.bin`);
});
test('save archive header and termination failures propagate to the caller', async t => { await archive(t, ['--failure']); });
test('save export failures unmount before cleanup and retain unknown state without publishing or retrying', () => {
  assert.match(run(['--flow']), /passed/);
});
