'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function startServer(undoMs = 10000) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-undo-test-'));
  const port = await freePort();
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      TZ: 'UTC',
      UNDO_TTL_MS: String(undoMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk; });
  proc.stderr.on('data', (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) { up = true; break; }
    } catch { /* starting */ }
    await sleep(75);
  }
  if (!up) {
    proc.kill('SIGKILL');
    throw new Error('Test server did not start:\n' + output);
  }
  async function close() {
    if (proc.exitCode !== null) return;
    proc.kill('SIGTERM');
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    await Promise.race([exited, sleep(3000)]);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return { base, close, output: () => output };
}

function client(base) {
  let cookie = '';
  let csrf = '';
  async function request(method, route, body, options = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (csrf && method !== 'GET' && !options.skipCsrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(base + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = /todo\.sid=([^;]+)/.exec(setCookie);
      if (match) cookie = `todo.sid=${match[1]}`;
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  async function signIn(password = 'test-password') {
    let res = await request('POST', '/api/setup', { password });
    if (res.status === 409) res = await request('POST', '/api/login', { password });
    assert.ok(res.status === 200 || res.status === 201, `sign-in failed: ${res.status} ${JSON.stringify(res.data)}`);
    const session = await request('GET', '/api/session');
    csrf = session.data.csrfToken;
    assert.ok(csrf, 'missing CSRF token');
  }
  return { request, signIn };
}

async function state(api) {
  const res = await api.request('GET', '/api/state');
  assert.equal(res.status, 200);
  return res.data;
}

async function createReminder(api, body) {
  const res = await api.request('POST', '/api/reminders', body);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.id;
}

function futureISO(days = 3, hour = 9) {
  const date = new Date(Date.now() + days * 86400000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

test('immediate Undo for completion and deletion', async (t) => {
  const server = await startServer(10000);
  t.after(() => server.close());
  const api = client(server.base);
  await api.signIn();

  const initial = await state(api);
  const unlisted = initial.lists.find((list) => list.is_system);
  assert.ok(unlisted, 'Unlisted list missing');

  await t.test('completion undo restores an ordinary item', async () => {
    const id = await createReminder(api, {
      title: 'Undo ordinary', notes: 'alpha\nbeta', list_id: unlisted.id,
    });
    const before = (await state(api)).lists.find((list) => list.id === unlisted.id);
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.equal(completed.status, 200, JSON.stringify(completed.data));
    assert.ok(completed.data.undo && completed.data.undo.token, 'missing undo token');
    let snapshot = await state(api);
    let row = snapshot.reminders.find((item) => item.id === id);
    assert.equal(row.completed, 1);
    assert.ok(row.completed_at);
    let list = snapshot.lists.find((item) => item.id === unlisted.id);
    assert.equal(list.done_count, before.done_count + 1);

    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    snapshot = await state(api);
    row = snapshot.reminders.find((item) => item.id === id);
    assert.equal(row.completed, 0);
    assert.equal(row.completed_at, null);
    assert.equal(row.title, 'Undo ordinary');
    assert.equal(row.notes, 'alpha\nbeta');
    list = snapshot.lists.find((item) => item.id === unlisted.id);
    assert.equal(list.done_count, before.done_count);

    const repeat = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(repeat.status, 404);
  });

  await t.test('completion undo keeps edits made afterwards', async () => {
    const id = await createReminder(api, { title: 'Original', list_id: unlisted.id });
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.ok(completed.data.undo);
    const edited = await api.request('PATCH', `/api/reminders/${id}`, { title: 'Edited later' });
    assert.equal(edited.status, 200);
    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    const row = (await state(api)).reminders.find((item) => item.id === id);
    assert.equal(row.completed, 0);
    assert.equal(row.title, 'Edited later');
  });

  await t.test('a reopened item is not undone by a stale token', async () => {
    const id = await createReminder(api, { title: 'Reopened', list_id: unlisted.id });
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.ok(completed.data.undo);
    const reopened = await api.request('PATCH', `/api/reminders/${id}`, { completed: false });
    assert.equal(reopened.status, 200);
    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 409, JSON.stringify(undone.data));
    const row = (await state(api)).reminders.find((item) => item.id === id);
    assert.equal(row.completed, 0);
  });

  await t.test('only the latest undoable action can be undone', async () => {
    const first = await createReminder(api, { title: 'First', list_id: unlisted.id });
    const firstDone = await api.request('PATCH', `/api/reminders/${first}`, { completed: true });
    assert.ok(firstDone.data.undo);
    const second = await createReminder(api, { title: 'Second', list_id: unlisted.id });
    const secondDone = await api.request('PATCH', `/api/reminders/${second}`, { completed: true });
    assert.ok(secondDone.data.undo);
    const old = await api.request('POST', `/api/undo/${firstDone.data.undo.token}`);
    assert.equal(old.status, 404);
    const latest = await api.request('POST', `/api/undo/${secondDone.data.undo.token}`);
    assert.equal(latest.status, 200, JSON.stringify(latest.data));
    const snapshot = await state(api);
    assert.equal(snapshot.reminders.find((item) => item.id === first).completed, 1);
    assert.equal(snapshot.reminders.find((item) => item.id === second).completed, 0);
  });

  await t.test('recurring completion undo targets one occurrence and keeps its edit', async () => {
    const due = futureISO(3);
    const id = await createReminder(api, {
      title: 'Recurring undo',
      list_id: unlisted.id,
      due_at: due,
      has_time: true,
      repeat_rule: { type: 'daily', interval: 1 },
      time_model: 'fixed',
    });
    const edit = await api.request('PATCH', `/api/reminders/${id}`, {
      scope: 'occurrence',
      notes: 'Only this occurrence',
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.equal(completed.status, 200, JSON.stringify(completed.data));
    assert.equal(completed.data.advanced, true);
    assert.ok(completed.data.undo);
    let row = (await state(api)).reminders.find((item) => item.id === id);
    assert.equal(row.due_at, completed.data.nextDue);
    assert.notEqual(row.due_at, due);
    let history = await api.request('GET', `/api/reminders/${id}/occurrences`);
    assert.equal(history.data.occurrences[0].occurrence_at, due);
    assert.equal(history.data.occurrences[0].status, 'completed');

    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    row = (await state(api)).reminders.find((item) => item.id === id);
    assert.equal(row.due_at, due);
    history = await api.request('GET', `/api/reminders/${id}/occurrences`);
    const occurrence = history.data.occurrences.find((item) => item.occurrence_at === due);
    assert.equal(occurrence.status, 'exception');
    assert.equal(occurrence.notes, 'Only this occurrence');
  });

  await t.test('recurring undo refuses to rewind after a schedule edit', async () => {
    const due = futureISO(4);
    const id = await createReminder(api, {
      title: 'Recurring conflict',
      list_id: unlisted.id,
      due_at: due,
      has_time: true,
      repeat_rule: { type: 'daily', interval: 1 },
      time_model: 'fixed',
    });
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.ok(completed.data.undo);
    const moved = await api.request('PATCH', `/api/reminders/${id}`, {
      due_at: futureISO(8), has_time: true,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const afterMove = (await state(api)).reminders.find((item) => item.id === id);
    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 409, JSON.stringify(undone.data));
    const row = (await state(api)).reminders.find((item) => item.id === id);
    assert.equal(row.due_at, afterMove.due_at);
  });

  await t.test('recurring undo refuses after a snooze touched the series', async () => {
    const id = await createReminder(api, {
      title: 'Recurring snooze conflict',
      list_id: unlisted.id,
      due_at: futureISO(5),
      has_time: true,
      repeat_rule: { type: 'daily', interval: 1 },
      time_model: 'fixed',
    });
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.ok(completed.data.undo);
    const snoozedUntil = new Date(Date.now() + 3600 * 1000).toISOString();
    const snoozed = await api.request('PATCH', `/api/reminders/${id}`, { snoozed_until: snoozedUntil });
    assert.equal(snoozed.status, 200, JSON.stringify(snoozed.data));
    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 409, JSON.stringify(undone.data));
  });

  await t.test('deletion undo restores the same row and its history', async () => {
    const due = futureISO(6);
    const id = await createReminder(api, {
      title: 'Recurring delete',
      notes: 'keep me',
      list_id: unlisted.id,
      due_at: due,
      has_time: true,
      repeat_rule: { type: 'daily', interval: 1 },
      time_model: 'fixed',
    });
    await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    const beforeDelete = (await state(api)).reminders.find((item) => item.id === id);
    const historyBefore = (await api.request('GET', `/api/reminders/${id}/occurrences`)).data.occurrences;
    const deleted = await api.request('DELETE', `/api/reminders/${id}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.ok(deleted.data.undo);
    assert.equal((await state(api)).reminders.find((item) => item.id === id), undefined);

    const undone = await api.request('POST', `/api/undo/${deleted.data.undo.token}`);
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    const restored = (await state(api)).reminders.find((item) => item.id === id);
    assert.ok(restored);
    assert.equal(restored.title, 'Recurring delete');
    assert.equal(restored.notes, 'keep me');
    assert.equal(restored.due_at, beforeDelete.due_at);
    assert.equal(restored.repeat_rule, beforeDelete.repeat_rule);
    const historyAfter = (await api.request('GET', `/api/reminders/${id}/occurrences`)).data.occurrences;
    assert.equal(historyAfter.length, historyBefore.length);
    assert.deepEqual(historyAfter[0].occurrence_at, historyBefore[0].occurrence_at);
    assert.equal(historyAfter[0].status, 'completed');
  });

  await t.test('deletion undo restores notes and identity for a normal item', async () => {
    const id = await createReminder(api, {
      title: 'Delete me', notes: 'line one\nline two', urgent: true, list_id: unlisted.id,
    });
    const before = (await state(api)).reminders.find((item) => item.id === id);
    const deleted = await api.request('DELETE', `/api/reminders/${id}`);
    assert.ok(deleted.data.undo);
    await api.request('POST', `/api/undo/${deleted.data.undo.token}`);
    const restored = (await state(api)).reminders.find((item) => item.id === id);
    assert.ok(restored);
    assert.equal(restored.id, before.id);
    assert.equal(restored.notes, 'line one\nline two');
    assert.equal(restored.urgent, 1);
    assert.equal(restored.created_at, before.created_at);
  });

  await t.test('deletion undo reports a missing list', async () => {
    const listRes = await api.request('POST', '/api/lists', { name: 'Temporary list', color: 'red' });
    assert.equal(listRes.status, 201, JSON.stringify(listRes.data));
    const listId = listRes.data.id;
    const id = await createReminder(api, { title: 'In temporary list', list_id: listId });
    const deleted = await api.request('DELETE', `/api/reminders/${id}`);
    assert.ok(deleted.data.undo);
    const listDeleted = await api.request('DELETE', `/api/lists/${listId}`);
    assert.equal(listDeleted.status, 200, JSON.stringify(listDeleted.data));
    const undone = await api.request('POST', `/api/undo/${deleted.data.undo.token}`);
    assert.equal(undone.status, 409, JSON.stringify(undone.data));
    assert.equal((await state(api)).reminders.find((item) => item.id === id), undefined);
  });

  await t.test('an undo token belongs to the session that created it', async () => {
    const id = await createReminder(api, { title: 'Session-bound', list_id: unlisted.id });
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.ok(completed.data.undo);
    const other = client(server.base);
    await other.signIn();
    const rejected = await other.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(rejected.status, 403, JSON.stringify(rejected.data));
    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
  });

  await t.test('undo requires the CSRF header', async () => {
    const id = await createReminder(api, { title: 'CSRF', list_id: unlisted.id });
    const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
    assert.ok(completed.data.undo);
    const rejected = await api.request('POST', `/api/undo/${completed.data.undo.token}`, undefined, { skipCsrf: true });
    assert.equal(rejected.status, 403);
    const undone = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
    assert.equal(undone.status, 200);
  });
});

test('Undo expires on the server', async (t) => {
  const server = await startServer(250);
  t.after(() => server.close());
  const api = client(server.base);
  await api.signIn();
  const id = await createReminder(api, {
    title: 'Expiring undo',
    list_id: (await state(api)).lists.find((list) => list.is_system).id,
  });
  const completed = await api.request('PATCH', `/api/reminders/${id}`, { completed: true });
  assert.ok(completed.data.undo);
  await sleep(400);
  const expired = await api.request('POST', `/api/undo/${completed.data.undo.token}`);
  assert.equal(expired.status, 410, JSON.stringify(expired.data));
  const row = (await state(api)).reminders.find((item) => item.id === id);
  assert.equal(row.completed, 1);
});
