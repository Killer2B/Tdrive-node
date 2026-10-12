import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, hostOf } from '../../src/lib/origin.ts';

test('hostOf', () => {
  assert.equal(hostOf('https://tdrive.cc.cd'), 'tdrive.cc.cd');
  assert.equal(hostOf('https://a.b:8443/x?y'), 'a.b:8443');
  assert.equal(hostOf('bare-host'), null);
});

test('allows same-origin via publicUrl', () => {
  assert.equal(isAllowedOrigin('https://tdrive.cc.cd', ['https://tdrive.cc.cd']), true);
});

test('allows via request host (bare host entry)', () => {
  assert.equal(isAllowedOrigin('https://tdrive.cc.cd', ['http://localhost:8080', 'tdrive.cc.cd']), true);
});

test('rejects foreign origin', () => {
  assert.equal(isAllowedOrigin('https://evil.example', ['https://tdrive.cc.cd', 'tdrive.cc.cd']), false);
});

test('missing origin is allowed', () => {
  assert.equal(isAllowedOrigin(undefined, ['https://tdrive.cc.cd']), true);
});

test('unparseable origin is allowed (no false CSRF reject)', () => {
  assert.equal(isAllowedOrigin('null', ['https://tdrive.cc.cd']), true);
  assert.equal(isAllowedOrigin('weird-value', ['https://tdrive.cc.cd']), true);
});

test('scheme-tolerant host match', () => {
  assert.equal(isAllowedOrigin('http://tdrive.cc.cd', ['https://tdrive.cc.cd']), true);
});
