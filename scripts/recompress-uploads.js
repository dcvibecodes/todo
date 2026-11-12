'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
process.env.DATA_DIR = DATA_DIR;
const db = require('../db');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const IMAGE_MAX_EDGE = 2200;
const FIRST_IMAGE_QUALITY = 75;
const SECOND_IMAGE_QUALITY = 80;
const PNG_QUALITY = 80;
const PDF_IMAGE_DPI = 130;
const PDF_MONO_DPI = 260;
const IMAGE_MIN_SAVINGS = 0.08;
const PDF_MIN_SAVINGS = 0.03;
const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRMED = process.argv.includes('--confirm');
const REPORT_ARG = process.argv.find((arg) => arg.startsWith('--report='));
const REPORT_PATH = REPORT_ARG ? REPORT_ARG.slice('--report='.length) : null;

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout, stderr });
    });
  });
}

function kindFor(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg';
  if (ext === '.png') return 'png';
  if (ext === '.webp') return 'webp';
  if (ext === '.pdf') return 'pdf';
  return null;
}

function isSecondPass(optimization) {
  return /(?:image:optimized|heic:converted|pdf:optimized)(?!-v2)/.test(optimization || '');
}

function signatureMatches(buffer, kind) {
  if (!buffer || !buffer.length) return false;
  if (kind === 'jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (kind === 'png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === 'webp') return buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP';
  if (kind === 'pdf') return buffer.toString('latin1', 0, 5) === '%PDF-';
  return false;
}

async function replaceIfSmaller(original, temp, kind, minSavings) {
  const [before, after] = await Promise.all([fs.promises.stat(original), fs.promises.stat(temp)]);
  if (after.size > 0 && after.size < before.size * (1 - minSavings)) {
    await fs.promises.rename(temp, original);
    return after.size;
  }
  await fs.promises.unlink(temp).catch(() => {});
  return null;
}

async function optimizeImage(filePath, kind, secondPass) {
  const ext = path.extname(filePath).toLowerCase();
  const temp = `${filePath}.recompress-${crypto.randomUUID()}${ext}`;
  const command = process.env.IMAGEMAGICK_BIN || 'convert';
  const quality = kind === 'png' ? PNG_QUALITY : (secondPass ? SECOND_IMAGE_QUALITY : FIRST_IMAGE_QUALITY);
  const args = [
    '-limit', 'area', '60000000',
    '-limit', 'memory', '256MiB',
    '-limit', 'map', '512MiB',
    filePath,
    '-auto-orient',
    '-resize', `${IMAGE_MAX_EDGE}x${IMAGE_MAX_EDGE}>`,
    '+profile', '!icc,*',
  ];
  if (kind === 'png') {
    args.push('-colors', '256', '-dither', 'FloydSteinberg', '-quality', String(PNG_QUALITY), '-define', 'png:compression-level=9');
  } else if (kind === 'jpeg') {
    args.push('-quality', String(quality), '-sampling-factor', '4:2:0', '-interlace', 'Plane');
  } else if (kind === 'webp') {
    args.push('-quality', String(quality));
  }
  args.push(temp);
  try {
    await execFileAsync(command, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const head = await fs.promises.readFile(temp);
    if (!signatureMatches(head, kind)) throw new Error('output signature mismatch');
    return await replaceIfSmaller(filePath, temp, kind, IMAGE_MIN_SAVINGS);
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => {});
    throw err;
  }
}

async function optimizePdf(filePath) {
  const temp = `${filePath}.recompress-${crypto.randomUUID()}.pdf`;
  const command = process.env.GHOSTSCRIPT_BIN || 'gs';
  const args = [
    '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    '-dPDFSETTINGS=/ebook',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    `-dColorImageResolution=${PDF_IMAGE_DPI}`,
    `-dGrayImageResolution=${PDF_IMAGE_DPI}`,
    `-dMonoImageResolution=${PDF_MONO_DPI}`,
    `-sOutputFile=${temp}`,
    filePath,
  ];
  try {
    await execFileAsync(command, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const head = await fs.promises.readFile(temp);
    if (!signatureMatches(head, 'pdf')) throw new Error('output signature mismatch');
    return await replaceIfSmaller(filePath, temp, 'pdf', PDF_MIN_SAVINGS);
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => {});
    throw err;
  }
}

async function main() {
  if (!DRY_RUN && !CONFIRMED) {
    console.error('Refusing to modify uploads without --confirm (use --dry-run to preview).');
    process.exitCode = 1;
    return;
  }
  await db.init();
  const rows = await db.all(
    `SELECT id, name, stored_name, size, stored_size, original_size, optimization
     FROM attachments ORDER BY id`
  );
  const report = { dryRun: DRY_RUN, started: new Date().toISOString(), files: [] };
  let replaced = 0;
  let saved = 0;
  for (const row of rows) {
    const kind = kindFor(row.name);
    if (!kind) continue;
    if (row.optimization === 'image:disabled' || row.optimization === 'pdf:disabled') continue;
    if (row.optimization === 'image:skipped-invalid' || row.optimization === 'pdf:skipped-small') continue;
    if (row.optimization && row.optimization.endsWith('-v2')) continue;
    const filePath = path.join(UPLOAD_DIR, row.stored_name);
    const before = await fs.promises.stat(filePath).catch(() => null);
    if (!before) {
      report.files.push({ id: row.id, name: row.name, status: 'missing' });
      continue;
    }
    if (kind === 'pdf' && before.size < 50 * 1024) {
      report.files.push({ id: row.id, name: row.name, status: 'skipped-small', before: before.size });
      continue;
    }
    if (kind !== 'pdf' && before.size < 1024) {
      report.files.push({ id: row.id, name: row.name, status: 'skipped-small', before: before.size });
      continue;
    }
    const secondPass = isSecondPass(row.optimization);
    try {
      const after = kind === 'pdf'
        ? await (DRY_RUN ? dryRunPdf(filePath) : optimizePdf(filePath))
        : await (DRY_RUN ? dryRunCandidate(filePath, kind, secondPass) : optimizeImage(filePath, kind, secondPass));
      if (!after) {
        report.files.push({ id: row.id, name: row.name, status: 'kept', before: before.size, secondPass });
        continue;
      }
      const storedAfter = DRY_RUN ? after : after;
      if (!DRY_RUN) {
        const optimization = kind === 'pdf' ? 'pdf:optimized-v2'
          : (row.optimization && row.optimization.startsWith('heic:') ? 'heic:converted-v2' : 'image:optimized-v2');
        await db.run('UPDATE attachments SET stored_size = ?, optimization = ? WHERE id = ?', [storedAfter, optimization, row.id]);
      }
      replaced += 1;
      saved += before.size - storedAfter;
      report.files.push({ id: row.id, name: row.name, status: 'optimized', before: before.size, after: storedAfter, secondPass });
      console.log(`${DRY_RUN ? '[dry] ' : ''}${row.name}: ${before.size} -> ${storedAfter} (${secondPass ? 'second pass' : 'first pass'})`);
    } catch (err) {
      report.files.push({ id: row.id, name: row.name, status: 'error', before: before.size, error: err.message });
      console.warn(`Skipped ${row.name}: ${err.message}`);
    }
  }
  const total = await db.get('SELECT COALESCE(SUM(COALESCE(stored_size, size)), 0) AS bytes FROM attachments');
  report.finished = new Date().toISOString();
  report.replaced = replaced;
  report.saved = saved;
  report.storageBytes = total.bytes;
  if (REPORT_PATH) await fs.promises.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Done. ${DRY_RUN ? 'Would replace' : 'Replaced'} ${replaced} files; ${DRY_RUN ? 'would save' : 'saved'} ${saved} bytes. Stored total: ${total.bytes}.`);
  db.db.close();
}

async function dryRunPdf(filePath) {
  const temp = `${filePath}.recompress-${crypto.randomUUID()}.pdf`;
  const command = process.env.GHOSTSCRIPT_BIN || 'gs';
  const args = [
    '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook',
    '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true',
    `-dColorImageResolution=${PDF_IMAGE_DPI}`, `-dGrayImageResolution=${PDF_IMAGE_DPI}`,
    `-dMonoImageResolution=${PDF_MONO_DPI}`, `-sOutputFile=${temp}`, filePath,
  ];
  try {
    await execFileAsync(command, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const before = await fs.promises.stat(filePath);
    const after = await fs.promises.stat(temp);
    const head = await fs.promises.readFile(temp);
    if (!signatureMatches(head, 'pdf')) throw new Error('output signature mismatch');
    return after.size < before.size * (1 - PDF_MIN_SAVINGS) ? after.size : null;
  } finally {
    await fs.promises.unlink(temp).catch(() => {});
  }
}

async function dryRunCandidate(filePath, kind, secondPass) {
  const ext = path.extname(filePath).toLowerCase();
  const temp = `${filePath}.recompress-${crypto.randomUUID()}${ext}`;
  const command = process.env.IMAGEMAGICK_BIN || 'convert';
  const quality = kind === 'png' ? PNG_QUALITY : (secondPass ? SECOND_IMAGE_QUALITY : FIRST_IMAGE_QUALITY);
  const args = [
    '-limit', 'area', '60000000', '-limit', 'memory', '256MiB', '-limit', 'map', '512MiB',
    filePath, '-auto-orient', '-resize', `${IMAGE_MAX_EDGE}x${IMAGE_MAX_EDGE}>`, '+profile', '!icc,*',
  ];
  if (kind === 'png') args.push('-colors', '256', '-dither', 'FloydSteinberg', '-quality', String(PNG_QUALITY), '-define', 'png:compression-level=9');
  else if (kind === 'jpeg') args.push('-quality', String(quality), '-sampling-factor', '4:2:0', '-interlace', 'Plane');
  else if (kind === 'webp') args.push('-quality', String(quality));
  args.push(temp);
  try {
    await execFileAsync(command, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const before = await fs.promises.stat(filePath);
    const after = await fs.promises.stat(temp);
    const head = await fs.promises.readFile(temp);
    if (!signatureMatches(head, kind)) throw new Error('output signature mismatch');
    return after.size < before.size * (1 - (kind === 'pdf' ? PDF_MIN_SAVINGS : IMAGE_MIN_SAVINGS)) ? after.size : null;
  } finally {
    await fs.promises.unlink(temp).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
