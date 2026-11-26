'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

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

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-in-progress-import-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 149) throw new Error(`server did not start\n${output}`);
  }
  const ctx = { base, cookie: '', csrf: '', child, dir };
  ctx.call = async (pathname, options = {}) => {
    const headers = {};
    if (ctx.cookie) headers.cookie = ctx.cookie;
    if (options.csrf) headers['x-csrf-token'] = ctx.csrf;
    let body;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(base + pathname, { method: options.method, headers, body });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) ctx.cookie = setCookie.split(';')[0];
    const data = await response.json();
    if (!response.ok) throw new Error(`${pathname} -> ${response.status}: ${JSON.stringify(data)}`);
    return data;
  };
  await ctx.call('/api/setup', {
    method: 'POST', body: { username: 'tester', password: 'password123', confirm: 'password123' },
  });
  ctx.csrf = (await ctx.call('/api/session')).csrfToken;
  return ctx;
}

async function stop(ctx) {
  ctx.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    ctx.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await fs.rm(ctx.dir, { recursive: true, force: true });
}

test('a backup restored into a fresh database keeps ids and in-progress marks', async () => {
  const source = await startServer();
  const target = await startServer();
  try {
    const lists = await source.call('/api/lists');
    const folder = lists.lists.find((list) => list.tenant === 'reminders').id;
    const make = async (title) => {
      const data = await source.call('/api/reminders', {
        method: 'POST', csrf: true, body: { list_id: folder, title },
      });
      return (data.reminder || data).id;
    };
    const marked = await make('Marked');
    const plain = await make('Plain');
    const done = await make('Done');
    await source.call(`/api/reminders/${marked}`, { method: 'PATCH', csrf: true, body: { in_progress: true } });
    await source.call(`/api/reminders/${done}`, { method: 'PATCH', csrf: true, body: { completed: true } });
    const stamp = (await source.call(`/api/reminders/${marked}`));
    const markedStamp = (stamp.reminder || stamp).in_progress_at;
    assert.ok(markedStamp);

    const backup = await source.call('/api/export');
    await target.call('/api/import', { method: 'POST', csrf: true, body: { data: backup } });

    const restored = await target.call('/api/export');
    const byId = new Map(restored.reminders.map((r) => [r.id, r]));
    assert.equal(byId.get(marked).title, 'Marked');
    assert.equal(byId.get(marked).in_progress_at, markedStamp);
    assert.equal(byId.get(plain).in_progress_at, null);
    assert.equal(byId.get(done).completed, 1);
    assert.equal(byId.get(done).in_progress_at, null);
  } finally {
    await stop(source);
    await stop(target);
  }
});
