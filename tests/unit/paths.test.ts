import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  sanitizeFileName,
  normalizeVirtualPath,
  isSafeSegment,
  resolveWithin,
  splitExt,
} from '../../src/lib/paths.ts';

test('sanitizeFileName strips traversal + illegal chars', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('..\\..\\win\\system32'), 'system32');
  assert.equal(sanitizeFileName('my:file*?.mp4'), 'my_file__.mp4');
  assert.equal(sanitizeFileName('  trailing...  '), 'trailing');
});

test('sanitizeFileName fallbacks', () => {
  assert.equal(sanitizeFileName(''), 'file');
  assert.equal(sanitizeFileName('...'), 'file');
  assert.equal(sanitizeFileName('..'), 'file');
});

test('sanitizeFileName windows reserved', () => {
  assert.equal(sanitizeFileName('con'), '_con');
  assert.equal(sanitizeFileName('LPT1'), '_LPT1');
});

test('sanitizeFileName length cap keeps extension', () => {
  const long = 'a'.repeat(500) + '.mp4';
  const out = sanitizeFileName(long);
  assert.ok(out.length <= 200);
  assert.ok(out.endsWith('.mp4'));
});

test('splitExt', () => {
  assert.deepEqual(splitExt('movie.final.mp4'), { stem: 'movie.final', ext: '.mp4' });
  assert.deepEqual(splitExt('noext'), { stem: 'noext', ext: '' });
  assert.deepEqual(splitExt('.hidden'), { stem: '.hidden', ext: '' });
});

test('normalizeVirtualPath', () => {
  assert.equal(normalizeVirtualPath('/a/b/../c'), '/a/c');
  assert.equal(normalizeVirtualPath('a//b/'), '/a/b');
  assert.equal(normalizeVirtualPath('/'), '/');
  assert.equal(normalizeVirtualPath(''), '/');
});

test('isSafeSegment', () => {
  assert.equal(isSafeSegment('folder'), true);
  assert.equal(isSafeSegment('..'), false);
  assert.equal(isSafeSegment('a/b'), false);
  assert.equal(isSafeSegment('a\\b'), false);
});

test('resolveWithin contains + rejects escape', () => {
  const root = path.resolve('srv', 'data');
  const inside = resolveWithin(root, 'sub', 'f.txt');
  assert.ok(inside.startsWith(root));
  assert.throws(() => resolveWithin(root, '..', 'escape'));
  assert.throws(() => resolveWithin(root, '/etc/passwd'.replace(/\//g, path.sep)));
});
