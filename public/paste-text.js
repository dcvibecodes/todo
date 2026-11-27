'use strict';

(function (root) {
  function normalizePastedParagraphs(text) {
    const lf = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    return lf.replace(/\n{2,}/g, '\n');
  }

  const api = { normalizePastedParagraphs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorkspacePasteText = api;
})(typeof window !== 'undefined' ? window : null);
