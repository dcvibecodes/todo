/* Shared view/route persistence helpers.
   Loaded as a plain script in the browser (window.TodoViewState) and required
   by the node:test suite, so the last-view restore rules are testable without
   booting the whole UI. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TodoViewState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TENANTS = ['reminders', 'notes', 'docs'];
  const LAST_VIEW_KEY = 'todo.lastView';
  const SPLIT_BREAKPOINT = 900;

  function normalizeTenant(tenant) {
    return TENANTS.includes(tenant) ? tenant : 'reminders';
  }

  function isSplitWidth(width) {
    return Number(width) >= SPLIT_BREAKPOINT;
  }

  function viewKeyForPath(path) {
    const raw = String(path);
    if (raw.startsWith('list/')) return Number(raw.slice(5));
    if (raw.startsWith('notes/folder/')) return 'notes-folder-' + raw.slice(13);
    if (raw.startsWith('docs/folder/')) return 'docs-folder-' + raw.slice(12);
    return raw;
  }

  function viewPathFor(view) {
    if (typeof view === 'number') return 'list/' + view;
    const raw = String(view);
    if (raw.startsWith('notes-folder-')) return 'notes/folder/' + raw.slice(13);
    if (raw.startsWith('docs-folder-')) return 'docs/folder/' + raw.slice(12);
    return raw;
  }

  function routeTenant(view, currentTenant) {
    if (view === 'notes' || String(view).startsWith('notes-folder-')) return 'notes';
    if (view === 'docs' || String(view).startsWith('docs-folder-')) return 'docs';
    if (view === 'home') return normalizeTenant(currentTenant);
    return 'reminders';
  }

  function defaultPathForTenant(tenant) {
    if (tenant === 'notes') return 'notes';
    if (tenant === 'docs') return 'docs';
    return 'all';
  }

  function readLastViews(storage) {
    try {
      const raw = JSON.parse(storage.getItem(LAST_VIEW_KEY) || '{}');
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  function rememberView(storage, view, currentTenant) {
    if (view === 'home') return readLastViews(storage);
    const tenant = routeTenant(view, currentTenant);
    const path = viewPathFor(view);
    const views = readLastViews(storage);
    if (views[tenant] === path) return views;
    views[tenant] = path;
    storage.setItem(LAST_VIEW_KEY, JSON.stringify(views));
    return views;
  }

  function storedPathForTenant(storage, tenant, currentTenant) {
    const views = readLastViews(storage);
    const path = views[tenant];
    if (!path) return null;
    const key = viewKeyForPath(path);
    if (key === 'home' || routeTenant(key, currentTenant) !== tenant) return null;
    return path;
  }

  function lastPathForTenant(storage, tenant, currentTenant) {
    return storedPathForTenant(storage, tenant, currentTenant)
      || defaultPathForTenant(normalizeTenant(tenant));
  }

  return {
    TENANTS,
    LAST_VIEW_KEY,
    SPLIT_BREAKPOINT,
    normalizeTenant,
    isSplitWidth,
    viewKeyForPath,
    viewPathFor,
    routeTenant,
    defaultPathForTenant,
    readLastViews,
    rememberView,
    storedPathForTenant,
    lastPathForTenant,
  };
});
