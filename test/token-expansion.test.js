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
let tokenRaw = '';
let tokenId = null;
let remindersFolder;
let notesFolder;
let docsFolder;
let docId;

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

async function tokenRequest(pathname, options = {}) {
  const headers = { ...(options.headers || {}), authorization: `Bearer ${tokenRaw}` };
  let body = options.body;
  if (body && typeof body !== 'string') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  return fetch(base + pathname, { ...options, headers, body });
}

async function tokenJson(pathname, options = {}) {
  const response = await tokenRequest(pathname, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${pathname} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function createFolder(name, tenant) {
  return json('/api/lists', { method: 'POST', csrf: true, body: { name, tenant } });
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-token-expansion-test-'));
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

  const lists = await json('/api/lists');
  remindersFolder = lists.lists.find((list) => list.tenant === 'reminders');
  notesFolder = await createFolder('Agent Notes', 'notes');
  docsFolder = await createFolder('Agent Docs', 'docs');
  const uploaded = await uploadDoc(docsFolder.id, 'agent.txt', 'batch doc body');
  docId = uploaded.docs[0].id;

  const created = await json('/api/tokens', {
    method: 'POST', csrf: true,
    body: { name: 'agent', profile: 'write', permissions: [] },
  });
  tokenRaw = created.token;
  tokenId = created.id;
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

test('new permissions are denied until explicitly granted, then work on the existing token', async () => {
  const folderBefore = await tokenRequest('/api/lists', {
    method: 'POST', body: { name: 'Denied', tenant: 'notes' },
  });
  assert.equal(folderBefore.status, 403);
  assert.equal((await tokenRequest('/api/export/token')).status, 403);
  assert.equal((await tokenRequest('/api/batch', {
    method: 'POST', headers: { 'Idempotency-Key': 'denied-batch' }, body: { operations: [] },
  })).status, 403);

  await json(`/api/tokens/${tokenId}/permissions`, {
    method: 'POST', csrf: true,
    body: { permissions: ['folders', 'backup', 'batch', 'notes:read', 'notes:write', 'docs:read', 'docs:write'] },
  });

  const created = await tokenRequest('/api/lists', {
    method: 'POST', body: { name: 'Token folder', tenant: 'notes' },
  });
  assert.equal(created.status, 201);
  const row = await created.json();
  assert.equal(row.tenant, 'notes');

  const renamed = await tokenRequest(`/api/lists/${row.id}`, {
    method: 'PATCH', body: { name: 'Token folder renamed' },
  });
  assert.equal(renamed.status, 200);
  const lists = await tokenJson('/api/lists');
  assert.ok(lists.lists.some((list) => list.id === row.id && list.name === 'Token folder renamed'));

  const notesFolders = lists.lists.filter((list) => list.tenant === 'notes');
  const system = notesFolders.find((list) => list.is_system);
  const reordered = notesFolders.filter((list) => list.id !== system.id).reverse().map((list) => list.id);
  const order = await tokenRequest('/api/lists/order', {
    method: 'PUT', body: { tenant: 'notes', ids: [system.id, ...reordered] },
  });
  assert.equal(order.status, 200);
  const afterOrder = await tokenJson('/api/lists');
  assert.deepEqual(
    afterOrder.lists.filter((list) => list.tenant === 'notes').map((list) => list.id),
    [system.id, ...reordered],
  );

  const deleted = await tokenRequest(`/api/lists/${row.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);

  const purge = await tokenRequest('/api/trash/empty', { method: 'POST' });
  assert.equal(purge.status, 403);
});

test('capabilities expose the new write/read scopes and batch limit', async () => {
  const caps = await tokenJson('/api/capabilities');
  assert.equal(caps.capabilities.folders.write, true);
  assert.equal(caps.capabilities.backup.read, true);
  assert.equal(caps.capabilities.batch.write, true);
  assert.equal(caps.limits.batch_operations, 100);
});

test('token backup returns the same structure as the session backup', async () => {
  const sessionBackup = await json('/api/export');
  const tokenBackup = await tokenJson('/api/export/token');
  assert.deepEqual(Object.keys(tokenBackup).sort(), Object.keys(sessionBackup).sort());
  assert.ok(Array.isArray(tokenBackup.docs));
  assert.ok(Array.isArray(tokenBackup.attachments));
  assert.ok(Object.prototype.hasOwnProperty.call(tokenBackup, 'scratchpad'));
});

test('batch writes atomically, reports per-item errors and is idempotent', async () => {
  const state = await tokenJson('/api/state');
  const epoch = state.store_epoch;
  const doc = await tokenJson(`/api/docs/${docId}`);
  const body = {
    operations: [
      {
        type: 'note', action: 'create',
        data: { folder_id: notesFolder.id, title: 'Batch note', body: 'alpha', base_epoch: epoch },
      },
      {
        type: 'reminder', action: 'create',
        data: { list_id: remindersFolder.id, title: 'Batch reminder' },
      },
      {
        type: 'doc', action: 'update', id: docId,
        data: { description: 'Batch doc updated', base_revision: doc.doc.revision, base_epoch: epoch },
      },
    ],
  };
  const first = await tokenRequest('/api/batch', {
    method: 'POST', headers: { 'Idempotency-Key': 'batch-valid-1' }, body,
  });
  assert.equal(first.status, 200);
  const firstData = await first.json();
  assert.equal(firstData.results.length, 3);

  const notes = await tokenJson('/api/notes');
  const batchNotes = notes.notes.filter((note) => note.title === 'Batch note');
  assert.equal(batchNotes.length, 1);
  const reminders = await tokenJson('/api/reminders');
  assert.equal(reminders.reminders.filter((item) => item.title === 'Batch reminder').length, 1);
  assert.equal((await tokenJson(`/api/docs/${docId}`)).doc.description, 'Batch doc updated');

  const replay = await tokenRequest('/api/batch', {
    method: 'POST', headers: { 'Idempotency-Key': 'batch-valid-1' }, body,
  });
  assert.equal(replay.status, 200);
  const replayData = await replay.json();
  assert.equal(replayData.deduplicated, true);
  assert.equal((await tokenJson('/api/notes')).notes.filter((note) => note.title === 'Batch note').length, 1);

  const invalidBody = {
    operations: [
      {
        type: 'note', action: 'create',
        data: { folder_id: notesFolder.id, title: 'Should not write', body: 'alpha', base_epoch: epoch },
      },
      {
        type: 'note', action: 'create',
        data: { folder_id: 999999, title: 'Broken batch note', base_epoch: epoch },
      },
    ],
  };
  const invalid = await tokenRequest('/api/batch', {
    method: 'POST', headers: { 'Idempotency-Key': 'batch-invalid-1' }, body: invalidBody,
  });
  assert.equal(invalid.status, 400);
  const invalidData = await invalid.json();
  assert.equal(invalidData.items.length, 1);
  assert.equal(invalidData.items[0].index, 1);
  assert.equal((await tokenJson('/api/notes')).notes.filter((note) => note.title === 'Should not write').length, 0);

  const batchOnly = await json('/api/tokens', {
    method: 'POST', csrf: true, body: { name: 'batch-only', profile: 'read', permissions: ['batch'] },
  });
  const deniedBody = {
    operations: [{
      type: 'note', action: 'create',
      data: { folder_id: notesFolder.id, title: 'Denied batch note', base_epoch: epoch },
    }],
  };
  const denied = await fetch(base + '/api/batch', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${batchOnly.token}`,
      'content-type': 'application/json',
      'Idempotency-Key': 'batch-denied-1',
    },
    body: JSON.stringify(deniedBody),
  });
  assert.equal(denied.status, 403);
  const deniedData = await denied.json();
  assert.equal(deniedData.items[0].status, 403);
});
