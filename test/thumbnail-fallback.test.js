'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');

let child;
let tmpDir;
let base;
let cookie = '';
let csrf = '';
let output = '';
let docsFolder;
let imagemagickBin;

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-thumb-fallback-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  imagemagickBin = path.join(tmpDir, 'missing-imagemagick');
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATA_DIR: tmpDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      IMAGEMAGICK_BIN: imagemagickBin,
    },
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
  docsFolder = lists.lists.find((list) => list.tenant === 'docs');
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

test('a missing ImageMagick binary redirects thumbnails to the original preview', async () => {
  const form = new FormData();
  form.append('folder_id', String(docsFolder.id));
  form.append('files', new Blob([PNG], { type: 'image/png' }), 'pixel.png');
  const upload = await request('/api/docs', { method: 'POST', csrf: true, body: form });
  const data = await upload.json();
  if (!upload.ok) throw new Error(`upload -> ${upload.status}: ${JSON.stringify(data)}`);
  const id = data.docs[0].id;

  const thumb = await request(`/api/files/${id}/thumb?w=160`, { redirect: 'manual' });
  assert.equal(thumb.status, 302);
  assert.equal(thumb.headers.get('location'), `/api/files/${id}/preview`);
  assert.equal(thumb.headers.get('cache-control'), 'private, no-store');

  const preview = await request(`/api/files/${id}/preview`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type') || '', /^image\/png/);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), PNG);

  if (process.platform !== 'win32') {
    await fs.writeFile(imagemagickBin, '#!/bin/sh\nexit 1\n');
    await fs.chmod(imagemagickBin, 0o755);
    const failed = await request(`/api/files/${id}/thumb?w=160`, { redirect: 'manual' });
    assert.equal(failed.status, 415);
  }
});
