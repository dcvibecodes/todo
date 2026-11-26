'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let child;
let tmpDir;
let base;
let cookie = '';
let csrf = '';
let output = '';
let folderId;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start\n${output}`);
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (options.csrf) headers['x-csrf-token'] = csrf;
  let body = options.body;
  if (body && typeof body !== 'string' && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(base + pathname, { ...options, headers, body });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}

async function json(pathname, options = {}) {
  const response = await request(pathname, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${pathname} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-in-progress-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: tmpDir, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForHealth();
  const setup = await request('/api/setup', {
    method: 'POST',
    body: { username: 'tester', password: 'password123', confirm: 'password123' },
  });
  if (!setup.ok) throw new Error(`setup -> ${setup.status}: ${await setup.text()}`);
  csrf = (await json('/api/session')).csrfToken;
  const lists = await json('/api/lists');
  folderId = lists.lists.find((list) => list.tenant === 'reminders').id;
});

test.after(async () => {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

async function create(extra = {}) {
  const data = await json('/api/reminders', {
    method: 'POST', csrf: true, body: { list_id: folderId, title: 'Item', ...extra },
  });
  return data.reminder || data;
}
const patch = (id, body) => json(`/api/reminders/${id}`, { method: 'PATCH', csrf: true, body });
const get = async (id) => {
  const data = await json(`/api/reminders/${id}`);
  return data.reminder || data;
};

test('new items are not in progress', async () => {
  const item = await create();
  assert.equal((await get(item.id)).in_progress_at, null);
});

test('marking in progress sets a timestamp, clearing removes it, and it keeps the first time', async () => {
  const item = await create();
  await patch(item.id, { in_progress: true });
  const first = (await get(item.id)).in_progress_at;
  assert.ok(first);
  await patch(item.id, { in_progress: true });
  assert.equal((await get(item.id)).in_progress_at, first);
  await patch(item.id, { in_progress: false });
  assert.equal((await get(item.id)).in_progress_at, null);
});

test('marking in progress bumps the revision', async () => {
  const item = await create();
  const before = (await get(item.id)).revision;
  await patch(item.id, { in_progress: true });
  assert.ok((await get(item.id)).revision > before);
});

test('an ordinary edit that sends completed:false keeps the in-progress mark', async () => {
  const item = await create();
  await patch(item.id, { in_progress: true });
  const stamp = (await get(item.id)).in_progress_at;
  await patch(item.id, { title: 'Edited while in progress', completed: false });
  const edited = await get(item.id);
  assert.equal(edited.title, 'Edited while in progress');
  assert.equal(edited.in_progress_at, stamp);
});

test('completing clears in progress, and uncompleting does not bring it back', async () => {
  const item = await create();
  await patch(item.id, { in_progress: true });
  await patch(item.id, { completed: true });
  const done = await get(item.id);
  assert.equal(done.completed, 1);
  assert.equal(done.in_progress_at, null);
  const refused = await request(`/api/reminders/${item.id}`, {
    method: 'PATCH', csrf: true, body: { in_progress: true },
  });
  assert.equal(refused.status, 400, 'a completed item cannot be marked');
  assert.equal((await get(item.id)).in_progress_at, null);
  await patch(item.id, { completed: false });
  assert.equal((await get(item.id)).in_progress_at, null);
});

test('completing or skipping a repeating occurrence clears in progress', async () => {
  const due = new Date(Date.now() + 3600 * 1000).toISOString();
  const item = await create({ due_at: due, has_time: true, repeat_rule: 'daily' });
  await patch(item.id, { in_progress: true });
  assert.ok((await get(item.id)).in_progress_at);
  await patch(item.id, { completed: true });
  const advanced = await get(item.id);
  assert.equal(advanced.completed, 0);
  assert.notEqual(advanced.due_at, due);
  assert.equal(advanced.in_progress_at, null);
  await patch(item.id, { in_progress: true });
  await json(`/api/reminders/${item.id}/skip`, { method: 'POST', csrf: true, body: {} });
  assert.equal((await get(item.id)).in_progress_at, null);
});

test('the list endpoint, JSON backup and CSV carry in_progress_at', async () => {
  const item = await create({ title: 'Marked item' });
  await patch(item.id, { in_progress: true });
  const stamp = (await get(item.id)).in_progress_at;
  const list = await json('/api/reminders');
  const listed = (list.reminders || list).find((r) => r.id === item.id);
  assert.equal(listed.in_progress_at, stamp);
  const backup = await json('/api/export');
  assert.equal(backup.reminders.find((r) => r.id === item.id).in_progress_at, stamp);
  const csv = await (await request('/api/export/reminders.csv')).text();
  assert.match(csv.split('\n')[0], /in_progress_at/);
  assert.ok(csv.includes(stamp));
});

test('state endpoint includes in_progress_at for open items', async () => {
  const item = await create({ title: 'Bootstrap marked' });
  await patch(item.id, { in_progress: true });
  const boot = await json('/api/state');
  const found = (boot.reminders || []).find((r) => r.id === item.id);
  assert.ok(found && found.in_progress_at);
});

test('the In progress smart view, status menu and item number are served', async () => {
  const html = await (await request('/')).text();
  assert.match(html, /data-view="inprogress"/);
  assert.match(html, /id="count-inprogress"/);
  assert.match(html, /id="i-progress"/);
  const app = await (await request('/app.js')).text();
  assert.match(app, /view === 'inprogress'/);
  assert.match(app, /class: 'meta-id'/);
  assert.doesNotMatch(app, /Copy item number/);
  const sort = await request('/api/settings/sort', {
    method: 'POST', csrf: true, body: { view: 'inprogress', field: 'created', dir: 'desc' },
  });
  assert.equal(sort.status, 200);
});
