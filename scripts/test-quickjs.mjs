import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
await build({ absWorkingDir: root, entryPoints: ['tests/quickjs-fixture.mjs'], outfile: 'build/quickjs-fixture.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', alias: { buffer: 'buffer/' } });
const args = ['cc', '-Os', '-D_GNU_SOURCE', '-DCONFIG_VERSION="2026-06-04"', '-Ivendor/quickjs', 'tests/quickjs-runner.c',
  ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c', 'cutils.c'].map(file => 'vendor/quickjs/' + file), '-o', 'build/quickjs-test.exe'];
const buildResult = spawnSync(zig, args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
if (buildResult.status !== 0) throw Error(buildResult.error?.message || buildResult.stderr);
const result = spawnSync(path.join(root, 'build/quickjs-test.exe'), [path.join(root, 'build/quickjs-fixture.js')], { encoding: 'utf8' });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exitCode = result.status ?? 1;
