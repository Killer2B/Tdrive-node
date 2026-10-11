import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  sha256OfStream,
  HashingPassThrough,
  hashesEqual,
  fingerprintFromChunkHashes,
} from '../../src/lib/hash.ts';

const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('sha256OfStream of "abc"', async () => {
  const digest = await sha256OfStream(Readable.from([Buffer.from('abc')]));
  assert.equal(digest, SHA_ABC);
});

test('HashingPassThrough matches + counts bytes', async () => {
  const hpt = new HashingPassThrough();
  await pipeline(
    Readable.from([Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]),
    hpt,
    async (source) => {
      for await (const _ of source) {
        void _;
      }
    },
  );
  assert.equal(hpt.digestHex(), SHA_ABC);
  assert.equal(hpt.bytes, 3);
});

test('hashesEqual constant-time compare', () => {
  assert.equal(hashesEqual(SHA_ABC, SHA_ABC), true);
  assert.equal(hashesEqual(SHA_ABC, 'deadbeef'), false);
});

test('fingerprintFromChunkHashes is stable', () => {
  const a = fingerprintFromChunkHashes(['x', 'y', 'z']);
  const b = fingerprintFromChunkHashes(['x', 'y', 'z']);
  assert.equal(a, b);
  assert.notEqual(a, fingerprintFromChunkHashes(['x', 'y']));
});
