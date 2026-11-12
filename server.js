'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const db = require('./db');
const auth = require('./auth');
const push = require('./push');
const SQLiteSessionStore = require('./session-store');
const recurrence = require('./recurrence');
const fuzzy = require('./public/fuzzy-search');
const chrono = require('chrono-node');

const PORT = Number(process.env.PORT) || 3006;
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = require('./package.json').version;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_SECRET_KEY = 'session_secret';
const DEFAULT_LIST_COLOR = 'blue';
const LIST_COLORS = new Set(['red', 'rose', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'slate', 'gray']);
const NOTES_MAX = 50000;
const NOTE_BODY_MAX = 200000;
const TENANTS = new Set(['reminders', 'notes', 'docs']);
const DOC_FORMAT_REGISTRY = [
  { ext: '.doc', category: 'Word', label: 'Word document', mime: 'application/msword', icon: 'file', signature: 'ole' },
  { ext: '.docx', category: 'Word', label: 'Word document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', icon: 'file', signature: 'zip' },
  { ext: '.pdf', category: 'PDF', label: 'PDF', mime: 'application/pdf', icon: 'file', signature: 'pdf' },
  { ext: '.xls', category: 'Excel', label: 'Excel spreadsheet', mime: 'application/vnd.ms-excel', icon: 'table', signature: 'ole' },
  { ext: '.xlsx', category: 'Excel', label: 'Excel spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', icon: 'table', signature: 'zip' },
  { ext: '.txt', category: 'TXT', label: 'TXT', mime: 'text/plain', icon: 'file', signature: null },
  { ext: '.md', category: 'Markdown', label: 'Markdown', mime: 'text/markdown', icon: 'file', signature: null },
  { ext: '.html', category: 'HTML', label: 'HTML', mime: 'text/html', icon: 'file', signature: null },
  { ext: '.htm', category: 'HTML', label: 'HTML', mime: 'text/html', icon: 'file', signature: null },
  { ext: '.png', category: 'Images', label: 'PNG image', mime: 'image/png', icon: 'image', signature: 'png' },
  { ext: '.jpg', category: 'Images', label: 'JPEG image', mime: 'image/jpeg', icon: 'image', signature: 'jpeg' },
  { ext: '.gif', category: 'Images', label: 'GIF image', mime: 'image/gif', icon: 'image', signature: 'gif' },
  { ext: '.webp', category: 'Images', label: 'WebP image', mime: 'image/webp', icon: 'image', signature: 'webp' },
  { ext: '.bmp', category: 'Images', label: 'BMP image', mime: 'image/bmp', icon: 'image', signature: 'bmp' },
  { ext: '.csv', category: 'CSV', label: 'CSV', mime: 'text/csv', icon: 'table', signature: null },
  { ext: '.json', category: 'JSON', label: 'JSON', mime: 'application/json', icon: 'braces', signature: null },
  { ext: '.zip', category: 'ZIP', label: 'ZIP archive', mime: 'application/zip', icon: 'archive', signature: 'zip' },
];
const DOC_FORMAT_MAP = new Map(DOC_FORMAT_REGISTRY.map((format) => [format.ext, format]));
const DOC_EXTENSIONS = new Set(DOC_FORMAT_REGISTRY.map((format) => format.ext));
const DOC_FORMATS_PUBLIC = DOC_FORMAT_REGISTRY.map(({ ext, category, label, mime, icon }) => ({
  ext, category, label, mime, icon,
}));
const DOC_FORMAT_CATEGORIES = [...new Set(DOC_FORMAT_REGISTRY.map((format) => format.category))];
const DOC_FORMAT_SUMMARY = DOC_FORMAT_CATEGORIES.join(', ');
const DOC_FORMAT_EXTENSIONS = DOC_FORMAT_REGISTRY.map((format) => format.ext).join(', ');
const PREVIEW_IMAGE_FORMATS = new Map([
  ['.png', { mime: 'image/png', signature: 'png' }],
  ['.jpg', { mime: 'image/jpeg', signature: 'jpeg' }],
  ['.jpeg', { mime: 'image/jpeg', signature: 'jpeg' }],
  ['.gif', { mime: 'image/gif', signature: 'gif' }],
  ['.webp', { mime: 'image/webp', signature: 'webp' }],
  ['.bmp', { mime: 'image/bmp', signature: 'bmp' }],
]);

function previewImageFormatForName(name) {
  return PREVIEW_IMAGE_FORMATS.get(path.extname(String(name || '')).toLowerCase()) || null;
}
const UPLOAD_DIR = path.join(db.DATA_DIR, 'uploads');
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 10 },
});

function validTenant(value, fallback = 'reminders') {
  return TENANTS.has(value) ? value : fallback;
}

function cleanFileName(value) {
  const name = path.basename(String(value || 'file')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'file').slice(0, 200);
}

function docFormatForName(name) {
  return DOC_FORMAT_MAP.get(path.extname(String(name || '')).toLowerCase()) || null;
}

function docExtensionAllowed(name) {
  return Boolean(docFormatForName(name));
}

function docsFormatError() {
  return `Docs supports ${DOC_FORMAT_SUMMARY} files only (${DOC_FORMAT_EXTENSIONS}).`;
}

async function readFileHead(filePath, length = 16) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close().catch(() => {});
  }
}

function signatureMatches(buffer, kind) {
  if (!buffer || !buffer.length) return false;
  const ascii = buffer.toString('latin1');
  if (kind === 'pdf') return ascii.startsWith('%PDF-');
  if (kind === 'png') return buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === 'jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (kind === 'gif') return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
  if (kind === 'webp') return buffer.length >= 12 && ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (kind === 'bmp') return ascii.startsWith('BM');
  if (kind === 'zip') return ascii.startsWith('PK\x03\x04') || ascii.startsWith('PK\x05\x06') || ascii.startsWith('PK\x07\x08');
  if (kind === 'ole') return buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  return true;
}

async function docContentMatches(filePath, format) {
  if (!format || !format.signature) return true;
  const head = await readFileHead(filePath);
  return signatureMatches(head, format.signature);
}

const COMPRESSIBLE_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm', '.xml', '.svg',
  '.js', '.css', '.log', '.rtf', '.yaml', '.yml', '.tsv', '.sql', '.ini', '.conf',
]);
const IMAGE_COMPRESSION_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const IMAGE_SIGNATURES = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp' };
const IMAGE_MAX_EDGE = 2400;
const MIN_COMPRESSION_SAVINGS = 0.08;
const MIN_COMPRESSION_BYTES = 1024;
let imageMagickMissingLogged = false;

function isCompressibleText(name, mime) {
  if (COMPRESSIBLE_TEXT_EXTENSIONS.has(path.extname(String(name || '')).toLowerCase())) return true;
  return /^text\//i.test(String(mime || ''))
    || ['application/json', 'application/xml', 'application/javascript', 'image/svg+xml'].includes(String(mime || '').toLowerCase());
}

async function replaceIfSmaller(original, temp, minSavings = MIN_COMPRESSION_SAVINGS) {
  try {
    const [before, after] = await Promise.all([
      fs.promises.stat(original),
      fs.promises.stat(temp),
    ]);
    if (after.size > 0 && after.size < before.size * (1 - minSavings)) {
      await fs.promises.rename(temp, original);
      return after.size;
    }
  } catch { /* fall through to cleanup */ }
  await fs.promises.unlink(temp).catch(() => {});
  return null;
}

async function optimizeImage(filePath, name) {
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_COMPRESSION_EXTENSIONS.has(ext)) return null;
  let matches = true;
  try {
    matches = await docContentMatches(filePath, { signature: IMAGE_SIGNATURES[ext] });
  } catch {
    matches = false;
  }
  if (!matches) return null;
  const temp = `${filePath}.opt-${crypto.randomUUID()}${ext}`;
  const command = process.env.IMAGEMAGICK_BIN || 'convert';
  const args = [
    '-limit', 'memory', '256MiB',
    '-limit', 'map', '512MiB',
    filePath,
  ];
  if (ext === '.gif' || ext === '.webp') args.push('-coalesce');
  args.push('-auto-orient', '-resize', `${IMAGE_MAX_EDGE}x${IMAGE_MAX_EDGE}>`, '-strip');
  if (ext === '.png') {
    args.push('-colors', '256', '-dither', 'FloydSteinberg', '-quality', '90', '-define', 'png:compression-level=9');
  } else if (ext === '.jpg' || ext === '.jpeg') {
    args.push('-quality', '82', '-sampling-factor', '4:2:0', '-interlace', 'Plane');
  } else if (ext === '.webp') {
    args.push('-quality', '82');
  } else if (ext === '.gif') {
    args.push('-layers', 'Optimize');
  }
  args.push(temp);
  try {
    await execFileAsync(command, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    return await replaceIfSmaller(filePath, temp);
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => {});
    if (err.code === 'ENOENT') {
      if (!imageMagickMissingLogged) {
        imageMagickMissingLogged = true;
        console.warn('Image compression unavailable: ImageMagick (convert) is not installed');
      }
    } else {
      console.warn(`Image compression skipped for ${name}: ${err.message}`);
    }
    return null;
  }
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function optimizePdf(filePath, name) {
  const before = await fs.promises.stat(filePath).catch(() => null);
  if (!before || before.size < 50 * 1024) return null;
  const temp = `${filePath}.opt-${crypto.randomUUID()}`;
  const gs = process.env.GHOSTSCRIPT_BIN || 'gs';
  const args = [
    '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    '-dPDFSETTINGS=/ebook',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    '-dColorImageResolution=150',
    '-dGrayImageResolution=150',
    '-dMonoImageResolution=300',
    `-sOutputFile=${temp}`,
    filePath,
  ];
  try {
    await execFileAsync(gs, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const head = await readFileHead(temp, 5);
    if (head.toString() !== '%PDF-') throw new Error('Ghostscript did not produce a PDF');
    return await replaceIfSmaller(filePath, temp, 0.03);
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => {});
    if (err.code !== 'ENOENT') console.warn(`PDF compression skipped for ${name}: ${err.message}`);
    return null;
  }
}

async function gzipTextFile(filePath) {
  const before = await fs.promises.stat(filePath).catch(() => null);
  if (!before || before.size < MIN_COMPRESSION_BYTES) return null;
  const temp = `${filePath}.gz-${crypto.randomUUID()}`;
  try {
    const raw = await fs.promises.readFile(filePath);
    const zipped = await new Promise((resolve, reject) => {
      zlib.gzip(raw, { level: 9 }, (err, buffer) => (err ? reject(err) : resolve(buffer)));
    });
    if (zipped.length >= before.size * (1 - MIN_COMPRESSION_SAVINGS)) return null;
    await fs.promises.writeFile(temp, zipped);
    await fs.promises.rename(temp, filePath);
    return zipped.length;
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => {});
    console.warn(`Text compression skipped: ${err.message}`);
    return null;
  }
}

async function optimizeUploadedFile(file, name) {
  const stat = await fs.promises.stat(file.path);
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_COMPRESSION_EXTENSIONS.has(ext)) {
    const next = await optimizeImage(file.path, name);
    const size = next || stat.size;
    return { size, storedSize: size, compression: '' };
  }
  if (ext === '.pdf') {
    const next = await optimizePdf(file.path, name);
    const size = next || stat.size;
    return { size, storedSize: size, compression: '' };
  }
  if (isCompressibleText(name, file.mimetype)) {
    const storedSize = await gzipTextFile(file.path);
    if (storedSize) return { size: stat.size, storedSize, compression: 'gzip' };
  }
  return { size: stat.size, storedSize: stat.size, compression: '' };
}

async function removeStoredFiles(rows) {
  const root = path.resolve(UPLOAD_DIR);
  for (const row of rows || []) {
    if (!row) continue;
    let target = null;
    if (row.stored_name) target = path.join(root, path.basename(row.stored_name));
    else if (row.filename) target = path.join(root, path.basename(row.filename));
    else if (row.path) target = path.resolve(row.path);
    if (!target) continue;
    if (path.dirname(target) !== root) continue;
    await fs.promises.unlink(target).catch(() => {});
  }
}

async function folderRow(id, tenant) {
  const folder = await db.get('SELECT id, name, tenant FROM lists WHERE id = ?', [id]);
  if (!folder || folder.tenant !== tenant) return null;
  return folder;
}

async function systemFolderId(tenant) {
  const folder = await db.get('SELECT id FROM lists WHERE tenant = ? AND is_system = 1 LIMIT 1', [tenant]);
  return folder ? folder.id : null;
}

async function hashUploadedFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function storageSnapshot(allowedTenants = null) {
  const [reminderText, noteText, docNames, fileRows, largestRows] = await Promise.all([
    db.get(`SELECT COALESCE(SUM(LENGTH(CAST(title AS BLOB)) + LENGTH(CAST(notes AS BLOB))), 0) AS bytes FROM reminders`),
    db.get(`SELECT COALESCE(SUM(LENGTH(CAST(title AS BLOB)) + LENGTH(CAST(body AS BLOB))), 0) AS bytes FROM notes`),
    db.get(`SELECT COALESCE(SUM(LENGTH(CAST(name AS BLOB))), 0) AS bytes FROM attachments WHERE owner_type = 'doc'`),
    db.all(`SELECT tenant, COALESCE(SUM(COALESCE(stored_size, size)), 0) AS bytes, COUNT(*) AS files FROM attachments GROUP BY tenant`),
    db.all(`SELECT a.id, a.tenant, a.owner_type, a.owner_id, a.name, COALESCE(a.stored_size, a.size) AS size, a.mime,
                   l.name AS folder_name
            FROM attachments a LEFT JOIN lists l ON l.id = a.folder_id
            ORDER BY COALESCE(a.stored_size, a.size) DESC, a.id DESC LIMIT 20`),
  ]);
  const files = { reminders: 0, notes: 0, docs: 0 };
  const counts = { reminders: 0, notes: 0, docs: 0 };
  for (const row of fileRows) {
    if (!files[row.tenant]) files[row.tenant] = 0;
    files[row.tenant] += row.bytes || 0;
    counts[row.tenant] = row.files || 0;
  }
  const text = {
    reminders: reminderText.bytes || 0,
    notes: noteText.bytes || 0,
    docs: docNames.bytes || 0,
  };
  const tenants = {};
  let fileTotal = 0;
  for (const tenant of ['reminders', 'notes', 'docs']) {
    fileTotal += files[tenant];
    tenants[tenant] = {
      files: files[tenant],
      fileCount: counts[tenant],
      text: text[tenant],
      total: files[tenant] + text[tenant],
    };
  }
  let databaseBytes = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try { databaseBytes += fs.statSync(db.DB_FILE + suffix).size; } catch { /* not present */ }
  }
  const total = fileTotal + databaseBytes;
  let snapshot = {
    total,
    database: databaseBytes,
    files: fileTotal,
    text: text.reminders + text.notes + text.docs,
    other: Math.max(0, databaseBytes - (text.reminders + text.notes + text.docs)),
    tenants,
    largest: largestRows,
    filtered: false,
  };
  if (Array.isArray(allowedTenants)) {
    const allowed = new Set(allowedTenants);
    const scopedTenants = {};
    let scopedFiles = 0;
    let scopedText = 0;
    for (const tenant of ['reminders', 'notes', 'docs']) {
      if (!allowed.has(tenant)) {
        scopedTenants[tenant] = { files: 0, fileCount: 0, text: 0, total: 0 };
        continue;
      }
      scopedTenants[tenant] = tenants[tenant];
      scopedFiles += tenants[tenant].files;
      scopedText += tenants[tenant].text;
    }
    snapshot = {
      total: scopedFiles + scopedText,
      database: 0,
      files: scopedFiles,
      text: scopedText,
      other: 0,
      tenants: scopedTenants,
      largest: largestRows.filter((row) => allowed.has(row.tenant)),
      filtered: true,
    };
  }
  return snapshot;
}


const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// Express 4 does not forward rejected promises from async handlers/callbacks
// to the error middleware; since Node 15 an unhandled rejection kills the
// process. Wrap every verb route so a failed await becomes next(err) instead
// of a crash. The final error middleware additionally avoids re-responding
// after headers are already sent.
for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[verb].bind(app);
  app[verb] = function (...layers) {
    const wrapped = layers.map((layer) => (typeof layer !== 'function' ? layer
      : function route(req, res, next) {
        try {
          const out = layer(req, res, next);
          if (out && typeof out.catch === 'function') out.catch(next);
        } catch (err) {
          next(err);
        }
      }));
    return original(...wrapped);
  };
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  },
});

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// For import: any parseable date string becomes the canonical `...Z` ISO form
// (the scheduler and occurrence matching compare such strings lexically), an
// unparseable one becomes null.
function isoOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validColor(value) {
  return LIST_COLORS.has(value) ? value : DEFAULT_LIST_COLOR;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/* ---------------- Settings ---------------- */

const SETTING_DEFAULTS = {
  default_time: '09:00',
  // Floating is the everyday default: a reminder at 6pm stays at 6pm when
  // the device travels. Existing reminders keep their stored model.
  default_time_model: 'floating',
  default_time_zone: '',
  device_zone: '',
  device_zone_updated_at: '',
  repush_enabled: '0',
  repush_cadence_min: '60',
  repush_max: '3',
  quiet_start: '23:00',
  quiet_end: '07:00',
  // Per-list progress display, synced across devices (like sorting).
  // 'bar' | 'ring' | 'off', and 'all' | '30d' for what the counts cover.
  list_progress: 'bar',
  list_progress_range: 'all',
  // Per-view sorting, synced across devices. JSON string:
  // { default: {field, dir} | null, overrides: { "list:5": {field, dir},
  // "today": {...}, ... } }. Empty means no device has seeded it yet; the
  // web app then falls back to its own local sorting and offers it as the
  // seed. Written only through /api/settings/sort, never the generic
  // settings endpoint.
  sort: '',
};

const TIME_MODELS = ['fixed', 'floating', 'anchored'];

function isHHMM(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

async function getSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  const out = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (row.key in out) out[row.key] = row.value;
  }
  return out;
}

const COMPLETED_RETENTION_VALUES = ['1m', '3m', '6m', '12m', 'forever'];
const COMPLETED_RETENTION_DAYS = { '1m': 30, '3m': 90, '6m': 180, '12m': 365 };

function validCompletedRetention(value) {
  return COMPLETED_RETENTION_VALUES.includes(value) ? value : null;
}

function retentionCutoff(value) {
  const days = COMPLETED_RETENTION_DAYS[value];
  return days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
}

function retentionCutoffs() {
  const cutoffs = {};
  for (const [value, days] of Object.entries(COMPLETED_RETENTION_DAYS)) {
    cutoffs[value] = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }
  return cutoffs;
}

async function purgeCompletedRetention(listId = null) {
  const lists = listId
    ? await db.all('SELECT id, completed_retention FROM lists WHERE id = ?', [listId])
    : await db.all('SELECT id, completed_retention FROM lists');
  let total = 0;
  for (const list of lists) {
    const cutoff = retentionCutoff(list.completed_retention);
    if (!cutoff) continue;
    const expired = await db.all(
      `SELECT id FROM reminders
       WHERE list_id = ? AND completed = 1 AND completed_at IS NOT NULL AND completed_at < ?`,
      [list.id, cutoff]
    );
    for (const reminder of expired) {
      const files = await db.all(
        "SELECT stored_name FROM attachments WHERE owner_type = 'reminder' AND owner_id = ?",
        [reminder.id]
      );
      await removeStoredFiles(files);
      await db.run(
        "DELETE FROM attachments WHERE owner_type = 'reminder' AND owner_id = ?",
        [reminder.id]
      );
    }
    const result = await db.run(
      `DELETE FROM reminders
       WHERE list_id = ? AND completed = 1 AND completed_at IS NOT NULL AND completed_at < ?`,
      [list.id, cutoff]
    );
    total += result.changes || 0;
  }
  return total;
}

// Only these keys may be written through the settings endpoint. Anything
// else (VAPID keys, session secret) stays server-managed.
function validateSetting(key, value) {
  switch (key) {
    case 'default_time':
    case 'quiet_start':
    case 'quiet_end':
      if (!isHHMM(value)) return 'Must look like 09:00';
      return null;
    case 'default_time_model':
      if (!TIME_MODELS.includes(value)) return 'Must be fixed, floating, or anchored';
      return null;
    case 'default_time_zone':
      if (value !== '' && !recurrence.isValidTimeZone(value)) return 'Unknown timezone';
      return null;
    case 'device_zone':
      if (value !== '' && !recurrence.isValidTimeZone(value)) {
        return 'Unknown timezone';
      }
      return null;
    case 'device_zone_updated_at':
      return null;
    case 'repush_enabled':
      if (value !== '0' && value !== '1') return 'Must be 0 or 1';
      return null;
    case 'repush_cadence_min': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 15 || n > 480) return 'Must be 15 to 480 minutes';
      return null;
    }
    case 'repush_max': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 10) return 'Must be 1 to 10';
      return null;
    }
    case 'list_progress':
      if (!['bar', 'ring', 'off'].includes(value)) return 'Must be bar, ring, or off';
      return null;
    case 'list_progress_range':
      if (!['all', '30d'].includes(value)) return 'Must be all or 30d';
      return null;
    default:
      return 'Unknown setting';
  }
}

function effectiveZoneFor(reminder, settings) {
  // Which zone drives this reminder's schedule math. Fixed instants use UTC
  // calendar math (zone null). Floating follows the last-synced device zone;
  // anchored follows the reminder's home zone.
  if (reminder.time_model === 'anchored' && recurrence.isValidTimeZone(reminder.time_zone)) {
    return reminder.time_zone;
  }
  if (reminder.time_model === 'floating') {
    if (recurrence.isValidTimeZone(settings.device_zone)) return settings.device_zone;
    if (recurrence.isValidTimeZone(reminder.time_zone)) return reminder.time_zone;
  }
  return null;
}

/* ---------------- Personal access tokens ---------------- */

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function tokenAuth(req, res, next) {
  if (req.token) return next(); // Already validated by the bearer pre-check.
  const raw = bearerToken(req);
  if (!raw) return next();
  try {
    const row = await lookupToken(raw);
    if (!row) return res.status(401).json({ error: 'Invalid or revoked token' });
    req.token = row;
    req.tokenHash = hashToken(raw);
    touchToken(row.id);
    return next();
  } catch (err) {
    return next(err);
  }
}

function denyToken(res) {
  return res.status(403).json({ error: 'This token is not allowed to use this endpoint' });
}


const TOKEN_SCOPES = new Set([
  'notes:read', 'notes:write', 'notes:delete',
  'docs:read', 'docs:write', 'docs:delete',
  'storage:read', 'search:read',
]);

function normalizeTokenPermissions(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((scope) => TOKEN_SCOPES.has(scope)))];
}

function validTokenPermissionsInput(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.some((scope) => !TOKEN_SCOPES.has(scope))) return null;
  return [...new Set(value)];
}

function tokenPermissions(token) {
  return normalizeTokenPermissions(token ? token.permissions : []);
}

function tokenHas(token, scope) {
  return tokenPermissions(token).includes(scope);
}

function tokenReminderWrite(token) {
  return Boolean(token) && (token.profile === 'write' || token.profile === 'legacy');
}

function tokenTenantCan(token, tenant, level) {
  if (tenant === 'reminders') {
    if (level === 'read') return true;
    if (level === 'write') return tokenReminderWrite(token);
    return false;
  }
  return tokenHas(token, `${tenant}:${level}`);
}

function tokenAuthorizedTenants(token) {
  return ['reminders'].concat(
    tokenHas(token, 'notes:read') ? ['notes'] : [],
    tokenHas(token, 'docs:read') ? ['docs'] : [],
  );
}

async function lookupToken(raw) {
  return db.get(
    'SELECT id, name, profile, permissions FROM personal_access_tokens WHERE token_hash = ? AND revoked_at IS NULL',
    [hashToken(raw)]
  );
}

function touchToken(id) {
  db.run(
    'UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?',
    [new Date().toISOString(), id]
  ).catch(() => {});
}

// Canonical JSON (object keys sorted, recursive) for idempotency payload
// fingerprints. Fingerprints cover the RAW client-supplied body fields,
// excluding idempotency_key itself — never resolved defaults or
// server-computed targets.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function payloadFingerprint(body) {
  const copy = { ...(body || {}) };
  delete copy.idempotency_key;
  return crypto.createHash('sha256').update(canonicalJson(copy)).digest('hex');
}

function idempotencyKeyFrom(req) {
  const key = req.get('Idempotency-Key') ?? req.body?.idempotency_key;
  if (typeof key !== 'string' || !key.trim() || key.trim().length > 200) return null;
  return key.trim();
}

// Server-managed store epoch: regenerated on every completed backup import
// and nowhere else. Guards (id, revision) pairs against restore-coincidence.
async function getStoreEpoch() {
  let epoch = await db.getSetting('store_epoch');
  if (!epoch) {
    epoch = crypto.randomBytes(16).toString('hex');
    await db.setSetting('store_epoch', epoch);
  }
  return epoch;
}

// Stored-response idempotency for write-profile token mutations. Claim +
// validation + mutation + response freeze run as ONE transaction; the HTTP
// response is sent only after COMMIT.
async function runTokenWrite(req, res, { route, key, fingerprint, execute }) {
  const tokenId = req.token.id;
  const replayEnvelope = async (claim) => {
    const result = JSON.parse(claim.response_json);
    const envelope = { deduplicated: true, original_status: claim.status, result };
    if (claim.reminder_id) {
      const stillThere = await loadReminder(claim.reminder_id);
      if (!stillThere) envelope.deleted = true;
    }
    return { status: 200, body: envelope };
  };
  try {
    return await db.transaction(async () => {
      const claim = await db.get(
        'SELECT payload_hash, response_json, status, reminder_id FROM token_idempotency_keys WHERE token_id = ? AND route = ? AND key = ?',
        [tokenId, route, key]
      );
      if (claim) {
        if (claim.payload_hash !== fingerprint) {
          throw tokenWriteError(409, 'Idempotency key reused with a different payload');
        }
        const out = await replayEnvelope(claim);
        return out;
      }
      try {
        await db.run(
          'INSERT INTO token_idempotency_keys (token_id, route, key, payload_hash, response_json, status, reminder_id, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)',
          [tokenId, route, key, fingerprint, new Date().toISOString()]
        );
      } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT') {
          // Lost a race with an identical claim: re-read and answer as replay.
          const raced = await db.get(
            'SELECT payload_hash, response_json, status, reminder_id FROM token_idempotency_keys WHERE token_id = ? AND route = ? AND key = ?',
            [tokenId, route, key]
          );
          if (raced && raced.payload_hash === fingerprint) {
            return replayEnvelope(raced);
          }
          throw tokenWriteError(409, 'Idempotency key reused with a different payload');
        }
        throw err;
      }
      const out = await execute();
      if (out.status >= 200 && out.status < 300) {
        await db.run(
          'UPDATE token_idempotency_keys SET response_json = ?, status = ?, reminder_id = ? WHERE token_id = ? AND route = ? AND key = ?',
          [JSON.stringify(out.body), out.status, out.reminderId ?? null, tokenId, route, key]
        );
        return out;
      }
      // Conflicts and validation outcomes freeze nothing: roll the claim
      // back so the same key stays safely retryable with corrected input.
      throw { status: out.status, body: out.body, rollbackOnly: true };
    }).then((out) => res.status(out.status).json(out.body));
  } catch (err) {
    if (res.headersSent) return;
    if (err && err.rollbackOnly) return res.status(err.status).json(err.body);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
}


// Token uploads: same stored-response protocol as runTokenWrite, but the
// temporary files must be deleted on replay/validation failure. The caller
// owns deleting them on success (they become the stored file).
async function runTokenUpload(req, res, { route, key, fingerprint, execute, cleanup }) {
  const tokenId = req.token.id;
  const replayEnvelope = async (claim) => {
    await cleanup();
    const result = JSON.parse(claim.response_json);
    return { status: 200, body: { deduplicated: true, original_status: claim.status, result } };
  };
  try {
    const out = await db.transaction(async () => {
      const claim = await db.get(
        'SELECT payload_hash, response_json, status FROM token_idempotency_keys WHERE token_id = ? AND route = ? AND key = ?',
        [tokenId, route, key]
      );
      if (claim) {
        if (claim.payload_hash !== fingerprint) {
          throw tokenWriteError(409, 'Idempotency key reused with a different payload');
        }
        return replayEnvelope(claim);
      }
      try {
        await db.run(
          'INSERT INTO token_idempotency_keys (token_id, route, key, payload_hash, response_json, status, reminder_id, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)',
          [tokenId, route, key, fingerprint, new Date().toISOString()]
        );
      } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT') {
          const raced = await db.get(
            'SELECT payload_hash, response_json, status FROM token_idempotency_keys WHERE token_id = ? AND route = ? AND key = ?',
            [tokenId, route, key]
          );
          if (raced && raced.payload_hash === fingerprint) return replayEnvelope(raced);
          throw tokenWriteError(409, 'Idempotency key reused with a different payload');
        }
        throw err;
      }
      const result = await execute();
      if (result.status >= 200 && result.status < 300) {
        await db.run(
          'UPDATE token_idempotency_keys SET response_json = ?, status = ? WHERE token_id = ? AND route = ? AND key = ?',
          [JSON.stringify(result.body), result.status, tokenId, route, key]
        );
        return result;
      }
      throw { status: result.status, body: result.body, rollbackOnly: true };
    });
    res.status(out.status).json(out.body);
  } catch (err) {
    await cleanup();
    if (res.headersSent) return;
    if (err && err.rollbackOnly) return res.status(err.status).json(err.body);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
}

function tokenWriteError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Push-action signatures: the scheduler signs (reminder, occurrence, action)
// with the server secret so the service worker can Complete/Snooze without a
// session or CSRF token. Stale occurrences are rejected by matching due_at.
let actionSecretCache = null;
async function getActionSecret() {
  if (!actionSecretCache) {
    actionSecretCache = await db.getSetting(SESSION_SECRET_KEY);
  }
  return actionSecretCache;
}

async function signPushAction(reminderId, occurrenceAt, action) {
  const secret = await getActionSecret();
  return crypto.createHmac('sha256', secret)
    .update(`${reminderId}:${occurrenceAt}:${action}`)
    .digest('hex');
}

async function verifyPushAction(reminderId, occurrenceAt, action, sig) {
  if (typeof sig !== 'string' || !sig) return false;
  const expected = await signPushAction(reminderId, occurrenceAt, action);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- Shared reminder logic ---------------- */
// Every write path (browser UI, token API, push actions) funnels through these
// helpers so behavior is identical no matter where the request came from.

async function loadReminder(id) {
  return db.get('SELECT * FROM reminders WHERE id = ?', [id]);
}

function parseRuleColumn(value) {
  try {
    return recurrence.parseRepeatRule(value);
  } catch (err) {
    err.status = 400;
    throw err;
  }
}

// A completed stamp newer than this is treated as a double-tap / racing
// retry of the same occurrence; an older stamp is history (the user moved
// the date back) and completes normally.
const DUPLICATE_COMPLETE_WINDOW_MS = 10000;

async function completeReminder(id) {
  const reminder = await loadReminder(id);
  if (!reminder) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }
  const now = new Date().toISOString();
  let rule = parseRuleColumn(reminder.repeat_rule);
  if (!recurrence.isRecurringRule(rule)) {
    if (reminder.completed) return { advanced: false, reminder };
    await db.run(
      'UPDATE reminders SET completed = 1, completed_at = ?, snoozed_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [now, now, id]
    );
    return { advanced: false };
  }
  // Recurring: completing records this occurrence and advances the series.
  // The series itself is never marked completed.
  if (!reminder.due_at) {
    const err = new Error('Repeating items need a date');
    err.status = 400;
    throw err;
  }
  const settings = await getSettings();
  const zone = effectiveZoneFor(reminder, settings);
  // Series created before anchorHour/anchorMinute existed still get the right
  // DST behavior: derive the intended clock time from the current occurrence.
  rule = recurrence.anchorRule(rule, reminder.due_at, zone);
  // Concurrency guard: if THIS scheduled occurrence was JUST recorded as
  // completed (within seconds), the series already moved on (double-tap /
  // racing retry). Re-running would record the NEXT occurrence and advance
  // the series a second time, silently skipping a day.
  //
  // But an OLDER stamp is history, not a duplicate: the user moved the date
  // back onto an already-completed occurrence. Refusing forever would brick
  // the series, so a stale stamp is treated as a fresh completion below.
  const prior = await db.get(
    `SELECT status, completed_at FROM reminder_occurrences
     WHERE reminder_id = ? AND occurrence_at = ? AND status = 'completed'`,
    [id, reminder.due_at]
  );
  if (prior) {
    const stampAge = Date.now() - new Date(prior.completed_at || 0).getTime();
    if (Number.isFinite(stampAge) && stampAge < DUPLICATE_COMPLETE_WINDOW_MS) {
      return { advanced: false, alreadyDone: true, reminder };
    }
  }
  const next = recurrence.firstFutureOccurrence(rule, reminder.due_at, zone, now);
  const exception = await db.get(
    `SELECT title, notes, list_id, urgent FROM reminder_occurrences
     WHERE reminder_id = ? AND occurrence_at = ? AND status = 'exception'`,
    [id, reminder.due_at]
  );
  await db.run(`
    INSERT INTO reminder_occurrences
      (reminder_id, occurrence_at, status, title, notes, list_id, urgent, completed_at, created_at)
    VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reminder_id, occurrence_at) DO UPDATE SET
      status = 'completed', title = excluded.title, notes = excluded.notes,
      list_id = excluded.list_id, urgent = excluded.urgent, completed_at = excluded.completed_at
  `, [
    id, reminder.due_at,
    exception ? exception.title : reminder.title,
    exception ? exception.notes : reminder.notes,
    exception && exception.list_id !== null && exception.list_id !== undefined ? exception.list_id : reminder.list_id,
    exception && exception.urgent !== null && exception.urgent !== undefined ? exception.urgent : reminder.urgent,
    now, now,
  ]);
  // The advance is conditional on due_at still being the snapshot value: if
  // another racer advanced between our load and this write, changes = 0 and
  // we report it instead of advancing the (already new) current occurrence.
  const updated = await db.run(
    `UPDATE reminders SET due_at = ?, notified_at = NULL, last_push_at = NULL,
       push_count = 0, snoozed_until = NULL, updated_at = ?, revision = revision + 1
     WHERE id = ? AND due_at = ?`,
    [next, now, id, reminder.due_at]
  );
  return { advanced: updated.changes > 0, nextDue: updated.changes ? next : null };
}

async function skipOccurrence(id) {
  const reminder = await loadReminder(id);
  if (!reminder) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }
  let rule = parseRuleColumn(reminder.repeat_rule);
  if (!recurrence.isRecurringRule(rule) || !reminder.due_at) {
    const err = new Error('Only dated repeating items can skip an occurrence');
    err.status = 400;
    throw err;
  }
  const settings = await getSettings();
  const zone = effectiveZoneFor(reminder, settings);
  rule = recurrence.anchorRule(rule, reminder.due_at, zone);
  const now = new Date().toISOString();
  // Same concurrency guard as completeReminder: a recorded skip is
  // idempotent; a racing duplicate must not skip the NEXT occurrence too.
  const prior = await db.get(
    `SELECT status FROM reminder_occurrences
     WHERE reminder_id = ? AND occurrence_at = ? AND status = 'skipped'`,
    [id, reminder.due_at]
  );
  if (prior) return { nextDue: reminder.due_at, alreadyDone: true };
  const next = recurrence.firstFutureOccurrence(rule, reminder.due_at, zone, now);
  await db.run(`
    INSERT INTO reminder_occurrences (reminder_id, occurrence_at, status, created_at)
    VALUES (?, ?, 'skipped', ?)
    ON CONFLICT(reminder_id, occurrence_at) DO UPDATE SET status = 'skipped', completed_at = NULL
  `, [id, reminder.due_at, now]);
  // Same conditional advance as completeReminder: only the writer that
  // flips due_at from the snapshot value owns this skip.
  const updated = await db.run(
    `UPDATE reminders SET due_at = ?, notified_at = NULL, last_push_at = NULL,
       push_count = 0, snoozed_until = NULL, updated_at = ?, revision = revision + 1
     WHERE id = ? AND due_at = ?`,
    [next, now, id, reminder.due_at]
  );
  return { nextDue: updated.changes ? next : reminder.due_at, skipped: updated.changes > 0 };
}

// Undo a skip: remove the skip record entirely (it disappears from history)
// and put the occurrence back in play. If the skipped occurrence is earlier
// than the series' current due date, the series moves back to it and re-arms
// notifications; a later skipped occurrence simply has its record removed and
// comes up naturally when the series reaches it.
async function unskipOccurrence(id, occurrenceAt) {
  const reminder = await loadReminder(id);
  if (!reminder) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }
  const rule = parseRuleColumn(reminder.repeat_rule);
  if (!recurrence.isRecurringRule(rule) || !reminder.due_at) {
    const err = new Error('Only dated repeating items can undo a skip');
    err.status = 400;
    throw err;
  }
  const occurrenceMs = Date.parse(occurrenceAt);
  if (typeof occurrenceAt !== 'string' || Number.isNaN(occurrenceMs)) {
    const err = new Error('A valid occurrence_at is required');
    err.status = 400;
    throw err;
  }
  const row = await db.get(
    'SELECT status, title, notes, list_id, urgent FROM reminder_occurrences WHERE reminder_id = ? AND occurrence_at = ?',
    [id, occurrenceAt]
  );
  if (!row || row.status !== 'skipped') {
    const err = new Error('That skipped occurrence was not found');
    err.status = 404;
    throw err;
  }
  const now = new Date().toISOString();
  // A skipped row can still carry a this-occurrence edit (skipping only
  // flipped its status). Keep that edit by reverting to 'exception';
  // otherwise remove the row so the skipped date leaves the history.
  const hasOverride = row.title !== null || row.notes !== null
    || (row.list_id !== null && row.list_id !== undefined)
    || (row.urgent !== null && row.urgent !== undefined);
  if (hasOverride) {
    await db.run(
      `UPDATE reminder_occurrences SET status = 'exception'
       WHERE reminder_id = ? AND occurrence_at = ?`,
      [id, occurrenceAt]
    );
  } else {
    await db.run(
      'DELETE FROM reminder_occurrences WHERE reminder_id = ? AND occurrence_at = ?',
      [id, occurrenceAt]
    );
  }
  let dueAt = reminder.due_at;
  if (occurrenceMs < Date.parse(reminder.due_at)) {
    dueAt = occurrenceAt;
    await db.run(
      `UPDATE reminders SET due_at = ?, notified_at = NULL, last_push_at = NULL,
         push_count = 0, snoozed_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?`,
      [dueAt, now, id]
    );
  } else {
    await db.run(
      'UPDATE reminders SET updated_at = ?, revision = revision + 1 WHERE id = ?',
      [now, id]
    );
  }
  return { dueAt };
}

// Undo a completion: the history row disappears and the series goes back to
// the undone date, as if that occurrence had never been completed. Two
// guards keep history honest:
//   1. Most-recent-first: a completion with a later completed occurrence
//      still on record cannot be undone (undo the newer one first), so the
//      series can never replay over an already-completed occurrence.
//   2. Settled history: once the NEXT occurrence after the undone one has
//      passed, the undo is refused — there is nothing useful to reopen.
async function uncompleteOccurrence(id, occurrenceAt) {
  const reminder = await loadReminder(id);
  if (!reminder) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }
  let rule = parseRuleColumn(reminder.repeat_rule);
  if (!recurrence.isRecurringRule(rule) || !reminder.due_at) {
    const err = new Error('Only dated repeating items can undo a completion');
    err.status = 400;
    throw err;
  }
  const occurrenceMs = Date.parse(occurrenceAt);
  if (typeof occurrenceAt !== 'string' || Number.isNaN(occurrenceMs)) {
    const err = new Error('A valid occurrence_at is required');
    err.status = 400;
    throw err;
  }
  const row = await db.get(
    'SELECT status, title, notes, list_id, urgent FROM reminder_occurrences WHERE reminder_id = ? AND occurrence_at = ?',
    [id, occurrenceAt]
  );
  if (!row || row.status !== 'completed') {
    const err = new Error('That completed occurrence was not found');
    err.status = 404;
    throw err;
  }
  const newer = await db.get(
    `SELECT occurrence_at FROM reminder_occurrences
     WHERE reminder_id = ? AND occurrence_at > ? AND status = 'completed' LIMIT 1`,
    [id, occurrenceAt]
  );
  if (newer) {
    const err = new Error('Undo the most recent completion first');
    err.status = 409;
    throw err;
  }
  const settings = await getSettings();
  const zone = effectiveZoneFor(reminder, settings);
  rule = recurrence.anchorRule(rule, occurrenceAt, zone);
  const now = new Date().toISOString();
  // The immediate successor decides: if it already passed, this slice of
  // history is settled. (firstFutureOccurrence would skip over the past and
  // wrongly reopen long-settled occurrences.)
  const next = recurrence.advanceOccurrence(rule, occurrenceAt, zone);
  if (new Date(next).getTime() <= Date.now()) {
    const err = new Error('That occurrence has already passed — history is settled');
    err.status = 409;
    throw err;
  }
  // A completed row always snapshots the series values, so "has an edit"
  // means the snapshot differs from the series as it stands now. Only then
  // is there a this-occurrence edit worth keeping (revert to 'exception');
  // otherwise the row is removed so the date leaves the history.
  const same = (a, b) => (a ?? null) === (b ?? null);
  const hasOverride = !same(row.title, reminder.title)
    || (row.notes || null) !== (reminder.notes || null)
    || !same(row.list_id, reminder.list_id)
    || !same(row.urgent, reminder.urgent);
  if (hasOverride) {
    await db.run(
      `UPDATE reminder_occurrences SET status = 'exception'
       WHERE reminder_id = ? AND occurrence_at = ?`,
      [id, occurrenceAt]
    );
  } else {
    await db.run(
      'DELETE FROM reminder_occurrences WHERE reminder_id = ? AND occurrence_at = ?',
      [id, occurrenceAt]
    );
  }
  let dueAt = reminder.due_at;
  if (occurrenceMs < Date.parse(reminder.due_at)) {
    dueAt = occurrenceAt;
    await db.run(
      `UPDATE reminders SET due_at = ?, notified_at = NULL, last_push_at = NULL,
         push_count = 0, snoozed_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?`,
      [dueAt, now, id]
    );
  } else {
    await db.run(
      'UPDATE reminders SET updated_at = ?, revision = revision + 1 WHERE id = ?',
      [now, id]
    );
  }
  return { dueAt };
}

async function snoozeReminder(id, untilISO) {
  const reminder = await loadReminder(id);
  if (!reminder) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }
  const until = new Date(untilISO);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
    const err = new Error('Snooze time must be in the future');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  // Snoozing must RE-ARM the reminder: with re-push off (the default), a
  // fired-and-snoozed item otherwise has notified_at set and would never be
  // picked up again once snoozed_until passes.
  await db.run(`UPDATE reminders SET snoozed_until = ?, notified_at = NULL,
      last_push_at = NULL, push_count = 0, updated_at = ?, revision = revision + 1 WHERE id = ?`,
    [until.toISOString(), now, id]);
  return { snoozedUntil: until.toISOString() };
}

async function clearSnooze(id) {
  const reminder = await loadReminder(id);
  if (!reminder) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }
  await db.run('UPDATE reminders SET snoozed_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?',
    [new Date().toISOString(), id]);
  return { ok: true };
}

// One-tap reschedule for overdue items. Non-recurring items move their due
// date (keeping the clock time when one is set). Recurring series move the
// current occurrence AND re-anchor monthly/yearly rules to the new date, since
// an explicit move means "this is the new rhythm".
async function rescheduleReminder(id, target) {
  const reminder = await loadReminder(id);
  if (!reminder) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }
  const settings = await getSettings();
  const zone = settings.device_zone && recurrence.isValidTimeZone(settings.device_zone)
    ? settings.device_zone
    : null;
  let dateStr = target;
  if (target === 'today' || target === 'tomorrow') {
    const base = zone
      ? recurrence.instantToWall(Date.now(), zone)
      : (() => { const d = new Date(); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() }; })();
    let dd = base.d + (target === 'tomorrow' ? 1 : 0);
    const dim = new Date(Date.UTC(base.y, base.mo, 0)).getUTCDate();
    let mm = base.mo;
    let yy = base.y;
    if (dd > dim) { dd = 1; mm += 1; if (mm > 12) { mm = 1; yy += 1; } }
    dateStr = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
    const err = new Error('Reschedule target must be today, tomorrow, or YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  const rule = parseRuleColumn(reminder.repeat_rule);
  const effZone = effectiveZoneFor(reminder, settings);
  let dueAt;
  let hasTime = reminder.has_time ? 1 : 0;
  if (reminder.has_time && reminder.due_at) {
    // Keep the original clock time in the series' own zone.
    const w = effZone
      ? recurrence.instantToWall(new Date(reminder.due_at).getTime(), effZone)
      : (() => { const d = new Date(reminder.due_at); return { h: d.getUTCHours(), mi: d.getUTCMinutes() }; })();
    dueAt = effZone
      ? recurrence.wallToInstant(effZone, { y: yy, mo: mm, d: dd, h: w.h, mi: w.mi })
      : new Date(Date.UTC(yy, mm - 1, dd, w.h, w.mi)).toISOString();
  } else {
    const [hh, mi] = (settings.default_time || '09:00').split(':').map(Number);
    dueAt = effZone
      ? recurrence.wallToInstant(effZone, { y: yy, mo: mm, d: dd, h: hh, mi })
      : new Date(Date.UTC(yy, mm - 1, dd, hh, mi)).toISOString();
  }
  const now = new Date().toISOString();
  const fields = ['due_at = ?', 'has_time = ?', 'notified_at = NULL',
    'last_push_at = NULL', 'push_count = 0', 'snoozed_until = NULL', 'updated_at = ?', 'revision = revision + 1'];
  const params = [dueAt, hasTime, now, id];
  if (recurrence.isRecurringRule(rule) && (rule.type === 'monthly' || rule.type === 'yearly' || (rule.type === 'custom' && rule.unit === 'months'))) {
    const anchored = recurrence.anchorRule({ ...rule, anchorDay: undefined, anchorMonth: undefined }, dueAt, effZone);
    fields.push('repeat_rule = ?');
    params.splice(params.length - 1, 0, recurrence.encodeRepeatRule(anchored));
  }
  await db.run(`UPDATE reminders SET ${fields.join(', ')} WHERE id = ?`, params);
  return { dueAt };
}

async function resolveList(ref) {
  if (ref === undefined || ref === null || ref === '') return null;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) {
    const row = await db.get("SELECT id, name FROM lists WHERE id = ? AND tenant = 'reminders'", [Number(ref)]);
    return row || null;
  }
  const name = String(ref).trim();
  if (!name) return null;
  const rows = await db.all("SELECT id, name FROM lists WHERE LOWER(name) = LOWER(?) AND tenant = 'reminders'", [name]);
  if (rows.length > 1) {
    const err = new Error(`Multiple lists match "${name}" — use the list id instead`);
    err.status = 400;
    throw err;
  }
  return rows[0] || null;
}

async function main() {
  await db.init();
  await push.init();

  let secret = await db.getSetting(SESSION_SECRET_KEY);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await db.setSetting(SESSION_SECRET_KEY, secret);
  }
  await getStoreEpoch();

  app.use(session({
    name: 'todo.sid',
    secret,
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use((req, res, next) => {
    if (req.session) req.session.cookie.secure = req.secure;
    if (req.session && !req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    next();
  });

  app.use(express.static(PUBLIC_DIR, {
    maxAge: '1d',
    setHeaders(res, filePath) {
      if (/(?:sw\.js|index\.html|manifest\.webmanifest|fuzzy-search\.js|app\.js|styles\.css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // Bearer pre-check: runs before EVERY /api route, including the early
  // auth/push routes below that predate tokenAuth. No Authorization header
  // -> untouched (public routes stay public, HMAC push actions stay
  // bearer-free). A malformed, unknown, or revoked bearer -> 401 everywhere.
  // A valid bearer may use the harmless early GETs; the early POSTs stay
  // session/HMAC-only and reject token callers with the scope error.
  // Anything else passes through to the normal token/session chain below.
  const EARLY_ROUTES = new Set(['GET /health', 'GET /session', 'POST /setup', 'POST /login', 'POST /push/action']);
  app.use('/api', async (req, res, next) => {
    const header = req.get('authorization') || '';
    if (!header) return next();
    const raw = bearerToken(req);
    if (!raw) return res.status(401).json({ error: 'Invalid or revoked token' });
    try {
      const row = await lookupToken(raw);
      if (!row) return res.status(401).json({ error: 'Invalid or revoked token' });
      req.token = row;
      req.tokenHash = hashToken(raw);
      touchToken(row.id);
      const key = `${req.method} ${req.path}`;
      if (!EARLY_ROUTES.has(key)) return next();
      if (req.method === 'GET') return next();
      return denyToken(res);
    } catch (err) {
      return next(err);
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  app.get('/api/session', async (req, res) => {
    const user = await db.get('SELECT id, username FROM users LIMIT 1');
    const authenticated = Boolean(req.session.userId);
    res.json({
      needsSetup: !user,
      authenticated,
      username: authenticated && user ? (user.username || null) : null,
      needsUsername: authenticated && user ? !user.username : false,
      // Public login hint only; the username itself is never exposed before sign-in.
      usernameRequired: Boolean(user && user.username),
      csrfToken: authenticated ? req.session.csrfToken : null,
      vapidPublicKey: authenticated ? push.getPublicKey() : null,
      version: VERSION,
    });
  });

  app.post('/api/setup', authLimiter, async (req, res) => {
    const existing = await db.get('SELECT id FROM users LIMIT 1');
    if (existing) return res.status(409).json({ error: 'This app is already set up' });

    const nameCheck = auth.validateUsername(req.body.username);
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (password !== confirm) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const hash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    await db.run('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)', [nameCheck.username, hash, now]);
    const remindersList = await db.get('SELECT id FROM lists WHERE LOWER(name) = ? LIMIT 1', ['reminders']);
    if (!remindersList) {
      const max = await db.get('SELECT COALESCE(MAX(sort_order), -1) AS s FROM lists');
      await db.run(
        'INSERT INTO lists (name, color, sort_order, created_at) VALUES (?, ?, ?, ?)',
        ['Reminders', DEFAULT_LIST_COLOR, max.s + 1, now]
      );
    }

    await regenerate(req);
    req.session.userId = 1;
    await saveSession(req);
    res.json({ ok: true });
  });

  app.post('/api/login', authLimiter, async (req, res) => {
    const password = String(req.body.password || '');
    const user = await db.get('SELECT id, username, password_hash FROM users LIMIT 1');
    if (!user) return res.status(401).json({ error: 'Incorrect password' });

    // Once a username exists both fields are required. Always run bcrypt so a
    // wrong username and a wrong password take the same work and return the
    // same message (no account enumeration).
    const passwordOk = await bcrypt.compare(password, user.password_hash);
    const usernameOk = user.username ? auth.usernameMatches(req.body.username, user.username) : true;
    if (!usernameOk || !passwordOk) {
      return res.status(401).json({
        error: user.username ? 'Incorrect username or password' : 'Incorrect password',
      });
    }

    await regenerate(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.json({ ok: true });
  });

  // Signed push actions (Complete / Snooze 1h) from notification buttons.
  // The service worker has no session or CSRF token, so each action carries
  // an HMAC bound to (reminder, scheduled occurrence, action). Stale
  // notifications whose series already advanced are rejected.
  app.post('/api/push/action', async (req, res) => {
    const id = parseId(req.body.reminder_id);
    const action = String(req.body.action || '');
    const occurrence = typeof req.body.occurrence_at === 'string' ? req.body.occurrence_at : '';
    if (!id || (action !== 'complete' && action !== 'snooze')) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const reminder = await loadReminder(id);
    if (!reminder) return res.status(404).json({ error: 'Item not found' });
    if (!occurrence || reminder.due_at !== occurrence) {
      return res.status(409).json({ error: 'That notification is for an old occurrence' });
    }
    if (!(await verifyPushAction(id, occurrence, action, req.body.sig))) {
      return res.status(403).json({ error: 'Bad action signature' });
    }
    try {
      if (action === 'complete') {
        const result = await completeReminder(id);
        return res.json({ ok: true, advanced: result.advanced || false, nextDue: result.nextDue || null });
      }
      const result = await snoozeReminder(id, new Date(Date.now() + 3600 * 1000).toISOString());
      return res.json({ ok: true, snoozedUntil: result.snoozedUntil });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
  });


  const tokenLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: Number(process.env.TOKEN_RATE_LIMIT) || 300,
    keyGenerator: (req) => req.tokenHash || ipKeyGenerator(req.ip),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: 'Token rate limit reached. Slow down and try again later.' });
    },
  });

  app.use('/api', tokenAuth, (req, res, next) => {
    if (req.token) return tokenLimiter(req, res, next);
    next();
  });

  app.use('/api', (req, res, next) => {
    if (req.token || req.session.userId) return next();
    return res.status(401).json({ error: 'Not signed in' });
  });

  // Token scope enforcement by profile (default-deny). `read` is the
  // default for new tokens; `write` is opt-in; `legacy` keeps exactly the
  // capabilities tokens had before profiles existed. Deletes, list
  // management, settings, token management, import/export, password, push
  // management, and logout stay session-only for every profile, no
  // exceptions. (req.path is mount-relative here.)
  const REMINDER_ID = /^\/reminders\/\d+$/;
  const OCCURRENCES = /^\/reminders\/\d+\/occurrences$/;
  const REMINDER_ACTION = /^\/reminders\/\d+\/(snooze|skip|reschedule)$/;
  const REMINDER_FILES = /^\/reminders\/\d+\/attachments$/;
  const NOTE_ID = /^\/notes\/\d+$/;
  const NOTE_FILES = /^\/notes\/\d+\/attachments$/;
  const DOC_ID = /^\/docs\/\d+$/;

  function tokenRouteAllowed(req, token) {
    const method = req.method;
    const route = req.path;
    if (method === 'GET') {
      if (route === '/capabilities') return true;
      if (['/lists', '/reminders', '/state', '/parse'].includes(route)) return true;
      if (REMINDER_ID.test(route) || OCCURRENCES.test(route) || REMINDER_FILES.test(route)) return true;
      if (route === '/notes' || NOTE_ID.test(route) || NOTE_FILES.test(route)) return tokenHas(token, 'notes:read');
      if (route === '/docs' || DOC_ID.test(route)) return tokenHas(token, 'docs:read');
      if (/^\/files\/\d+(\/preview)?$/.test(route)) return true;
      if (route === '/storage') return tokenHas(token, 'storage:read');
      if (route === '/search') return tokenHas(token, 'search:read');
      return false;
    }
    if (method === 'POST') {
      if (route === '/parse') return true;
      if (route === '/reminders') return tokenReminderWrite(token);
      if (REMINDER_ACTION.test(route)) return tokenReminderWrite(token);
      if (REMINDER_FILES.test(route)) return tokenReminderWrite(token);
      if (route === '/notes') return tokenHas(token, 'notes:write');
      if (NOTE_FILES.test(route)) return tokenHas(token, 'notes:write');
      if (route === '/docs') return tokenHas(token, 'docs:write');
      return false;
    }
    if (method === 'PATCH') {
      if (REMINDER_ID.test(route)) return tokenReminderWrite(token);
      if (NOTE_ID.test(route)) return tokenHas(token, 'notes:write');
      if (DOC_ID.test(route)) return tokenHas(token, 'docs:write');
      return false;
    }
    if (method === 'DELETE') {
      if (NOTE_ID.test(route)) return tokenHas(token, 'notes:delete');
      if (DOC_ID.test(route)) return tokenHas(token, 'docs:delete');
      if (/^\/attachments\/\d+$/.test(route)) {
        return tokenHas(token, 'notes:delete') || tokenHas(token, 'docs:delete');
      }
      return false;
    }
    return false;
  }

  app.use('/api', (req, res, next) => {
    if (!req.token) return next();
    if (tokenRouteAllowed(req, req.token)) return next();
    return denyToken(res);
  });

  app.get('/api/capabilities', async (req, res) => {
    const token = req.token;
    const owner = !token;
    const caps = owner ? {
      reminders: { read: true, write: true, delete: true },
      notes: { read: true, write: true, delete: true },
      docs: { read: true, write: true, delete: true },
      storage: { read: true, scoped: false },
      search: { read: true, scoped: false },
    } : {
      reminders: { read: true, write: tokenReminderWrite(token), delete: false },
      notes: {
        read: tokenHas(token, 'notes:read'),
        write: tokenHas(token, 'notes:write'),
        delete: tokenHas(token, 'notes:delete'),
      },
      docs: {
        read: tokenHas(token, 'docs:read'),
        write: tokenHas(token, 'docs:write'),
        delete: tokenHas(token, 'docs:delete'),
      },
      storage: { read: tokenHas(token, 'storage:read'), scoped: true },
      search: { read: tokenHas(token, 'search:read'), scoped: true },
    };
    res.json({
      api_version: VERSION,
      authenticated_as: owner ? 'owner-session' : 'bearer-token',
      capabilities: caps,
      limits: { upload_bytes: UPLOAD_MAX_BYTES, files_per_request: 10 },
      docs_formats: DOC_FORMATS_PUBLIC.map((format) => format.ext),
      docs_format_details: DOC_FORMATS_PUBLIC,
      search_fields: {
        reminders: 'title + notes',
        notes: 'title + body',
        docs: 'filename only',
      },
      json_backup: { includes_uploaded_files: false },
    });
  });

  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    // Personal access tokens authenticate with the secret itself, so they are
    // exempt from CSRF the same way a session without one would be impossible.
    if (req.token) return next();
    const token = req.get('x-csrf-token');
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).json({ error: 'Invalid CSRF token. Please refresh and try again.' });
    }
    next();
  });

  // Token responses must never be cached anywhere: every token-authenticated
  // response and every token-management response carries no-store.
  app.use('/api', (req, res, next) => {
    if (req.token || req.path.startsWith('/tokens')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  app.post('/api/password', authLimiter, async (req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');
    if (next.length < 8 || next.length > 200) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (next !== confirm) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }
    const user = await db.get('SELECT id, password_hash FROM users LIMIT 1');
    if (!user || !(await bcrypt.compare(current, user.password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(next, 12);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    // A password change signs out every other browser. The current session
    // stays valid because its own row is the only one left.
    await db.run('DELETE FROM sessions WHERE sid <> ?', [req.sessionID]);
    res.json({ ok: true });
  });

  app.post('/api/account/username', async (req, res) => {
    if (req.token) return denyToken(res);
    const nameCheck = auth.validateUsername(req.body.username);
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });
    const current = String(req.body.currentPassword || req.body.current_password || '');
    const user = await db.get('SELECT id, password_hash FROM users LIMIT 1');
    if (!user || !current || !(await bcrypt.compare(current, user.password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await db.run('UPDATE users SET username = ? WHERE id = ?', [nameCheck.username, user.id]);
    res.json({ ok: true, username: nameCheck.username });
  });

  app.get('/api/settings', async (req, res) => {
    if (req.token) return denyToken(res);
    res.json(await getSettings());
  });

  // Future floating reminders move with the device zone. Past-due items stay
  // overdue, and fixed/anchored items are never touched.
  async function futureFloating() {
    const rows = await db.all(
      "SELECT id, due_at, time_zone, revision FROM reminders WHERE time_model = 'floating' AND completed = 0 AND due_at IS NOT NULL"
    );
    const nowMs = Date.now();
    return rows.filter((reminder) => new Date(reminder.due_at).getTime() > nowMs);
  }

  // Lets the PWA ask "what would this zone change do?" before committing it,
  // so a second device in another zone cannot silently move floating items.
  app.post('/api/settings/zone-preview', async (req, res) => {
    if (req.token) return denyToken(res);
    const zone = typeof req.body.zone === 'string' ? req.body.zone : '';
    if (!recurrence.isValidTimeZone(zone)) {
      return res.status(400).json({ error: 'Unknown timezone' });
    }
    const settings = await getSettings();
    const floating = await futureFloating();
    res.json({ from: settings.device_zone || '', to: zone, count: floating.length });
  });

  // Undo a just-confirmed zone move. Rows are restored only if nobody edited
  // them since (revision match), and only while they are still floating.
  app.post('/api/settings/zone-undo', async (req, res) => {
    if (req.token) return denyToken(res);
    const zone = typeof req.body.device_zone === 'string' ? req.body.device_zone : '';
    if (zone !== '' && !recurrence.isValidTimeZone(zone)) {
      return res.status(400).json({ error: 'Unknown timezone' });
    }
    const restore = Array.isArray(req.body.restore) ? req.body.restore : [];
    if (restore.length > 500) return res.status(400).json({ error: 'Too many items to restore' });
    let restored = 0;
    for (const item of restore) {
      if (!item || typeof item !== 'object') continue;
      const id = parseId(item.id);
      const revision = Number(item.revision);
      const dueAt = typeof item.due_at === 'string' && !Number.isNaN(new Date(item.due_at).getTime())
        ? new Date(item.due_at).toISOString()
        : null;
      if (!id || !Number.isInteger(revision) || dueAt === null) continue;
      const timeZone = typeof item.time_zone === 'string' && recurrence.isValidTimeZone(item.time_zone)
        ? item.time_zone
        : null;
      const result = await db.run(
        `UPDATE reminders SET due_at = ?, time_zone = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND revision = ? AND time_model = 'floating'`,
        [dueAt, timeZone, new Date().toISOString(), id, revision]
      );
      if (result.changes) restored += 1;
    }
    await db.setSetting('device_zone', zone);
    await db.setSetting('device_zone_updated_at', new Date().toISOString());
    res.json({ ok: true, settings: await getSettings(), restored });
  });

  app.post('/api/settings', async (req, res) => {
    if (req.token) return denyToken(res);
    const incoming = req.body.settings;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Send { settings: { key: value } }' });
    }
    const before = await getSettings();
    const updates = {};
    for (const [key, value] of Object.entries(incoming)) {
      const problem = validateSetting(key, value);
      if (problem) return res.status(400).json({ error: `${key}: ${problem}` });
      updates[key] = String(value);
    }
    for (const [key, value] of Object.entries(updates)) {
      await db.setSetting(key, value);
    }
    // When the device reports a new zone, floating reminders ("6pm wherever I
    // am") move with it: keep their wall-clock time, resolve it in the new
    // zone, and remember the zone the instant was computed in. Only future
    // occurrences move; past-due items stay overdue. (The PWA cannot detect
    // travel while closed, so this runs on app open/resume instead.)
    let moved = 0;
    const movedItems = [];
    if (updates.device_zone && updates.device_zone !== before.device_zone) {
      const fromZone = before.device_zone && recurrence.isValidTimeZone(before.device_zone)
        ? before.device_zone
        : null;
      const toZone = updates.device_zone;
      const floating = await futureFloating();
      for (const reminder of floating) {
        const oldZone = recurrence.isValidTimeZone(reminder.time_zone) ? reminder.time_zone : fromZone;
        if (!oldZone) continue;
        try {
          const movedDue = recurrence.recomputeInZone(reminder.due_at, oldZone, toZone);
          const result = await db.run(
            'UPDATE reminders SET due_at = ?, time_zone = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
            [movedDue, toZone, new Date().toISOString(), reminder.id]
          );
          if (!result.changes) continue;
          movedItems.push({
            id: reminder.id,
            due_at: reminder.due_at,
            time_zone: reminder.time_zone,
            // The UPDATE above increments revision; undo matches that value so
            // a later edit is never overwritten.
            revision: reminder.revision + 1,
          });
          moved += 1;
        } catch {
          // Leave the reminder on its stored instant if the zone math fails.
        }
      }
      await db.setSetting('device_zone_updated_at', new Date().toISOString());
    }
    res.json({ ok: true, settings: await getSettings(), floatingMoved: moved, moved: movedItems });
  });

  const SORT_FIELDS = ['due', 'created', 'completed', 'name'];
  const SORT_DIRS = ['asc', 'desc'];
  const SORT_VIEW_KEY = /^(today|scheduled|all|flagged|completed|notes|docs|list:\d{1,10}|notes:\d{1,10}|docs:\d{1,10})$/;
  const SORT_MAX_OVERRIDES = 200;

  function parseSortSetting(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const out = { default: null, overrides: {} };
      if (parsed.default && typeof parsed.default === 'object'
        && SORT_FIELDS.includes(parsed.default.field) && SORT_DIRS.includes(parsed.default.dir)) {
        out.default = { field: parsed.default.field, dir: parsed.default.dir };
      }
      if (parsed.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)) {
        for (const [key, choice] of Object.entries(parsed.overrides)) {
          if (!SORT_VIEW_KEY.test(key)) continue;
          if (!choice || typeof choice !== 'object') continue;
          if (!SORT_FIELDS.includes(choice.field) || !SORT_DIRS.includes(choice.dir)) continue;
          out.overrides[key] = { field: choice.field, dir: choice.dir };
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  // Sorting syncs across devices through the settings table. Every write is
  // a single intent (one view, one apply-all, or a first-device seed) merged
  // into the stored map inside one transaction, so a tab holding stale state
  // can only change the view its user just touched - it can never wipe newer
  // choices made on another device.
  app.post('/api/settings/sort', async (req, res) => {
    if (req.token) return denyToken(res);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Send a JSON object' });
    }
    const isApplyAll = body.apply_all === true;
    const isSeed = body.seed && typeof body.seed === 'object' && !Array.isArray(body.seed);
    if (!isApplyAll && !isSeed && !SORT_VIEW_KEY.test(String(body.view || ''))) {
      return res.status(400).json({ error: 'view: Unknown view' });
    }
    if (isApplyAll
      && (!SORT_FIELDS.includes(body.field) || !SORT_DIRS.includes(body.dir))) {
      return res.status(400).json({ error: 'field/dir: Unknown sorting' });
    }
    // A single-view write carries only the dimension(s) the user changed;
    // the server merges them into the stored choice, so a stale tab changing
    // the direction cannot reset a newer field choice from another device.
    if (!isApplyAll && !isSeed) {
      const hasField = body.field !== undefined;
      const hasDir = body.dir !== undefined;
      if ((!hasField && !hasDir)
        || (hasField && !SORT_FIELDS.includes(body.field))
        || (hasDir && !SORT_DIRS.includes(body.dir))) {
        return res.status(400).json({ error: 'field/dir: Unknown sorting' });
      }
    }
    try {
      const result = await db.transaction(async () => {
        const raw = await db.getSetting('sort');
        const current = parseSortSetting(raw) || { default: null, overrides: {} };
        if (isSeed) {
          // First device to run the new version offers its local choices as
          // the seed. Only an empty server value takes it, so two devices
          // racing to seed cannot clobber each other - the first one wins.
          if (raw) return { sort: current };
          const seed = parseSortSetting(JSON.stringify(body.seed));
          if (!seed || (!seed.default && !Object.keys(seed.overrides).length)) {
            const err = new Error('seed: No valid sorting choices');
            err.status = 400;
            throw err;
          }
          await db.setSetting('sort', JSON.stringify(seed));
          return { sort: seed };
        }
        if (isApplyAll) {
          current.default = { field: body.field, dir: body.dir };
          current.overrides = {};
        } else {
          if (!current.overrides[body.view]
            && Object.keys(current.overrides).length >= SORT_MAX_OVERRIDES) {
            const err = new Error('Too many saved sortings');
            err.status = 400;
            throw err;
          }
          const existing = current.overrides[body.view] || current.default || { field: 'due', dir: 'asc' };
          current.overrides[body.view] = {
            field: body.field !== undefined ? body.field : existing.field,
            dir: body.dir !== undefined ? body.dir : existing.dir,
          };
        }
        await db.setSetting('sort', JSON.stringify(current));
        return { sort: current };
      });
      res.json({ ok: true, sort: result.sort });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Could not save sorting' });
    }
  });

  app.get('/api/tokens', async (req, res) => {
    if (req.token) return denyToken(res);
    const rows = await db.all(
      'SELECT id, name, profile, permissions, created_at, last_used_at, revoked_at FROM personal_access_tokens ORDER BY id'
    );
    res.json({ tokens: rows.map((row) => ({ ...row, permissions: tokenPermissions(row) })) });
  });

  app.post('/api/tokens', async (req, res) => {
    if (req.token) return denyToken(res);
    const name = text(req.body.name, 80) || 'agent';
    // Only read (default) or write may be selected. `legacy` is a
    // migration-only landing state and is never a creation target.
    const profile = req.body.profile === undefined ? 'read' : String(req.body.profile);
    if (profile !== 'read' && profile !== 'write') {
      return res.status(400).json({ error: 'profile must be read or write' });
    }
    const permissions = validTokenPermissionsInput(req.body.permissions);
    if (permissions === null) return res.status(400).json({ error: 'Unknown permission scope' });
    // 48 random bytes, base64url: unguessable, URL-safe. Only the SHA-256
    // hash is stored — the raw value below is shown exactly once.
    const raw = crypto.randomBytes(48).toString('base64url');
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO personal_access_tokens (name, token_hash, profile, permissions, created_at) VALUES (?, ?, ?, ?, ?)',
      [name, hashToken(raw), profile, JSON.stringify(permissions), now]
    );
    res.status(201).json({ id: result.lastID, name, profile, permissions, token: raw, created_at: now });
  });

  app.post('/api/tokens/:id/permissions', async (req, res) => {
    if (req.token) return denyToken(res);
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid token' });
    const permissions = validTokenPermissionsInput(req.body.permissions);
    if (permissions === null) return res.status(400).json({ error: 'Unknown permission scope' });
    const row = await db.get('SELECT id, revoked_at FROM personal_access_tokens WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Token not found' });
    if (row.revoked_at) return res.status(400).json({ error: 'Token is revoked' });
    await db.run('UPDATE personal_access_tokens SET permissions = ? WHERE id = ?', [JSON.stringify(permissions), id]);
    res.json({ ok: true, permissions });
  });

  // Owner-only profile changes: the ONLY way a token's capability changes.
  // Allowed: legacy -> read/write, read <-> write. `legacy` is never a
  // target and no token can ever land in it except by the one-time
  // migration backfill.
  app.post('/api/tokens/:id/profile', async (req, res) => {
    if (req.token) return denyToken(res);
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid token' });
    const profile = String(req.body.profile || '');
    if (profile !== 'read' && profile !== 'write') {
      return res.status(400).json({ error: 'profile must be read or write' });
    }
    const row = await db.get('SELECT id, profile, revoked_at FROM personal_access_tokens WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Token not found' });
    if (row.revoked_at) return res.status(400).json({ error: 'Token is revoked' });
    if (row.profile === profile) return res.json({ ok: true, profile });
    await db.run('UPDATE personal_access_tokens SET profile = ? WHERE id = ?', [profile, id]);
    res.json({ ok: true, profile });
  });

  app.post('/api/tokens/:id/revoke', async (req, res) => {
    if (req.token) return denyToken(res);
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid token' });
    const result = await db.run(
      'UPDATE personal_access_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      [new Date().toISOString(), id]
    );
    if (!result.changes) return res.status(404).json({ error: 'Token not found' });
    res.json({ ok: true });
  });

  // JSON backup in Settings. Secrets (password hash, VAPID keys, session
  // secret, API tokens) are never exported.
  app.get('/api/export', async (req, res) => {
    if (req.token) return denyToken(res);
    const settings = await getSettings();
    const lists = await db.all('SELECT id, name, color, sort_order, completed_retention, tenant, created_at FROM lists ORDER BY tenant, sort_order, id');
    const reminders = await db.all(`SELECT id, list_id, title, notes, due_at, has_time, completed,
      completed_at, urgent, repeat_rule, time_model, time_zone, snoozed_until,
      sort_order, created_at, updated_at, revision FROM reminders ORDER BY id`);
    const occurrences = await db.all(
      `SELECT reminder_id, occurrence_at, status, title, notes, list_id, urgent,
         completed_at, created_at FROM reminder_occurrences ORDER BY id`
    );
    const notes = await db.all('SELECT id, folder_id, title, body, body_format, created_at, updated_at FROM notes ORDER BY id');
    res.json({
      app: 'todo',
      format: 1,
      exported_at: new Date().toISOString(),
      settings: {
        default_time: settings.default_time,
        default_time_model: settings.default_time_model,
        repush_enabled: settings.repush_enabled,
        repush_cadence_min: settings.repush_cadence_min,
        repush_max: settings.repush_max,
        quiet_start: settings.quiet_start,
        quiet_end: settings.quiet_end,
      },
      lists,
      reminders,
      occurrences,
      notes,
    });
  });

  // Import matches the export format. Merge-only and id-safe: rows whose id
  // already exists are skipped, never overwritten, and every reminder needs
  // an existing list (newly imported ones count). Nothing is ever deleted.
  app.post('/api/import', async (req, res) => {
    if (req.token) return denyToken(res);
    const data = req.body.data;
    if (!data || typeof data !== 'object' || !['todo', 'remember', 'done'].includes(data.app)) {
      return res.status(400).json({ error: 'That is not a Workspace backup file' });
    }
    const counts = { listsAdded: 0, listsSkipped: 0, remindersAdded: 0, remindersSkipped: 0, occurrencesAdded: 0, occurrencesSkipped: 0, notesAdded: 0, notesSkipped: 0 };
    const knownLists = new Set((await db.all('SELECT id FROM lists')).map((r) => r.id));
    for (const list of Array.isArray(data.lists) ? data.lists : []) {
      if (!list || !Number.isInteger(list.id) || !String(list.name || '').trim()) {
        counts.listsSkipped += 1;
        continue;
      }
      if (knownLists.has(list.id)) { counts.listsSkipped += 1; continue; }
      try {
        const tenant = validTenant(list.tenant, 'reminders');
        await db.run(
          'INSERT INTO lists (id, name, color, sort_order, completed_retention, tenant, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [list.id, String(list.name).slice(0, 120), validColor(list.color),
            Number.isInteger(list.sort_order) ? list.sort_order : 0,
            tenant === 'reminders'
              ? (validCompletedRetention(list.completed_retention) || 'forever')
              : 'forever',
            tenant,
            typeof list.created_at === 'string' ? list.created_at : new Date().toISOString()]
        );
        knownLists.add(list.id);
        counts.listsAdded += 1;
      } catch { counts.listsSkipped += 1; }
    }
    const knownReminders = new Set((await db.all('SELECT id FROM reminders')).map((r) => r.id));
    for (const reminder of Array.isArray(data.reminders) ? data.reminders : []) {
      if (!reminder || !Number.isInteger(reminder.id) || !String(reminder.title || '').trim()
        || !knownLists.has(reminder.list_id)) {
        counts.remindersSkipped += 1;
        continue;
      }
      if (knownReminders.has(reminder.id)) { counts.remindersSkipped += 1; continue; }
      const reminderFolder = await db.get('SELECT tenant FROM lists WHERE id = ?', [reminder.list_id]);
      if (!reminderFolder || reminderFolder.tenant !== 'reminders') {
        counts.remindersSkipped += 1;
        continue;
      }
      let rule = 'none';
      try { rule = recurrence.encodeRepeatRule(recurrence.parseRepeatRule(reminder.repeat_rule ?? 'none')); }
      catch { counts.remindersSkipped += 1; continue; }
      const model = TIME_MODELS.includes(reminder.time_model) ? reminder.time_model : 'fixed';
      const zone = typeof reminder.time_zone === 'string' && recurrence.isValidTimeZone(reminder.time_zone)
        ? reminder.time_zone : null;
      try {
        await db.run(`
          INSERT INTO reminders
            (id, list_id, title, notes, due_at, has_time, completed, completed_at, urgent,
             repeat_rule, time_model, time_zone, snoozed_until, notified_at, last_push_at, push_count,
             sort_order, created_at, updated_at, revision)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `, [
          reminder.id, reminder.list_id, String(reminder.title).slice(0, 500),
          String(reminder.notes || '').slice(0, NOTES_MAX),
          isoOrNull(reminder.due_at),
          reminder.has_time ? 1 : 0, reminder.completed ? 1 : 0,
          isoOrNull(reminder.completed_at),
          reminder.urgent ? 1 : 0, rule, model, zone,
          isoOrNull(reminder.snoozed_until),
          isoOrNull(reminder.notified_at),
          null,
          Number.isInteger(reminder.sort_order) ? reminder.sort_order : 0,
          typeof reminder.created_at === 'string' ? reminder.created_at : new Date().toISOString(),
          typeof reminder.updated_at === 'string' ? reminder.updated_at : new Date().toISOString(),
          Number.isInteger(reminder.revision) && reminder.revision >= 0 ? reminder.revision : 0,
        ]);
        knownReminders.add(reminder.id);
        counts.remindersAdded += 1;
      } catch { counts.remindersSkipped += 1; }
    }
    for (const occurrence of Array.isArray(data.occurrences) ? data.occurrences : []) {
      if (!occurrence || !knownReminders.has(occurrence.reminder_id)
        || typeof occurrence.occurrence_at !== 'string'
        || !['completed', 'skipped', 'exception'].includes(occurrence.status)) {
        counts.occurrencesSkipped += 1;
        continue;
      }
      try {
        // Older backups have no list_id/urgent: absent stays NULL, which
        // means "inherit the series values" just like an occurrence edit
        // that never set that override.
        const occurrenceList = Number.isInteger(occurrence.list_id) && knownLists.has(occurrence.list_id)
          ? occurrence.list_id : null;
        const occurrenceUrgent = occurrence.urgent === null || occurrence.urgent === undefined
          ? null : (occurrence.urgent ? 1 : 0);
        const inserted = await db.run(`
          INSERT INTO reminder_occurrences
            (reminder_id, occurrence_at, status, title, notes, list_id, urgent, completed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(reminder_id, occurrence_at) DO NOTHING
        `, [
          occurrence.reminder_id, isoOrNull(occurrence.occurrence_at), occurrence.status,
          typeof occurrence.title === 'string' ? occurrence.title.slice(0, 500) : null,
          typeof occurrence.notes === 'string' ? occurrence.notes.slice(0, NOTES_MAX) : null,
          occurrenceList, occurrenceUrgent,
          isoOrNull(occurrence.completed_at),
          typeof occurrence.created_at === 'string' ? occurrence.created_at : new Date().toISOString(),
        ]);
        if (inserted.changes) counts.occurrencesAdded += 1;
        else counts.occurrencesSkipped += 1;
      } catch { counts.occurrencesSkipped += 1; }
    }
    const knownNotes = new Set((await db.all('SELECT id FROM notes')).map((r) => r.id));
    for (const note of Array.isArray(data.notes) ? data.notes : []) {
      if (!note || !Number.isInteger(note.id) || !String(note.title || '').trim()
        || !knownLists.has(note.folder_id)) {
        counts.notesSkipped += 1;
        continue;
      }
      const folder = await db.get('SELECT tenant FROM lists WHERE id = ?', [note.folder_id]);
      if (!folder || folder.tenant !== 'notes' || knownNotes.has(note.id)) {
        counts.notesSkipped += 1;
        continue;
      }
      try {
        await db.run(
          'INSERT INTO notes (id, folder_id, title, body, body_format, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [note.id, note.folder_id, String(note.title).slice(0, 500),
            String(note.body || '').slice(0, NOTE_BODY_MAX),
            note.body_format === 'html' ? 'html' : 'text',
            typeof note.created_at === 'string' ? note.created_at : new Date().toISOString(),
            typeof note.updated_at === 'string' ? note.updated_at : new Date().toISOString()]
        );
        knownNotes.add(note.id);
        counts.notesAdded += 1;
      } catch { counts.notesSkipped += 1; }
    }
    await db.setSetting('store_epoch', crypto.randomBytes(16).toString('hex'));
    res.json({ ok: true, ...counts });
  });

  // Per-occurrence history for one recurring reminder (newest first).
  app.get('/api/reminders/:id/occurrences', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    const rows = await db.all(
      `SELECT occurrence_at, status, title, notes, completed_at, created_at
       FROM reminder_occurrences WHERE reminder_id = ? ORDER BY occurrence_at DESC LIMIT 25`,
      [id]
    );
    res.json({ occurrences: rows });
  });

  // ---- Write-profile token handlers for occurrence actions ----
  function validateWriteSkip(body) {
    for (const key of Object.keys(body || {})) {
      if (!['occurrence_at', 'base_revision', 'base_epoch'].includes(key)) {
        throw tokenWriteError(400, `Unknown field: ${key}`);
      }
    }
    if (body.occurrence_at !== undefined && typeof body.occurrence_at !== 'string') {
      throw tokenWriteError(400, 'Invalid occurrence_at');
    }
    requireBase(body);
  }

  async function writeSkip(req, res, id) {
    const body = req.body || {};
    try {
      validateWriteSkip(body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const key = idempotencyKeyFrom(req);
    if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
    const route = `POST /api/reminders/${id}/skip`;
    return runTokenWrite(req, res, {
      route, key, fingerprint: payloadFingerprint(body),
      execute: async () => {
        const current = await loadReminder(id);
        if (!current) return { status: 404, body: { error: 'Item not found' } };
        const epochGuard = await guardEpoch(body.base_epoch);
        if (epochGuard) return epochGuard;
        const occGuard = await guardOccurrence(id, current, body.occurrence_at, 'skip');
        if (occGuard) return occGuard;
        const revGuard = await guardRevision(current, body.base_revision);
        if (revGuard) return revGuard;
        try {
          const result = await skipOccurrence(id);
          return { status: 200, body: { ok: true, nextDue: result.nextDue }, reminderId: id };
        } catch (err) {
          return { status: err.status || 500, body: { error: err.message || 'Server error' } };
        }
      },
    });
  }

  function validateWriteSnooze(body) {
    for (const key of Object.keys(body || {})) {
      if (!['hours', 'clear', 'base_revision', 'base_epoch'].includes(key)) {
        throw tokenWriteError(400, `Unknown field: ${key}`);
      }
    }
    if (body.hours !== undefined && typeof body.hours !== 'number') {
      throw tokenWriteError(400, 'Invalid hours');
    }
    if (body.clear !== undefined && typeof body.clear !== 'boolean') {
      throw tokenWriteError(400, 'Invalid clear');
    }
    requireBase(body);
  }

  async function writeSnooze(req, res, id) {
    const body = req.body || {};
    try {
      validateWriteSnooze(body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const key = idempotencyKeyFrom(req);
    if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
    const route = `POST /api/reminders/${id}/snooze`;
    return runTokenWrite(req, res, {
      route, key, fingerprint: payloadFingerprint(body),
      execute: async () => {
        const current = await loadReminder(id);
        if (!current) return { status: 404, body: { error: 'Item not found' } };
        const epochGuard = await guardEpoch(body.base_epoch);
        if (epochGuard) return epochGuard;
        const revGuard = await guardRevision(current, body.base_revision);
        if (revGuard) return revGuard;
        try {
          if (body.clear) {
            await clearSnooze(id);
            return { status: 200, body: { ok: true, snoozedUntil: null }, reminderId: id };
          }
          const hours = body.hours === undefined ? 1 : Number(body.hours);
          if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
            return { status: 400, body: { error: 'Snooze hours must be between 0 and 72' } };
          }
          const result = await snoozeReminder(id, new Date(Date.now() + hours * 3600 * 1000).toISOString());
          return { status: 200, body: { ok: true, snoozedUntil: result.snoozedUntil }, reminderId: id };
        } catch (err) {
          return { status: err.status || 500, body: { error: err.message || 'Server error' } };
        }
      },
    });
  }

  function validateWriteReschedule(body) {
    for (const key of Object.keys(body || {})) {
      if (!['date', 'base_revision', 'base_epoch'].includes(key)) {
        throw tokenWriteError(400, `Unknown field: ${key}`);
      }
    }
    if (body.date !== undefined && typeof body.date !== 'string') {
      throw tokenWriteError(400, 'Invalid date');
    }
    requireBase(body);
  }

  async function writeReschedule(req, res, id) {
    const body = req.body || {};
    try {
      validateWriteReschedule(body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const key = idempotencyKeyFrom(req);
    if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
    const route = `POST /api/reminders/${id}/reschedule`;
    return runTokenWrite(req, res, {
      route, key, fingerprint: payloadFingerprint(body),
      execute: async () => {
        const current = await loadReminder(id);
        if (!current) return { status: 404, body: { error: 'Item not found' } };
        const epochGuard = await guardEpoch(body.base_epoch);
        if (epochGuard) return epochGuard;
        const revGuard = await guardRevision(current, body.base_revision);
        if (revGuard) return revGuard;
        if (!current.due_at) {
          return { status: 400, body: { error: 'Only dated items can be rescheduled' } };
        }
        try {
          const result = await rescheduleReminder(id, body.date);
          return { status: 200, body: { ok: true, dueAt: result.dueAt }, reminderId: id };
        } catch (err) {
          return { status: err.status || 500, body: { error: err.message || 'Server error' } };
        }
      },
    });
  }

  app.post('/api/reminders/:id/skip', async (req, res) => {
    const id = parseId(req.params.id);
    if (req.token && (req.token.profile || 'legacy') === 'write') {
      return writeSkip(req, res, id);
    }
    if (req.token) return denyToken(res);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    try {
      const result = await skipOccurrence(id);
      res.json({ ok: true, nextDue: result.nextDue });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
  });

  app.post('/api/reminders/:id/unskip', async (req, res) => {
    const id = parseId(req.params.id);
    if (req.token) return denyToken(res);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    try {
      const result = await unskipOccurrence(id, req.body ? req.body.occurrence_at : undefined);
      res.json({ ok: true, dueAt: result.dueAt });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
  });

  app.post('/api/reminders/:id/uncomplete', async (req, res) => {
    const id = parseId(req.params.id);
    if (req.token) return denyToken(res);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    try {
      const result = await uncompleteOccurrence(id, req.body ? req.body.occurrence_at : undefined);
      res.json({ ok: true, dueAt: result.dueAt });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
  });

  app.post('/api/reminders/:id/snooze', async (req, res) => {
    const id = parseId(req.params.id);
    if (req.token && (req.token.profile || 'legacy') === 'write') {
      return writeSnooze(req, res, id);
    }
    if (req.token) return denyToken(res);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    try {
      if (req.body.clear) {
        await clearSnooze(id);
        return res.json({ ok: true, snoozedUntil: null });
      }
      const hours = req.body.hours === undefined ? 1 : Number(req.body.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
        return res.status(400).json({ error: 'Snooze hours must be between 0 and 72' });
      }
      const result = await snoozeReminder(id, new Date(Date.now() + hours * 3600 * 1000).toISOString());
      res.json({ ok: true, snoozedUntil: result.snoozedUntil });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
  });

  app.post('/api/reminders/:id/reschedule', async (req, res) => {
    const id = parseId(req.params.id);
    if (req.token && (req.token.profile || 'legacy') === 'write') {
      return writeReschedule(req, res, id);
    }
    if (req.token) return denyToken(res);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    const reminder = await loadReminder(id);
    if (!reminder) return res.status(404).json({ error: 'Item not found' });
    if (!reminder.due_at) return res.status(400).json({ error: 'Only dated items can be rescheduled' });
    try {
      const result = await rescheduleReminder(id, req.body.date);
      res.json({ ok: true, dueAt: result.dueAt });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
  });

  // Natural-language quick add: "call mom tomorrow 6pm" -> title + date +
  // time (+ repeat rule). The editor calls this as you type and pre-checks
  // the Date/Time/Repeat controls so you see exactly what will be saved.
  app.post('/api/parse', async (req, res) => {
    const input = text(req.body.text, 500);
    if (!input) return res.status(400).json({ error: 'Nothing to parse' });
    const settings = await getSettings();
    let zone = typeof req.body.timeZone === 'string' ? req.body.timeZone : '';
    if (!recurrence.isValidTimeZone(zone)) {
      zone = recurrence.isValidTimeZone(settings.device_zone) ? settings.device_zone : 'UTC';
    }
    const { rule, cleaned } = recurrence.detectRepeat(input);
    // chrono reads the process timezone, so pin it to the device zone for the
    // synchronous parse call only, then restore it. No await in between, so
    // concurrent requests cannot observe the switch.
    // chrono resolves the parsed components lazily: start.date() computes the
    // instant using the timezone that is active when it is called. Materialise
    // it inside the pinned block, otherwise restoring TZ first makes "at 5pm"
    // resolve in the server zone (UTC) and land hours late.
    const previousTZ = process.env.TZ;
    let results = [];
    let parsedStart = null;
    try {
      if (zone) process.env.TZ = zone;
      results = chrono.parse(cleaned, new Date(), { forwardDate: true });
      if (results.length) {
        parsedStart = {
          ms: results[0].start.date().getTime(),
          hasTime: results[0].start.isCertain('hour'),
        };
      }
    } finally {
      if (previousTZ === undefined) delete process.env.TZ;
      else process.env.TZ = previousTZ;
    }
    if (!results.length) {
      // chrono skips bare ordinals ("on the 31st") — pull those out only when
      // chrono found nothing else, so "on the 31st at 9am" follows chrono's
      // date ("at 9am") instead of hijacking it with a stripped title.
      const monthday = recurrence.detectMonthDay(cleaned);
      if (monthday) {
        return res.json({
          title: monthday.cleaned || input,
          date: recurrence.upcomingMonthDay(monthday.day, zone, Date.now()),
          time: null,
          hasTime: false,
          repeat: recurrence.isRecurringRule(rule) ? rule : 'none',
          summary: '',
        });
      }
      // No date found, but a repeat rule may still have been detected
      // ("water plants every 3 days"): return it so the editor pre-checks
      // Repeat; the date validation on save asks for the missing date.
      return res.json({
        title: cleaned || input,
        date: null,
        time: null,
        hasTime: false,
        repeat: recurrence.isRecurringRule(rule) ? rule : 'none',
        summary: '',
      });
    }
    const wall = recurrence.instantToWall(parsedStart.ms, zone);
    const date = `${wall.y}-${String(wall.mo).padStart(2, '0')}-${String(wall.d).padStart(2, '0')}`;
    const hasTime = parsedStart.hasTime;
    const time = hasTime
      ? `${String(wall.h).padStart(2, '0')}:${String(wall.mi).padStart(2, '0')}`
      : null;
    let title = cleaned.replace(results[0].text, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
      .trim() || input;
    res.json({
      title,
      date,
      time,
      hasTime,
      repeat: recurrence.isRecurringRule(rule) ? rule : 'none',
      summary: '',
    });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('todo.sid');
      res.json({ ok: true });
    });
  });

  const REMINDER_COLUMNS = `id, list_id, title, notes, due_at, has_time, completed,
    completed_at, urgent, repeat_rule, time_model, time_zone, snoozed_until,
    notified_at, last_push_at, push_count, sort_order, created_at, updated_at, revision`;

  // Merge pending occurrence-only edits: an 'exception' row for the current
  // scheduled occurrence overrides the series values for display.
  async function applyOccurrenceOverrides(reminders) {
    if (!reminders.length) return reminders;
    const ids = reminders.filter((r) => r.due_at && r.repeat_rule !== 'none').map((r) => r.id);
    if (!ids.length) return reminders;
    const placeholders = ids.map(() => '?').join(',');
    const exceptions = await db.all(
      `SELECT reminder_id, occurrence_at, title, notes, list_id, urgent
       FROM reminder_occurrences WHERE status = 'exception' AND reminder_id IN (${placeholders})`,
      ids
    );
    const byKey = new Map(exceptions.map((e) => [`${e.reminder_id}|${e.occurrence_at}`, e]));
    for (const reminder of reminders) {
      const exception = byKey.get(`${reminder.id}|${reminder.due_at}`);
      if (!exception) continue;
      if (exception.title !== null && exception.title !== undefined) reminder.title = exception.title;
      if (exception.notes !== null && exception.notes !== undefined) reminder.notes = exception.notes;
      if (exception.list_id) reminder.list_id = exception.list_id;
      if (exception.urgent !== null && exception.urgent !== undefined) reminder.urgent = exception.urgent;
      reminder.occurrence_edited = true;
    }
    return reminders;
  }

  app.get('/api/state', async (req, res) => {
    const settings = await getSettings();
    const thirtyDayCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const cutoffs = retentionCutoffs();
    const lists = await db.all(`
      SELECT l.id, l.name, l.color, l.sort_order, l.completed_retention, l.created_at, l.is_system, l.tenant,
        CASE l.tenant
          WHEN 'notes' THEN (SELECT COUNT(*) FROM notes n WHERE n.folder_id = l.id)
          WHEN 'docs' THEN (SELECT COUNT(*) FROM attachments a WHERE a.folder_id = l.id AND a.owner_type = 'doc')
          ELSE (SELECT COUNT(*) FROM reminders r WHERE r.list_id = l.id AND r.completed = 0)
        END AS count,
        (SELECT COUNT(*) FROM reminders r WHERE r.list_id = l.id AND r.completed = 1)
        AS done_count,
        (SELECT COUNT(*) FROM reminders r WHERE r.list_id = l.id AND r.completed = 1
           AND r.completed_at IS NOT NULL AND r.completed_at >= ?)
        AS done_count_30d
      FROM lists l ORDER BY l.tenant, l.sort_order, l.id
    `, [thirtyDayCutoff]);
    const notes = await db.all(`
      SELECT n.id, n.folder_id, n.title, n.body, n.body_format, n.revision, n.created_at, n.updated_at,
             l.name AS folder_name, l.color AS folder_color
      FROM notes n JOIN lists l ON l.id = n.folder_id
      ORDER BY n.updated_at DESC, n.id DESC
    `);
    const docs = await db.all(`
      SELECT a.id, a.folder_id, a.name, a.mime, a.size, a.revision, a.created_at,
             l.name AS folder_name, l.color AS folder_color
      FROM attachments a JOIN lists l ON l.id = a.folder_id
      WHERE a.owner_type = 'doc'
      ORDER BY a.created_at DESC, a.id DESC
    `);
    const attachments = await db.all(`
      SELECT id, tenant, owner_type, owner_id, folder_id, name, mime, size, revision, created_at
      FROM attachments WHERE owner_type IN ('reminder', 'note')
      ORDER BY id ASC
    `);
    const reminders = await db.all(`
      SELECT r.* FROM reminders r JOIN lists l ON l.id = r.list_id
      WHERE r.completed = 0 OR r.completed_at IS NULL OR r.completed_at >=
        CASE l.completed_retention
          WHEN '1m' THEN ? WHEN '3m' THEN ? WHEN '6m' THEN ? WHEN '12m' THEN ?
          ELSE '0000-01-01T00:00:00.000Z'
        END
      ORDER BY r.sort_order, r.id
    `, [cutoffs['1m'], cutoffs['3m'], cutoffs['6m'], cutoffs['12m']]);
    await applyOccurrenceOverrides(reminders);
    let visibleLists = lists;
    let visibleNotes = notes;
    let visibleDocs = docs;
    let visibleAttachments = attachments;
    if (req.token) {
      const tenants = new Set(tokenAuthorizedTenants(req.token));
      visibleLists = lists.filter((list) => tenants.has(list.tenant));
      visibleNotes = tenants.has('notes') ? notes : [];
      visibleDocs = tenants.has('docs') ? docs : [];
      visibleAttachments = attachments.filter((file) => (
        file.owner_type === 'reminder'
        || (file.owner_type === 'note' && tenants.has('notes'))
      ));
    }
    res.json({
      lists: visibleLists,
      reminders,
      notes: visibleNotes,
      docs: visibleDocs,
      attachments: visibleAttachments,
      docs_formats: DOC_FORMATS_PUBLIC,
      settings,
      now: new Date().toISOString(),
      store_epoch: await getStoreEpoch(),
      filtered: Boolean(req.token),
    });
  });

  // Full-history search for the UI: /api/state only carries each list's
  // retained completed items, so older matches have to come from the database.
  // Matching is typo-tolerant (public/fuzzy-search.js); candidates are scored
  // in JS, then each group is capped independently so a long completed history
  // cannot crowd out active items.
  app.get('/api/search', async (req, res) => {
    const query = text(req.query.q, 200);
    if (!query) return res.status(400).json({ error: 'Search text is required' });
    let limit = 250;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ error: 'limit must be 1 to 500' });
      }
    }
    const scope = req.query.scope === undefined ? 'all' : String(req.query.scope);
    if (!['all', 'reminders', 'notes', 'docs'].includes(scope)) {
      return res.status(400).json({ error: 'Invalid search scope' });
    }
    if (req.token && scope === 'notes' && !tokenHas(req.token, 'notes:read')) {
      return denyToken(res);
    }
    if (req.token && scope === 'docs' && !tokenHas(req.token, 'docs:read')) {
      return denyToken(res);
    }
    const includeReminders = scope === 'all' || scope === 'reminders';
    const includeNotes = (scope === 'all' || scope === 'notes')
      && (!req.token || tokenHas(req.token, 'notes:read'));
    const includeDocs = (scope === 'all' || scope === 'docs')
      && (!req.token || tokenHas(req.token, 'docs:read'));
    const cutoffs = retentionCutoffs();
    const [openRows, completedRows, noteRows, docRows, storeEpoch] = await Promise.all([
      includeReminders ? db.all(
        `SELECT r.* FROM reminders r
         WHERE r.completed = 0
         ORDER BY r.sort_order, r.id`
      ) : [],
      includeReminders ? db.all(
        `SELECT r.* FROM reminders r JOIN lists l ON l.id = r.list_id
         WHERE r.completed = 1 AND (r.completed_at IS NULL OR r.completed_at >=
           CASE l.completed_retention
             WHEN '1m' THEN ? WHEN '3m' THEN ? WHEN '6m' THEN ? WHEN '12m' THEN ?
             ELSE '0000-01-01T00:00:00.000Z'
           END)
         ORDER BY r.completed_at DESC, r.id DESC`,
        [cutoffs['1m'], cutoffs['3m'], cutoffs['6m'], cutoffs['12m']]
      ) : [],
      includeNotes ? db.all(
        `SELECT n.id, n.folder_id, n.title, n.body, n.body_format, n.revision, n.created_at, n.updated_at,
                l.name AS folder_name, l.color AS folder_color
         FROM notes n JOIN lists l ON l.id = n.folder_id
         WHERE instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body), lower(?)) > 0
         ORDER BY n.updated_at DESC, n.id DESC`,
        [query, query]
      ) : [],
      includeDocs ? db.all(
        `SELECT a.id, a.folder_id, a.name, a.mime, a.size, a.revision, a.created_at,
                l.name AS folder_name, l.color AS folder_color
         FROM attachments a JOIN lists l ON l.id = a.folder_id
         WHERE a.owner_type = 'doc' AND instr(lower(a.name), lower(?)) > 0
         ORDER BY a.created_at DESC, a.id DESC`,
        [query]
      ) : [],
      getStoreEpoch(),
    ]);
    // rank() is stable for equal scores, so the SQL ordering above is the tie-break.
    const openMatches = includeReminders ? fuzzy.rank(openRows, query) : [];
    const completedMatches = includeReminders ? fuzzy.rank(completedRows, query) : [];
    const open = openMatches.slice(0, limit).map((entry) => entry.reminder);
    const completed = completedMatches.slice(0, limit).map((entry) => entry.reminder);
    const notes = noteRows.slice(0, limit);
    const docs = docRows.slice(0, limit);
    await applyOccurrenceOverrides(open);
    res.json({
      query,
      scope,
      open,
      completed,
      notes,
      docs,
      totals: {
        open: openMatches.length,
        completed: completedMatches.length,
        notes: noteRows.length,
        docs: docRows.length,
      },
      truncated: openMatches.length > open.length || completedMatches.length > completed.length
        || noteRows.length > notes.length || docRows.length > docs.length,
      store_epoch: storeEpoch,
      filtered: Boolean(req.token),
    });
  });

  // Agent + UI reads. Tokens may use these; full rows for UI convenience.
  app.get('/api/lists', async (req, res) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const lists = await db.all(`
      SELECT l.id, l.name, l.color, l.sort_order, l.completed_retention, l.created_at, l.is_system, l.tenant,
        CASE l.tenant
          WHEN 'notes' THEN (SELECT COUNT(*) FROM notes n WHERE n.folder_id = l.id)
          WHEN 'docs' THEN (SELECT COUNT(*) FROM attachments a WHERE a.folder_id = l.id AND a.owner_type = 'doc')
          ELSE (SELECT COUNT(*) FROM reminders r WHERE r.list_id = l.id AND r.completed = 0)
        END AS count,
        (SELECT COUNT(*) FROM reminders r WHERE r.list_id = l.id AND r.completed = 1)
        AS done_count,
        (SELECT COUNT(*) FROM reminders r WHERE r.list_id = l.id AND r.completed = 1
           AND r.completed_at IS NOT NULL AND r.completed_at >= ?)
        AS done_count_30d
      FROM lists l ORDER BY l.tenant, l.sort_order, l.id
    `, [cutoff]);
    const visible = req.token
      ? lists.filter((list) => tokenAuthorizedTenants(req.token).includes(list.tenant))
      : lists;
    res.json({ lists: visible, filtered: Boolean(req.token) });
  });

  app.get('/api/reminders', async (req, res) => {
    const storeEpoch = await getStoreEpoch();
    const hasFilters = req.query.list_id !== undefined || req.query.completed !== undefined
      || (req.query.q !== undefined && String(req.query.q).trim() !== '')
      || req.query.limit !== undefined;
    if (!hasFilters) {
      // Complete snapshot mode: every reminder, active and full completed
      // history (no 30-day cutoff), ordered by id. Change awareness is a
      // client-side diff of two snapshots by id (revision compare). Only
      // absence from THIS unfiltered response implies deletion; absence
      // from any filtered or limited response means nothing.
      const reminders = await db.all(
        `SELECT ${REMINDER_COLUMNS} FROM reminders ORDER BY id ASC`
      );
      return res.json({ reminders, complete: true, store_epoch: storeEpoch });
    }
    const conditions = [];
    const params = [];
    if (req.query.list_id !== undefined) {
      const listId = parseId(req.query.list_id);
      if (!listId) return res.status(400).json({ error: 'Invalid list_id' });
      conditions.push('list_id = ?');
      params.push(listId);
    }
    if (req.query.completed !== undefined) {
      if (req.query.completed !== '0' && req.query.completed !== '1') {
        return res.status(400).json({ error: 'completed must be 0 or 1' });
      }
      conditions.push('completed = ?');
      params.push(Number(req.query.completed));
    }
    if (req.query.q !== undefined && String(req.query.q).trim() !== '') {
      conditions.push('(title LIKE ? OR notes LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    let limit = 100;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ error: 'limit must be 1 to 500' });
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const reminders = await db.all(
      `SELECT ${REMINDER_COLUMNS} FROM reminders ${where} ORDER BY sort_order, id LIMIT ?`,
      [...params, limit]
    );
    res.json({ reminders, store_epoch: storeEpoch });
  });

  app.get('/api/reminders/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    const reminder = await db.get(
      `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ?`, [id]
    );
    if (!reminder) return res.status(404).json({ error: 'Item not found' });
    res.json({ reminder });
  });

  app.post('/api/lists', async (req, res) => {
    const name = text(req.body.name, 120);
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    const tenant = validTenant(req.body.tenant, 'reminders');
    const completedRetention = tenant !== 'reminders' || req.body.completed_retention === undefined
      ? 'forever'
      : validCompletedRetention(req.body.completed_retention);
    if (!completedRetention) {
      return res.status(400).json({ error: 'Invalid completed retention' });
    }
    const max = await db.get('SELECT COALESCE(MAX(sort_order), -1) AS s FROM lists WHERE tenant = ?', [tenant]);
    const result = await db.run(
      'INSERT INTO lists (name, color, sort_order, completed_retention, tenant, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [name, validColor(req.body.color), max.s + 1, completedRetention, tenant, new Date().toISOString()]
    );
    res.status(201).json({ id: result.lastID, tenant, completed_retention: completedRetention });
  });

  app.put('/api/lists/order', async (req, res) => {
    const tenant = validTenant(req.body.tenant, 'reminders');
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((value) => Number(value)) : [];
    if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Invalid folder order' });
    }
    const existing = await db.all('SELECT id, is_system FROM lists WHERE tenant = ?', [tenant]);
    const existingIds = new Set(existing.map((row) => row.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: 'Folder order is out of date' });
    }
    const systemList = existing.find((row) => row.is_system);
    if (systemList && ids[0] !== systemList.id) {
      return res.status(400).json({ error: 'Unfiled must stay first' });
    }
    const cases = ids.map((id, index) => `WHEN ${id} THEN ${index}`).join(' ');
    try {
      await db.run(`UPDATE lists SET sort_order = CASE id ${cases} END WHERE tenant = ? AND id IN (${ids.join(', ')})`, [tenant]);
      res.json({ ok: true });
    } catch (err) {
      console.error('Folder reorder failed:', err.message);
      res.status(500).json({ error: 'Could not save folder order' });
    }
  });

  app.patch('/api/lists/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid folder' });
    const list = await db.get('SELECT id, name, is_system, completed_retention, tenant FROM lists WHERE id = ?', [id]);
    if (!list) return res.status(404).json({ error: 'Folder not found' });

    const fields = [];
    const params = [];
    if (req.body.name !== undefined) {
      const name = text(req.body.name, 120);
      if (!name) return res.status(400).json({ error: 'Folder name is required' });
      if (list.is_system && name !== list.name) {
        return res.status(400).json({ error: 'Unfiled cannot be renamed' });
      }
      fields.push('name = ?');
      params.push(name);
    }
    if (req.body.color !== undefined) {
      fields.push('color = ?');
      params.push(validColor(req.body.color));
    }
    let retentionChanged = false;
    if (req.body.completed_retention !== undefined) {
      if (list.tenant !== 'reminders') {
        return res.status(400).json({ error: 'Completed retention only applies to Reminders folders' });
      }
      const completedRetention = validCompletedRetention(req.body.completed_retention);
      if (!completedRetention) {
        return res.status(400).json({ error: 'Invalid completed retention' });
      }
      retentionChanged = completedRetention !== list.completed_retention;
      fields.push('completed_retention = ?');
      params.push(completedRetention);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    await db.run(`UPDATE lists SET ${fields.join(', ')} WHERE id = ?`, params);
    const purged = retentionChanged ? await purgeCompletedRetention(id) : 0;
    res.json({ ok: true, purged });
  });

  app.delete('/api/lists/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid folder' });
    const list = await db.get('SELECT id, is_system, tenant FROM lists WHERE id = ?', [id]);
    if (!list) return res.status(404).json({ error: 'Folder not found' });
    if (list.is_system) return res.status(400).json({ error: 'Unfiled cannot be deleted' });
    // Remove stored files before the cascade drops their metadata rows.
    const files = await db.all('SELECT stored_name FROM attachments WHERE folder_id = ?', [id]);
    await removeStoredFiles(files);
    await db.run('DELETE FROM lists WHERE id = ?', [id]);
    res.json({ ok: true });
  });

  /* ---------------- Notes tenant ---------------- */

  const NOTE_COLUMNS = 'id, folder_id, title, body, body_format, revision, created_at, updated_at';
  const NOTE_WRITE_FIELDS = ['title', 'body', 'body_format', 'folder_id', 'base_revision', 'base_epoch', 'idempotency_key'];

  async function loadNoteRow(id) {
    return db.get(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`, [id]);
  }

  async function guardNoteEpoch(baseEpoch) {
    if (typeof baseEpoch !== 'string' || !baseEpoch) {
      return { status: 400, body: { error: 'base_epoch is required for API writes' } };
    }
    if ((await getStoreEpoch()) !== baseEpoch) {
      return { status: 409, body: { error: 'Store was restored since your read' } };
    }
    return null;
  }

  function validateNoteWrite(body, { create }) {
    for (const key of Object.keys(body || {})) {
      if (!NOTE_WRITE_FIELDS.includes(key)) return `Unknown field: ${key}`;
    }
    if (body.title !== undefined && typeof body.title !== 'string') return 'Invalid title';
    if (body.body !== undefined && typeof body.body !== 'string') return 'Invalid body';
    if (body.body_format !== undefined && !['text', 'html'].includes(body.body_format)) {
      return 'Invalid body_format';
    }
    if (body.folder_id !== undefined && (!Number.isInteger(body.folder_id) || body.folder_id <= 0)) {
      return 'Invalid folder_id';
    }
    if (create) {
      if (typeof body.base_epoch !== 'string' || !body.base_epoch) return 'base_epoch is required for API writes';
    } else {
      if (!Number.isInteger(body.base_revision) || body.base_revision < 0
        || typeof body.base_epoch !== 'string' || !body.base_epoch) {
        return 'base_revision and base_epoch are required for API writes';
      }
    }
    return null;
  }

  app.get('/api/notes', async (req, res) => {
    const conditions = [];
    const params = [];
    if (req.query.folder_id !== undefined) {
      const folderId = parseId(req.query.folder_id);
      if (!folderId) return res.status(400).json({ error: 'Invalid folder_id' });
      const folder = await folderRow(folderId, 'notes');
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
      conditions.push('n.folder_id = ?');
      params.push(folderId);
    }
    let limit = 100;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ error: 'limit must be 1 to 500' });
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const notes = await db.all(
      `SELECT ${NOTE_COLUMNS.replace(/(^|, )/g, (m) => m.startsWith(',') ? ', n.' : 'n.')}
       FROM notes n ${where} ORDER BY n.updated_at DESC, n.id DESC LIMIT ?`,
      [...params, limit]
    );
    res.json({ notes, complete: req.query.limit === undefined, filtered: Boolean(req.token) });
  });

  app.get('/api/notes/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid note' });
    const note = await loadNoteRow(id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  });

  app.post('/api/notes', async (req, res) => {
    if (req.token) {
      const key = idempotencyKeyFrom(req);
      if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
      const invalid = validateNoteWrite(req.body, { create: true });
      if (invalid) return res.status(400).json({ error: invalid });
      return runTokenWrite(req, res, {
        route: 'POST /api/notes',
        key,
        fingerprint: payloadFingerprint(req.body),
        execute: async () => {
          const epochError = await guardNoteEpoch(req.body.base_epoch);
          if (epochError) return epochError;
          const title = text(req.body.title, 500);
          if (!title) return { status: 400, body: { error: 'Note title is required' } };
          const body = typeof req.body.body === 'string' ? req.body.body.slice(0, NOTE_BODY_MAX) : '';
          const bodyFormat = req.body.body_format === 'html' ? 'html' : 'text';
          const folderId = req.body.folder_id === undefined || req.body.folder_id === null
            ? await systemFolderId('notes')
            : req.body.folder_id;
          const folder = folderId ? await folderRow(folderId, 'notes') : null;
          if (!folder) return { status: 400, body: { error: 'Choose a Notes folder' } };
          const now = new Date().toISOString();
          const result = await db.run(
            'INSERT INTO notes (folder_id, title, body, body_format, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [folder.id, title, body, bodyFormat, now, now]
          );
          const note = await loadNoteRow(result.lastID);
          return { status: 201, body: { id: result.lastID, note } };
        },
      });
    }
    const title = text(req.body.title, 500);
    if (!title) return res.status(400).json({ error: 'Note title is required' });
    const body = typeof req.body.body === 'string' ? req.body.body.slice(0, NOTE_BODY_MAX) : '';
    const bodyFormat = req.body.body_format === 'html' ? 'html' : 'text';
    const folderId = req.body.folder_id === undefined || req.body.folder_id === null
      ? await systemFolderId('notes')
      : parseId(req.body.folder_id);
    const folder = folderId ? await folderRow(folderId, 'notes') : null;
    if (!folder) return res.status(400).json({ error: 'Choose a Notes folder' });
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO notes (folder_id, title, body, body_format, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [folder.id, title, body, bodyFormat, now, now]
    );
    res.status(201).json({ id: result.lastID });
  });

  app.patch('/api/notes/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid note' });
    if (req.token) {
      const key = idempotencyKeyFrom(req);
      if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
      const invalid = validateNoteWrite(req.body, { create: false });
      if (invalid) return res.status(400).json({ error: invalid });
      return runTokenWrite(req, res, {
        route: `PATCH /api/notes/${id}`,
        key,
        fingerprint: payloadFingerprint(req.body),
        execute: async () => {
          const current = await loadNoteRow(id);
          if (!current) return { status: 404, body: { error: 'Note not found' } };
          const epochError = await guardNoteEpoch(req.body.base_epoch);
          if (epochError) return epochError;
          if (current.revision !== req.body.base_revision) {
            return { status: 409, body: { error: 'Note changed since your read', note: current } };
          }
          const fields = [];
          const params = [];
          if (req.body.title !== undefined) {
            const title = text(req.body.title, 500);
            if (!title) return { status: 400, body: { error: 'Note title is required' } };
            fields.push('title = ?');
            params.push(title);
          }
          if (req.body.body !== undefined) {
            fields.push('body = ?');
            params.push(req.body.body.slice(0, NOTE_BODY_MAX));
          }
          if (req.body.body_format !== undefined) {
            fields.push('body_format = ?');
            params.push(req.body.body_format);
          }
          if (req.body.folder_id !== undefined) {
            const folder = await folderRow(req.body.folder_id, 'notes');
            if (!folder) return { status: 400, body: { error: 'Choose a Notes folder' } };
            fields.push('folder_id = ?');
            params.push(folder.id);
            await db.run(
              "UPDATE attachments SET folder_id = ? WHERE owner_type = 'note' AND owner_id = ?",
              [folder.id, id]
            );
          }
          if (!fields.length) return { status: 400, body: { error: 'Nothing to update' } };
          fields.push('updated_at = ?');
          params.push(new Date().toISOString());
          fields.push('revision = revision + 1');
          params.push(id);
          await db.run(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`, params);
          return { status: 200, body: { ok: true, note: await loadNoteRow(id) } };
        },
      });
    }
    const note = await db.get('SELECT id FROM notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const fields = [];
    const params = [];
    if (req.body.title !== undefined) {
      const title = text(req.body.title, 500);
      if (!title) return res.status(400).json({ error: 'Note title is required' });
      fields.push('title = ?');
      params.push(title);
    }
    if (req.body.body !== undefined) {
      fields.push('body = ?');
      params.push(typeof req.body.body === 'string' ? req.body.body.slice(0, NOTE_BODY_MAX) : '');
    }
    if (req.body.body_format !== undefined) {
      if (!['text', 'html'].includes(req.body.body_format)) {
        return res.status(400).json({ error: 'Invalid body_format' });
      }
      fields.push('body_format = ?');
      params.push(req.body.body_format);
    }
    if (req.body.folder_id !== undefined) {
      const folder = await folderRow(parseId(req.body.folder_id), 'notes');
      if (!folder) return res.status(400).json({ error: 'Choose a Notes folder' });
      fields.push('folder_id = ?');
      params.push(folder.id);
      await db.run(
        "UPDATE attachments SET folder_id = ? WHERE owner_type = 'note' AND owner_id = ?",
        [folder.id, id]
      );
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    fields.push('revision = revision + 1');
    params.push(id);
    await db.run(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  });

  app.delete('/api/notes/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid note' });
    if (req.token) {
      const key = idempotencyKeyFrom(req);
      if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
      if (!Number.isInteger(req.body.base_revision) || req.body.base_revision < 0
        || typeof req.body.base_epoch !== 'string' || !req.body.base_epoch) {
        return res.status(400).json({ error: 'base_revision and base_epoch are required for API writes' });
      }
      return runTokenWrite(req, res, {
        route: `DELETE /api/notes/${id}`,
        key,
        fingerprint: payloadFingerprint(req.body),
        execute: async () => {
          const note = await loadNoteRow(id);
          if (!note) return { status: 404, body: { error: 'Note not found' } };
          const epochError = await guardNoteEpoch(req.body.base_epoch);
          if (epochError) return epochError;
          if (note.revision !== req.body.base_revision) {
            return { status: 409, body: { error: 'Note changed since your read', note } };
          }
          const files = await db.all(
            "SELECT stored_name FROM attachments WHERE owner_type = 'note' AND owner_id = ?", [id]
          );
          await removeStoredFiles(files);
          await db.run("DELETE FROM attachments WHERE owner_type = 'note' AND owner_id = ?", [id]);
          await db.run('DELETE FROM notes WHERE id = ?', [id]);
          return { status: 200, body: { ok: true, deleted: true } };
        },
      });
    }
    const note = await db.get('SELECT id FROM notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const files = await db.all(
      "SELECT stored_name FROM attachments WHERE owner_type = 'note' AND owner_id = ?", [id]
    );
    await removeStoredFiles(files);
    await db.run("DELETE FROM attachments WHERE owner_type = 'note' AND owner_id = ?", [id]);
    await db.run('DELETE FROM notes WHERE id = ?', [id]);
    res.json({ ok: true });
  });

  /* ---------------- Attachments and Docs ---------------- */

  async function saveUploads(req, { tenant, ownerType, ownerId, folderId }) {
    const rows = [];
    try {
      for (const file of req.files || []) {
        const name = cleanFileName(file.originalname);
        const format = tenant === 'docs' ? docFormatForName(name) : null;
        const mime = format ? format.mime : (file.mimetype || 'application/octet-stream');
        const optimized = await optimizeUploadedFile(file, name);
        const result = await db.run(
          `INSERT INTO attachments (tenant, owner_type, owner_id, folder_id, name, stored_name, mime, size, stored_size, compression, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tenant, ownerType, ownerId, folderId, name, file.filename,
            mime, optimized.size, optimized.storedSize, optimized.compression, new Date().toISOString()]
        );
        rows.push({ id: result.lastID, name, mime, size: optimized.size });
      }
      return rows;
    } catch (err) {
      for (const row of rows) {
        await db.run('DELETE FROM attachments WHERE id = ?', [row.id]).catch(() => {});
      }
      await removeStoredFiles(req.files);
      throw err;
    }
  }

  app.get('/api/reminders/:id/attachments', async (req, res) => {
    const id = parseId(req.params.id);
    const reminder = id ? await db.get('SELECT id FROM reminders WHERE id = ?', [id]) : null;
    if (!reminder) return res.status(404).json({ error: 'Item not found' });
    const attachments = await db.all(
      "SELECT id, name, mime, size, revision, created_at FROM attachments WHERE owner_type = 'reminder' AND owner_id = ? ORDER BY id",
      [id]
    );
    res.json({ attachments });
  });

  app.get('/api/notes/:id/attachments', async (req, res) => {
    const id = parseId(req.params.id);
    const note = id ? await db.get('SELECT id FROM notes WHERE id = ?', [id]) : null;
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const attachments = await db.all(
      "SELECT id, name, mime, size, revision, created_at FROM attachments WHERE owner_type = 'note' AND owner_id = ? ORDER BY id",
      [id]
    );
    res.json({ attachments });
  });

  async function uploadFingerprint(ownerType, ownerId, folderId, baseEpoch, files) {
    const hashes = await Promise.all(files.map(async (file) => ({
      name: cleanFileName(file.originalname),
      size: file.size || 0,
      sha256: await hashUploadedFile(file.path),
    })));
    return crypto.createHash('sha256')
      .update(JSON.stringify({ ownerType, ownerId, folderId, baseEpoch, files: hashes })).digest('hex');
  }

  app.post('/api/reminders/:id/attachments', upload.array('files', 10), async (req, res) => {
    const id = parseId(req.params.id);
    const reminder = id ? await db.get('SELECT id, list_id FROM reminders WHERE id = ?', [id]) : null;
    if (!reminder) {
      await removeStoredFiles(req.files);
      return res.status(404).json({ error: 'Item not found' });
    }
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'Choose at least one file' });
    if (req.token) {
      const key = idempotencyKeyFrom(req);
      if (!key || typeof req.body.base_epoch !== 'string' || !req.body.base_epoch) {
        await removeStoredFiles(req.files);
        return res.status(400).json({ error: 'Idempotency-Key and base_epoch are required for API writes' });
      }
      const fingerprint = await uploadFingerprint('reminder', reminder.id, reminder.list_id, req.body.base_epoch, req.files);
      return runTokenUpload(req, res, {
        route: `POST /api/reminders/${id}/attachments`,
        key,
        fingerprint,
        cleanup: () => removeStoredFiles(req.files),
        execute: async () => {
          if ((await getStoreEpoch()) !== req.body.base_epoch) {
            return { status: 409, body: { error: 'Store was restored since your read' } };
          }
          const rows = await saveUploads(req, {
            tenant: 'reminders', ownerType: 'reminder', ownerId: reminder.id, folderId: reminder.list_id,
          });
          await db.run('UPDATE reminders SET revision = revision + 1 WHERE id = ?', [reminder.id]);
          return { status: 201, body: { attachments: rows } };
        },
      });
    }
    const rows = await saveUploads(req, {
      tenant: 'reminders', ownerType: 'reminder', ownerId: reminder.id, folderId: reminder.list_id,
    });
    await db.run('UPDATE reminders SET revision = revision + 1 WHERE id = ?', [reminder.id]);
    res.status(201).json({ attachments: rows });
  });

  app.post('/api/notes/:id/attachments', upload.array('files', 10), async (req, res) => {
    const id = parseId(req.params.id);
    const note = id ? await db.get('SELECT id, folder_id FROM notes WHERE id = ?', [id]) : null;
    if (!note) {
      await removeStoredFiles(req.files);
      return res.status(404).json({ error: 'Note not found' });
    }
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'Choose at least one file' });
    if (req.token) {
      const key = idempotencyKeyFrom(req);
      if (!key || typeof req.body.base_epoch !== 'string' || !req.body.base_epoch) {
        await removeStoredFiles(req.files);
        return res.status(400).json({ error: 'Idempotency-Key and base_epoch are required for API writes' });
      }
      const fingerprint = await uploadFingerprint('note', note.id, note.folder_id, req.body.base_epoch, req.files);
      return runTokenUpload(req, res, {
        route: `POST /api/notes/${id}/attachments`,
        key,
        fingerprint,
        cleanup: () => removeStoredFiles(req.files),
        execute: async () => {
          if ((await getStoreEpoch()) !== req.body.base_epoch) {
            return { status: 409, body: { error: 'Store was restored since your read' } };
          }
          const rows = await saveUploads(req, {
            tenant: 'notes', ownerType: 'note', ownerId: note.id, folderId: note.folder_id,
          });
          await db.run('UPDATE notes SET revision = revision + 1 WHERE id = ?', [note.id]);
          return { status: 201, body: { attachments: rows } };
        },
      });
    }
    const rows = await saveUploads(req, {
      tenant: 'notes', ownerType: 'note', ownerId: note.id, folderId: note.folder_id,
    });
    await db.run('UPDATE notes SET revision = revision + 1 WHERE id = ?', [note.id]);
    res.status(201).json({ attachments: rows });
  });

  app.post('/api/docs', upload.array('files', 10), async (req, res) => {
    const folderId = req.body.folder_id === undefined || req.body.folder_id === null
      ? await systemFolderId('docs')
      : parseId(req.body.folder_id);
    const folder = folderId ? await folderRow(folderId, 'docs') : null;
    if (!folder || !req.files || !req.files.length) {
      await removeStoredFiles(req.files);
      return res.status(400).json({ error: folder ? 'Choose at least one file' : 'Choose a Docs folder' });
    }
    const unsupported = req.files.find((file) => !docExtensionAllowed(file.originalname));
    if (unsupported) {
      await removeStoredFiles(req.files);
      return res.status(400).json({ error: docsFormatError() });
    }
    for (const file of req.files) {
      const format = docFormatForName(file.originalname);
      let matches = true;
      try {
        matches = await docContentMatches(file.path, format);
      } catch {
        matches = false;
      }
      if (!matches) {
        await removeStoredFiles(req.files);
        return res.status(400).json({
          error: `File content does not match the ${format ? format.label : 'declared'} extension: ${cleanFileName(file.originalname)}`,
        });
      }
    }
    if (req.token) {
      const key = idempotencyKeyFrom(req);
      if (!key || typeof req.body.base_epoch !== 'string' || !req.body.base_epoch) {
        await removeStoredFiles(req.files);
        return res.status(400).json({ error: 'Idempotency-Key and base_epoch are required for API writes' });
      }
      const hashes = await Promise.all(req.files.map(async (file) => ({
        name: cleanFileName(file.originalname),
        size: file.size || 0,
        sha256: await hashUploadedFile(file.path),
      })));
      const fingerprint = crypto.createHash('sha256')
        .update(JSON.stringify({ folder_id: folder.id, base_epoch: req.body.base_epoch, files: hashes })).digest('hex');
      return runTokenUpload(req, res, {
        route: 'POST /api/docs',
        key,
        fingerprint,
        cleanup: () => removeStoredFiles(req.files),
        execute: async () => {
          if ((await getStoreEpoch()) !== req.body.base_epoch) {
            return { status: 409, body: { error: 'Store was restored since your read' } };
          }
          const rows = await saveUploads(req, {
            tenant: 'docs', ownerType: 'doc', ownerId: null, folderId: folder.id,
          });
          return { status: 201, body: { docs: rows } };
        },
      });
    }
    const rows = await saveUploads(req, {
      tenant: 'docs', ownerType: 'doc', ownerId: null, folderId: folder.id,
    });
    res.status(201).json({ docs: rows });
  });

  app.get('/api/docs', async (req, res) => {
    const conditions = ["a.owner_type = 'doc'"];
    const params = [];
    if (req.query.folder_id !== undefined) {
      const folderId = parseId(req.query.folder_id);
      if (!folderId) return res.status(400).json({ error: 'Invalid folder_id' });
      const folder = await folderRow(folderId, 'docs');
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
      conditions.push('a.folder_id = ?');
      params.push(folderId);
    }
    let limit = 100;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ error: 'limit must be 1 to 500' });
      }
    }
    const docs = await db.all(
      `SELECT a.id, a.folder_id, a.name, a.mime, a.size, a.revision, a.created_at
       FROM attachments a WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      [...params, limit]
    );
    res.json({ docs, complete: req.query.limit === undefined, filtered: Boolean(req.token) });
  });

  app.get('/api/docs/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid file' });
    const doc = await db.get(
      `SELECT id, folder_id, name, mime, size, revision, created_at
       FROM attachments WHERE id = ? AND owner_type = 'doc'`, [id]
    );
    if (!doc) return res.status(404).json({ error: 'File not found' });
    res.json({ doc });
  });

  app.get('/api/files/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const file = id ? await db.get(
      'SELECT name, stored_name, mime, size, compression, owner_type, owner_id FROM attachments WHERE id = ?', [id]
    ) : null;
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (req.token) {
      const allowed = file.owner_type === 'reminder'
        || (file.owner_type === 'note' && tokenHas(req.token, 'notes:read'))
        || (file.owner_type === 'doc' && tokenHas(req.token, 'docs:read'));
      if (!allowed) return denyToken(res);
    }
    const full = path.join(UPLOAD_DIR, file.stored_name);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (file.compression === 'gzip') {
      res.attachment(file.name);
      res.type(file.mime || 'application/octet-stream');
      if (file.size !== null && file.size !== undefined) res.setHeader('Content-Length', String(file.size));
      const source = fs.createReadStream(full);
      const gunzip = zlib.createGunzip();
      const fail = () => {
        if (!res.headersSent) res.status(404).json({ error: 'File not found' });
        else res.destroy();
      };
      source.on('error', fail);
      gunzip.on('error', fail);
      res.on('close', () => {
        source.destroy();
        gunzip.destroy();
      });
      source.pipe(gunzip).pipe(res);
      return;
    }
    res.download(full, file.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
    });
  });

  app.get('/api/files/:id/preview', async (req, res) => {
    const id = parseId(req.params.id);
    const file = id ? await db.get(
      'SELECT name, stored_name, owner_type, owner_id FROM attachments WHERE id = ?', [id]
    ) : null;
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (req.token) {
      const allowed = file.owner_type === 'reminder'
        || (file.owner_type === 'note' && tokenHas(req.token, 'notes:read'))
        || (file.owner_type === 'doc' && tokenHas(req.token, 'docs:read'));
      if (!allowed) return denyToken(res);
    }
    const format = previewImageFormatForName(file.name);
    if (!format) return res.status(415).json({ error: 'Preview is only available for image files' });
    const full = path.join(UPLOAD_DIR, file.stored_name);
    let matches = true;
    try {
      matches = await docContentMatches(full, format);
    } catch {
      matches = false;
    }
    if (!matches) return res.status(415).json({ error: 'Preview is not available for this file' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Disposition', 'inline');
    res.type(format.mime);
    res.sendFile(full, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
    });
  });

  async function deleteAttachmentRow(id) {
    const file = await db.get(
      'SELECT id, stored_name, owner_type, owner_id FROM attachments WHERE id = ?', [id]
    );
    if (!file) return null;
    await removeStoredFiles([file]);
    await db.run('DELETE FROM attachments WHERE id = ?', [id]);
    if (file.owner_type === 'note') {
      await db.run('UPDATE notes SET revision = revision + 1 WHERE id = ?', [file.owner_id]);
    } else if (file.owner_type === 'reminder') {
      await db.run('UPDATE reminders SET revision = revision + 1 WHERE id = ?', [file.owner_id]);
    }
    return file;
  }

  app.delete('/api/attachments/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid file' });
    const file = await db.get(
      'SELECT id, owner_type, stored_name, revision FROM attachments WHERE id = ?', [id]
    );
    if (req.token) {
      if (file) {
        const allowed = (file.owner_type === 'note' && tokenHas(req.token, 'notes:delete'))
          || (file.owner_type === 'doc' && tokenHas(req.token, 'docs:delete'));
        if (!allowed) return denyToken(res);
      }
      const key = idempotencyKeyFrom(req);
      if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
      if (!Number.isInteger(req.body.base_revision) || req.body.base_revision < 0
        || typeof req.body.base_epoch !== 'string' || !req.body.base_epoch) {
        return res.status(400).json({ error: 'base_revision and base_epoch are required for API writes' });
      }
      return runTokenWrite(req, res, {
        route: `DELETE /api/attachments/${id}`,
        key,
        fingerprint: payloadFingerprint(req.body),
        execute: async () => {
          const current = await db.get('SELECT revision FROM attachments WHERE id = ?', [id]);
          if (!current) return { status: 404, body: { error: 'File not found' } };
          if ((await getStoreEpoch()) !== req.body.base_epoch) {
            return { status: 409, body: { error: 'Store was restored since your read' } };
          }
          if (current.revision !== req.body.base_revision) {
            return { status: 409, body: { error: 'File changed since your read' } };
          }
          await deleteAttachmentRow(id);
          return { status: 200, body: { ok: true, deleted: true } };
        },
      });
    }
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (!(await deleteAttachmentRow(id))) return res.status(404).json({ error: 'File not found' });
    res.json({ ok: true });
  });

  app.patch('/api/docs/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid file' });
    const file = await db.get(
      "SELECT id, folder_id, name, stored_name, revision FROM attachments WHERE id = ? AND owner_type = 'doc'", [id]
    );
    if (!file) return res.status(404).json({ error: 'File not found' });

    const hasName = req.body.name !== undefined;
    const hasFolder = req.body.folder_id !== undefined;
    if (!hasName && !hasFolder) return res.status(400).json({ error: 'Nothing to update' });

    let nextName = file.name;
    let nextMime = null;
    if (hasName) {
      const requested = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!requested) return res.status(400).json({ error: 'File name is required' });
      nextName = cleanFileName(requested);
      const originalExt = path.extname(file.name).toLowerCase();
      if (path.extname(nextName).toLowerCase() !== originalExt) {
        return res.status(400).json({ error: `Keep the ${originalExt} extension when renaming this file` });
      }
      const format = docFormatForName(nextName);
      if (!format) return res.status(400).json({ error: docsFormatError() });
      let matches = true;
      try {
        matches = await docContentMatches(path.join(UPLOAD_DIR, file.stored_name), format);
      } catch {
        matches = false;
      }
      if (!matches) {
        return res.status(400).json({ error: `File content does not match the ${format.label} extension: ${nextName}` });
      }
      nextMime = format.mime;
    }

    let nextFolder = file.folder_id;
    if (hasFolder) {
      const folder = await folderRow(parseId(req.body.folder_id), 'docs');
      if (!folder) return res.status(400).json({ error: 'Choose a Docs folder' });
      nextFolder = folder.id;
    }

    if (req.token) {
      const allowed = ['name', 'folder_id', 'base_revision', 'base_epoch', 'idempotency_key'];
      for (const key of Object.keys(req.body || {})) {
        if (!allowed.includes(key)) return res.status(400).json({ error: `Unknown field: ${key}` });
      }
      const key = idempotencyKeyFrom(req);
      if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
      if (!Number.isInteger(req.body.base_revision) || req.body.base_revision < 0
        || typeof req.body.base_epoch !== 'string' || !req.body.base_epoch) {
        return res.status(400).json({ error: 'base_revision and base_epoch are required for API writes' });
      }
      return runTokenWrite(req, res, {
        route: `PATCH /api/docs/${id}`,
        key,
        fingerprint: payloadFingerprint(req.body),
        execute: async () => {
          const current = await db.get(
            "SELECT id, folder_id, name, revision FROM attachments WHERE id = ? AND owner_type = 'doc'", [id]
          );
          if (!current) return { status: 404, body: { error: 'File not found' } };
          if ((await getStoreEpoch()) !== req.body.base_epoch) {
            return { status: 409, body: { error: 'Store was restored since your read' } };
          }
          if (current.revision !== req.body.base_revision) {
            return { status: 409, body: { error: 'File changed since your read' } };
          }
          const fields = [];
          const params = [];
          if (hasFolder) { fields.push('folder_id = ?'); params.push(nextFolder); }
          if (hasName) {
            fields.push('name = ?');
            params.push(nextName);
            fields.push('mime = ?');
            params.push(nextMime);
          }
          fields.push('revision = revision + 1');
          params.push(id);
          await db.run(`UPDATE attachments SET ${fields.join(', ')} WHERE id = ?`, params);
          return { status: 200, body: { ok: true, name: nextName, folder_id: nextFolder } };
        },
      });
    }

    const fields = [];
    const params = [];
    if (hasFolder) { fields.push('folder_id = ?'); params.push(nextFolder); }
    if (hasName) {
      fields.push('name = ?');
      params.push(nextName);
      fields.push('mime = ?');
      params.push(nextMime);
    }
    fields.push('revision = revision + 1');
    params.push(id);
    await db.run(`UPDATE attachments SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true, name: nextName, folder_id: nextFolder });
  });

  app.delete('/api/docs/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid file' });
    if (req.token) {
      const key = idempotencyKeyFrom(req);
      if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
      if (!Number.isInteger(req.body.base_revision) || req.body.base_revision < 0
        || typeof req.body.base_epoch !== 'string' || !req.body.base_epoch) {
        return res.status(400).json({ error: 'base_revision and base_epoch are required for API writes' });
      }
      return runTokenWrite(req, res, {
        route: `DELETE /api/docs/${id}`,
        key,
        fingerprint: payloadFingerprint(req.body),
        execute: async () => {
          const current = await db.get(
            "SELECT id, revision FROM attachments WHERE id = ? AND owner_type = 'doc'", [id]
          );
          if (!current) return { status: 404, body: { error: 'File not found' } };
          if ((await getStoreEpoch()) !== req.body.base_epoch) {
            return { status: 409, body: { error: 'Store was restored since your read' } };
          }
          if (current.revision !== req.body.base_revision) {
            return { status: 409, body: { error: 'File changed since your read' } };
          }
          await deleteAttachmentRow(id);
          return { status: 200, body: { ok: true, deleted: true } };
        },
      });
    }
    await deleteAttachmentRow(id);
    res.json({ ok: true });
  });

  app.get('/api/storage', async (req, res) => {
    const allowed = req.token ? tokenAuthorizedTenants(req.token) : null;
    res.json(await storageSnapshot(allowed));
  });

  // Shared reminder-create preparation. strict=false preserves the exact
  // legacy/session coercion behavior; strict=true rejects unknown fields
  // and wrong types for write-profile token callers (naming the field).
  // parity=true resolves an omitted time_model from the owner's Settings
  // default instead of hardcoding 'fixed'. Throws {status, message}.
  const CREATE_FIELDS = ['title', 'notes', 'list_id', 'list', 'due_at', 'has_time',
    'urgent', 'repeat_rule', 'repeat', 'time_model', 'time_zone', 'device_zone',
    'idempotency_key', 'completed'];
  function failWith(status, message) {
    throw Object.assign(new Error(message), { status });
  }
  async function prepareReminderCreate(body, { strict, parity, isToken }) {
    if (strict) {
      for (const key of Object.keys(body || {})) {
        if (!CREATE_FIELDS.includes(key)) failWith(400, `Unknown field: ${key}`);
      }
      const mustBe = (key, check) => {
        if (body[key] !== undefined && !check(body[key])) failWith(400, `Invalid ${key}`);
      };
      mustBe('title', (v) => typeof v === 'string');
      mustBe('notes', (v) => typeof v === 'string');
      mustBe('list_id', (v) => Number.isInteger(v) && v > 0);
      mustBe('list', (v) => typeof v === 'string');
      mustBe('due_at', (v) => v === null || typeof v === 'string');
      mustBe('has_time', (v) => typeof v === 'boolean');
      mustBe('urgent', (v) => typeof v === 'boolean');
      mustBe('repeat_rule', (v) => typeof v === 'string' || (v !== null && typeof v === 'object'));
      mustBe('repeat', (v) => typeof v === 'string' || (v !== null && typeof v === 'object'));
      mustBe('time_model', (v) => typeof v === 'string');
      mustBe('time_zone', (v) => v === null || typeof v === 'string');
      mustBe('device_zone', (v) => typeof v === 'string');
    }
    const title = text(body.title, 500);
    if (!title) failWith(400, 'Title is required');
    const listRef = body.list_id !== undefined ? body.list_id : body.list;
    const hasListRef = listRef !== undefined && listRef !== null && listRef !== '';
    let list = null;
    try {
      list = await resolveList(listRef);
    } catch (err) {
      failWith(err.status || 500, err.message || 'Server error');
    }
    if (!list && !hasListRef) {
      list = await db.get('SELECT id, name FROM lists WHERE is_system = 1 LIMIT 1');
    }
    if (!list) failWith(400, 'Choose a list');
    const listId = list.id;

    const dueAtRaw = normalizeDate(body.due_at);
    if (dueAtRaw === undefined) failWith(400, 'Invalid date');
    const hasTime = dueAtRaw && body.has_time ? 1 : 0;
    const urgent = body.urgent ? 1 : 0;
    const completed = !isToken && body.completed ? 1 : 0;

    let rule;
    try {
      rule = recurrence.parseRepeatRule(body.repeat_rule ?? body.repeat ?? 'none');
    } catch (err) {
      failWith(err.status || 500, err.message || 'Server error');
    }
    if (recurrence.isRecurringRule(rule) && !dueAtRaw) {
      failWith(400, 'Repeating items need a date');
    }

    const settings = await getSettings();
    let timeModel;
    if (body.time_model === undefined) {
      timeModel = parity ? settings.default_time_model : 'fixed';
    } else {
      timeModel = String(body.time_model);
    }
    if (!TIME_MODELS.includes(timeModel)) {
      failWith(400, 'time_model must be fixed, floating, or anchored');
    }
    let timeZone = body.time_zone === undefined || body.time_zone === null
      ? null
      : String(body.time_zone);
    if (timeZone === '') timeZone = null;
    if (timeZone && !recurrence.isValidTimeZone(timeZone)) {
      failWith(400, 'Unknown time_zone');
    }
    if (timeModel === 'anchored' && !timeZone) {
      if (parity) {
        timeZone = recurrence.isValidTimeZone(settings.default_time_zone)
          ? settings.default_time_zone : null;
      }
      if (!timeZone) failWith(400, 'Zone-anchored items need a time_zone');
    }
    if (timeModel === 'floating' && !timeZone) {
      const deviceZone = typeof body.device_zone === 'string' ? body.device_zone : '';
      if (recurrence.isValidTimeZone(deviceZone)) timeZone = deviceZone;
    }

    let dueAt = dueAtRaw;
    if (dueAt && recurrence.isRecurringRule(rule)) {
      const anchored = recurrence.anchorRule(rule, dueAt, effectiveZoneFor({ time_model: timeModel, time_zone: timeZone }, settings));
      rule = anchored;
      if (new Date(dueAt).getTime() <= Date.now()) {
        dueAt = recurrence.firstFutureOccurrence(rule, dueAt,
          effectiveZoneFor({ time_model: timeModel, time_zone: timeZone }, settings), new Date().toISOString());
      }
    }
    return { title, listId, dueAt, dueAtRaw, hasTime, urgent, completed, rule, timeModel, timeZone };
  }

  async function insertReminderRow(prep, body, now) {
    const notifiedAt = !prep.completed && prep.dueAt && !prep.hasTime && new Date(prep.dueAt) <= new Date() ? now : null;
    const max = await db.get(
      'SELECT COALESCE(MAX(sort_order), -1) AS s FROM reminders WHERE list_id = ?',
      [prep.listId]
    );
    const result = await db.run(`
      INSERT INTO reminders
        (list_id, title, notes, due_at, has_time, completed, completed_at, urgent,
         repeat_rule, time_model, time_zone, notified_at, last_push_at, push_count,
         sort_order, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 1)
    `, [prep.listId, prep.title, text(body.notes, NOTES_MAX), prep.dueAt, prep.hasTime,
      prep.completed, prep.completed ? now : null,
      prep.urgent, recurrence.encodeRepeatRule(prep.rule), prep.timeModel, prep.timeZone, notifiedAt,
      max.s + 1, now, now]);
    return result.lastID;
  }

  app.post('/api/reminders', async (req, res) => {
    const profile = req.token ? (req.token.profile || 'legacy') : null;
    if (req.token && req.body.completed) return denyToken(res);
    // Session browsers and legacy tokens: exact historical behavior
    // (coercing validation, legacy idempotency table, {id} shapes).
    if (!req.token || profile === 'legacy') {
      try {
        const prep = await prepareReminderCreate(req.body, { strict: false, parity: false, isToken: Boolean(req.token) });
        // Duplicate-safe creation: a retried request carrying the same
        // idempotency key returns the original reminder instead of a copy.
        const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotency_key;
        if (idempotencyKey) {
          if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) {
            return res.status(400).json({ error: 'Invalid idempotency key' });
          }
          const seen = await db.get('SELECT reminder_id FROM idempotency_keys WHERE key = ?', [idempotencyKey]);
          if (seen) {
            const existing = await loadReminder(seen.reminder_id);
            if (existing) return res.json({ id: existing.id, deduplicated: true });
          }
        }
        const now = new Date().toISOString();
        const createdId = await insertReminderRow(prep, req.body, now);
        if (idempotencyKey) {
          await db.run('INSERT OR IGNORE INTO idempotency_keys (key, reminder_id, created_at) VALUES (?, ?, ?)',
            [idempotencyKey, createdId, now]);
          const winner = await db.get('SELECT reminder_id FROM idempotency_keys WHERE key = ?', [idempotencyKey]);
          if (winner && winner.reminder_id !== createdId) {
            // Lost a race with an identical retry: drop our duplicate.
            await db.run('DELETE FROM reminders WHERE id = ?', [createdId]);
            return res.json({ id: winner.reminder_id, deduplicated: true });
          }
        }
        return res.status(201).json({ id: createdId });
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'Server error' });
      }
    }
    // Write-profile tokens: key required, strict validation, Settings
    // time-model parity, stored-response idempotency ledger.
    const key = idempotencyKeyFrom(req);
    if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
    const fingerprint = payloadFingerprint(req.body);
    return runTokenWrite(req, res, {
      route: 'POST /api/reminders',
      key,
      fingerprint,
      execute: async () => {
        const prep = await prepareReminderCreate(req.body, { strict: true, parity: true, isToken: true });
        const now = new Date().toISOString();
        const createdId = await insertReminderRow(prep, req.body, now);
        const reminder = await loadReminder(createdId);
        return { status: 201, body: { id: createdId, reminder }, reminderId: createdId };
      },
    });
  });

  // ---- Write-profile token mutation helpers ----
  // Strict validation for token callers: unknown fields and wrong types are
  // rejected naming the field. Session behavior (coercion) is untouched.
  const PATCH_FIELDS = ['title', 'notes', 'list_id', 'due_at', 'has_time', 'urgent',
    'repeat_rule', 'repeat', 'time_model', 'time_zone', 'completed', 'snoozed_until',
    'scope', 'occurrence_at', 'base_revision', 'base_epoch'];
  function requireBase(body) {
    if (!Number.isInteger(body.base_revision) || body.base_revision < 0
      || typeof body.base_epoch !== 'string' || !body.base_epoch) {
      throw tokenWriteError(400, 'base_revision and base_epoch are required for API writes');
    }
  }
  function validateWritePatch(body) {
    for (const key of Object.keys(body || {})) {
      if (!PATCH_FIELDS.includes(key)) throw tokenWriteError(400, `Unknown field: ${key}`);
    }
    const mustBe = (key, check) => {
      if (body[key] !== undefined && !check(body[key])) throw tokenWriteError(400, `Invalid ${key}`);
    };
    mustBe('title', (v) => typeof v === 'string');
    mustBe('notes', (v) => typeof v === 'string');
    mustBe('list_id', (v) => Number.isInteger(v) && v > 0);
    mustBe('due_at', (v) => v === null || typeof v === 'string');
    mustBe('has_time', (v) => typeof v === 'boolean');
    mustBe('urgent', (v) => typeof v === 'boolean');
    mustBe('repeat_rule', (v) => typeof v === 'string' || (v !== null && typeof v === 'object'));
    mustBe('repeat', (v) => typeof v === 'string' || (v !== null && typeof v === 'object'));
    mustBe('time_model', (v) => typeof v === 'string');
    mustBe('time_zone', (v) => v === null || typeof v === 'string');
    mustBe('completed', (v) => typeof v === 'boolean');
    mustBe('snoozed_until', (v) => v === null || typeof v === 'string');
    mustBe('scope', (v) => typeof v === 'string');
    mustBe('occurrence_at', (v) => typeof v === 'string');
    requireBase(body);
  }
  async function guardEpoch(baseEpoch) {
    const epoch = await getStoreEpoch();
    if (epoch !== baseEpoch) {
      return { status: 409, body: { error: 'Store was restored since your read' } };
    }
    return null;
  }
  async function guardRevision(current, baseRevision) {
    if (current.revision === baseRevision) return null;
    const fresh = await loadReminder(current.id);
    return { status: 409, body: { error: 'Item changed since your read', reminder: fresh } };
  }
  // Occurrence precondition for write-profile complete/skip on recurring
  // series (closes the double-advance retry hazard). Returns a finished
  // response, or null to proceed. Recognition bypasses ONLY the revision
  // staleness check, never the epoch guard (checked before calling this).
  async function guardOccurrence(id, current, occurrenceAt, action) {
    const rule = parseRuleColumn(current.repeat_rule);
    if (!recurrence.isRecurringRule(rule) || !current.due_at) {
      return action === 'skip'
        ? { status: 400, body: { error: 'Only dated repeating items can skip an occurrence' } }
        : null;
    }
    if (occurrenceAt === undefined) {
      throw tokenWriteError(400, 'occurrence_at is required for this operation on a recurring item');
    }
    if (occurrenceAt === current.due_at) return null;
    const row = await db.get(
      'SELECT status FROM reminder_occurrences WHERE reminder_id = ? AND occurrence_at = ?',
      [id, occurrenceAt]
    );
    const recognized = action === 'complete'
      ? (row && row.status === 'completed')
      : (row && row.status === 'skipped');
    if (recognized) {
      return { status: 200, body: { ok: true, alreadyDone: true } };
    }
    const fresh = await loadReminder(id);
    return { status: 409, body: { error: 'Stale occurrence', currentDue: fresh ? fresh.due_at : current.due_at } };
  }

  async function writeReminderPatch(req, res, id) {
    const body = req.body || {};
    try {
      validateWritePatch(body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const key = idempotencyKeyFrom(req);
    if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required for API writes' });
    const route = `PATCH /api/reminders/${id}`;
    return runTokenWrite(req, res, {
      route, key, fingerprint: payloadFingerprint(body),
      execute: async () => {
        const current = await loadReminder(id);
        if (!current) return { status: 404, body: { error: 'Item not found' } };
        const epochGuard = await guardEpoch(body.base_epoch);
        if (epochGuard) return epochGuard;

        // Completing flows through the shared helper so browser, token,
        // and push actions advance recurring series identically.
        if (body.completed === true && !current.completed) {
          const occGuard = await guardOccurrence(id, current, body.occurrence_at, 'complete');
          if (occGuard) return occGuard;
          const revGuard = await guardRevision(current, body.base_revision);
          if (revGuard) return revGuard;
          try {
            const result = await completeReminder(id);
            const reminder = await loadReminder(id);
            return { status: 200, body: { ok: true, advanced: result.advanced || false, alreadyDone: result.alreadyDone || false, nextDue: result.nextDue || null, reminder }, reminderId: id };
          } catch (err) {
            return { status: err.status || 500, body: { error: err.message || 'Server error' } };
          }
        }
        if (body.completed === true && current.completed
          && !recurrence.isRecurringRule(parseRuleColumn(current.repeat_rule))) {
          // Already in the desired end state: idempotent no-op.
          return { status: 200, body: { ok: true, advanced: false, reminder: current }, reminderId: id };
        }

        const scope = body.scope === undefined ? 'series' : String(body.scope);
        if (scope !== 'series' && scope !== 'occurrence') {
          return { status: 400, body: { error: 'scope must be series or occurrence' } };
        }
        const currentRule = parseRuleColumn(current.repeat_rule);
        const recurring = recurrence.isRecurringRule(currentRule);

        if (scope === 'occurrence') {
          if (!recurring || !current.due_at) {
            return { status: 400, body: { error: 'Only dated repeating items have occurrences to edit' } };
          }
          const allowed = ['title', 'notes', 'list_id', 'urgent'];
          const provided = Object.keys(body).filter((k) => !['scope', 'base_revision', 'base_epoch'].includes(k));
          if (provided.some((k) => !allowed.includes(k))) {
            return { status: 400, body: { error: 'Date changes apply to the whole series — edit those with scope "series"' } };
          }
          if (!provided.length) return { status: 400, body: { error: 'Nothing to update' } };
          const revGuard = await guardRevision(current, body.base_revision);
          if (revGuard) return revGuard;
          const overrides = { title: null, notes: null, list_id: null, urgent: null };
          if (body.title !== undefined) {
            const title = text(body.title, 500);
            if (!title) return { status: 400, body: { error: 'Title is required' } };
            overrides.title = title;
          }
          if (body.notes !== undefined) overrides.notes = text(body.notes, NOTES_MAX);
          if (body.list_id !== undefined) {
            const list = await db.get("SELECT id FROM lists WHERE id = ? AND tenant = 'reminders'", [body.list_id]);
            if (!list) return { status: 400, body: { error: 'Choose a valid list' } };
            overrides.list_id = body.list_id;
          }
          if (body.urgent !== undefined) overrides.urgent = body.urgent ? 1 : 0;
          const now = new Date().toISOString();
          await db.run(`
            INSERT INTO reminder_occurrences (reminder_id, occurrence_at, status, title, notes, list_id, urgent, created_at)
            VALUES (?, ?, 'exception', ?, ?, ?, ?, ?)
            ON CONFLICT(reminder_id, occurrence_at) DO UPDATE SET
              status = 'exception', title = excluded.title, notes = excluded.notes,
              list_id = excluded.list_id, urgent = excluded.urgent
          `, [id, current.due_at, overrides.title, overrides.notes, overrides.list_id, overrides.urgent, now]);
          await db.run('UPDATE reminders SET updated_at = ?, revision = revision + 1 WHERE id = ?',
            [now, id]);
          const reminder = await loadReminder(id);
          return { status: 200, body: { ok: true, occurrenceEdited: true, reminder }, reminderId: id };
        }

        // Series edit: same surface as session callers.
        const revGuard = await guardRevision(current, body.base_revision);
        if (revGuard) return revGuard;
        const fields = [];
        const params = [];
        let dueChanged = false;
        if (body.title !== undefined) {
          const title = text(body.title, 500);
          if (!title) return { status: 400, body: { error: 'Title is required' } };
          fields.push('title = ?');
          params.push(title);
        }
        if (body.notes !== undefined) {
          fields.push('notes = ?');
          params.push(text(body.notes, NOTES_MAX));
        }
        if (body.list_id !== undefined) {
          const list = await db.get("SELECT id FROM lists WHERE id = ? AND tenant = 'reminders'", [body.list_id]);
          if (!list) return { status: 400, body: { error: 'Choose a valid list' } };
          fields.push('list_id = ?');
          params.push(body.list_id);
        }
        if (body.due_at !== undefined) {
          const dueAt = normalizeDate(body.due_at);
          if (dueAt === undefined) return { status: 400, body: { error: 'Invalid date' } };
          const hasTime = dueAt && body.has_time ? 1 : 0;
          fields.push('due_at = ?');
          params.push(dueAt);
          fields.push('has_time = ?');
          params.push(hasTime);
          fields.push('notified_at = NULL');
          fields.push('last_push_at = NULL');
          fields.push('push_count = 0');
          fields.push('snoozed_until = NULL');
          dueChanged = true;
        }
        if (body.urgent !== undefined) {
          fields.push('urgent = ?');
          params.push(body.urgent ? 1 : 0);
        }
        if (body.repeat_rule !== undefined || body.repeat !== undefined) {
          let rule;
          try {
            rule = recurrence.parseRepeatRule(body.repeat_rule ?? body.repeat ?? 'none');
          } catch (err) {
            return { status: err.status || 500, body: { error: err.message || 'Server error' } };
          }
          const settings = await getSettings();
          const zone = effectiveZoneFor({
            time_model: body.time_model !== undefined ? body.time_model : current.time_model,
            time_zone: body.time_zone !== undefined ? body.time_zone : current.time_zone,
          }, settings);
          const dueForAnchor = body.due_at !== undefined
            ? normalizeDate(body.due_at)
            : current.due_at;
          if (recurrence.isRecurringRule(rule)) {
            if (!dueForAnchor) return { status: 400, body: { error: 'Repeating items need a date' } };
            rule = recurrence.anchorRule(rule, dueForAnchor, zone);
          }
          fields.push('repeat_rule = ?');
          params.push(recurrence.encodeRepeatRule(rule));
        }
        if (body.time_model !== undefined) {
          const model = String(body.time_model);
          if (!TIME_MODELS.includes(model)) {
            return { status: 400, body: { error: 'time_model must be fixed, floating, or anchored' } };
          }
          const zone = body.time_zone !== undefined ? body.time_zone : current.time_zone;
          if (model === 'anchored' && !(typeof zone === 'string' && recurrence.isValidTimeZone(zone))) {
            return { status: 400, body: { error: 'Zone-anchored items need a valid time_zone' } };
          }
          fields.push('time_model = ?');
          params.push(model);
        }
        if (body.time_zone !== undefined) {
          const zone = body.time_zone === null || body.time_zone === '' ? null : String(body.time_zone);
          if (zone && !recurrence.isValidTimeZone(zone)) {
            return { status: 400, body: { error: 'Unknown time_zone' } };
          }
          fields.push('time_zone = ?');
          params.push(zone);
        }
        if (body.completed !== undefined) {
          const completed = body.completed ? 1 : 0;
          if (recurring && !completed) {
            return { status: 400, body: { error: 'Recurring items stay open — use Skip for an occurrence' } };
          }
          fields.push('completed = ?');
          params.push(completed);
          if (completed && !current.completed) {
            fields.push('completed_at = ?');
            params.push(new Date().toISOString());
          } else if (!completed) {
            fields.push('completed_at = NULL');
          }
        }
        if (body.snoozed_until !== undefined) {
          if (body.snoozed_until === null || body.snoozed_until === '') {
            fields.push('snoozed_until = NULL');
          } else {
            const until = new Date(body.snoozed_until);
            if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
              return { status: 400, body: { error: 'Snooze time must be in the future' } };
            }
            fields.push('snoozed_until = ?');
            params.push(until.toISOString());
            fields.push('notified_at = NULL');
            fields.push('last_push_at = NULL');
            fields.push('push_count = 0');
          }
        }
        if (!fields.length) return { status: 400, body: { error: 'Nothing to update' } };
        const now = new Date().toISOString();
        fields.push('updated_at = ?');
        params.push(now);
        fields.push('revision = revision + 1');
        params.push(id, body.base_revision);
        const updated = await db.run(
          `UPDATE reminders SET ${fields.join(', ')} WHERE id = ? AND revision = ?`, params);
        if (!updated.changes) {
          const fresh = await loadReminder(id);
          if (!fresh) return { status: 404, body: { error: 'Item not found' } };
          return { status: 409, body: { error: 'Item changed since your read', reminder: fresh } };
        }
        if (body.list_id !== undefined) {
          await db.run(
            "UPDATE attachments SET folder_id = ? WHERE owner_type = 'reminder' AND owner_id = ?",
            [body.list_id, id]
          );
        }
        const reminder = await loadReminder(id);
        return { status: 200, body: { ok: true, dueChanged, reminder }, reminderId: id };
      },
    });
  }

  app.patch('/api/reminders/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    if (req.token && (req.token.profile || 'legacy') === 'write') {
      return writeReminderPatch(req, res, id);
    }
    const current = await loadReminder(id);
    if (!current) return res.status(404).json({ error: 'Item not found' });

    // Legacy token scope: agents may only complete reminders through this endpoint.
    if (req.token) {
      const keys = Object.keys(req.body);
      if (req.body.completed !== true || keys.some((key) => key !== 'completed')) {
        return denyToken(res);
      }
    }

    // Completing flows through the shared helper so the browser, the token
    // API, and push actions all advance recurring series identically.
    if (req.body.completed === true && !current.completed) {
      try {
        const result = await completeReminder(id);
        return res.json({ ok: true, advanced: result.advanced || false, alreadyDone: result.alreadyDone || false, nextDue: result.nextDue || null });
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'Server error' });
      }
    }

    const scope = req.body.scope === undefined ? 'series' : String(req.body.scope);
    if (scope !== 'series' && scope !== 'occurrence') {
      return res.status(400).json({ error: 'scope must be series or occurrence' });
    }
    if (req.token && scope !== 'series') return denyToken(res);
    const currentRule = parseRuleColumn(current.repeat_rule);
    const recurring = recurrence.isRecurringRule(currentRule);

    if (scope === 'occurrence') {
      // "This occurrence only": store an exception for the current scheduled
      // occurrence. The series itself is untouched and keeps its rhythm.
      // Date changes always apply to the whole series (see hint in the UI).
      if (!recurring || !current.due_at) {
        return res.status(400).json({ error: 'Only dated repeating items have occurrences to edit' });
      }
      const allowed = ['title', 'notes', 'list_id', 'urgent'];
      // device_zone is a settings echo the client always saves alongside;
      // it is not an occurrence-readable field, so ignore it rather than
      // failing every "This occurrence" edit.
      const provided = Object.keys(req.body)
        .filter((key) => key !== 'scope' && key !== 'device_zone');
      if (provided.some((key) => !allowed.includes(key))) {
        return res.status(400).json({ error: 'Date changes apply to the whole series — edit those with scope "series"' });
      }
      if (!provided.length) return res.status(400).json({ error: 'Nothing to update' });
      const overrides = { title: null, notes: null, list_id: null, urgent: null };
      if (req.body.title !== undefined) {
        const title = text(req.body.title, 500);
        if (!title) return res.status(400).json({ error: 'Title is required' });
        overrides.title = title;
      }
      if (req.body.notes !== undefined) overrides.notes = text(req.body.notes, NOTES_MAX);
      if (req.body.list_id !== undefined) {
        const listId = parseId(req.body.list_id);
        const list = listId ? await db.get("SELECT id FROM lists WHERE id = ? AND tenant = 'reminders'", [listId]) : null;
        if (!list) return res.status(400).json({ error: 'Choose a valid list' });
        overrides.list_id = listId;
      }
      if (req.body.urgent !== undefined) overrides.urgent = req.body.urgent ? 1 : 0;
      const now = new Date().toISOString();
      await db.run(`
        INSERT INTO reminder_occurrences (reminder_id, occurrence_at, status, title, notes, list_id, urgent, created_at)
        VALUES (?, ?, 'exception', ?, ?, ?, ?, ?)
        ON CONFLICT(reminder_id, occurrence_at) DO UPDATE SET
          status = 'exception', title = excluded.title, notes = excluded.notes,
          list_id = excluded.list_id, urgent = excluded.urgent
      `, [id, current.due_at, overrides.title, overrides.notes, overrides.list_id, overrides.urgent, now]);
      await db.run('UPDATE reminders SET updated_at = ?, revision = revision + 1 WHERE id = ?',
        [now, id]);
      return res.json({ ok: true, occurrenceEdited: true });
    }

    const fields = [];
    const params = [];
    let dueChanged = false;

    if (req.body.title !== undefined) {
      const title = text(req.body.title, 500);
      if (!title) return res.status(400).json({ error: 'Title is required' });
      fields.push('title = ?');
      params.push(title);
    }

    if (req.body.notes !== undefined) {
      fields.push('notes = ?');
      params.push(text(req.body.notes, NOTES_MAX));
    }

    if (req.body.list_id !== undefined) {
      const listId = parseId(req.body.list_id);
      const list = listId ? await db.get("SELECT id FROM lists WHERE id = ? AND tenant = 'reminders'", [listId]) : null;
      if (!list) return res.status(400).json({ error: 'Choose a valid list' });
      fields.push('list_id = ?');
      params.push(listId);
    }

    if (req.body.due_at !== undefined) {
      const dueAt = normalizeDate(req.body.due_at);
      if (dueAt === undefined) return res.status(400).json({ error: 'Invalid date' });
      const hasTime = dueAt && req.body.has_time ? 1 : 0;
      fields.push('due_at = ?');
      params.push(dueAt);
      fields.push('has_time = ?');
      params.push(hasTime);
      // Re-arm the reminder so the new date can notify again.
      fields.push('notified_at = NULL');
      fields.push('last_push_at = NULL');
      fields.push('push_count = 0');
      fields.push('snoozed_until = NULL');
      dueChanged = true;
    }

    if (req.body.urgent !== undefined) {
      fields.push('urgent = ?');
      params.push(req.body.urgent ? 1 : 0);
    }

    if (req.body.repeat_rule !== undefined || req.body.repeat !== undefined) {
      let rule;
      try {
        rule = recurrence.parseRepeatRule(req.body.repeat_rule ?? req.body.repeat ?? 'none');
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'Server error' });
      }
      const settings = await getSettings();
      const zone = effectiveZoneFor({
        time_model: req.body.time_model !== undefined ? req.body.time_model : current.time_model,
        time_zone: req.body.time_zone !== undefined ? req.body.time_zone : current.time_zone,
      }, settings);
      const dueForAnchor = req.body.due_at !== undefined
        ? normalizeDate(req.body.due_at)
        : current.due_at;
      if (recurrence.isRecurringRule(rule)) {
        if (!dueForAnchor) return res.status(400).json({ error: 'Repeating items need a date' });
        rule = recurrence.anchorRule(rule, dueForAnchor, zone);
      }
      fields.push('repeat_rule = ?');
      params.push(recurrence.encodeRepeatRule(rule));
    }

    if (req.body.time_model !== undefined) {
      const model = String(req.body.time_model);
      if (!TIME_MODELS.includes(model)) return res.status(400).json({ error: 'time_model must be fixed, floating, or anchored' });
      const zone = req.body.time_zone !== undefined ? req.body.time_zone : current.time_zone;
      if (model === 'anchored' && !(typeof zone === 'string' && recurrence.isValidTimeZone(zone))) {
        return res.status(400).json({ error: 'Zone-anchored items need a valid time_zone' });
      }
      fields.push('time_model = ?');
      params.push(model);
    }

    if (req.body.time_zone !== undefined) {
      const zone = req.body.time_zone === null || req.body.time_zone === '' ? null : String(req.body.time_zone);
      if (zone && !recurrence.isValidTimeZone(zone)) {
        return res.status(400).json({ error: 'Unknown time_zone' });
      }
      fields.push('time_zone = ?');
      params.push(zone);
    }

    if (req.body.completed !== undefined) {
      const completed = req.body.completed ? 1 : 0;
      if (recurring && !completed) {
        return res.status(400).json({ error: 'Recurring items stay open — use Skip for an occurrence' });
      }
      fields.push('completed = ?');
      params.push(completed);
      if (completed && !current.completed) {
        fields.push('completed_at = ?');
        params.push(new Date().toISOString());
      } else if (!completed) {
        fields.push('completed_at = NULL');
      }
    }

    if (req.body.snoozed_until !== undefined) {
      if (req.body.snoozed_until === null || req.body.snoozed_until === '') {
        fields.push('snoozed_until = NULL');
      } else {
        const until = new Date(req.body.snoozed_until);
        if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
          return res.status(400).json({ error: 'Snooze time must be in the future' });
        }
        fields.push('snoozed_until = ?');
        params.push(until.toISOString());
        // Re-arm like /snooze does: a fired reminder keeps snoozing usefully.
        fields.push('notified_at = NULL');
        fields.push('last_push_at = NULL');
        fields.push('push_count = 0');
      }
    }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    fields.push('revision = revision + 1');
    params.push(id);
    await db.run(`UPDATE reminders SET ${fields.join(', ')} WHERE id = ?`, params);
    if (req.body.list_id !== undefined) {
      await db.run(
        "UPDATE attachments SET folder_id = ? WHERE owner_type = 'reminder' AND owner_id = ?",
        [parseId(req.body.list_id), id]
      );
    }
    res.json({ ok: true, dueChanged });
  });

  app.delete('/api/reminders/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid item' });
    const files = await db.all(
      "SELECT stored_name FROM attachments WHERE owner_type = 'reminder' AND owner_id = ?", [id]
    );
    const result = await db.run('DELETE FROM reminders WHERE id = ?', [id]);
    if (!result.changes) return res.status(404).json({ error: 'Item not found' });
    await removeStoredFiles(files);
    await db.run("DELETE FROM attachments WHERE owner_type = 'reminder' AND owner_id = ?", [id]);
    res.json({ ok: true });
  });

  app.post('/api/push/subscribe', async (req, res) => {
    const sub = req.body.subscription || {};
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    const now = new Date().toISOString();
    await db.run(`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
    `, [sub.endpoint, sub.keys.p256dh, sub.keys.auth, now]);
    // Items due within the last day stay un-notified so they still fire now
    // that a device exists; older backlog is stamped to avoid a flood.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await db.run(
      `UPDATE reminders SET notified_at = ? WHERE completed = 0 AND notified_at IS NULL
       AND due_at IS NOT NULL AND due_at <= ? AND due_at < ?`,
      [now, now, dayAgo]
    );
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', async (req, res) => {
    const endpoint = text(req.body.endpoint, 2000);
    if (!endpoint) return res.status(400).json({ error: 'Endpoint is required' });
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    res.json({ ok: true });
  });

  app.post('/api/push/test', async (req, res) => {
    const result = await push.sendToAll({
      title: 'Workspace',
      body: 'Notifications are working.',
      url: '/#/today',
      tag: 'todo-test',
    });
    res.json(result);
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Each file must be 25 MB or smaller'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Up to 10 files per upload'
          : 'Could not upload that file';
      return res.status(400).json({ error: message });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  app.listen(PORT, HOST, () => {
    console.log(`Workspace ${VERSION} listening on http://${HOST}:${PORT}`);
  });

  function inQuietHours(nowMs, zone, start, end) {
    // Quiet hours are wall-clock hours in the device zone (or UTC without
    // one). Ranges may wrap midnight, e.g. 23:00-07:00.
    let h;
    let mi;
    if (zone && recurrence.isValidTimeZone(zone)) {
      const w = recurrence.instantToWall(nowMs, zone);
      h = w.h;
      mi = w.mi;
    } else {
      const d = new Date(nowMs);
      h = d.getUTCHours();
      mi = d.getUTCMinutes();
    }
    const toMin = (s) => {
      const [hh, mm] = s.split(':').map(Number);
      return hh * 60 + mm;
    };
    const cur = h * 60 + mi;
    const from = toMin(start);
    const to = toMin(end);
    if (from === to) return false;
    return from < to ? cur >= from && cur < to : cur >= from || cur < to;
  }

  // Reminders more than this overdue never fire on their own: with no
  // subscriptions we leave them un-stamped instead of burying them, and this
  // cap keeps a later subscribe from replaying ancient history.
  const BACKLOG_CAP_DAYS = 7;

  let checkingDue = false;
  async function checkDueReminders() {
    if (checkingDue) return;
    checkingDue = true;
    try {
      const settings = await getSettings();
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const floor = new Date(nowMs - BACKLOG_CAP_DAYS * 24 * 3600 * 1000).toISOString();
      // Explicit snooze replaces the next alert time, not the task date.
      // Keep its expired value after firing: notified_at prevents another
      // first alert at the original due time; repeat pushes keep their cadence.
      const due = await db.all(`
        SELECT r.id, r.title, r.notes, r.list_id, r.due_at, r.notified_at,
               r.last_push_at, r.push_count, r.revision, l.name AS list_name
        FROM reminders r JOIN lists l ON l.id = r.list_id
        WHERE r.completed = 0 AND r.due_at IS NOT NULL
          AND COALESCE(r.snoozed_until, r.due_at) <= ?
          AND COALESCE(r.snoozed_until, r.due_at) >= ?
        ORDER BY COALESCE(r.snoozed_until, r.due_at) LIMIT 50
      `, [now, floor]);
      if (!due.length) return;

      const subscriptions = await db.get('SELECT COUNT(*) AS n FROM push_subscriptions');
      if (!subscriptions.n) {
        // No device to push to: do NOT stamp notified_at, so enabling
        // notifications later still delivers recently-due items.
        return;
      }
      const repushOn = settings.repush_enabled === '1';
      const cadenceMs = Number(settings.repush_cadence_min) * 60 * 1000;
      const repushMax = Number(settings.repush_max);
      const quiet = inQuietHours(nowMs,
        recurrence.isValidTimeZone(settings.device_zone) ? settings.device_zone : null,
        settings.quiet_start, settings.quiet_end);

      // Badge mirrors the app's updateBadge(): unfinished items due by end of
      // today in the last confirmed device zone (overdue included), excluding
      // items snoozed into the future (they rejoin the count when the snooze
      // fires). Sent with every push so the service worker can refresh the
      // icon badge without the app being opened.
      const badgeZone = recurrence.isValidTimeZone(settings.device_zone) ? settings.device_zone : null;
      const badgeWall = badgeZone ? recurrence.instantToWall(nowMs, badgeZone) : null;
      const badgeEnd = badgeWall
        ? new Date(new Date(recurrence.wallToInstant(badgeZone, { y: badgeWall.y, mo: badgeWall.mo, d: badgeWall.d, h: 23, mi: 59 })).getTime() + 59999).toISOString()
        : new Date(nowMs + 24 * 3600 * 1000).toISOString();
      const badgeRow = await db.get(
        'SELECT COUNT(*) AS n FROM reminders WHERE completed = 0 AND due_at IS NOT NULL AND due_at <= ? AND (snoozed_until IS NULL OR snoozed_until <= ?)',
        [badgeEnd, now]
      );
      const badgeCount = badgeRow ? badgeRow.n : 0;

      for (const reminder of due) {
        const firstFire = !reminder.notified_at;
        let repush = false;
        if (!firstFire && repushOn && (reminder.push_count || 0) < repushMax && !quiet) {
          const last = reminder.last_push_at ? new Date(reminder.last_push_at).getTime() : 0;
          repush = nowMs - last >= cadenceMs;
        }
        if (!firstFire && !repush) continue;
        if (firstFire && quiet) {
          // First fire during quiet hours still notifies once (missing a
          // deadline is worse than a buzz); only re-pushes stay silent.
        }
        const pushResult = await push.sendToAll({
          badge: badgeCount,
          title: reminder.title,
          body: reminder.notes || reminder.list_name,
          url: '/#/list/' + reminder.list_id,
          tag: 'reminder-' + reminder.id,
          reminderId: reminder.id,
          occurrence: reminder.due_at,
          sigComplete: await signPushAction(reminder.id, reminder.due_at, 'complete'),
          sigSnooze: await signPushAction(reminder.id, reminder.due_at, 'snooze'),
        });
        // Nothing delivered (all devices failed, or push is not ready): leave
        // notified_at NULL so the next tick retries. Dead 404/410 endpoints
        // are pruned by sendToAll; once none remain the no-subscriptions
        // guard above stops stamping, so a new device can still receive it.
        if (!pushResult || !pushResult.sent) continue;
        // Stamp only if the reminder is still on THIS occurrence: a slow
        // push loop can race the user re-arming or completing the item, and
        // an unconditional stamp would mark the NEXT occurrence as already
        // notified (it would then never fire with re-push off).
        await db.run(
          `UPDATE reminders SET notified_at = COALESCE(notified_at, ?),
             last_push_at = ?, push_count = COALESCE(push_count, 0) + 1
           WHERE id = ? AND due_at = ? AND revision = ? AND completed = 0`,
          [now, now, reminder.id, reminder.due_at, reminder.revision]
        );
      }
    } catch (err) {
      console.error('Due check failed:', err.message);
    } finally {
      checkingDue = false;
    }
  }

  checkDueReminders();
  setInterval(checkDueReminders, 15 * 1000);

  const purgeOldCompleted = () => purgeCompletedRetention().then((count) => {
    if (count) console.log(`Removed ${count} completed item(s) outside retention`);
  }).catch((err) => {
    console.error('Completed retention purge failed:', err.message);
  });
  purgeOldCompleted();
  setInterval(purgeOldCompleted, 24 * 60 * 60 * 1000);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
