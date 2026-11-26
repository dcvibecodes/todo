'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fuzzy = require('../public/fuzzy-search');

const NOTE_KEYS = { title: 'title', notes: 'body' };
const DOC_KEYS = { title: 'name' };

test('notes match when the query uses spaces and the title uses a hyphen', () => {
  const notes = [{ id: 1, title: 'one word-second word', body: '' }];
  const matches = fuzzy.rankItems(notes, 'one word second word', NOTE_KEYS);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].item.id, 1);
});

test('notes match when the query uses a hyphen and the title uses spaces', () => {
  const notes = [{ id: 1, title: 'one word second word', body: '' }];
  const matches = fuzzy.rankItems(notes, 'one-word-second-word', NOTE_KEYS);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].item.id, 1);
});

test('notes search the body as well as the title', () => {
  const notes = [{ id: 1, title: 'Unrelated', body: 'one word-second word' }];
  const matches = fuzzy.rankItems(notes, 'one word second word', NOTE_KEYS);
  assert.equal(matches.length, 1);
});

test('a one-word typo still matches a note title and body', () => {
  const notes = [
    { id: 1, title: 'one word-second word', body: '' },
    { id: 2, title: 'Unrelated', body: 'one word-second word' },
  ];
  const matches = fuzzy.rankItems(notes, 'secnod', NOTE_KEYS);
  assert.deepEqual(matches.map((entry) => entry.item.id).sort(), [1, 2]);
});

test('documents match across hyphen/space differences in the name', () => {
  const docs = [{ id: 1, name: 'one word second word.txt' }];
  assert.equal(fuzzy.rankItems(docs, 'one-word-second-word', DOC_KEYS).length, 1);
  assert.equal(fuzzy.rankItems([{ id: 2, name: 'one word-second word.txt' }], 'one word second word', DOC_KEYS).length, 1);
});

test('a one-word typo still matches a document name', () => {
  const docs = [{ id: 1, name: 'one word second word.txt' }];
  assert.equal(fuzzy.rankItems(docs, 'secnod', DOC_KEYS).length, 1);
});

test('document contents stay out of scope; only the name is searched', () => {
  const docs = [{ id: 1, name: 'unrelated.txt', body: 'one word-second word' }];
  assert.equal(fuzzy.rankItems(docs, 'one word second word', DOC_KEYS).length, 0);
});

test('reminders keep the existing fuzzy behaviour', () => {
  const reminders = [{ id: 1, title: 'one word-second word', notes: '' }];
  const matches = fuzzy.rank(reminders, 'one word second word');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].reminder.id, 1);
});

// ---- Relevance ranking and spacing (Form 16 search) ----

const FORM16_DOCS = [
  { id: 1, name: '2018-03 Form 16 FY2017-18 Maersk (Part A and B).pdf' },
  { id: 2, name: '2026-03-31 Form 16 FY2025-26 Altisource.pdf' },
  { id: 3, name: '2014-03-31 Form 16 FY2013-14 Altisource Part A.pdf' },
  { id: 4, name: '2015-03 Form 16 FY2014-15 Altisource.pdf' },
  { id: 5, name: 'Health report.pdf' },
];

function docIds(query) {
  return fuzzy.rankItems(FORM16_DOCS, query, { title: 'name', tieBreak: fuzzy.docTieBreak })
    .map((entry) => entry.item.id);
}

test('"Form16", "Form 16" and "Form-16" find the same documents', () => {
  const expected = docIds('Form 16');
  assert.deepEqual([...expected].sort(), [1, 2, 3, 4]);
  assert.deepEqual([...docIds('Form16')].sort(), [1, 2, 3, 4]);
  assert.deepEqual([...docIds('form-16')].sort(), [1, 2, 3, 4]);
});

test('equal-score documents list the newest dated name first', () => {
  assert.deepEqual(docIds('Form 16'), [2, 1, 4, 3]);
});

test('a short or numeric query word does not match inside body text', () => {
  const reminders = [
    { id: 1, title: 'Movie: Sing Sing', notes: 'Release checked 16 Nov 2026. More information about the format.' },
    { id: 2, title: 'Pay property tax', notes: 'form 16 attached' },
  ];
  const ids = fuzzy.rank(reminders, 'Form 16').map((entry) => entry.reminder.id);
  assert.deepEqual(ids, [2]);
});

test('a title hit outranks a body-only hit for the same words', () => {
  const reminders = [
    { id: 1, title: 'Unrelated', notes: 'Please send the form 16 copy' },
    { id: 2, title: 'Form 16 download', notes: '' },
  ];
  const ranked = fuzzy.rank(reminders, 'form 16');
  assert.deepEqual(ranked.map((entry) => entry.reminder.id), [2, 1]);
  assert.ok(ranked[0].score - ranked[1].score >= 20, 'title hit must lead by a clear margin');
});

test('codes and years must match exactly; one changed digit is a different year', () => {
  const docs = [{ id: 1, name: '2019-03-31 Form 16 FY2018-19.pdf' }];
  assert.equal(fuzzy.rankItems(docs, 'form 16 FY2014', DOC_KEYS).length, 0);
  assert.equal(fuzzy.rankItems(docs, 'form 16 FY2018', DOC_KEYS).length, 1);
});

test('"form 16 FY2014" puts the FY2014-15 file first', () => {
  assert.equal(docIds('form 16 FY2014')[0], 4);
});

test('long words still match in body text and tolerate a typo', () => {
  const notes = [{ id: 1, title: 'Unrelated', body: 'Choline intake during pregnancy' }];
  assert.equal(fuzzy.rankItems(notes, 'choline', NOTE_KEYS).length, 1);
  assert.equal(fuzzy.rankItems(notes, 'pregnnacy', NOTE_KEYS).length, 1);
});

test('a plain word that appears only in titles still finds those titles first', () => {
  const reminders = [
    { id: 1, title: 'Unrelated', notes: 'mentions Sing Sing in passing' },
    { id: 2, title: 'Sing Sing, the 2024 prison drama', notes: '' },
  ];
  assert.equal(fuzzy.rank(reminders, 'sing sing')[0].reminder.id, 2);
});

test('docDateKey reads a leading year-month or year-month-day', () => {
  assert.equal(fuzzy.docDateKey('2026-03-31 Form 16.pdf'), '2026-03-31');
  assert.equal(fuzzy.docDateKey('2018-03 Form 16.pdf'), '2018-03');
  assert.equal(fuzzy.docDateKey('Health report.pdf'), '');
});

test('"Form16", "Form-16" and "Form 16" score every Form 16 title the same', () => {
  const titles = ['2010-03-31 Form 16.pdf', '2024-03-31 Form16.pdf', '2021-03-31 Form-16 Part B.pdf'];
  for (const title of titles) {
    const scores = ['Form 16', 'Form16', 'form-16'].map((query) => fuzzy.matchOne({ title, notes: '' }, query));
    assert.ok(scores.every((score) => score > 0), `${title}: ${scores}`);
    assert.equal(new Set(scores).size, 1, `${title}: ${scores}`);
  }
});

test('newest year first across spaced, hyphenated and compact spellings', () => {
  const docs = [
    { id: 1, name: '2010-03-31 Form 16.pdf' },
    { id: 2, name: '2024-03-31 Form16.pdf' },
    { id: 3, name: '2021-03-31 Form-16 Part B.pdf' },
    { id: 4, name: '2023-03-31 Form 16.pdf' },
    { id: 5, name: 'Bank statement march.pdf' },
  ];
  for (const query of ['Form 16', 'Form16', 'form-16']) {
    const ranked = fuzzy.rankItems(docs, query, { title: 'name', tieBreak: fuzzy.docTieBreak });
    assert.deepEqual(ranked.map((row) => row.item.id), [2, 4, 3, 1], query);
  }
});
