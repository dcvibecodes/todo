'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  inspectPdfBuffer,
  inspectPdfProtection,
  protectionStatus,
} = require('../pdf-protection');

const PLAIN_PDF = [
  '%PDF-1.4',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
  'trailer << /Root 1 0 R /Size 4 >>',
  '%%EOF',
].join('\n');

const SIGNED_PDF = PLAIN_PDF.replace(
  '%%EOF',
  '4 0 obj << /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached '
  + '/ByteRange [0 840 960 120] /Contents <00> >> endobj\n%%EOF'
);

const ENCRYPTED_PDF = PLAIN_PDF.replace(
  '/Size 4 >>',
  '/Size 4 /Encrypt 5 0 R /ID [<00><00>] >>'
);

function tempFile(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-protection-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents, 'latin1');
  return file;
}

test('a plain PDF is neither encrypted nor signed', () => {
  assert.deepEqual(inspectPdfBuffer(Buffer.from(PLAIN_PDF, 'latin1')), { encrypted: false, signed: false });
  assert.equal(protectionStatus({ encrypted: false, signed: false, unreadable: false }), '');
});

test('a PDF with a signature dictionary is signed even without a password', () => {
  const info = inspectPdfBuffer(Buffer.from(SIGNED_PDF, 'latin1'));
  assert.equal(info.signed, true);
  assert.equal(info.encrypted, false);
  assert.equal(protectionStatus(info), 'skipped-signed');
});

test('a PDF whose trailer names an /Encrypt dictionary is encrypted', () => {
  const info = inspectPdfBuffer(Buffer.from(ENCRYPTED_PDF, 'latin1'));
  assert.equal(info.encrypted, true);
  assert.equal(protectionStatus(info), 'skipped-encrypted');
});

test('an inline /Encrypt dictionary is detected too', () => {
  const inline = PLAIN_PDF.replace('/Size 4 >>', '/Size 4 /Encrypt << /Filter /Standard /V 4 >> >>');
  assert.equal(inspectPdfBuffer(Buffer.from(inline, 'latin1')).encrypted, true);
});

test('a document timestamp counts as a signature', () => {
  const stamped = PLAIN_PDF.replace('%%EOF', '4 0 obj << /Type /DocTimeStamp /SubFilter /ETSI.RFC3161 >> endobj\n%%EOF');
  assert.equal(inspectPdfBuffer(Buffer.from(stamped, 'latin1')).signed, true);
});

test('words like Encrypted or Signature in page text do not trigger the check', () => {
  const texty = PLAIN_PDF.replace('%%EOF', '(Encrypt this) (ByteRange) (Signature) Tj\n%%EOF');
  assert.deepEqual(inspectPdfBuffer(Buffer.from(texty, 'latin1')), { encrypted: false, signed: false });
});

test('inspectPdfProtection reads a file from disk', async () => {
  assert.deepEqual(await inspectPdfProtection(tempFile('plain.pdf', PLAIN_PDF)), { encrypted: false, signed: false, unreadable: false });
  assert.equal((await inspectPdfProtection(tempFile('signed.pdf', SIGNED_PDF))).signed, true);
  assert.equal((await inspectPdfProtection(tempFile('enc.pdf', ENCRYPTED_PDF))).encrypted, true);
});

test('an unreadable file fails safe so the original is kept', async () => {
  const info = await inspectPdfProtection(path.join(os.tmpdir(), 'pdf-protection-missing-file.pdf'));
  assert.equal(info.unreadable, true);
  assert.equal(protectionStatus(info), 'skipped-protected');
});

test('encrypted wins over signed when both are present', () => {
  assert.equal(protectionStatus({ encrypted: true, signed: true, unreadable: false }), 'skipped-encrypted');
});

test('a PDF encrypted by qpdf is detected (skipped when qpdf is not installed)', (t) => {
  let hasQpdf = true;
  try { execFileSync('qpdf', ['--version'], { stdio: 'ignore' }); } catch { hasQpdf = false; }
  if (!hasQpdf) return t.skip('qpdf is not installed');
  const source = tempFile('source.pdf', PLAIN_PDF);
  const output = path.join(path.dirname(source), 'locked.pdf');
  try {
    execFileSync('qpdf', ['--allow-weak-crypto', '--encrypt', 'user', 'owner', '128', '--', source, output], { stdio: 'ignore' });
  } catch {
    return t.skip('qpdf could not encrypt the sample');
  }
  assert.equal(inspectPdfBuffer(fs.readFileSync(output)).encrypted, true);
});
