// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCandidate, candidateWindows, validateComparison } from '../src/scan-refinement.mjs';
test('numeric comparison keeps 64-bit precision and rejects nonfinite floating-point candidates', () => {
  const a = Buffer.alloc(8), b = Buffer.alloc(8);a.writeBigUInt64LE(0xfffffffffffffff0n);b.writeBigUInt64LE(0xfffffffffffffff1n);
  assert.equal(compareCandidate(a, b, 'increased', null, 'u64'), true);
  a.writeBigInt64LE(-9007199254740993n);b.writeBigInt64LE(-9007199254740992n);
  assert.equal(compareCandidate(a, b, 'increased', null, 'i64'), true);
  for (const value of [NaN, Infinity, -Infinity]) { a.writeDoubleLE(1);b.writeDoubleLE(value);assert.equal(compareCandidate(a, b, 'increased', null, 'f64'), false); }
  a.writeDoubleLE(-0.5);b.writeDoubleLE(-1);assert.equal(compareCandidate(a, b, 'decreased', null, 'f64'), true);
  for (const type of ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'f32', 'f64']) {
    const width = type.endsWith('64') ? 8 : type.endsWith('32') ? 4 : type.endsWith('16') ? 2 : 1;
    validateComparison('increased', type, width);assert.throws(() => validateComparison('changed', type, width), { code: 'SCAN_VALUE_TYPE' });
  }
});
test('candidate batching bounds every read and preserves boundary-spanning candidate bytes', () => {
  assert.deepEqual([...candidateWindows(['0x1', '0xff80', '0x10000', '0x1ffff'], 128)], [
    { first: 0, last: 2, offset: 1n, length: 65535 }, { first: 2, last: 3, offset: 65536n, length: 128 }, { first: 3, last: 4, offset: 131071n, length: 128 }
  ]);
  assert.deepEqual([...candidateWindows([], 4)], []);
});
