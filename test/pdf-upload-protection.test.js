'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

let child;
let tmpDir;
let base;
let cookie = '';
let csrf = '';
let output = '';
let docsFolder;
let hasGhostscript = true;
let hasQpdf = true;
let plainPdf;

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

// A multi-page PDF written without stream compression, so Ghostscript can
// shrink it well past the 3% threshold and the optimizer visibly runs.
function buildLargePlainPdf(dir) {
  const source = path.join(dir, 'source.ps');
  const target = path.join(dir, 'plain.pdf');
  const pages = [];
  for (let page = 0; page < 300; page += 1) {
    pages.push(`/Helvetica findfont 12 scalefont setfont 72 700 moveto (Protected PDF test page ${page} lorem ipsum dolor sit amet) show showpage`);
  }
  return fs.writeFile(source, pages.join('\n')).then(() => {
    execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', '-dCompressPages=false', `-sOutputFile=${target}`, source], { stdio: 'ignore' });
    return fs.readFile(target);
  });
}

async function upload(name, buffer) {
  const form = new FormData();
  form.append('folder_id', String(docsFolder.id));
  form.append('files', new Blob([buffer], { type: 'application/pdf' }), name);
  const response = await request('/api/docs', { method: 'POST', csrf: true, body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(`upload -> ${response.status}: ${JSON.stringify(data)}`);
  return data.docs[0];
}

async function download(id) {
  const response = await request(`/api/files/${id}`);
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}

test.before(async () => {
  try { execFileSync('gs', ['--version'], { stdio: 'ignore' }); } catch { hasGhostscript = false; }
  try { execFileSync('qpdf', ['--version'], { stdio: 'ignore' }); } catch { hasQpdf = false; }
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-pdf-protection-test-'));
  if (hasGhostscript) plainPdf = await buildLargePlainPdf(tmpDir);
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: path.join(tmpDir, 'data'), PORT: String(port), HOST: '127.0.0.1' },
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
  docsFolder = (await json('/api/lists')).lists.find((list) => list.tenant === 'docs');
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

test('a regular PDF is still optimized on upload', async (t) => {
  if (!hasGhostscript) return t.skip('Ghostscript is not installed');
  assert.ok(plainPdf.length > 50 * 1024, 'the sample must be over the 50 KB threshold');
  const doc = await upload('regular.pdf', plainPdf);
  // The optimizer must run. Whether it keeps its output depends on how much
  // smaller Ghostscript can make this sample, so both outcomes count.
  assert.match(doc.optimization, /^pdf:(optimized|kept)$/);
  assert.ok(doc.stored_size <= doc.original_size);
});

test('a digitally signed PDF without a password is stored unchanged', async (t) => {
  if (!hasGhostscript) return t.skip('Ghostscript is not installed');
  const signed = Buffer.concat([
    plainPdf,
    Buffer.from('\n9999 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 100 200 300] /Contents <00> >>\nendobj\n', 'latin1'),
  ]);
  const doc = await upload('signed.pdf', signed);
  assert.equal(doc.optimization, 'pdf:skipped-signed');
  assert.equal(doc.stored_size, signed.length);
  assert.ok((await download(doc.id)).equals(signed), 'stored bytes must equal the upload');
});

test('a password-protected PDF is stored unchanged and still needs its password', async (t) => {
  if (!hasGhostscript || !hasQpdf) return t.skip('Ghostscript and qpdf are required');
  const source = path.join(tmpDir, 'to-lock.pdf');
  const locked = path.join(tmpDir, 'locked.pdf');
  await fs.writeFile(source, plainPdf);
  try {
    execFileSync('qpdf', ['--allow-weak-crypto', '--encrypt', 'user', 'owner', '128', '--', source, locked], { stdio: 'ignore' });
  } catch {
    return t.skip('qpdf could not encrypt the sample');
  }
  const lockedBytes = await fs.readFile(locked);
  assert.ok(lockedBytes.length > 50 * 1024);
  const doc = await upload('locked.pdf', lockedBytes);
  assert.equal(doc.optimization, 'pdf:skipped-encrypted');
  const stored = await download(doc.id);
  assert.ok(stored.equals(lockedBytes), 'stored bytes must equal the upload');
  const stillLocked = await fs.writeFile(path.join(tmpDir, 'stored.pdf'), stored)
    .then(() => { try { execFileSync('qpdf', ['--check', path.join(tmpDir, 'stored.pdf')], { stdio: 'ignore' }); return false; } catch { return true; } });
  assert.equal(stillLocked, true, 'the stored PDF must still require the password');
});
