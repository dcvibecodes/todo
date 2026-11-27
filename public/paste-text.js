'use strict';

(function (root) {
  function normalizeNewlines(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Convert clipboard/dictation plain text into editor HTML. A single newline
  // stays a soft line break; a blank line becomes a real empty paragraph, so
  // pasted paragraphs keep the same boundaries as pressing Enter. Text without
  // newlines stays inline (no paragraph wrapper).
  function textToHtml(text) {
    const lf = normalizeNewlines(text);
    if (!lf) return '';
    if (!lf.includes('\n')) return escapeHtml(lf);
    if (!/\n{2,}/.test(lf)) return escapeHtml(lf).replace(/\n/g, '<br>');
    const parts = [];
    let paragraph = [];
    const flush = () => {
      if (!paragraph.length) return;
      parts.push(`<p>${paragraph.map(escapeHtml).join('<br>')}</p>`);
      paragraph = [];
    };
    for (const line of lf.split('\n')) {
      if (line === '') {
        flush();
        parts.push('<p><br></p>');
      } else {
        paragraph.push(line);
      }
    }
    flush();
    return parts.join('');
  }

  // Kept for callers that only need newline normalization.
  function normalizePastedParagraphs(text) {
    return normalizeNewlines(text);
  }

  const api = { normalizeNewlines, normalizePastedParagraphs, textToHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorkspacePasteText = api;
})(typeof window !== 'undefined' ? window : null);
