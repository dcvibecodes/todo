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
let notesFolder;
let docsFolder;
let remindersFolder;
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

async function uploadDoc(folderId, name, contents) {
  const form = new FormData();
  form.append('folder_id', String(folderId));
  form.append('files', new Blob([contents], { type: 'text/plain' }), name);
  const response = await request('/api/docs', { method: 'POST', csrf: true, body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(`upload ${name} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-search-test-'));
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

  notesFolder = await json('/api/lists', {
    method: 'POST', csrf: true, body: { name: 'Notes', tenant: 'notes' },
  });
  docsFolder = await json('/api/lists', {
    method: 'POST', csrf: true, body: { name: 'Docs', tenant: 'docs' },
  });
  const lists = await json('/api/lists');
  remindersFolder = lists.lists.find((list) => list.tenant === 'reminders');

  await json('/api/notes', {
    method: 'POST',
    csrf: true,
    body: { folder_id: notesFolder.id, title: 'one word-second word', body: 'note body' },
  });
  await json('/api/reminders', {
    method: 'POST',
    csrf: true,
    body: { list_id: remindersFolder.id, title: 'one word-second word' },
  });
  await uploadDoc(docsFolder.id, 'one word second word.txt', 'plain text');
  await uploadDoc(docsFolder.id, 'unrelated.txt', 'one word-second word');
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

test('server search matches notes and docs across hyphen/space differences', async () => {
  const data = await json('/api/search?q=one%20word%20second%20word&limit=all&scope=all');
  assert.equal(data.notes.length, 1);
  assert.equal(data.notes[0].title, 'one word-second word');
  assert.equal(data.docs.length, 1);
  assert.equal(data.docs[0].name, 'one word second word.txt');
  assert.equal(data.open.length, 1);
});

test('server search matches the hyphenated query against spaced names', async () => {
  const data = await json('/api/search?q=one-word-second-word&limit=all&scope=all');
  assert.equal(data.notes.length, 1);
  assert.equal(data.docs.length, 1);
});

test('server search still tolerates a one-word typo in notes and docs', async () => {
  const data = await json('/api/search?q=secnod&limit=all&scope=all');
  assert.equal(data.notes.length, 1);
  assert.equal(data.docs.length, 1);
  assert.equal(data.open.length, 1);
});

test('server search ranks notes and docs like reminders', async () => {
  const data = await json('/api/search?q=one%20word&limit=all&scope=all');
  assert.deepEqual(data.notes.map((note) => note.title), ['one word-second word']);
  assert.deepEqual(data.docs.map((doc) => doc.name), ['one word second word.txt']);
});

test('document contents are not searched by the server endpoint', async () => {
  const data = await json('/api/search?q=one%20word%20second%20word&limit=all&scope=docs');
  assert.deepEqual(data.docs.map((doc) => doc.name), ['one word second word.txt']);
});

test('server search reports the best score per group so the client can order groups', async () => {
  const data = await json('/api/search?q=one%20word&limit=all&scope=all');
  assert.ok(data.best_scores);
  assert.ok(data.best_scores.open > 0);
  assert.ok(data.best_scores.notes > 0);
  assert.ok(data.best_scores.docs > 0);
  assert.equal(data.best_scores.completed, 0);
});

test('server search finds a spaced document name when the query has no space', async () => {
  const data = await json('/api/search?q=oneword&limit=all&scope=docs');
  assert.deepEqual(data.docs.map((doc) => doc.name), ['one word second word.txt']);
});

test('server search finds a reminder by its exact item number', async () => {
  const created = await json('/api/reminders', {
    method: 'POST',
    csrf: true,
    body: { list_id: remindersFolder.id, title: 'reference without digits' },
  });
  for (const query of [String(created.id), `#${created.id}`]) {
    const data = await json(`/api/search?q=${encodeURIComponent(query)}&limit=all&scope=all`);
    assert.equal(data.open[0].id, created.id);
    assert.equal(data.open[0].title, 'reference without digits');
    assert.ok(data.best_scores.open >= 1000);
  }
});
