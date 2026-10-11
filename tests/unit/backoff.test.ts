import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffCeiling, backoffDelay } from '../../src/lib/backoff.ts';

const opts = { baseMs: 1000, factor: 2, maxMs: 60_000, jitter: 0.2 };

test('ceiling grows then caps', () => {
  assert.equal(backoffCeiling(1, opts), 1000);
  assert.equal(backoffCeiling(2, opts), 2000);
  assert.equal(backoffCeiling(3, opts), 4000);
  assert.equal(backoffCeiling(7, opts), 60_000); // 64000 capped
  assert.equal(backoffCeiling(20, opts), 60_000);
});

test('delay stays within jitter band', () => {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const ceil = backoffCeiling(attempt, opts);
    const min = ceil * (1 - opts.jitter);
    const max = ceil * (1 + opts.jitter);
    for (let i = 0; i < 50; i++) {
      const d = backoffDelay(attempt, opts);
      assert.ok(d >= Math.floor(min) - 1 && d <= Math.ceil(max) + 1, `attempt ${attempt}: ${d} خارج [${min},${max}]`);
    }
  }
});

test('no jitter is deterministic', () => {
  assert.equal(backoffDelay(3, { ...opts, jitter: 0 }), 4000);
});
