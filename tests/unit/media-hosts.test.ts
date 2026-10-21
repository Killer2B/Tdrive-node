import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMediaHost } from '../../src/lib/media-hosts.ts';

test('media hosts: النطاق نفسه والنطاقات الفرعية فقط', () => {
  assert.equal(isMediaHost('youtube.com'), true);
  assert.equal(isMediaHost('www.youtube.com'), true);
  assert.equal(isMediaHost('m.youtube.com'), true);
  assert.equal(isMediaHost('music.youtube.com'), true);
  assert.equal(isMediaHost('youtu.be'), true);
  assert.equal(isMediaHost('WWW.YouTube.COM'), true);
  assert.equal(isMediaHost('vimeo.com'), true);
});

test('media hosts: يرفض ما يشبه النطاق وليس منه (منع SSRF/التمرير)', () => {
  assert.equal(isMediaHost('notyoutube.com'), false);
  assert.equal(isMediaHost('youtube.com.evil.tld'), false);
  assert.equal(isMediaHost('evil-youtube.com'), false);
  assert.equal(isMediaHost('example.com'), false);
  assert.equal(isMediaHost(''), false);
});
