import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, parseIpv4, parseIpv6 } from '../../src/lib/ssrf.ts';

test('parseIpv4', () => {
  assert.equal(parseIpv4('1.2.3.4'), 0x01020304);
  assert.equal(parseIpv4('255.255.255.255'), 0xffffffff);
  assert.equal(parseIpv4('0.0.0.0'), 0);
  assert.equal(parseIpv4('256.0.0.1'), null);
  assert.equal(parseIpv4('1.2.3'), null);
  assert.equal(parseIpv4('a.b.c.d'), null);
});

test('parseIpv6 basic + mapped', () => {
  assert.equal(parseIpv6('::1'), 1n);
  assert.equal(parseIpv6('::'), 0n);
  assert.notEqual(parseIpv6('fc00::1'), null);
  assert.equal(parseIpv6('::ffff:127.0.0.1'), 0x0000ffff7f000001n);
  assert.equal(parseIpv6('not:an:ip'), null);
});

test('blocks private/loopback/link-local IPv4', () => {
  for (const ip of [
    '127.0.0.1', '10.1.2.3', '172.16.5.4', '172.31.255.255',
    '192.168.1.1', '169.254.10.10', '100.64.0.1', '0.0.0.0', '255.255.255.255',
  ]) {
    assert.equal(isBlockedIp(ip), true, `${ip} يجب أن يُحظر`);
  }
});

test('allows public IPv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
    assert.equal(isBlockedIp(ip), false, `${ip} يجب أن يُسمح`);
  }
});

test('blocks private/loopback IPv6', () => {
  for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isBlockedIp(ip), true, `${ip} يجب أن يُحظر`);
  }
});

test('allows public IPv6 (incl. mapped public v4)', () => {
  assert.equal(isBlockedIp('2606:4700:4700::1111'), false);
  assert.equal(isBlockedIp('::ffff:8.8.8.8'), false);
});

test('invalid input is blocked by default', () => {
  assert.equal(isBlockedIp('garbage'), true);
  assert.equal(isBlockedIp(''), true);
});
