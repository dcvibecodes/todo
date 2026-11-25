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
