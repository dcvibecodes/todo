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
let remindersA;
let remindersB;
let notesA;
let notesB;
let docsA;
let docsB;

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

async function createFolder(tenant, name) {
  return json('/api/lists', { method: 'POST', csrf: true, body: { name, tenant } });
}

async function uploadDoc(folderId, name) {
  const form = new FormData();
  form.append('folder_id', String(folderId));
  form.append('files', new Blob(['move me'], { type: 'text/plain' }), name);
  const response = await request('/api/docs', { method: 'POST', csrf: true, body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(`upload ${name} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-move-test-'));
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

  const initial = await json('/api/lists');
  remindersA = initial.lists.find((list) => list.tenant === 'reminders');
  remindersB = await createFolder('reminders', 'Later');
  notesA = await createFolder('notes', 'Notes A');
  notesB = await createFolder('notes', 'Notes B');
  docsA = await createFolder('docs', 'Docs A');
  docsB = await createFolder('docs', 'Docs B');
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

test('moving a reminder through list_id changes its folder', async () => {
  const created = await json('/api/reminders', {
    method: 'POST', csrf: true, body: { list_id: remindersA.id, title: 'Move reminder' },
  });
  await json(`/api/reminders/${created.id}`, {
    method: 'PATCH', csrf: true, body: { list_id: remindersB.id },
  });
  const moved = await json(`/api/reminders?list_id=${remindersB.id}`);
  assert.ok(moved.reminders.some((reminder) => reminder.id === created.id));
  const source = await json(`/api/reminders?list_id=${remindersA.id}`);
  assert.ok(!source.reminders.some((reminder) => reminder.id === created.id));
});

test('moving a note through folder_id changes its folder', async () => {
  const created = await json('/api/notes', {
    method: 'POST', csrf: true, body: { folder_id: notesA.id, title: 'Move note', body: 'body' },
  });
  await json(`/api/notes/${created.id}`, {
    method: 'PATCH', csrf: true, body: { folder_id: notesB.id },
  });
  const moved = await json(`/api/notes?folder_id=${notesB.id}`);
  assert.deepEqual(moved.notes.map((note) => note.id), [created.id]);
  const source = await json(`/api/notes?folder_id=${notesA.id}`);
  assert.ok(!source.notes.some((note) => note.id === created.id));
});

test('moving a document through folder_id changes its folder', async () => {
  const created = await uploadDoc(docsA.id, 'move-me.txt');
  const docId = created.docs[0].id;
  await json(`/api/docs/${docId}`, {
    method: 'PATCH', csrf: true, body: { folder_id: docsB.id },
  });
  const moved = await json(`/api/docs?folder_id=${docsB.id}`);
  assert.deepEqual(moved.docs.map((doc) => doc.id), [docId]);
  assert.equal(moved.docs[0].folder_id, docsB.id);
  const source = await json(`/api/docs?folder_id=${docsA.id}`);
  assert.ok(!source.docs.some((doc) => doc.id === docId));
});

test('folder moves reject a folder from another tenant', async () => {
  const note = await json('/api/notes', {
    method: 'POST', csrf: true, body: { folder_id: notesA.id, title: 'Stay note' },
  });
  const noteMove = await request(`/api/notes/${note.id}`, {
    method: 'PATCH', csrf: true, body: { folder_id: docsB.id },
  });
  assert.equal(noteMove.status, 400);

  const reminder = await json('/api/reminders', {
    method: 'POST', csrf: true, body: { list_id: remindersA.id, title: 'Stay reminder' },
  });
  const reminderMove = await request(`/api/reminders/${reminder.id}`, {
    method: 'PATCH', csrf: true, body: { list_id: notesB.id },
  });
  assert.equal(reminderMove.status, 400);
});
