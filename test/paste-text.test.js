'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePastedParagraphs } = require('../public/paste-text');

test('CRLF and CR are normalized before paragraph handling', () => {
  assert.equal(normalizePastedParagraphs('A\r\n\r\nB'), 'A\nB');
  assert.equal(normalizePastedParagraphs('A\r\rB'), 'A\nB');
});

test('a paragraph break becomes the same single break as one Enter', () => {
  assert.equal(normalizePastedParagraphs('First\n\nSecond'), 'First\nSecond');
  assert.equal(normalizePastedParagraphs('First\n\n\nSecond'), 'First\nSecond');
});

test('single newlines and the text around them are unchanged', () => {
  assert.equal(normalizePastedParagraphs('First\nSecond\nThird'), 'First\nSecond\nThird');
  assert.equal(normalizePastedParagraphs('  keep  spacing  '), '  keep  spacing  ');
});

test('blank leading and trailing lines are not dropped beyond the run collapse', () => {
  assert.equal(normalizePastedParagraphs('\n\nA\n\nB\n\n'), '\nA\nB\n');
});
