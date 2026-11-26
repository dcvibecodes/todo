'use strict';

// Detects PDFs whose protection a rewrite would destroy: password encryption
// and digital signatures (including document timestamps). Optimizers such as
// Ghostscript pdfwrite rebuild the file, which drops both without any warning,
// so callers must store these PDFs exactly as uploaded.
//
// The check reads raw bytes only and never parses the PDF. It is deliberately
// biased toward "protected": a false positive just skips an optimization, while
// a false negative would silently destroy a signature or encryption.

const fs = require('fs');

// An /Encrypt entry lives in the trailer or in the cross-reference stream
// dictionary, both stored as plain text even in an encrypted file.
const ENCRYPT_PATTERN = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;
// A signature value dictionary always carries a /ByteRange of four integers.
const BYTE_RANGE_PATTERN = /\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+/;
const SIGNATURE_TYPE_PATTERN = /\/Type\s*\/(?:Sig|DocTimeStamp)\b|\/SubFilter\s*\/(?:adbe\.pkcs7\.(?:detached|sha1)|adbe\.x509\.rsa_sha1|ETSI\.(?:CAdES\.detached|RFC3161))/;

function inspectPdfBuffer(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '');
  return {
    encrypted: ENCRYPT_PATTERN.test(text),
    signed: BYTE_RANGE_PATTERN.test(text) || SIGNATURE_TYPE_PATTERN.test(text),
  };
}

// Resolves to { encrypted, signed, unreadable }. An unreadable file reports
// unreadable: true so the caller can fail safe and keep the original.
async function inspectPdfProtection(filePath) {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return { ...inspectPdfBuffer(buffer), unreadable: false };
  } catch {
    return { encrypted: false, signed: false, unreadable: true };
  }
}

// Optimization status suffix for a protected PDF, or '' when it is safe to
// rewrite. Used as `pdf:<suffix>` in attachments.optimization.
function protectionStatus(info) {
  if (!info) return '';
  if (info.encrypted) return 'skipped-encrypted';
  if (info.signed) return 'skipped-signed';
  if (info.unreadable) return 'skipped-protected';
  return '';
}

module.exports = { inspectPdfBuffer, inspectPdfProtection, protectionStatus };
