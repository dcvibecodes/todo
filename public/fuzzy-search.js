/* Shared typo-tolerant search matcher.
   Loaded as a plain script in the browser (window.TodoFuzzy) and required by
   server.js for /api/search, so online and offline results use one algorithm. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TodoFuzzy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

  function normalize(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function words(value) {
    return value ? value.split(WORD_SPLIT).filter(Boolean) : [];
  }

  function tokens(value) {
    return words(normalize(value));
  }

  // 1–2 characters are too ambiguous to fuzzy-match: they must appear as text.
  function maxEditsFor(length) {
    if (length <= 2) return 0;
    if (length <= 7) return 1;
    return 2;
  }

  // Damerau-Levenshtein (optimal string alignment) with an early cutoff.
  // A transposition counts as one edit, so "meetign" is distance 1 from
  // "meeting" instead of 2.
  function distance(a, b, max) {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    if (Math.abs(la - lb) > max) return max + 1;

    let prev2 = null;
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j += 1) prev[j] = j;

    for (let i = 1; i <= la; i += 1) {
      curr[0] = i;
      let rowMin = i;
      for (let j = 1; j <= lb; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          value = Math.min(value, prev2[j - 2] + 1);
        }
        curr[j] = value;
        if (value < rowMin) rowMin = value;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = curr;
      curr = new Array(lb + 1);
    }
    return prev[lb];
  }

  // One textual field, prepared lazily: long notes only pay for word splitting
  // when a query word is not found as literal text.
  function prepare(value) {
    const text = normalize(value);
    let wordList = null;
    return {
      text,
      words() {
        if (!wordList) wordList = words(text);
        return wordList;
      },
    };
  }

  // 16 = exact word, 14 = word prefix, 10 = substring, 8/6 = fuzzy by edits.
  function scoreToken(field, token) {
    if (!field.text) return 0;
    if (field.text.indexOf(token) !== -1) {
      const wordList = field.words();
      if (wordList.indexOf(token) !== -1) return 16;
      for (const word of wordList) {
        if (word.length > token.length && word.startsWith(token)) return 14;
      }
      return 10;
    }
    const max = maxEditsFor(token.length);
    if (!max) return 0;
    let best = 0;
    for (const word of field.words()) {
      if (Math.abs(word.length - token.length) > max) continue;
      const edits = distance(token, word, max);
      if (edits === 0) return 16;
      if (edits <= max) best = Math.max(best, 10 - edits * 2);
    }
    return best;
  }

  function matchPrepared(reminder, phrase, queryTokens) {
    const title = prepare(reminder.title);
    const notes = prepare(reminder.notes);
    let score = 0;

    for (const token of queryTokens) {
      const inTitle = scoreToken(title, token);
      const inNotes = scoreToken(notes, token);
      const best = Math.max(inTitle, inNotes);
      if (!best) return null;
      // Title matches win ties so the most visible hit ranks first.
      score += best + (inTitle >= inNotes && inTitle ? 2 : 0);
    }

    // Keep the old exact-phrase behaviour at the top of the list.
    if (phrase && title.text.indexOf(phrase) !== -1) score += 24;
    else if (phrase && notes.text.indexOf(phrase) !== -1) score += 12;
    return score;
  }

  function matchOne(reminder, query) {
    if (!reminder) return null;
    const phrase = normalize(query).trim();
    const queryTokens = tokens(phrase);
    if (!queryTokens.length) {
      // Punctuation-only queries keep the previous literal-substring behaviour.
      if (!phrase) return null;
      return prepare(reminder.title).text.indexOf(phrase) !== -1
        || prepare(reminder.notes).text.indexOf(phrase) !== -1
        ? 10
        : null;
    }
    return matchPrepared(reminder, phrase, queryTokens);
  }

  // Best matches first; equal scores keep the caller's existing order (the
  // SQL query already returns lists by sort_order and completed by newest).
  function rank(reminders, query) {
    const phrase = normalize(query).trim();
    const queryTokens = tokens(phrase);
    const scored = [];
    for (const reminder of reminders || []) {
      let score;
      if (!queryTokens.length) {
        if (!phrase) continue;
        score = prepare(reminder.title).text.indexOf(phrase) !== -1
          || prepare(reminder.notes).text.indexOf(phrase) !== -1
          ? 10
          : null;
      } else {
        score = matchPrepared(reminder, phrase, queryTokens);
      }
      if (score != null) scored.push({ reminder, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  return { normalize, tokens, distance, matchOne, rank };
});
