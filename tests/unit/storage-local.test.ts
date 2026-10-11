import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { LocalDiskStorage } from '../../src/storage/local.ts';
import { assertValidKey } from '../../src/storage/adapter.ts';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

test('LocalDiskStorage put/stat/get/range/list/delete', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tdrive-storage-'));
  try {
    const s = new LocalDiskStorage(root);
    const payload = Buffer.from('hello world');

    const put = await s.put('files/aa/bb.txt', Readable.from(payload), { contentType: 'text/plain' });
    assert.equal(put.size, 11);

    const st = await s.stat('files/aa/bb.txt');
    assert.ok(st);
    assert.equal(st?.size, 11);

    const got = await s.get('files/aa/bb.txt');
    assert.equal(got.toString('utf8'), 'hello world');

    const rangeStream = await s.createReadStream('files/aa/bb.txt', { start: 0, end: 4 });
    const partial = await collect(rangeStream);
    assert.equal(partial.toString('utf8'), 'hello');

    const listed = await s.list('files');
    assert.ok(listed.some((e) => e.key === 'files/aa/bb.txt'));

    await s.delete('files/aa/bb.txt');
    assert.equal(await s.stat('files/aa/bb.txt'), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects path traversal keys', () => {
  assert.throws(() => assertValidKey('../etc/passwd'));
  assert.throws(() => assertValidKey('/abs/key'));
  assert.throws(() => assertValidKey('a//b'));
  assert.doesNotThrow(() => assertValidKey('files/x/y.bin'));
});

test('put is atomic (no .tmp leftover on success)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tdrive-storage-'));
  try {
    const s = new LocalDiskStorage(root);
    await s.put('a/b.bin', Buffer.from([1, 2, 3]));
    const listed = await s.list('a');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].key, 'a/b.bin');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
