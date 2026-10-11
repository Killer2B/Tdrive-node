import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, parseBytes, mbToBytes, gbToBytes } from '../../src/lib/bytes.ts';

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(18 * 1024 * 1024), '18 MB');
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2 GB');
});

test('parseBytes', () => {
  assert.equal(parseBytes('18MB'), 18 * 1024 * 1024);
  assert.equal(parseBytes('2 gb'), 2 * 1024 * 1024 * 1024);
  assert.equal(parseBytes('512'), 512);
  assert.equal(parseBytes('1.5kb'), 1536);
  assert.equal(parseBytes('abc'), null);
});

test('mb/gb helpers', () => {
  assert.equal(mbToBytes(18), 18 * 1024 * 1024);
  assert.equal(gbToBytes(1), 1024 * 1024 * 1024);
});
