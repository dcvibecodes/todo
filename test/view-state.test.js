'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const viewState = require('../public/view-state');

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

test('route paths round-trip through the internal view keys', () => {
  assert.equal(viewState.viewKeyForPath('list/12'), 12);
  assert.equal(viewState.viewKeyForPath('notes/folder/7'), 'notes-folder-7');
  assert.equal(viewState.viewKeyForPath('docs/folder/9'), 'docs-folder-9');
  assert.equal(viewState.viewPathFor(12), 'list/12');
  assert.equal(viewState.viewPathFor('notes-folder-7'), 'notes/folder/7');
  assert.equal(viewState.viewPathFor('docs-folder-9'), 'docs/folder/9');
});

test('the restore key is kept per tenant and updated on navigation', () => {
  const storage = memoryStorage();
  viewState.rememberView(storage, 'list/12', 'reminders');
  viewState.rememberView(storage, 'notes-folder-7', 'notes');
  assert.deepEqual(viewState.readLastViews(storage), {
    reminders: 'list/12',
    notes: 'notes/folder/7',
  });
  assert.equal(viewState.lastPathForTenant(storage, 'reminders'), 'list/12');
  assert.equal(viewState.lastPathForTenant(storage, 'notes'), 'notes/folder/7');
});

test('a stored view from another tenant is ignored', () => {
  const storage = memoryStorage();
  viewState.rememberView(storage, 'notes-folder-7', 'notes');
  assert.equal(viewState.storedPathForTenant(storage, 'reminders'), null);
  assert.equal(viewState.lastPathForTenant(storage, 'reminders'), 'all');
});

test('tenants without a stored view fall back to their All view', () => {
  const storage = memoryStorage();
  assert.equal(viewState.lastPathForTenant(storage, 'reminders'), 'all');
  assert.equal(viewState.lastPathForTenant(storage, 'notes'), 'notes');
  assert.equal(viewState.lastPathForTenant(storage, 'docs'), 'docs');
});

test('home is stored per tenant for mobile restore but ignored by the desktop path', () => {
  const storage = memoryStorage();
  viewState.rememberView(storage, 'docs-folder-9', 'docs');
  viewState.rememberView(storage, 'home', 'docs');
  assert.deepEqual(viewState.readLastViews(storage), { docs: 'home' });
  assert.equal(viewState.storedPathForTenant(storage, 'docs'), 'home');
  assert.equal(viewState.lastPathForTenant(storage, 'docs'), 'docs');

  viewState.rememberView(storage, 'list/12', 'reminders');
  viewState.rememberView(storage, 'home', 'reminders');
  assert.equal(viewState.storedPathForTenant(storage, 'reminders'), 'home');
  assert.equal(viewState.lastPathForTenant(storage, 'reminders'), 'all');
});

test('the desktop split breakpoint is 900px', () => {
  assert.equal(viewState.isSplitWidth(899), false);
  assert.equal(viewState.isSplitWidth(900), true);
});
