'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusSync } = require('../public/status-sync');

test('optimistic status applies before a slow request resolves', async () => {
  let resolveRequest;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const calls = [];
  const sync = createStatusSync();
  const running = sync.run(7, {
    optimistic: () => calls.push('optimistic'),
    request: () => request,
    commit: () => calls.push('commit'),
    rollback: () => calls.push('rollback'),
  });
  assert.deepEqual(calls, ['optimistic']);
  resolveRequest({ ok: true });
  const result = await running;
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['optimistic', 'commit']);
});

test('a failed request rolls the optimistic status back', async () => {
  const calls = [];
  const sync = createStatusSync();
  const result = await sync.run(8, {
    optimistic: () => calls.push('optimistic'),
    request: () => Promise.reject(new Error('nope')),
    commit: () => calls.push('commit'),
    rollback: (err) => calls.push(`rollback:${err.message}`),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ['optimistic', 'rollback:nope']);
});

test('a second change on the same item is ignored while one is pending', async () => {
  let resolveRequest;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const sync = createStatusSync();
  let optimistic = 0;
  const first = sync.run(9, {
    optimistic: () => { optimistic += 1; },
    request: () => request,
    commit: () => {},
    rollback: () => {},
  });
  const second = await sync.run(9, {
    optimistic: () => { optimistic += 1; },
    request: () => Promise.resolve(),
    commit: () => {},
    rollback: () => {},
  });
  assert.equal(second.skipped, true);
  assert.equal(optimistic, 1);
  resolveRequest({ ok: true });
  await first;
  const third = await sync.run(9, {
    optimistic: () => { optimistic += 1; },
    request: () => Promise.resolve(),
    commit: () => {},
    rollback: () => {},
  });
  assert.equal(third.ok, true);
  assert.equal(optimistic, 2);
});
