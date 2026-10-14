import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIpAllowed, validateIpAllow } from '../../src/lib/ip-allow.ts';

test('validates exact IPs and IPv4/IPv6 CIDR ranges', () => {
  assert.equal(validateIpAllow('192.0.2.5, 198.51.100.0/24, 2001:db8::/32'), true);
  assert.equal(validateIpAllow('192.0.2.5/33'), false);
  assert.equal(validateIpAllow('2001:db8::/129'), false);
  assert.equal(validateIpAllow('192.0.2.5/'), false);
  assert.equal(validateIpAllow('192.0.2.5/24/1'), false);
  assert.equal(validateIpAllow('example.com'), false);
});

test('matches exact addresses and CIDR ranges without crossing address families', () => {
  assert.equal(isIpAllowed('192.0.2.42', '192.0.2.0/24'), true);
  assert.equal(isIpAllowed('192.0.3.42', '192.0.2.0/24'), false);
  assert.equal(isIpAllowed('2001:db8::42', '2001:db8::/32'), true);
  assert.equal(isIpAllowed('2001:db9::42', '2001:db8::/32'), false);
  assert.equal(isIpAllowed('192.0.2.42', '2001:db8::/32'), false);
  assert.equal(isIpAllowed('192.0.2.42', null), true);
});
