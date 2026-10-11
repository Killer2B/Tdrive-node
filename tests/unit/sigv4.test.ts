import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequestV4, uriEncode, amzDate, EMPTY_SHA256 } from '../../src/storage/sigv4.ts';

// متجه اختبار AWS SigV4 الرسميّ "get-vanilla"
test('AWS SigV4 get-vanilla known vector', () => {
  const res = signRequestV4({
    method: 'GET',
    host: 'example.amazonaws.com',
    path: '/',
    query: {},
    headers: { host: 'example.amazonaws.com' },
    payloadHash: EMPTY_SHA256,
    region: 'us-east-1',
    service: 'service',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    amzDate: '20150830T123600Z',
  });
  assert.equal(res.signedHeaders, 'host;x-amz-date');
  assert.equal(res.signature, '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

test('uriEncode RFC3986', () => {
  assert.equal(uriEncode('a b'), 'a%20b');
  assert.equal(uriEncode('a/b', true), 'a%2Fb');
  assert.equal(uriEncode('a/b', false), 'a/b');
  assert.equal(uriEncode('~-_.'), '~-_.');
  assert.equal(uriEncode('ملف'), '%D9%85%D9%84%D9%81');
});

test('amzDate format', () => {
  assert.equal(amzDate(new Date('2015-08-30T12:36:00.123Z')), '20150830T123600Z');
});
