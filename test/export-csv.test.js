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
let notesFolder;
let docsFolder;
let docId;
let docStoredName;

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-export-csv-test-'));
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
  const reminderFolder = lists.lists.find((list) => list.tenant === 'reminders');
  notesFolder = await json('/api/lists', {
    method: 'POST', csrf: true, body: { name: 'CSV Notes', tenant: 'notes' },
  });
  docsFolder = await json('/api/lists', {
    method: 'POST', csrf: true, body: { name: 'CSV Docs', tenant: 'docs' },
  });

  await json('/api/reminders', {
    method: 'POST', csrf: true,
    body: {
      list_id: reminderFolder.id,
      title: 'CSV reminder',
      notes: 'Reminder line 1\nReminder line 2, "quoted"\nREMINDER-END',
    },
  });
  await json('/api/notes', {
    method: 'POST', csrf: true,
    body: {
      folder_id: notesFolder.id,
      title: 'CSV note, "quoted"',
      body: 'Note line 1\nNote line 2, "quoted"\nNOTE-END',
    },
  });
  const uploaded = await uploadDoc(docsFolder.id, 'csv-doc.txt', 'complete-download-body');
  docId = uploaded.docs[0].id;
  await json(`/api/docs/${docId}`, {
    method: 'PATCH', csrf: true,
    body: { description: 'Doc line 1\nDoc line 2, "quoted"\nDOC-END' },
  });
  const backup = await json('/api/export');
  docStoredName = backup.docs.find((doc) => doc.id === docId).stored_name;
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

test('reminder CSV includes full notes with correct escaping', async () => {
  const res = await request('/api/export/reminders.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  const csv = await res.text();
  assert.ok(csv.startsWith('tenant,id,list_id,folder_name,title,notes,'));
  assert.ok(csv.includes('Reminder line 2, ""quoted""'));
  assert.ok(csv.includes('REMINDER-END'));
  assert.ok(csv.includes('\r\n'));
});

test('notes and docs CSV include the full body/description', async () => {
  const notesRes = await request('/api/export/notes.csv');
  assert.equal(notesRes.status, 200);
  const notesCsv = await notesRes.text();
  assert.ok(notesCsv.startsWith('tenant,id,folder_id,folder_name,title,body,body_format,'));
  assert.ok(notesCsv.includes('"CSV note, ""quoted"""'));
  assert.ok(notesCsv.includes('Note line 2, ""quoted""'));
  assert.ok(notesCsv.includes('NOTE-END'));

  const docsRes = await request('/api/export/docs.csv');
  assert.equal(docsRes.status, 200);
  const docsCsv = await docsRes.text();
  assert.ok(docsCsv.startsWith('tenant,id,folder_id,folder_name,name,description,mime,'));
  assert.ok(docsCsv.includes('Doc line 2, ""quoted""'));
  assert.ok(docsCsv.includes('DOC-END'));
});

test('all-tenants CSV contains one combined set of rows and a tenant column', async () => {
  const res = await request('/api/export/all.csv');
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.startsWith('tenant,id,list_id,folder_id,folder_name,title,name,'));
  assert.ok(csv.includes('\r\nreminders,'));
  assert.ok(csv.includes('\r\nnotes,'));
  assert.ok(csv.includes('\r\ndocs,'));
  assert.ok(csv.includes('CSV note, ""quoted"""'));
  assert.ok(csv.includes('csv-doc.txt'));
});

test('complete download is a ZIP with the JSON data and uploaded files', async () => {
  const res = await request('/api/export/complete');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/zip/);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.includes(Buffer.from('workspace-data.json')));
  assert.ok(buffer.includes(Buffer.from('README.txt')));
  assert.ok(buffer.includes(Buffer.from('uploads/')));
  assert.ok(buffer.includes(Buffer.from(`uploads/${docStoredName}`)));
  const text = buffer.toString('latin1');
  assert.ok(text.includes('docs') || buffer.length > 1000);
});

test('exports screen and menu entry are served', async () => {
  const response = await request('/');
  const html = await response.text();
  assert.match(html, /id="account-exports"/);
  assert.match(html, /id="exports-sheet"/);
  assert.match(html, /id="export-reminders-csv"/);
  assert.match(html, /id="export-notes-csv"/);
  assert.match(html, /id="export-docs-csv"/);
  assert.match(html, /id="export-all-csv"/);
  assert.match(html, /id="export-json-backup"/);
  assert.match(html, /id="export-complete-zip"/);
});

test('JSON backup includes docs and attachment metadata', async () => {
  const backup = await json('/api/export');
  assert.ok(Array.isArray(backup.docs));
  assert.ok(Array.isArray(backup.attachments));
  assert.ok(backup.docs.some((doc) => doc.id === docId && doc.description.includes('DOC-END')));
});
