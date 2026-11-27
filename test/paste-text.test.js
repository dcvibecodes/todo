'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePastedParagraphs, textToHtml } = require('../public/paste-text');

test('CRLF and CR are normalized before insertion', () => {
  assert.equal(normalizePastedParagraphs('A\r\n\r\nB'), 'A\n\nB');
  assert.equal(normalizePastedParagraphs('A\r\rB'), 'A\n\nB');
});

test('a blank line becomes a real empty paragraph, never a bare text node', () => {
  assert.equal(textToHtml('First\n\nSecond'), '<p>First</p><p><br></p><p>Second</p>');
  assert.equal(textToHtml('First\n\n\nSecond'), '<p>First</p><p><br></p><p><br></p><p>Second</p>');
});

test('single newlines stay soft line breaks inside one paragraph', () => {
  assert.equal(textToHtml('First\nSecond\nThird'), 'First<br>Second<br>Third');
  assert.equal(textToHtml('First\n\nSecond\nThird'), '<p>First</p><p><br></p><p>Second<br>Third</p>');
});

test('paragraph boundaries survive leading and trailing blank lines', () => {
  assert.equal(textToHtml('\n\nA\n\nB\n\n'),
    '<p><br></p><p><br></p><p>A</p><p><br></p><p>B</p><p><br></p><p><br></p>');
});

test('clipboard text is HTML-escaped', () => {
  assert.equal(textToHtml('a < b & c > d "quote"'), 'a &lt; b &amp; c &gt; d &quot;quote&quot;');
});

test('text without newlines stays inline', () => {
  assert.equal(textToHtml('plain text'), 'plain text');
  assert.equal(textToHtml('  keep  spacing  '), '  keep  spacing  ');
  assert.equal(textToHtml(''), '');
});
