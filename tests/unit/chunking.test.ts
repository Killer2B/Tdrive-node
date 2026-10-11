import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planChunks,
  sizeOfChunk,
  offsetOfChunk,
  toRanges,
  missingChunks,
  isValidChunkLength,
} from '../../src/lib/chunking.ts';

const MB = 1024 * 1024;

test('empty file => single zero-byte chunk', () => {
  const p = planChunks(0, 18 * MB);
  assert.equal(p.totalChunks, 1);
  assert.equal(p.lastChunkSize, 0);
  assert.equal(sizeOfChunk(p, 0), 0);
});

test('exact multiple', () => {
  const p = planChunks(80, 40);
  assert.equal(p.totalChunks, 2);
  assert.equal(p.lastChunkSize, 40);
});

test('remainder', () => {
  const p = planChunks(100, 40);
  assert.equal(p.totalChunks, 3);
  assert.equal(p.lastChunkSize, 20);
  assert.equal(sizeOfChunk(p, 0), 40);
  assert.equal(sizeOfChunk(p, 2), 20);
  assert.equal(offsetOfChunk(2, 40), 80);
});

test('18MB chunking of a 50MB file', () => {
  const p = planChunks(50 * MB, 18 * MB);
  assert.equal(p.totalChunks, 3); // 18+18+14
  assert.equal(p.lastChunkSize, 50 * MB - 2 * 18 * MB);
});

test('isValidChunkLength', () => {
  const p = planChunks(100, 40);
  assert.equal(isValidChunkLength(p, 0, 40), true);
  assert.equal(isValidChunkLength(p, 2, 20), true);
  assert.equal(isValidChunkLength(p, 2, 40), false);
});

test('out-of-range index throws', () => {
  const p = planChunks(100, 40);
  assert.throws(() => sizeOfChunk(p, 3));
  assert.throws(() => sizeOfChunk(p, -1));
});

test('toRanges compresses', () => {
  assert.deepEqual(toRanges([0, 1, 2, 4, 5, 7]), [[0, 2], [4, 5], [7, 7]]);
  assert.deepEqual(toRanges([3, 1, 2, 0]), [[0, 3]]);
  assert.deepEqual(toRanges([]), []);
});

test('missingChunks', () => {
  assert.deepEqual(missingChunks([0, 2], 4), [1, 3]);
  assert.deepEqual(missingChunks([0, 1, 2, 3], 4), []);
});
