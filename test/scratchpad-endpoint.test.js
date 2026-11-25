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
  if (body && typeof body !== 'string') {
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-scratchpad-test-'));
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
  const session = await json('/api/session');
  csrf = session.csrfToken;
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

test('scratch pad starts empty and keeps the exact text across saves', async () => {
  const initial = await json('/api/scratchpad');
  assert.equal(initial.text, '');
  assert.equal(initial.max_length, 200000);

  const text = 'first line\nsecond line\t✓';
  await json('/api/scratchpad', { method: 'PATCH', csrf: true, body: { text } });
  const saved = await json('/api/scratchpad');
  assert.equal(saved.text, text);
  assert.equal(typeof saved.updated_at, 'string');

  const changed = 'changed while open';
  await json('/api/scratchpad', { method: 'PATCH', csrf: true, body: { text: changed } });
  assert.equal((await json('/api/scratchpad')).text, changed);
});

test('scratch pad rejects invalid text and requires CSRF', async () => {
  const noCsrf = await request('/api/scratchpad', {
    method: 'PATCH', body: { text: 'not allowed' },
  });
  assert.equal(noCsrf.status, 403);

  const badType = await request('/api/scratchpad', {
    method: 'PATCH', csrf: true, body: { text: 42 },
  });
  assert.equal(badType.status, 400);

  const tooLong = await request('/api/scratchpad', {
    method: 'PATCH', csrf: true, body: { text: 'x'.repeat(200001) },
  });
  assert.equal(tooLong.status, 400);
});

test('scratch pad never appears in state, counts or search', async () => {
  const sentinel = 'scratchpad-sentinel-not-a-card';
  await json('/api/scratchpad', { method: 'PATCH', csrf: true, body: { text: sentinel } });

  const appState = await json('/api/state');
  assert.ok(!JSON.stringify(appState).includes(sentinel));

  const search = await json(`/api/search?q=${encodeURIComponent(sentinel)}&limit=all&scope=all`);
  assert.deepEqual(search.open, []);
  assert.deepEqual(search.notes, []);
  assert.deepEqual(search.docs, []);
  assert.equal(search.totals.open, 0);
  assert.equal(search.totals.notes, 0);
  assert.equal(search.totals.docs, 0);
});

test('scratch pad is a separate backup field, not a tenant card', async () => {
  const text = 'backup scratch only';
  await json('/api/scratchpad', { method: 'PATCH', csrf: true, body: { text } });
  const backup = await json('/api/export');
  assert.equal(backup.scratchpad.text, text);
  assert.ok(!backup.notes.some((note) => (note.body || '').includes(text)));
  assert.ok(!backup.reminders.some((reminder) => (reminder.notes || '').includes(text)));
});

test('scratch pad restores from a JSON backup', async () => {
  const backupText = 'from the backup';
  await json('/api/scratchpad', { method: 'PATCH', csrf: true, body: { text: backupText } });
  const backup = await json('/api/export');
  await json('/api/scratchpad', { method: 'PATCH', csrf: true, body: { text: 'current scratch' } });
  await json('/api/import', { method: 'POST', csrf: true, body: { data: backup } });
  assert.equal((await json('/api/scratchpad')).text, backupText);
});

test('scratch pad entry point, close, resize grip and pane divider are served', async () => {
  const response = await request('/');
  const html = await response.text();
  assert.match(html, /id="scratchpad-btn"/);
  assert.match(html, /id="scratchpad-close"/);
  assert.match(html, /id="scratchpad-resize"/);
  assert.match(html, /id="sidebar-resizer"/);
  assert.match(html, /aria-valuemin="256"/);
  assert.match(html, /aria-valuemax="416"/);
  assert.match(html, /id="e-notes"/);
  assert.match(html, /S Scratch pad/);
});

test('scratch pad survives sign-out and sign-in', async () => {
  const text = 'persists through auth';
  await json('/api/scratchpad', { method: 'PATCH', csrf: true, body: { text } });
  await json('/api/logout', { method: 'POST', csrf: true });
  const login = await request('/api/login', {
    method: 'POST', body: { username: 'tester', password: 'password123' },
  });
  assert.equal(login.status, 200);
  const session = await json('/api/session');
  csrf = session.csrfToken;
  assert.equal((await json('/api/scratchpad')).text, text);
});
