import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../../src/lib/ranges.ts';

test('no header => full', () => {
  assert.deepEqual(parseRange(undefined, 100), { type: 'full' });
});

test('bytes=0- => whole', () => {
  assert.deepEqual(parseRange('bytes=0-', 100), { type: 'ok', range: { start: 0, end: 99 } });
});

test('bytes=0-49', () => {
  assert.deepEqual(parseRange('bytes=0-49', 100), { type: 'ok', range: { start: 0, end: 49 } });
});

test('suffix bytes=-20', () => {
  assert.deepEqual(parseRange('bytes=-20', 100), { type: 'ok', range: { start: 80, end: 99 } });
});

test('end clamped to size', () => {
  assert.deepEqual(parseRange('bytes=50-200', 100), { type: 'ok', range: { start: 50, end: 99 } });
});

test('start beyond size => unsatisfiable', () => {
  assert.deepEqual(parseRange('bytes=200-', 100), { type: 'unsatisfiable' });
});

test('garbage => unsatisfiable', () => {
  assert.deepEqual(parseRange('bytes=abc', 100), { type: 'unsatisfiable' });
  assert.deepEqual(parseRange('items=0-1', 100), { type: 'unsatisfiable' });
});

test('multi-range unsupported', () => {
  assert.deepEqual(parseRange('bytes=0-1,2-3', 100), { type: 'unsatisfiable' });
});

test('zero-size resource', () => {
  assert.deepEqual(parseRange('bytes=0-10', 0), { type: 'unsatisfiable' });
});
