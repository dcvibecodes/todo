'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const ICON = (name, cls = 'ic') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

const COLORS = ['red', 'rose', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'slate', 'gray'];
const colorVar = (color) => `var(--list-${COLORS.includes(color) ? color : 'blue'})`;

const state = {
  authenticated: false,
  needsSetup: false,
  vapidPublicKey: null,
  lists: [],
  reminders: [],
  settings: {},
  view: 'today',
  search: '',
  searchOpen: [],
  searchCompleted: [],
  searchTotals: { open: 0, completed: 0 },
  searchTruncated: false,
  searchLoading: false,
  searchOffline: false,
  searchSeq: 0,
  searchQuery: '',
  searchKeepNavigation: false,
  showCompleted: false,
  editingId: null,
  editingListId: null,
  justAddedId: null,
  selectedColor: 'blue',
  csrfToken: null,
  subscription: null,
  editScope: 'series',
  sortDefault: {
    field: localStorage.getItem('todo.sortField') || 'created',
    dir: localStorage.getItem('todo.sortDir') || 'desc',
  },
  sortOverrides: readSortOverrides(),
  lastListId: Number(localStorage.getItem('todo.lastList')) || null,
};

const ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Ho_Chi_Minh', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'];

// Browsers disagree about which spelling of an IANA zone to report
// (Asia/Calcutta vs Asia/Kolkata, for example). Both are the same zone, so
// collapse aliases before building any picker or syncing a device zone.
const ZONE_ALIASES = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
};

function canonicalZone(zone) {
  return ZONE_ALIASES[zone] || zone;
}

function deviceZone() {
  try {
    return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  } catch {
    return '';
  }
}

function availableZones() {
  const zones = new Set();
  for (const zone of [deviceZone(), ...ZONES]) {
    if (zone) zones.add(canonicalZone(zone));
  }
  return [...zones];
}

// Client mirror of the server's rule labels (server/recurrence.js stays canonical).
function parseRuleClient(value) {
  if (!value || value === 'none') return { type: 'none' };
  try {
    const rule = JSON.parse(value);
    return rule && rule.type ? rule : { type: 'none' };
  } catch {
    return { type: 'none' };
  }
}

function repeatLabel(rule) {
  if (!rule || rule.type === 'none') return 'Never';
  const n = rule.interval || 1;
  if (rule.type === 'daily') return n === 1 ? 'Daily' : `Every ${n} days`;
  if (rule.type === 'weekly') return n === 1 ? 'Weekly' : `Every ${n} weeks`;
  if (rule.type === 'monthly') return n === 1 ? 'Monthly' : `Every ${n} months`;
  if (rule.type === 'yearly') return n === 1 ? 'Yearly' : `Every ${n} years`;
  if (rule.type === 'custom') {
    const unit = rule.unit === 'weeks' ? 'week' : rule.unit === 'months' ? 'month' : 'day';
    return `Every ${n} ${unit}${n === 1 ? '' : 's'}`;
  }
  return 'Repeats';
}

function announce(message) {
  const node = $('#live');
  if (!node) return;
  node.textContent = '';
  setTimeout(() => { node.textContent = message; }, 30);
}

const DENSITY_KEY = 'todo-density';
const LIST_PROGRESS_KEY = 'todo.listProgress';
const LIST_PROGRESS_RANGE_KEY = 'todo.listProgressRange';
const LIST_PROGRESS_SYNCED_KEY = 'todo.listProgressSynced';
const LIST_PROGRESS_MODES = ['bar', 'ring', 'off'];
const LIST_PROGRESS_RANGES = ['all', '30d'];
const SETTINGS_PROGRESS_KEYS = ['list_progress', 'list_progress_range'];

// Sidebar list progress display: 'bar' (bar with counts), 'ring' (ring on
// the dot) or 'off'. Synced through settings; localStorage is only an
// offline/last-known cache so a server value always wins.
function getListProgress() {
  const value = state.settings.list_progress;
  if (LIST_PROGRESS_MODES.includes(value)) return value;
  const cached = localStorage.getItem(LIST_PROGRESS_KEY);
  return LIST_PROGRESS_MODES.includes(cached) ? cached : 'bar';
}

// Which completions the bar/ring counts: 'all' (every completed item kept in
// the list) or '30d' (completed in the last 30 days). Synced too.
function getListProgressRange() {
  const value = state.settings.list_progress_range;
  if (LIST_PROGRESS_RANGES.includes(value)) return value;
  return localStorage.getItem(LIST_PROGRESS_RANGE_KEY) === '30d' ? '30d' : 'all';
}

// Settings-sheet preview: mutate the in-memory value and re-render; Save
// commits it to the server, Cancel restores the snapshot.
function previewListProgress(value) {
  state.settings.list_progress = LIST_PROGRESS_MODES.includes(value) ? value : 'bar';
  renderSidebar();
}

function previewListProgressRange(value) {
  state.settings.list_progress_range = LIST_PROGRESS_RANGES.includes(value) ? value : 'all';
  renderSidebar();
}

function cacheListProgress() {
  if (LIST_PROGRESS_MODES.includes(state.settings.list_progress)) {
    localStorage.setItem(LIST_PROGRESS_KEY, state.settings.list_progress);
  }
  if (LIST_PROGRESS_RANGES.includes(state.settings.list_progress_range)) {
    localStorage.setItem(LIST_PROGRESS_RANGE_KEY, state.settings.list_progress_range);
  }
}

// One-time bridge from the device-local v2.7.0 preference: if this browser
// still has a choice that differs from the server default, seed it on the
// server so an upgrade does not silently reset the display. Skipped when the
// server already holds a v2.7.1 choice (a different device won that race).
async function syncListProgressWithServer() {
  const localProgress = localStorage.getItem(LIST_PROGRESS_KEY);
  const localRange = localStorage.getItem(LIST_PROGRESS_RANGE_KEY);
  const seed = {};
  if (LIST_PROGRESS_MODES.includes(localProgress) && localProgress !== state.settings.list_progress) {
    seed.list_progress = localProgress;
  }
  if (LIST_PROGRESS_RANGES.includes(localRange) && localRange !== state.settings.list_progress_range) {
    seed.list_progress_range = localRange;
  }
  const finish = () => {
    cacheListProgress();
    localStorage.setItem(LIST_PROGRESS_SYNCED_KEY, '1');
  };
  if (localStorage.getItem(LIST_PROGRESS_SYNCED_KEY)) {
    cacheListProgress();
    return;
  }
  const serverAtDefaults = state.settings.list_progress === 'bar'
    && state.settings.list_progress_range === 'all';
  if (!serverAtDefaults) {
    finish();
    return;
  }
  if (!Object.keys(seed).length) {
    finish();
    return;
  }
  try {
    const result = await api('/api/settings', { method: 'POST', body: { settings: seed } });
    state.settings = result.settings || state.settings;
    finish();
  } catch {
    // Offline or a rejected value: keep this device's cached choice and
    // migrate on a later load.
  }
}

function applyDensity() {
  const density = localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  document.documentElement.dataset.density = density;
  return density;
}

function updateBadge() {
  try {
    const limit = endOfToday();
    const count = incompleteReminders()
      .filter((reminder) => reminder.due_at && new Date(reminder.due_at) <= limit).length;
    if ('setAppBadge' in navigator && navigator.setAppBadge) {
      if (count > 0) navigator.setAppBadge(count);
      else if ('clearAppBadge' in navigator) navigator.clearAppBadge();
    }
  } catch {
    // Badging is best-effort: skip silently where unsupported.
  }
}

// The device zone is reported to the server on open/resume so floating
// reminders ("6pm wherever I am") fire in the last confirmed zone. Because a
// second device in another zone would otherwise silently move everything, a
// change that would move items asks first and offers Undo.
const ZONE_PROMPT_KEY = 'todo.zone-prompt-dismissed';
let pendingZone = null;

async function syncDeviceZone() {
  if (!state.authenticated) return;
  const zone = deviceZone();
  const stored = canonicalZone(state.settings.device_zone || '');
  if (!zone || zone === stored) return;
  if (localStorage.getItem(ZONE_PROMPT_KEY) === zone) return;
  try {
    await requestDeviceZone(zone);
  } catch {
    // Offline or failed: the old zone stands until the next open.
  }
}

async function requestDeviceZone(zone, options = {}) {
  const preview = await api('/api/settings/zone-preview', {
    method: 'POST',
    body: { zone },
  });
  if (!preview.from || !preview.count) {
    const result = await applyDeviceZone(zone, preview.from);
    if (options.notify && !result?.floatingMoved) toast(`Time zone is now ${zone}`);
    return;
  }
  openZonePrompt(preview);
}

async function applyDeviceZone(zone, fromZone) {
  const result = await api('/api/settings', {
    method: 'POST',
    body: { settings: { device_zone: zone } },
  });
  state.settings = result.settings || state.settings;
  render();
  renderDeviceZoneRow();
  if (result.floatingMoved) {
    const count = result.floatingMoved;
    toast(
      `Time zone is now ${zone}; moved ${count} floating item${count === 1 ? '' : 's'}`,
      'Undo',
      () => undoDeviceZone(fromZone, result.moved || [])
    );
  }
  return result;
}

async function undoDeviceZone(fromZone, moved) {
  try {
    const result = await api('/api/settings/zone-undo', {
      method: 'POST',
      body: { device_zone: fromZone, restore: moved },
    });
    state.settings = result.settings || state.settings;
    await loadState();
    render();
    renderDeviceZoneRow();
    // The user just chose the old zone; don't ask again until the device
    // actually moves to a different zone.
    const zone = deviceZone();
    if (zone) localStorage.setItem(ZONE_PROMPT_KEY, zone);
    toast('Time zone change undone');
  } catch (err) {
    toast(err.message);
  }
}

function openZonePrompt(preview) {
  pendingZone = preview;
  const count = preview.count;
  $('#zone-prompt-text').textContent =
    `This device is now in ${preview.to}. Move ${count} floating item${count === 1 ? '' : 's'} from ${preview.from} so they keep the same clock time?`;
  $('#zone-move').textContent = `Move ${count} item${count === 1 ? '' : 's'}`;
  openSheet('#zone-sheet');
}

function keepDeviceZone() {
  if (pendingZone) localStorage.setItem(ZONE_PROMPT_KEY, pendingZone.to);
  pendingZone = null;
}

async function moveDeviceZone() {
  const preview = pendingZone;
  pendingZone = null;
  closeSheet('#zone-sheet');
  if (!preview) return;
  try {
    await applyDeviceZone(preview.to, preview.from);
  } catch (err) {
    toast(err.message);
  }
}

async function useThisDeviceZone() {
  const zone = deviceZone();
  if (!zone || zone === canonicalZone(state.settings.device_zone || '')) return;
  try {
    await requestDeviceZone(zone, { notify: true });
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------- Utilities ---------------- */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') {
      for (const [prop, val] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: {},
  };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (state.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(init.method.toUpperCase())) {
    init.headers['X-CSRF-Token'] = state.csrfToken;
  }
  const res = await fetch(path, init);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && state.authenticated) {
      state.authenticated = false;
      showAuth();
    }
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

let toastTimer = null;
function toast(message, actionLabel, action) {
  const node = $('#toast');
  node.replaceChildren(el('span', { text: message }));
  if (actionLabel && action) {
    const button = el('button', { type: 'button', class: 'toast-action', text: actionLabel });
    button.addEventListener('click', () => {
      node.hidden = true;
      clearTimeout(toastTimer);
      action();
    });
    node.append(button);
  }
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, action ? 10000 : 3200);
}

function showFieldError(input, messageNode, message) {
  messageNode.textContent = message;
  messageNode.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function clearFieldError(input, messageNode) {
  messageNode.hidden = true;
  messageNode.textContent = '';
  input.removeAttribute('aria-invalid');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dueValue(reminder) {
  return reminder.due_at ? new Date(reminder.due_at).getTime() : Number.MAX_SAFE_INTEGER;
}

function formatDue(reminder) {
  if (!reminder.due_at) return null;
  const date = new Date(reminder.due_at);
  const today = startOfToday();
  const dueDay = new Date(date);
  dueDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((dueDay - today) / 86400000);
  let day;
  if (dayDiff === 0) day = 'Today';
  else if (dayDiff === 1) day = 'Tomorrow';
  else if (dayDiff === -1) day = 'Yesterday';
  else if (date.getFullYear() === today.getFullYear()) {
    day = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } else {
    day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const time = reminder.has_time
    ? ' ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';
  const overdue = !reminder.completed && (
    reminder.has_time ? date.getTime() < Date.now() : dueDay.getTime() < today.getTime()
  );
  return { text: day + time, overdue };
}

function formatRecordDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function listById(id) {
  return state.lists.find((list) => list.id === id) || null;
}

function defaultListId() {
  if (state.view !== 'home' && typeof state.view === 'number' && listById(state.view)) {
    return state.view;
  }
  const unlisted = state.lists.find((list) => list.is_system);
  if (unlisted) return unlisted.id;
  if (state.lastListId && listById(state.lastListId)) return state.lastListId;
  return state.lists[0] ? state.lists[0].id : null;
}

function setLastList(id) {
  state.lastListId = id;
  localStorage.setItem('todo.lastList', String(id));
}

/* ---------------- Auth ---------------- */

async function boot() {
  registerServiceWorker();
  // A refresh closes every sheet but its history marker can survive the
  // reload; drop it so Back navigates instead of closing nothing.
  if (history.state && history.state.todoSheet) {
    try { history.replaceState(null, ''); } catch { /* ignore */ }
  }
  try {
    const session = await api('/api/session');
    state.needsSetup = session.needsSetup;
    if (!session.authenticated) return showAuth();
    state.csrfToken = session.csrfToken;
    state.vapidPublicKey = session.vapidPublicKey;
    showAppLoading();
    await loadState();
    showApp();
    syncPushState();
    syncDeviceZone();
  } catch (err) {
    // Replace skeletons with real (empty) views so the screen never hangs on them.
    if (state.authenticated) render();
    toast(err.message);
  }
}

function showAuth() {
  state.authenticated = false;
  $$('.sheet').forEach((sheet) => { sheet.hidden = true; });
  syncSheetState();
  $('#auth').hidden = false;
  $('#shell').hidden = true;
  $('#auth-confirm').hidden = !state.needsSetup;
  $('#auth-sub').textContent = state.needsSetup
    ? 'Create a password to protect your items'
    : 'Enter your password to continue';
  $('#auth-submit').textContent = state.needsSetup ? 'Create Password' : 'Unlock';
  $('#auth-password').setAttribute('autocomplete', state.needsSetup ? 'new-password' : 'current-password');
  $('#auth-password').value = '';
  $('#auth-confirm').value = '';
  $('#auth-error').hidden = true;
  setTimeout(() => $('#auth-password').focus(), 50);
}

function authError(message) {
  const node = $('#auth-error');
  node.textContent = message;
  node.hidden = false;
}

async function submitAuth(event) {
  event.preventDefault();
  const password = $('#auth-password').value;
  if (state.needsSetup) {
    if (password.length < 8) return authError('Use at least 8 characters');
    if (password !== $('#auth-confirm').value) return authError('Passwords do not match');
  }
  try {
    await api(state.needsSetup ? '/api/setup' : '/api/login', {
      method: 'POST',
      body: { password },
    });
    const session = await api('/api/session');
    state.needsSetup = false;
    state.csrfToken = session.csrfToken;
    state.vapidPublicKey = session.vapidPublicKey;
    showAppLoading();
    await loadState();
    showApp();
    syncPushState();
    syncDeviceZone();
  } catch (err) {
    authError(err.message);
  }
}

function showApp() {
  state.authenticated = true;
  $('#auth').hidden = true;
  $('#shell').hidden = false;
  route();
}

/* Skeletons: placeholder rows shaped like the real list, shown only while
   the first state load is in flight. They are replaced the moment data
   arrives - there is no artificial delay, and later reloads keep the real
   rows on screen. */
function showAppLoading() {
  state.authenticated = true;
  $('#auth').hidden = true;
  $('#shell').hidden = false;
  renderSkeletons();
}

function renderSkeletons() {
  // Mirror the screen the loaded view will use, or the main column stays
  // hidden behind the home default while skeletons are showing.
  document.body.dataset.screen = parseRoute() === 'home' ? 'home' : 'detail';
  const wrap = $('#lists');
  wrap.replaceChildren();
  for (let i = 0; i < 4; i++) {
    wrap.append(el('div', { class: 'skel-list-row', 'aria-hidden': 'true' }, [
      el('span', { class: 'skel skel-dot' }),
      el('span', { class: 'skel skel-bar', style: { width: `${92 - i * 14}px` } }),
    ]));
  }

  const content = $('#content');
  content.replaceChildren();
  if (parseRoute() === 'home') return;
  const group = el('div', { class: 'skel-group', 'aria-hidden': 'true' });
  for (let i = 0; i < 4; i++) {
    group.append(el('div', { class: 'skel-row' }, [
      el('span', { class: 'skel skel-check' }),
      el('div', { class: 'skel-lines' }, [
        el('span', { class: 'skel skel-bar skel-bar-title', style: { width: `${54 + (i % 3) * 12}%` } }),
        el('span', { class: 'skel skel-bar skel-bar-meta', style: { width: `${30 + (i % 2) * 8}%` } }),
      ]),
    ]));
  }
  content.append(group);
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch { /* ignore */ }
  state.authenticated = false;
  state.csrfToken = null;
  state.lists = [];
  state.reminders = [];
  state.subscription = null;
  showAuth();
}

/* ---------------- Data ---------------- */

async function loadState() {
  const data = await api('/api/state');
  state.lists = data.lists || [];
  state.reminders = data.reminders || [];
  state.settings = data.settings || {};
  await syncListProgressWithServer();
  await syncSortWithServer();
  if (state.lastListId && !listById(state.lastListId)) {
    state.lastListId = state.lists[0] ? state.lists[0].id : null;
  }
  // Mutations reload state; keep an active search in sync with them.
  if (state.search) await runSearch(state.search);
}

async function refreshState() {
  const buttons = $$('.refresh-btn');
  if (buttons.some((btn) => btn.disabled)) return;
  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.classList.add('loading');
  });
  try {
    await loadState();
    render();
    toast('Refreshed');
  } catch (err) {
    toast(err.message);
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('loading');
    });
  }
}

/* ---------------- Routing ---------------- */

function go(view) {
  location.hash = '#/' + view;
}

function clearSearch() {
  if (!state.search) return;
  state.search = '';
  $('#search').value = '';
  $('#main-search').value = '';
  clearSearchResults();
  render();
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return 'home';
  if (raw === 'home') return 'home';
  if (raw.startsWith('list/')) {
    const id = Number(raw.slice(5));
    return listById(id) ? id : 'all';
  }
  if (raw === 'today' || raw === 'scheduled' || raw === 'all' || raw === 'flagged' || raw === 'completed') return raw;
  return 'today';
}

const SHOW_COMPLETED_KEY = 'todo.showCompleted';

function showCompletedPrefs() {
  try {
    return JSON.parse(localStorage.getItem(SHOW_COMPLETED_KEY)) || {};
  } catch {
    return {};
  }
}

// Completed stays hidden by default, but when you tap "Show N Completed" on
// a list, that choice is remembered per list and restored on every visit.
function getShowCompleted(listId) {
  return Boolean(showCompletedPrefs()[listId]);
}

function setShowCompleted(listId, value) {
  const prefs = showCompletedPrefs();
  if (value) prefs[listId] = true;
  else delete prefs[listId];
  localStorage.setItem(SHOW_COMPLETED_KEY, JSON.stringify(prefs));
}

function route() {
  const view = parseRoute();
  // Search is global now, so navigating to a list or smart view leaves the
  // results behind unless the search itself caused the jump to All.
  if (state.search && view !== state.view) {
    if (state.searchKeepNavigation) state.searchKeepNavigation = false;
    else {
      state.search = '';
      $('#search').value = '';
      $('#main-search').value = '';
      clearSearchResults();
    }
  }
  if (view !== state.view) {
    state.showCompleted = typeof view === 'number' ? getShowCompleted(view) : false;
  }
  const active = document.activeElement;
  // Don't steal the keyboard when the user is mid-search: the results view
  // takes over and focus is handed to its own search box below.
  const searching = active && (active === $('#search') || active === $('#main-search')) && state.search;
  if (!searching && active && active.matches('input, textarea, select')) active.blur();
  state.view = view;
  document.body.dataset.screen = view === 'home' ? 'home' : 'detail';
  render();
  if (searching) {
    // The old screen (and its search box) may now be hidden; keep focus on a
    // visible search box so the keyboard stays up.
    let target = document.activeElement;
    if (!target || target.offsetParent === null) {
      target = $('#main-search').offsetParent ? $('#main-search') : $('#search');
    }
    if (target && target.offsetParent !== null) {
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
      const value = target.value;
      target.value = '';
      target.value = value;
    }
  }
}

/* ---------------- Render ---------------- */

function incompleteReminders() {
  return state.reminders.filter((reminder) => !reminder.completed);
}

function matchesSearch(reminder) {
  if (!state.search) return true;
  const needle = state.search.toLowerCase();
  return reminder.title.toLowerCase().includes(needle)
    || (reminder.notes || '').toLowerCase().includes(needle);
}

function readSortOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem('todo.sort.v2') || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveSortOverrides() {
  localStorage.setItem('todo.sort.v2', JSON.stringify(state.sortOverrides));
}

/* ---------------- Sorting sync ---------------- */

// Sorting lives on the server (settings.sort) so it follows the user across
// devices; localStorage stays as the instant-paint cache and offline copy.
// Writes are single intents merged server-side, so this tab never sends the
// whole map and can never wipe choices made on another device.
const SORT_PENDING_KEY = 'todo.sort.pending';

function readSortPending() {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_PENDING_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveSortPending(pending) {
  if (pending && (pending.applyAll || (pending.views && Object.keys(pending.views).length))) {
    localStorage.setItem(SORT_PENDING_KEY, JSON.stringify(pending));
  } else {
    localStorage.removeItem(SORT_PENDING_KEY);
  }
}

function serverSort() {
  try {
    const raw = state.settings && state.settings.sort;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      default: parsed.default && parsed.default.field ? parsed.default : null,
      overrides: parsed.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)
        ? parsed.overrides : {},
    };
  } catch {
    return null;
  }
}

function applyServerSort(sort) {
  if (sort.default) state.sortDefault = { field: sort.default.field, dir: sort.default.dir };
  state.sortOverrides = sort.overrides;
  localStorage.setItem('todo.sortField', state.sortDefault.field);
  localStorage.setItem('todo.sortDir', state.sortDefault.dir);
  saveSortOverrides();
}

async function pushSortWrite(body, pendingEntry) {
  try {
    const result = await api('/api/settings/sort', { method: 'POST', body });
    if (result && result.sort) state.settings.sort = JSON.stringify(result.sort);
  } catch {
    // Offline (or signed out): keep the change locally and queue it; the
    // next successful state load pushes it before adopting the server copy.
    const pending = readSortPending();
    if (pendingEntry.applyAll) {
      pending.applyAll = pendingEntry.applyAll;
      pending.views = {};
    } else {
      pending.views = pending.views || {};
      for (const [view, dims] of Object.entries(pendingEntry.views || {})) {
        pending.views[view] = Object.assign(pending.views[view] || {}, dims);
      }
    }
    saveSortPending(pending);
  }
}

let sortSyncing = false;

async function syncSortWithServer() {
  if (sortSyncing) return;
  sortSyncing = true;
  try {
    // 1. Queued offline changes are the user's latest explicit choices:
    //    push them before adopting anything from the server.
    const pending = readSortPending();
    const pendingViews = Object.entries(pending.views || {});
    if (pending.applyAll || pendingViews.length) {
      if (pending.applyAll) {
        await api('/api/settings/sort', {
          method: 'POST',
          body: { apply_all: true, field: pending.applyAll.field, dir: pending.applyAll.dir },
        });
      }
      for (const [view, dims] of pendingViews) {
        await api('/api/settings/sort', {
          method: 'POST',
          body: { view, ...dims },
        });
      }
      saveSortPending({});
      state.settings = await api('/api/settings');
    }
    // 2. Adopt the server's sorting; on first run after the upgrade, offer
    //    this device's local choices as the seed (only an empty server value
    //    takes it, so the first device wins and nothing jumps).
    const server = serverSort();
    if (server) {
      applyServerSort(server);
      return;
    }
    const overrides = readSortOverrides();
    const legacyField = localStorage.getItem('todo.sortField');
    const legacyDir = localStorage.getItem('todo.sortDir');
    const hasLocalChoices = Object.keys(overrides).length > 0
      || (legacyField && legacyField !== 'due') || (legacyDir && legacyDir !== 'asc');
    if (hasLocalChoices) {
      const result = await api('/api/settings/sort', {
        method: 'POST',
        body: {
          seed: {
            default: { field: legacyField || 'due', dir: legacyDir || 'asc' },
            overrides,
          },
        },
      });
      if (result && result.sort) {
        state.settings.sort = JSON.stringify(result.sort);
        applyServerSort(result.sort);
      }
    }
  } catch {
    // Offline or server error: the local copy stays in effect and the next
    // state load retries.
  } finally {
    sortSyncing = false;
  }
}

const SORT_DIR_LABELS = {
  due: { asc: 'Soonest on top', desc: 'Latest on top' },
  created: { asc: 'Oldest on top', desc: 'Newest on top' },
  name: { asc: 'A–Z', desc: 'Z–A' },
};

function syncSortDirLabels(fieldSelect, dirSelect) {
  const labels = SORT_DIR_LABELS[fieldSelect.value] || SORT_DIR_LABELS.due;
  for (const option of dirSelect.options) {
    if (labels[option.value]) option.textContent = labels[option.value];
  }
}

// Sorting is remembered per view: each list (and each smart view, including
// Scheduled) keeps its own field + direction. Views without their own choice
// fall back to the app default, which starts from the pre-2.5.0 global
// setting so nothing jumps.
function viewSortKey(view) {
  if (typeof view === 'number') return `list:${view}`;
  return String(view);
}

const DATED_VIEW_SORT = { field: 'due', dir: 'asc' };

function defaultSortFor(view) {
  return view === 'today' || view === 'scheduled' ? DATED_VIEW_SORT : state.sortDefault;
}

function effectiveSort(view) {
  const key = viewSortKey(view);
  const override = key ? state.sortOverrides[key] : null;
  const fallback = defaultSortFor(view);
  return {
    field: override && override.field ? override.field : fallback.field,
    dir: override && override.dir ? override.dir : fallback.dir,
  };
}

function setViewSort(view, patch) {
  const key = viewSortKey(view);
  if (!key) return;
  const current = effectiveSort(view);
  const choice = {
    field: patch.field || current.field,
    dir: patch.dir || current.dir,
  };
  state.sortOverrides[key] = choice;
  saveSortOverrides();
  // Send only the dimension(s) that actually changed; the server merges
  // them, so this tab cannot reset a newer choice made on another device.
  const body = { view: key };
  const dims = {};
  if (patch.field) { body.field = choice.field; dims.field = choice.field; }
  if (patch.dir) { body.dir = choice.dir; dims.dir = choice.dir; }
  pushSortWrite(body, { views: { [key]: dims } });
}

function compareReminders(a, b, sort) {
  const direction = sort.dir === 'desc' ? -1 : 1;
  const fallback = (a.sort_order - b.sort_order) || (a.id - b.id);
  if (sort.field === 'name') {
    const cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
    return cmp ? direction * cmp : fallback;
  }
  if (sort.field === 'created') {
    const av = new Date(a.created_at || 0).getTime();
    const bv = new Date(b.created_at || 0).getTime();
    return av === bv ? fallback : direction * (av - bv);
  }
  // Due date: undated reminders stay last in both directions, so they never
  // disappear into the middle of a date-sorted view.
  const av = a.due_at ? new Date(a.due_at).getTime() : null;
  const bv = b.due_at ? new Date(b.due_at).getTime() : null;
  if (av === null && bv === null) return fallback;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av === bv ? fallback : direction * (av - bv);
}

function sortItems(items, sort) {
  return [...items].sort((a, b) => compareReminders(a, b, sort));
}

function viewItems() {
  const view = state.view;
  let items;

  if (view === 'today') {
    const limit = endOfToday();
    items = incompleteReminders()
      .filter((reminder) => reminder.due_at && new Date(reminder.due_at) <= limit);
  } else if (view === 'scheduled') {
    // Buckets are assigned chronologically below; this sort only orders rows
    // within each bucket (and the pinned Overdue section).
    return sortItems(
      incompleteReminders().filter((reminder) => reminder.due_at),
      effectiveSort('scheduled'),
    );
  } else if (view === 'flagged') {
    items = incompleteReminders()
      .filter((reminder) => reminder.urgent);
  } else if (view === 'all') {
    items = incompleteReminders();
  } else if (view === 'completed') {
    items = state.reminders
      .filter((reminder) => reminder.completed);
  } else if (typeof view === 'number') {
    items = state.reminders
      .filter((reminder) => reminder.list_id === view && !reminder.completed);
  } else {
    items = [];
  }

  return sortItems(items, effectiveSort(view));
}

function completedInList(listId) {
  return sortItems(state.reminders
    .filter((reminder) => reminder.list_id === listId && reminder.completed),
    effectiveSort(listId));
}

// A search result can be older than the 30-day completed window that
// /api/state loads, so editor lookups must also check the search groups.
function findReminder(id) {
  return state.reminders.find((reminder) => reminder.id === id)
    || state.searchOpen.find((reminder) => reminder.id === id)
    || state.searchCompleted.find((reminder) => reminder.id === id)
    || null;
}

function render() {
  renderSidebar();
  renderMain();
  updateBadge();
  state.justAddedId = null;
}

function getAccountMenu() {
  return $('#account-menu');
}

function syncMenuButtons() {
  const menu = getAccountMenu();
  if (!menu) return;
  const open = !menu.hidden;
  $$('#menu-btn, #sidebar-menu-btn').forEach((btn) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.title = open ? 'Close menu' : 'Menu';
    btn.setAttribute('aria-label', btn.title);
  });
}

function toggleAccountMenu() {
  const menu = getAccountMenu();
  if (!menu) return;
  menu.hidden = !menu.hidden;
  syncMenuButtons();
}

function closeAccountMenu() {
  const menu = getAccountMenu();
  if (menu) menu.hidden = true;
  syncMenuButtons();
}

function handleMenuButton() {
  toggleAccountMenu();
}

let listDrag = null;
let dragTouchGuard = false;

function cleanupListDrag() {
  if (!listDrag) return;
  const drag = listDrag;
  listDrag = null;
  window.removeEventListener('pointermove', drag.onMove);
  window.removeEventListener('pointerup', drag.onUp);
  window.removeEventListener('pointercancel', drag.onCancel);
  try { drag.grip.releasePointerCapture(drag.pointerId); } catch { /* already released */ }
  drag.ghost.remove();
  drag.row.classList.remove('dragging');
  $$('#lists .list-row').forEach((node) => node.classList.remove('drop-before', 'drop-after'));
  document.body.classList.remove('list-dragging');
  dragTouchGuard = false;
}

function startListDrag(event, list, row, grip) {
  if (event.button !== undefined && event.button !== 0) return;
  if (list.is_system || state.lists.length < 2 || listDrag) return;
  event.preventDefault();

  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.classList.add('list-drag-ghost');
  ghost.classList.remove('active');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.append(ghost);

  row.classList.add('dragging');
  document.body.classList.add('list-dragging');

  const drag = {
    list,
    row,
    grip,
    ghost,
    pointerId: event.pointerId,
    startY: event.clientY,
    startTop: rect.top,
    height: rect.height,
    targetIndex: state.lists.findIndex((item) => item.id === list.id),
    minIndex: state.lists[0] && state.lists[0].is_system ? 1 : 0,
    onMove: null,
    onUp: null,
    onCancel: null,
  };
  listDrag = drag;
  dragTouchGuard = true;

  drag.onMove = (moveEvent) => {
    if (!listDrag || moveEvent.pointerId !== drag.pointerId) return;
    const dy = moveEvent.clientY - drag.startY;
    drag.ghost.style.top = `${drag.startTop + dy}px`;
    const center = drag.startTop + drag.height / 2 + dy;
    const rows = $$('#lists .list-row').filter((node) => node !== row);
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i].getBoundingClientRect();
      if (center < box.top + box.height / 2) {
        index = i;
        break;
      }
    }
    drag.targetIndex = Math.max(drag.minIndex, index);
    $$('#lists .list-row').forEach((node) => node.classList.remove('drop-before', 'drop-after'));
    if (drag.targetIndex < rows.length) rows[drag.targetIndex].classList.add('drop-before');
    else if (rows.length) rows[rows.length - 1].classList.add('drop-after');
  };

  drag.onUp = (upEvent) => {
    if (!listDrag || upEvent.pointerId !== drag.pointerId) return;
    const index = drag.targetIndex;
    const ids = state.lists.map((item) => item.id).filter((id) => id !== list.id);
    ids.splice(Math.max(drag.minIndex, Math.min(index, ids.length)), 0, list.id);
    const changed = ids.some((id, i) => id !== state.lists[i].id);
    cleanupListDrag();
    if (!changed) return;

    state.lists = ids.map((id) => state.lists.find((item) => item.id === id));
    renderSidebar();
    persistListOrder(ids);
  };

  drag.onCancel = () => cleanupListDrag();

  try { grip.setPointerCapture(event.pointerId); } catch { /* best effort */ }
  // Listen on window so the drag keeps tracking if the pointer leaves the grip.
  window.addEventListener('pointermove', drag.onMove);
  window.addEventListener('pointerup', drag.onUp);
  window.addEventListener('pointercancel', drag.onCancel);
}

// While a grip drag is active, stop the browser from turning the vertical
// movement into page scroll.
$('#lists').addEventListener('touchmove', (event) => {
  if (dragTouchGuard) event.preventDefault();
}, { passive: false });

function persistListOrder(ids) {
  api('/api/lists/order', { method: 'PUT', body: { ids } }).catch(async (err) => {
    toast(err.message);
    await loadState();
    render();
  });
}

// Keyboard alternative to drag-and-drop (WCAG 2.2 AA): focus a list's grip
// and use arrow keys to move it. Every move is announced.
function moveListKeyboard(listId, direction) {
  const from = state.lists.findIndex((item) => item.id === listId);
  if (from === -1 || state.lists[from].is_system) return;
  const minIndex = state.lists[0] && state.lists[0].is_system ? 1 : 0;
  const to = Math.max(minIndex, Math.min(state.lists.length - 1, from + direction));
  if (to === from) return;
  const ids = state.lists.map((item) => item.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  state.lists = ids.map((id) => state.lists.find((item) => item.id === id));
  renderSidebar();
  persistListOrder(ids);
  const list = listById(listId);
  announce(`${list ? list.name : 'List'} moved to position ${to + 1} of ${ids.length}`);
  const grip = $(`#lists .list-grip[data-list-id="${listId}"]`);
  if (grip) grip.focus();
}

function isOverdue(reminder) {
  if (!reminder.due_at || reminder.completed) return false;
  const due = formatDue(reminder);
  return Boolean(due && due.overdue);
}

function isSnoozed(reminder) {
  return Boolean(reminder.snoozed_until && new Date(reminder.snoozed_until).getTime() > Date.now());
}

function snoozeLabel(untilISO) {
  const date = new Date(untilISO);
  const today = startOfToday();
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const sameDay = day.getTime() === today.getTime();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Snoozed until ${time}` : `Snoozed until ${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

function renderSidebar() {
  const todayLimit = endOfToday();
  const incomplete = incompleteReminders();
  const todayCount = incomplete
    .filter((reminder) => reminder.due_at && new Date(reminder.due_at) <= todayLimit).length;
  const allCount = incomplete.length;
  const scheduledCount = incomplete.filter((reminder) => reminder.due_at).length;
  const flaggedCount = incomplete.filter((reminder) => reminder.urgent).length;

  $('#count-today').textContent = todayCount ? String(todayCount) : '';
  $('#count-scheduled').textContent = scheduledCount ? String(scheduledCount) : '';
  $('#count-all').textContent = allCount ? String(allCount) : '';
  $('#count-flagged').textContent = flaggedCount ? String(flaggedCount) : '';

  $$('#smart-nav .nav-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.view === state.view);
  });

  const wrap = $('#lists');
  wrap.replaceChildren();
  if (!state.lists.length) {
    wrap.append(el('p', { class: 'section-empty', text: 'No lists yet' }));
    return;
  }

  const progressMode = getListProgress();
  const progressRange = getListProgressRange();

  for (const list of state.lists) {
    const open = list.count || 0;
    const done = (progressRange === '30d' ? list.done_count_30d : list.done_count) || 0;
    const total = open + done;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const doneTitle = `${open} open \u00b7 ${done} done${progressRange === '30d' ? ' in the last 30 days' : ''}`;
    let dot = el('span', { class: 'list-dot' });
    if (progressMode === 'ring' && total > 0) {
      dot = el('span', { class: 'list-ring', style: { '--p': String(pct) }, title: doneTitle }, [dot]);
    }
    const row = el('button', {
      class: 'list-row' + (state.view === list.id ? ' active' : ''),
      style: { '--c': colorVar(list.color) },
      'data-list-id': list.id,
      onclick: () => {
        clearSearch();
        go('list/' + list.id);
      },
    }, [
      dot,
      el('span', { class: 'list-name', text: list.name }),
      el('span', { class: 'badge', text: list.count ? String(list.count) : '' }),
    ]);
    if (list.is_system) {
      row.append(el('span', {
        class: 'list-lock',
        title: 'Unlisted is always first',
        'aria-hidden': 'true',
        html: ICON('lock', 'ic'),
      }));
    } else {
      const grip = el('span', {
        class: 'list-grip',
        title: 'Drag to reorder',
        tabindex: '0',
        role: 'button',
        'data-list-id': list.id,
        'aria-label': `Reorder ${list.name}: drag, or press up and down arrows to move`,
        html: ICON('grip', 'ic'),
      });
      grip.addEventListener('pointerdown', (event) => startListDrag(event, list, row, grip));
      grip.addEventListener('click', (event) => event.stopPropagation());
      grip.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          moveListKeyboard(list.id, event.key === 'ArrowUp' ? -1 : 1);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          event.stopPropagation();
          const from = state.lists.findIndex((item) => item.id === list.id);
          moveListKeyboard(list.id, (event.key === 'Home' ? 0 : state.lists.length - 1) - from);
        }
      });
      row.append(grip);
    }
    if (progressMode === 'bar' && total > 0) {
      row.append(
        el('span', { class: 'list-progress', title: doneTitle, 'aria-hidden': 'true' }, [
          el('span', { class: 'list-progress-fill', style: { width: pct + '%' } }),
        ]),
        el('span', { class: 'list-progress-counts', text: `${open} open \u00b7 ${done} done` })
      );
    }
    wrap.append(row);
  }

  $('#notifications-label').textContent = state.subscription ? 'Notifications On' : 'Notifications';
}

function renderSearchResults(content) {
  document.title = 'ToDo — Search';
  $('#view-title').textContent = 'Search';
  const totals = state.searchTotals || { open: 0, completed: 0 };
  const total = totals.open + totals.completed;
  $('#view-count').textContent = total ? String(total) : '';
  $('#view-menu').hidden = true;

  const open = sortItems(state.searchOpen || [], effectiveSort(state.view));
  const completed = [...(state.searchCompleted || [])].sort((a, b) => {
    const av = new Date(a.completed_at || 0).getTime();
    const bv = new Date(b.completed_at || 0).getTime();
    return bv - av;
  });

  if (state.searchLoading && state.searchQuery !== state.search) {
    content.append(el('p', { class: 'search-status', text: 'Searching…' }));
    return;
  }
  if (!open.length && !completed.length) {
    content.append(emptySearchState());
    return;
  }
  if (state.searchOffline) {
    content.append(el('p', { class: 'search-status', text: 'Offline — showing recent items only.' }));
  }
  if (state.searchTruncated) {
    content.append(el('p', { class: 'search-status', text: 'Showing the first results — refine the search to see the rest.' }));
  }
  if (open.length) {
    content.append(el('h3', { class: 'group-title', text: `Open (${totals.open})` }));
    const group = el('div', { class: 'reminder-group' });
    for (const reminder of open) group.append(reminderRow(reminder, { showList: true }));
    content.append(group);
  }
  if (completed.length) {
    content.append(el('h3', { class: 'group-title', text: `Completed (${totals.completed})` }));
    const group = el('div', { class: 'reminder-group' });
    for (const reminder of completed) group.append(reminderRow(reminder, { showList: true }));
    content.append(group);
  }
}

function emptySearchState() {
  return el('div', { class: 'empty' }, [
    el('span', { html: ICON('search') }),
    el('h3', { class: 'empty-heading', text: 'No matches' }),
    el('p', { text: `No items match “${state.search}” in any list.` }),
    el('button', {
      type: 'button',
      class: 'primary-btn',
      text: 'Clear search',
      onclick: () => setSearch('', 'both'),
    }),
  ]);
}

function renderMain() {
  const view = state.view;
  const content = $('#content');
  content.replaceChildren();
  $('#view-menu').hidden = true;
  const sortBar = $('#sort-bar');
  sortBar.hidden = view === 'home';
  if (!sortBar.hidden) {
    const sort = effectiveSort(view);
    $('#sort-field').value = sort.field;
    $('#sort-dir').value = sort.dir;
    syncSortDirLabels($('#sort-field'), $('#sort-dir'));
  }

  if (state.search) {
    renderSearchResults(content);
    return;
  }

  if (view === 'home') {
    document.title = 'ToDo';
    return;
  }

  let title = 'Today';
  let list = null;
  if (view === 'all') title = 'All';
  else if (view === 'scheduled') title = 'Scheduled';
  else if (view === 'flagged') title = 'Flagged';
  else if (view === 'completed') title = 'Completed';
  else if (typeof view === 'number') {
    list = listById(view);
    title = list ? list.name : 'All';
  }

  const items = viewItems();
  const completed = typeof view === 'number' && state.showCompleted ? completedInList(view) : [];
  const completeCount = typeof view === 'number' && list
    ? state.reminders.filter((reminder) => reminder.list_id === list.id && reminder.completed).length
    : 0;

  $('#view-title').textContent = title;
  const shownCount = typeof view === 'number'
    ? items.length + (state.showCompleted && !state.search ? completed.length : 0)
    : items.length;
  $('#view-count').textContent = shownCount ? String(shownCount) : '';
  if (typeof view === 'number') {
    $('#view-menu').hidden = false;
    $('#view-menu').onclick = () => openListSheet(list);
  }
  document.title = `ToDo — ${title}`;

  if (!items.length) {
    content.append(emptyState(view));
    if (state.search) return;
  } else if (view === 'scheduled') {
    renderScheduled(content, items);
  } else if (view === 'today') {
    renderToday(content, items);
  } else {
    const group = el('div', { class: 'reminder-group' });
    for (const reminder of items) {
      group.append(reminderRow(reminder, { reschedule: view === 'flagged' && isOverdue(reminder) }));
    }
    content.append(group);
  }

  if (typeof view === 'number' && completeCount) {
    content.append(el('button', {
      class: 'toggle-completed',
      text: `${state.showCompleted ? 'Hide' : 'Show'} ${completeCount} Completed`,
      onclick: () => {
        state.showCompleted = !state.showCompleted;
        if (typeof state.view === 'number') setShowCompleted(state.view, state.showCompleted);
        renderMain();
      },
    }));

    if (state.showCompleted && completed.length) {
      content.append(el('h3', { class: 'group-title', text: 'Completed' }));
      const group = el('div', { class: 'reminder-group' });
      for (const reminder of completed) group.append(reminderRow(reminder));
      content.append(group);
    }
  }

  if (!state.lists.length) {
    content.append(el('button', {
      class: 'toggle-completed',
      text: 'Create a list to start adding items',
      onclick: () => openListSheet(null),
    }));
  }
}

function emptyState(view) {
  // Warmer empty states with a primary action where one makes sense.
  const copy = {
    today: { icon: 'calendar', heading: 'All clear', message: 'Nothing is due today. Enjoy the quiet — or get ahead.' },
    scheduled: { icon: 'clock', heading: 'Nothing scheduled', message: 'Give an item a date and it will show up here, grouped by when it is due.' },
    all: { icon: 'all', heading: 'A fresh start', message: 'No items yet. Capture the first thing on your mind.' },
    flagged: { icon: 'flag', heading: 'Nothing flagged', message: 'Mark an item urgent and it will wait for you here.' },
    completed: { icon: 'done', heading: 'No history yet', message: 'Finished items land here for the next 30 days.' },
  }[view] || { icon: 'all', heading: 'Nothing here', message: 'No items in this list yet.' };
  const children = [
    el('span', { html: ICON(copy.icon) }),
    el('h3', { class: 'empty-heading', text: copy.heading }),
    el('p', { text: state.search ? 'No matching items' : copy.message }),
  ];
  if (state.search) {
    children.push(el('button', {
      type: 'button',
      class: 'primary-btn',
      text: 'Clear search',
      onclick: () => setSearch('', 'both'),
    }));
  }
  return el('div', { class: 'empty' }, children);
}

// Scheduled groups upcoming items into time buckets instead of one heading
// per date: each item lands in the first bucket it fits, and its row still
// shows the exact due date. Weeks run Monday to Sunday.
const SCHEDULED_BUCKETS = ['Today', 'Tomorrow', 'This Week', 'Next Week', 'Later This Month', 'Later'];

function scheduledBucket(dueAt) {
  const today = startOfToday();
  const dueDay = new Date(dueAt);
  dueDay.setHours(0, 0, 0, 0);
  const diff = Math.round((dueDay - today) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const daysToSunday = 6 - ((today.getDay() + 6) % 7);
  if (diff <= daysToSunday) return 'This Week';
  if (diff <= daysToSunday + 7) return 'Next Week';
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthEndDiff = Math.round((monthEnd - today) / 86400000);
  if (diff <= monthEndDiff) return 'Later This Month';
  return 'Later';
}

// Overdue items stay pinned at the top until completed or rescheduled,
// with one-tap Today/Tomorrow buttons on each row.
function renderOverdueSection(content, items) {
  const overdue = items.filter(isOverdue);
  if (!overdue.length) return [];
  content.append(el('h3', { class: 'group-title overdue-title', text: `Overdue · ${overdue.length}` }));
  const group = el('div', { class: 'reminder-group' });
  for (const reminder of overdue) group.append(reminderRow(reminder, { reschedule: true }));
  content.append(group);
  return overdue.map((reminder) => reminder.id);
}

function renderToday(content, items) {
  const seen = new Set(renderOverdueSection(content, items));
  const rest = items.filter((reminder) => !seen.has(reminder.id));
  if (!rest.length) return;
  const group = el('div', { class: 'reminder-group' });
  for (const reminder of rest) group.append(reminderRow(reminder));
  content.append(group);
}

function renderScheduled(content, items) {
  const seen = new Set(renderOverdueSection(content, items));
  const upcoming = items.filter((reminder) => !seen.has(reminder.id));
  const groups = new Map();
  for (const reminder of upcoming) {
    const bucket = scheduledBucket(reminder.due_at);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(reminder);
  }
  for (const bucket of SCHEDULED_BUCKETS) {
    const group = groups.get(bucket);
    if (!group) continue;
    content.append(el('h3', { class: 'group-title', text: bucket }));
    const wrap = el('div', { class: 'reminder-group' });
    for (const reminder of group) wrap.append(reminderRow(reminder));
    content.append(wrap);
  }
}

// Full URLs plus bare domains ("example.com", "www.example.com/path") so
// notes don't require a scheme to become chips. Only the first matching
// alternative consumes a scheme-prefixed URL, avoiding double matches.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

function cleanUrl(value) {
  return String(value).replace(/^[\s(<\[]+|[),.;!?:\]>]+$/g, '');
}

function toHref(value) {
  const url = cleanUrl(value);
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/\//.test(url)) return 'https:' + url;
  return 'https://' + url.replace(/^www\./i, 'www.');
}

function domainOf(url) {
  try {
    return new URL(toHref(url)).hostname.replace(/^www\./, '');
  } catch {
    return cleanUrl(url).replace(/^https?:\/\//i, '').split('/')[0];
  }
}

function linkChip(url) {
  // Compact chip (icon + domain) instead of a full magenta URL: the full
  // address stays in the notes field. No third-party favicon service — the
  // link glyph is inline SVG so domains never leak to Google.
  const href = toHref(url);
  return el('a', {
    class: 'link-chip',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: href,
    'aria-label': `Open link: ${domainOf(href)}`,
    onclick: (event) => event.stopPropagation(),
  }, [
    el('span', { html: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 007.07 0l3.54-3.54a5 5 0 00-7.07-7.07L12 5M14 10a5 5 0 00-7.07 0L3.39 13.54a5 5 0 007.07 7.07L12 19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>' }),
    el('span', { class: 'link-domain', text: domainOf(href) }),
  ]);
}

// Split notes into prose and links. Punctuation that merely joined a link
// (commas/semicolons around it) is removed from the prose, so the card never
// shows stray commas between chips.
function noteParts(value) {
  const text = String(value || '');
  const segments = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = cleanUrl(raw);
    if (!url) continue;
    if (match.index > last) segments.push({ type: 'text', value: text.slice(last, match.index) });
    segments.push({ type: 'link', value: url });
    last = match.index + raw.length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  const prose = [];
  const links = [];
  segments.forEach((segment, index) => {
    if (segment.type === 'link') {
      const href = toHref(segment.value);
      if (!links.includes(href)) links.push(href);
      return;
    }
    let value = segment.value;
    const previous = segments[index - 1];
    const next = segments[index + 1];
    if (previous && previous.type === 'link') value = value.replace(/^[\s,;:!?.]+/, '');
    if (next && next.type === 'link') value = value.replace(/[\s,;:!?.]+$/, '');
    value = value.replace(/\s+/g, ' ').trim();
    if (value) prose.push(value);
  });
  return { text: prose.join(' ').replace(/\s{2,}/g, ' ').trim(), links };
}

function renderEditorLinks() {
  const wrap = $('#e-notes-links');
  if (!wrap) return;
  const { links } = noteParts($('#e-notes').value);
  wrap.replaceChildren();
  if (!links.length) {
    wrap.hidden = true;
    return;
  }
  for (const url of links) wrap.append(linkChip(url));
  wrap.hidden = false;
}

function autoGrowTitle() {
  const title = $('#e-title');
  title.style.height = 'auto';
  title.style.height = `${title.scrollHeight}px`;
}

function autoGrowNotes() {
  const notes = $('#e-notes');
  notes.style.height = 'auto';
  notes.style.height = `${notes.scrollHeight}px`;
}

function timeModelLabel(reminder) {
  // The model only changes behavior once a date exists; on an undated item
  // the label is noise.
  if (!reminder.due_at) return null;
  // Floating already means "this device's time"; showing a specific zone
  // there is noise (the editor discloses the last synced zone). Anchored is
  // different: its zone IS the rule, so keep it on the card.
  if (reminder.time_model === 'floating') return 'Floating';
  if (reminder.time_model === 'anchored') {
    return reminder.time_zone ? `Anchored · ${reminder.time_zone}` : 'Anchored';
  }
  return null;
}

async function snoozeRow(reminder, hours = 1) {
  try {
    const result = await api('/api/reminders/' + reminder.id + '/snooze', {
      method: 'POST',
      body: { hours },
    });
    await loadState();
    render();
    toast(`Snoozed until ${new Date(result.snoozedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
  } catch (err) {
    toast(err.message);
  }
}

async function skipToNext(reminder) {
  try {
    const result = await api('/api/reminders/' + reminder.id + '/skip', { method: 'POST' });
    await loadState();
    render();
    const next = new Date(result.nextDue);
    toast(`Snoozed until next occurrence: ${next.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
  } catch (err) {
    toast(err.message);
  }
}

async function rescheduleRow(reminder, date) {
  try {
    await api('/api/reminders/' + reminder.id + '/reschedule', {
      method: 'POST',
      body: { date },
    });
    await loadState();
    render();
    toast(date === 'today' ? 'Due today' : 'Due tomorrow');
  } catch (err) {
    toast(err.message);
  }
}

function reminderRow(reminder, options = {}) {
  const list = listById(reminder.list_id);
  const color = colorVar(list ? list.color : 'blue');
  const due = formatDue(reminder);
  const viewIsList = typeof state.view === 'number';

  const meta = el('div', { class: 'reminder-meta' });
  if ((options.showList || !viewIsList) && list) {
    meta.append(el('span', { class: 'meta-list', style: { '--c': color } }, [
      el('span', { class: 'meta-dot' }),
      el('span', { text: list.name }),
    ]));
  }
  if (due) {
    meta.append(el('span', {
      class: 'meta-due' + (due.overdue ? ' overdue' : ''),
      html: ICON('calendar', 'ic') + `<span>${escapeHtml(due.text)}</span>`,
    }));
  }
  if (reminder.completed && reminder.completed_at) {
    const completedText = formatRecordDate(reminder.completed_at);
    if (completedText) {
      meta.append(el('span', {
        class: 'meta-completed',
        html: ICON('done', 'ic') + `<span>Completed ${escapeHtml(completedText)}</span>`,
      }));
    }
  }
  const rule = parseRuleClient(reminder.repeat_rule);
  if (rule.type !== 'none') {
    meta.append(el('span', {
      class: 'meta-repeat',
      title: repeatLabel(rule),
      html: ICON('repeat', 'ic') + `<span>${escapeHtml(repeatLabel(rule))}</span>`,
    }));
  }
  if (reminder.urgent) {
    meta.append(el('span', {
      class: 'meta-urgent',
      html: ICON('bell', 'ic') + '<span>Urgent</span>',
    }));
  }
  const model = timeModelLabel(reminder);
  if (model) {
    meta.append(el('span', { class: 'meta-model', text: model }));
  }
  if (reminder.occurrence_edited) {
    meta.append(el('span', { class: 'meta-edited', text: 'This occurrence' }));
  }
  if (isSnoozed(reminder)) {
    meta.append(el('span', {
      class: 'meta-snoozed',
      html: ICON('clock', 'ic') + `<span>${escapeHtml(snoozeLabel(reminder.snoozed_until))}</span>`,
    }));
  }

  const body = el('div', { class: 'reminder-body' }, [
    el('div', { class: 'reminder-title', text: reminder.title }),
    meta,
  ]);
  if (reminder.notes) {
    const parts = noteParts(reminder.notes);
    if (parts.text) {
      body.append(el('div', { class: 'reminder-notes', text: parts.text }));
    }
    if (parts.links.length) {
      const links = el('div', { class: 'reminder-links' });
      for (const url of parts.links) links.append(linkChip(url));
      body.append(links);
    }
  }

  // Contextual actions live on the row so due items never require opening
  // the editor. Snoozing only silences the alert; rescheduling moves the due
  // date. They are separate groups so the labels say which is which.
  const snoozeActions = [];
  const rescheduleActions = [];
  const recurring = rule.type !== 'none';
  const overdue = isOverdue(reminder);
  const dueToday = Boolean(due) && new Date(reminder.due_at) <= endOfToday();
  const dueOnToday = Boolean(reminder.due_at)
    && localDateValue(new Date(reminder.due_at)) === localDateValue(new Date());
  if (!reminder.completed && reminder.due_at && !isSnoozed(reminder) && dueToday) {
    const hourChips = [];
    for (const hours of [1, 3, 6]) {
      hourChips.push(el('button', {
        type: 'button',
        class: 'mini-btn',
        text: `${hours} hour${hours === 1 ? '' : 's'}`,
        'aria-label': `Snooze ${reminder.title} until ${hours} hour${hours === 1 ? '' : 's'} from now`,
        onclick: (event) => { event.stopPropagation(); snoozeRow(reminder, hours); },
      }));
    }
    snoozeActions.push(el('span', { class: 'snooze-hours' }, hourChips));
    if (recurring) {
      snoozeActions.push(el('button', {
        type: 'button',
        class: 'mini-btn',
        text: 'Next occurrence',
        title: 'Snooze until the next scheduled occurrence',
        'aria-label': `Snooze ${reminder.title} until the next occurrence`,
        onclick: (event) => { event.stopPropagation(); skipToNext(reminder); },
      }));
    }
  }
  // "Today" would be a no-op on an item already due today (overdue only by
  // time), so only offer it when the calendar date is actually earlier.
  if (!reminder.completed && options.reschedule && overdue && !dueOnToday) {
    rescheduleActions.push(el('button', {
      type: 'button',
      class: 'mini-btn',
      text: 'Today',
      'aria-label': `Reschedule ${reminder.title} to today`,
      onclick: (event) => { event.stopPropagation(); rescheduleRow(reminder, 'today'); },
    }));
  }
  if (!reminder.completed && reminder.due_at && dueToday && (!recurring || (options.reschedule && overdue))) {
    rescheduleActions.push(el('button', {
      type: 'button',
      class: 'mini-btn',
      text: 'Tomorrow',
      'aria-label': `Reschedule ${reminder.title} to tomorrow`,
      onclick: (event) => { event.stopPropagation(); rescheduleRow(reminder, 'tomorrow'); },
    }));
  }
  const actionGroups = [];
  for (const [label, actions] of [['Snooze', snoozeActions], ['Reschedule', rescheduleActions]]) {
    if (!actions.length) continue;
    actionGroups.push(el('div', { class: 'row-actions', 'aria-label': label }, [
      el('span', { class: 'row-actions-label', text: label }),
      ...actions,
    ]));
  }
  if (actionGroups.length) body.append(el('div', { class: 'row-action-stack' }, actionGroups));

  const check = el('button', {
    class: 'check',
    'aria-label': reminder.completed ? 'Mark incomplete' : 'Mark complete',
    html: ICON('check'),
  });
  check.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCompleted(reminder, event.currentTarget.closest('.reminder'));
  });

  // Web delete affordance: the × appears on hover (mouse only); first click
  // turns it into an inline Confirm?, second click deletes. No browser popup.
  const remove = el('button', {
    type: 'button',
    class: 'row-delete',
    'aria-label': `Delete ${reminder.title}`,
    html: ICON('x', 'ic'),
    onclick: (event) => {
      event.stopPropagation();
      handleRowDelete(reminder, event.currentTarget);
    },
  });

  const deleteAction = el('button', {
    type: 'button',
    class: 'swipe-act del',
    tabindex: '-1',
    'aria-label': `Delete ${reminder.title}`,
    onclick: (event) => {
      event.stopPropagation();
      handleSwipeDelete(reminder, event.currentTarget);
    },
  }, [
    el('span', { class: 'del-label', text: 'Delete' }),
    el('span', { html: ICON('x', 'ic') }),
  ]);

  const content = el('div', { class: 'swipe-content' }, [check, body, remove]);
  const background = el('div', { class: 'swipe-bg', 'aria-hidden': 'true' }, [deleteAction]);

  // A title-only row (no meta, notes, or links) has a body shorter than the
  // row's min-height, so top-aligning the check would float it above centre.
  // Flag it so the check can centre; any extra line keeps the check on the title.
  const titleOnly = meta.childElementCount === 0 && !reminder.notes;

  return el('div', {
    class: 'reminder' + (reminder.completed ? ' done' : '') + (titleOnly ? ' reminder--single' : '')
      + (state.justAddedId === reminder.id ? ' entering' : ''),
    style: { '--c': color },
    'data-reminder-id': reminder.id,
    onclick: (event) => {
      // A swipe that just ended must not open the editor.
      if (Date.now() - lastSwipeEnd < 400) return;
      const row = event.currentTarget;
      // Tapping a parked row closes the reveal instead of opening the editor.
      if (row.classList.contains('swipe-open')) {
        resetSwipe(row);
        return;
      }
      openEditor(reminder.id);
    },
  }, [background, content]);
}

function resetRowDelete(button) {
  if (!button) return;
  clearTimeout(button._confirmTimer);
  button.dataset.confirm = '';
  button.classList.remove('confirming');
  button.innerHTML = ICON('x', 'ic');
  button.setAttribute('aria-label', button.dataset.origLabel || 'Delete item');
}

function handleRowDelete(reminder, button) {
  if (button.dataset.confirm !== '1') {
    if (!button.dataset.origLabel) button.dataset.origLabel = button.getAttribute('aria-label') || 'Delete item';
    button.dataset.confirm = '1';
    button.classList.add('confirming');
    button.textContent = 'Confirm?';
    button.setAttribute('aria-label', 'Confirm delete');
    clearTimeout(button._confirmTimer);
    button._confirmTimer = setTimeout(() => resetRowDelete(button), 4000);
    return;
  }
  clearTimeout(button._confirmTimer);
  deleteReminderInline(reminder, button.closest('.reminder'));
}

function handleSwipeDelete(reminder, button) {
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1';
    const label = button.querySelector('.del-label');
    if (label) label.textContent = 'Confirm?';
    button.setAttribute('aria-label', 'Confirm delete');
    return;
  }
  deleteReminderInline(reminder, button.closest('.reminder'));
}

function deleteReminderInline(reminder, row) {
  if (!row || row.dataset.deleting) return;
  row.dataset.deleting = '1';
  const content = swipeContentOf(row);
  const height = row.offsetHeight;
  row.style.height = `${height}px`;
  row.classList.add('removing');
  if (content) content.style.transform = 'translateX(-100%)';
  requestAnimationFrame(() => {
    row.style.height = '0px';
    row.style.opacity = '0';
  });
  setTimeout(async () => {
    try {
      await api('/api/reminders/' + reminder.id, { method: 'DELETE' });
      await loadState();
      render();
      toast('Item deleted');
    } catch (err) {
      toast(err.message);
      await loadState();
      render();
    }
  }, 230);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/* ---------------- Reminder actions ---------------- */

// One in-flight completion per item: a rapid double-tap must not send two
// PATCHes (for recurring series the second tap used to advance the series
// twice, silently skipping an occurrence).
const completingInFlight = new Set();

async function toggleCompleted(reminder, row) {
  // Optimistic feedback only: the check fills while the request is already
  // in flight. A failure re-renders the row's real state.
  if (completingInFlight.has(reminder.id)) return;
  completingInFlight.add(reminder.id);
  if (row && !reminder.completed) row.classList.add('completing');
  try {
    const result = await api('/api/reminders/' + reminder.id, {
      method: 'PATCH',
      body: { completed: !reminder.completed },
    });
    await loadState();
    render();
    if (result && result.advanced && result.nextDue) {
      const next = new Date(result.nextDue);
      toast(`Done — next: ${next.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
    }
  } catch (err) {
    if (row) row.classList.remove('completing');
    toast(err.message);
  } finally {
    completingInFlight.delete(reminder.id);
  }
}

/* ---------------- Editor ---------------- */

function syncDateTimeRows() {
  if ($('#e-time-on').checked) $('#e-date-on').checked = true;
  if (!$('#e-date-on').checked) $('#e-time-on').checked = false;
  if ($('#e-date-on').checked && !$('#e-date').value) $('#e-date').value = localDateValue(new Date());
  if ($('#e-time-on').checked && !$('#e-time').value) {
    $('#e-time').value = (state.settings && state.settings.default_time) || '09:00';
  }
  $('#e-date-row').hidden = !$('#e-date-on').checked;
  $('#e-time-row').hidden = !$('#e-time-on').checked;
  syncModelRows();
}

function updateEditorListVisual() {
  const list = listById(Number($('#e-list').value));
  $('#e-list-icon').style.setProperty('--c', colorVar(list ? list.color : 'blue'));
  $('#e-list-value').textContent = list ? list.name : '';
}

function setScope(scope) {
  state.editScope = scope === 'occurrence' ? 'occurrence' : 'series';
  $('#scope-occurrence').classList.toggle('active', state.editScope === 'occurrence');
  $('#scope-series').classList.toggle('active', state.editScope === 'series');
  $('#scope-occurrence').setAttribute('aria-pressed', state.editScope === 'occurrence' ? 'true' : 'false');
  $('#scope-series').setAttribute('aria-pressed', state.editScope === 'series' ? 'true' : 'false');
  syncEditorSubmit();
}

function syncRepeatRows() {
  const value = $('#e-repeat').value;
  $('#e-repeat-custom').hidden = value !== 'custom';
  $('#e-repeat-value').textContent = value === 'custom'
    ? `Every ${Math.max(1, Number($('#e-repeat-interval').value) || 1)} ${$('#e-repeat-unit').value}`
    : repeatLabel({ type: value, interval: 1 });
  const editing = Boolean(state.editingId);
  const recurring = value !== 'none';
  $('#completed-row').hidden = !editing || recurring;
  $('#series-section').hidden = !editing || !recurring;
}

function syncRecordRows() {
  const reminder = state.editingId
    ? findReminder(state.editingId)
    : null;
  const added = reminder ? formatRecordDate(reminder.created_at) : '';
  $('#e-added-row').hidden = !added;
  $('#e-added-value').textContent = added;
  const completed = reminder && reminder.completed && $('#e-completed').checked
    ? formatRecordDate(reminder.completed_at)
    : '';
  $('#e-completed-date-row').hidden = !completed;
  $('#e-completed-value').textContent = completed;
}

function renderSettingsZones(selected) {
  const select = $('#set-default-zone');
  if (!select) return;
  select.replaceChildren();
  select.append(el('option', { value: '', text: 'Device time zone' }));
  const zones = availableZones();
  for (const zone of zones) select.append(el('option', { value: zone, text: zone.replace(/_/g, ' ') }));
  const current = selected ? canonicalZone(selected) : '';
  if (current && !zones.includes(current)) {
    select.append(el('option', { value: current, text: current.replace(/_/g, ' ') }));
  }
  select.value = current;
}

function buildZoneOptions(selected) {
  const select = $('#e-zone');
  select.replaceChildren();
  const zones = availableZones();
  for (const zone of zones) {
    select.append(el('option', { value: zone, text: zone.replace(/_/g, ' ') }));
  }
  const current = selected ? canonicalZone(selected) : '';
  if (current && !zones.includes(current)) {
    select.append(el('option', { value: current, text: current.replace(/_/g, ' ') }));
  }
  select.value = current || zones[0] || 'UTC';
  updateZoneVisual();
}

function updateZoneVisual() {
  const value = $('#e-zone').value || '';
  $('#e-zone-value').textContent = value ? value.replace(/_/g, ' ') : 'Choose a time zone';
}

function syncModelRows() {
  const model = $('#e-model').value;
  $('#e-model-value').textContent = model === 'floating'
    ? 'My local time (Floating)' : 'Specific timezone';
  updateZoneVisual();
  // The time model only matters once a clock time exists; a date-only item
  // just asks for a date, so the choice stays out of the way.
  const timeOn = $('#e-time-on').checked;
  $('#e-model-row').hidden = !timeOn;
  $('#e-zone-row').hidden = !timeOn || model !== 'anchored';
  const hint = $('#e-model-hint');
  if (!timeOn) {
    hint.hidden = true;
    return;
  }
  if (model === 'floating') {
    const synced = (state.settings && state.settings.device_zone) || '';
    hint.hidden = false;
    hint.textContent = synced
      ? `Follows the last confirmed device zone (${synced}). Travel without opening the app cannot move it.`
      : 'Follows the last confirmed device zone once a device reports it.';
  } else if (model === 'anchored') {
    hint.hidden = false;
    hint.textContent = `Always fires at that clock time in ${$('#e-zone').value || 'the chosen zone'}.`;
  } else {
    hint.hidden = true;
  }
}

// Any manual touch of the Date/Time/Repeat controls wins over the
// natural-language autofill: your edits are never overwritten.
function markScheduleManual() {
  scheduleLocked = true;
  hideParseChip();
}

function onRepeatChange(manual = true) {
  syncRepeatRows();
  if (manual) markScheduleManual();
  if ($('#e-repeat').value !== 'none' && !$('#e-date-on').checked) {
    $('#e-date-on').checked = true;
    syncDateTimeRows();
  }
}

function syncSnoozeRow() {
  const reminder = state.editingId
    ? findReminder(state.editingId)
    : null;
  const row = $('#snooze-row');
  if (!reminder || !reminder.due_at) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  if (isSnoozed(reminder)) {
    $('#e-snooze-label').textContent = snoozeLabel(reminder.snoozed_until);
    $('#e-snooze-btn').textContent = 'Cancel';
  } else {
    $('#e-snooze-label').textContent = 'Snooze';
    $('#e-snooze-btn').textContent = 'Snooze 1h';
  }
}

async function toggleEditorSnooze() {
  const reminder = findReminder(state.editingId);
  if (!reminder) return;
  try {
    if (isSnoozed(reminder)) {
      await api('/api/reminders/' + reminder.id + '/snooze', { method: 'POST', body: { clear: true } });
      toast('Snooze cancelled');
    } else {
      const result = await api('/api/reminders/' + reminder.id + '/snooze', { method: 'POST', body: { hours: 1 } });
      toast(`Snoozed until ${new Date(result.snoozedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
    }
    await loadState();
    render();
    syncSnoozeRow();
  } catch (err) {
    toast(err.message);
  }
}

async function skipCurrentOccurrence() {
  if (!state.editingId) return;
  try {
    const result = await api('/api/reminders/' + state.editingId + '/skip', { method: 'POST' });
    closeSheet('#editor');
    await loadState();
    render();
    const next = new Date(result.nextDue);
    toast(`Skipped — next: ${next.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
  } catch (err) {
    toast(err.message);
  }
}

function formatOccurrenceDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

async function loadHistory(id) {
  const wrap = $('#e-history');
  wrap.replaceChildren();
  try {
    const data = await api('/api/reminders/' + id + '/occurrences');
    const rows = data.occurrences || [];
    if (!rows.length) {
      wrap.append(el('p', { class: 'history-empty', text: 'No completions or skips yet.' }));
    }
    for (const occurrence of rows) {
      const label = occurrence.status === 'completed' ? 'Done'
        : occurrence.status === 'skipped' ? 'Skipped' : 'Edited';
      const row = el('div', { class: 'history-row' }, [
        el('span', { class: 'history-status', text: label }),
        el('span', { class: 'history-date', text: formatOccurrenceDate(occurrence.occurrence_at) }),
      ]);
      if (occurrence.status === 'skipped') {
        row.append(el('button', {
          class: 'history-undo',
          type: 'button',
          text: 'Undo skip',
          onclick: () => undoSkip(id, occurrence.occurrence_at),
        }));
      }
      wrap.append(row);
    }
    wrap.hidden = false;
  } catch {
    wrap.hidden = true;
  }
}

// Removing the skip record entirely: if the occurrence sits before the
// series' current date the server moves the series back to it, so refresh
// the editor's date fields too when that item is open.
async function undoSkip(id, occurrenceAt) {
  try {
    const result = await api('/api/reminders/' + id + '/unskip', {
      method: 'POST',
      body: { occurrence_at: occurrenceAt },
    });
    await loadState();
    render();
    const reminder = findReminder(id);
    if (reminder && state.editingId === id) {
      const due = reminder.due_at ? new Date(reminder.due_at) : null;
      $('#e-date').value = due ? localDateValue(due) : '';
      $('#e-time').value = due && reminder.has_time ? localTimeValue(due) : '';
      editorSnapshot = editorValues();
      syncEditorSubmit();
    }
    await loadHistory(id);
    const next = new Date(result.dueAt);
    toast(`Skip undone — next: ${next.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
  } catch (err) {
    toast(err.message);
  }
}

// A new item asks for a name and nothing else: notes, date, time, repeat
// and list options stay behind More options until asked for. Editing an
// existing item always shows everything.
let editorSnapshot = null;

// Only compare values that the save actually sends: inactive date/time, the
// custom-repeat inputs when repeat is off, and the zone when the model is not
// anchored should not make the form look dirty.
function editorValues() {
  const dateOn = $('#e-date-on').checked;
  const timeOn = $('#e-time-on').checked;
  const repeat = $('#e-repeat').value;
  const model = $('#e-model').value;
  return {
    title: $('#e-title').value.trim(),
    notes: $('#e-notes').value.trim(),
    list: $('#e-list').value,
    dateOn,
    date: dateOn ? $('#e-date').value : '',
    timeOn,
    time: dateOn && timeOn ? $('#e-time').value : '',
    urgent: $('#e-urgent').checked,
    repeat,
    repeatInterval: repeat === 'custom' ? $('#e-repeat-interval').value : '',
    repeatUnit: repeat === 'custom' ? $('#e-repeat-unit').value : '',
    model,
    zone: model === 'anchored' ? $('#e-zone').value : '',
    completed: $('#e-completed').checked,
    scope: $('#series-section').hidden ? '' : state.editScope,
  };
}

function editorIsDirty() {
  if (!editorSnapshot) return false;
  const current = editorValues();
  return Object.keys(current).some((key) => current[key] !== editorSnapshot[key]);
}

function editorCanSubmit() {
  if (state.editorSaving) return false;
  if (!$('#e-title').value.trim()) return false;
  return state.editingId ? editorIsDirty() : true;
}

function syncEditorSubmit() {
  const submit = $('#editor-submit');
  if (submit) submit.disabled = !editorCanSubmit();
}

const MIN_SUBMIT_FEEDBACK_MS = 700;

async function settleSubmit(startedAt) {
  const remaining = MIN_SUBMIT_FEEDBACK_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function setEditorSubmitting(active) {
  state.editorSaving = active;
  const submit = $('#editor-submit');
  const form = $('#editor-form');
  submit.textContent = active
    ? (state.editingId ? 'Saving...' : 'Adding...')
    : (state.editingId ? 'Save' : 'Add');
  if (active) {
    form.setAttribute('aria-busy', 'true');
    submit.disabled = true;
  } else {
    form.removeAttribute('aria-busy');
    syncEditorSubmit();
  }
}

function setEditorMode(editing) {
  $('#editor').classList.toggle('is-new', !editing);
  const quick = $('#e-quick-actions');
  const more = $('#e-more');
  const toggle = $('#e-more-toggle');
  clearTimeout(more._hideTimer);
  const submit = $('#editor-submit');
  submit.textContent = editing ? 'Save' : 'Add';
  submit.setAttribute('aria-label', editing ? 'Save item' : 'Add item');
  if (editing) {
    quick.hidden = true;
    more.hidden = false;
    more.classList.add('expanded');
    $('#e-title').setAttribute('enterkeyhint', 'enter');
  } else {
    quick.hidden = false;
    more.hidden = true;
    more.classList.remove('expanded');
    toggle.setAttribute('aria-expanded', 'false');
    $('#e-more-label').textContent = 'More options';
    $('#e-title').setAttribute('enterkeyhint', 'done');
  }
}

function toggleEditorMore() {
  const more = $('#e-more');
  const toggle = $('#e-more-toggle');
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  clearTimeout(more._hideTimer);
  if (expanded) {
    toggle.setAttribute('aria-expanded', 'false');
    $('#e-more-label').textContent = 'More options';
    more.classList.remove('expanded');
    // Hide for keyboard/screen-reader users once the collapse has played.
    more._hideTimer = setTimeout(() => {
      if (toggle.getAttribute('aria-expanded') === 'false') more.hidden = true;
    }, 260);
  } else {
    toggle.setAttribute('aria-expanded', 'true');
    $('#e-more-label').textContent = 'Fewer options';
    more.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => more.classList.add('expanded')));
    setTimeout(() => autoGrowNotes(), 260);
  }
}

function openEditor(id) {
  const reminder = id ? findReminder(id) : null;
  if (!state.lists.length) {
    toast('Create a list first');
    openListSheet(null);
    return;
  }

  clearTimeout(parseTimer);
  scheduleLocked = false;
  parseSnapshot = null;
  hideParseChip();

  state.editingId = reminder ? reminder.id : null;
  $('#editor-heading').textContent = reminder ? 'Edit Item' : 'New Item';
  $('#e-title').value = reminder ? reminder.title : '';
  clearFieldError($('#e-title'), $('#e-title-error'));
  $('#e-notes').value = reminder ? reminder.notes : '';

  const select = $('#e-list');
  select.replaceChildren();
  for (const list of state.lists) {
    select.append(el('option', { value: String(list.id), text: list.name }));
  }
  select.value = String(reminder ? reminder.list_id : defaultListId());
  updateEditorListVisual();

  const due = reminder && reminder.due_at ? new Date(reminder.due_at) : null;
  $('#e-date-on').checked = Boolean(due);
  $('#e-time-on').checked = Boolean(due && reminder.has_time);
  $('#e-date').value = due ? localDateValue(due) : '';
  $('#e-time').value = due && reminder.has_time ? localTimeValue(due) : '';
  $('#e-urgent').checked = Boolean(reminder && reminder.urgent);
  syncDateTimeRows();

  const rule = parseRuleClient(reminder ? reminder.repeat_rule : 'none');
  if (rule.type === 'custom') {
    $('#e-repeat').value = 'custom';
    $('#e-repeat-interval').value = rule.interval || 2;
    $('#e-repeat-unit').value = rule.unit || 'days';
  } else {
    $('#e-repeat').value = rule.type;
  }
  // The editor offers Floating and Anchored only; anything older (a Fixed
  // item from an old backup) opens as Floating.
  $('#e-model').value = reminder && reminder.time_model === 'anchored'
    ? 'anchored'
    : (!reminder && state.settings && state.settings.default_time_model === 'anchored')
      ? 'anchored'
      : 'floating';
  buildZoneOptions(reminder
    ? reminder.time_zone
    : ((state.settings && state.settings.default_time_zone) || deviceZone()));
  setScope('series');
  syncRepeatRows();
  syncModelRows();

  const editing = Boolean(reminder);
  setEditorMode(editing);
  $('#e-completed').checked = editing && reminder.completed;
  syncRecordRows();
  $('#e-delete').hidden = !editing;
  renderEditorLinks();
  syncSnoozeRow();
  $('#e-history').hidden = true;
  if (editing && rule.type !== 'none') loadHistory(reminder.id);
  editorSnapshot = editing ? editorValues() : null;
  syncEditorSubmit();

  openSheet('#editor');
  setTimeout(() => {
    autoGrowTitle();
    autoGrowNotes();
    $('#e-title').focus();
  }, 80);
}

async function saveEditor(event) {
  event.preventDefault();
  if (state.editorSaving) return; // already saving - ignore double Enter/Add
  const titleInput = $('#e-title');
  const title = titleInput.value.trim();
  if (!title) {
    showFieldError(titleInput, $('#e-title-error'), 'Title is required');
    return;
  }
  clearFieldError(titleInput, $('#e-title-error'));

  const listId = Number($('#e-list').value);
  const dateOn = $('#e-date-on').checked;
  const timeOn = $('#e-time-on').checked;
  const dateValue = dateOn ? $('#e-date').value : '';
  const timeValue = timeOn ? $('#e-time').value : '';
  if (dateOn && !dateValue) return toast('Choose a date');
  if (timeOn && !dateValue) return toast('Choose a date for the time');

  let dueAt = null;
  let hasTime = 0;
  const current = state.editingId
    ? findReminder(state.editingId)
    : null;
  if (dateValue) {
    const [year, month, day] = dateValue.split('-').map(Number);
    if (timeOn && timeValue) {
      const [hours, minutes] = timeValue.split(':').map(Number);
      dueAt = new Date(year, month - 1, day, hours, minutes).toISOString();
      hasTime = 1;
    } else {
      const [defHours, defMinutes] = String((state.settings && state.settings.default_time) || '09:00').split(':').map(Number);
      dueAt = new Date(year, month - 1, day, defHours, defMinutes).toISOString();
      // Date-only items hide their stored timestamp (09:00 of the saved
      // day). Editing the title must not silently rewrite it to the
      // current default: keep the stored instant unless the user changed
      // the date the editor is showing.
      if (current && current.due_at && !current.has_time
        && dateValue === localDateValue(new Date(current.due_at))) {
        dueAt = current.due_at;
      }
    }
  }

  const repeatValue = $('#e-repeat').value;
  let repeatRule = 'none';
  if (repeatValue !== 'none') {
    if (!dateOn) return toast('Repeating items need a date');
    if (repeatValue === 'custom') {
      const interval = Math.max(1, Math.min(366, Number($('#e-repeat-interval').value) || 1));
      repeatRule = { type: 'custom', interval, unit: $('#e-repeat-unit').value };
    } else {
      repeatRule = { type: repeatValue, interval: 1 };
    }
  }

  const model = $('#e-model').value;
  const editingSeries = current && parseRuleClient(current.repeat_rule).type !== 'none';
  const scope = editingSeries ? state.editScope : 'series';
  const body = {
    title,
    notes: $('#e-notes').value,
    list_id: listId,
    urgent: $('#e-urgent').checked,
    device_zone: deviceZone(),
  };
  if (scope === 'occurrence') {
    // Occurrence-only edits carry just the overridden fields; date changes
    // always go through the series path (the server enforces this too).
    // device_zone is a series-mode settings echo — occurrence scope rejects it.
    delete body.device_zone;
    body.scope = 'occurrence';
  } else {
    body.due_at = dueAt;
    body.has_time = hasTime;
    body.repeat_rule = repeatRule;
    body.time_model = model;
    body.time_zone = model === 'anchored' ? $('#e-zone').value : (model === 'floating' ? deviceZone() || null : null);
    // Recurring series are never marked completed — completing advances them.
    if (!editingSeries) body.completed = $('#e-completed').checked;
  }

  const startedAt = Date.now();
  setEditorSubmitting(true);
  try {
    if (state.editingId) {
      await api('/api/reminders/' + state.editingId, { method: 'PATCH', body });
    } else {
      const created = await api('/api/reminders', { method: 'POST', body });
      state.justAddedId = created && created.id ? created.id : null;
    }
    setLastList(listId);
    await settleSubmit(startedAt);
    closeSheet('#editor');
    await loadState();
    render();
  } catch (err) {
    // Sheet stays open with the fields intact, so nothing typed is lost.
    toast(err.message);
  } finally {
    setEditorSubmitting(false);
  }
}

/* ---------------- Natural-language quick add ---------------- */

let parseTimer = null;
let parseSeq = 0;
let parseSnapshot = null;
let scheduleLocked = false;

function hideParseChip() {
  $('#e-parse-chip').hidden = true;
}

function scheduleParse() {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(runParse, 450);
}

async function runParse() {
  const text = $('#e-title').value;
  if ($('#editor').hidden || scheduleLocked || text.trim().length < 3) return;
  const seq = ++parseSeq;
  let result;
  try {
    result = await api('/api/parse', { method: 'POST', body: { text, timeZone: deviceZone() } });
  } catch {
    return; // offline: the title still saves verbatim
  }
  if (seq !== parseSeq || $('#editor').hidden || scheduleLocked) return;
  applyParse(result);
}

function chipDateLabel(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!timeStr) return label;
  const [h, mi] = timeStr.split(':').map(Number);
  const time = new Date(y, mo - 1, d, h, mi)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${label} · ${time}`;
}

function applyParse(result) {
  if ((!result.date) && (!result.repeat || result.repeat === 'none')) {
    hideParseChip();
    return;
  }
  parseSnapshot = {
    dateOn: $('#e-date-on').checked,
    timeOn: $('#e-time-on').checked,
    date: $('#e-date').value,
    time: $('#e-time').value,
    repeat: $('#e-repeat').value,
    interval: $('#e-repeat-interval').value,
    unit: $('#e-repeat-unit').value,
  };
  if (result.date) {
    $('#e-date-on').checked = true;
    $('#e-date').value = result.date;
    if (result.hasTime && result.time) {
      $('#e-time-on').checked = true;
      $('#e-time').value = result.time;
    } else {
      $('#e-time-on').checked = false;
    }
    syncDateTimeRows();
  }
  if (result.repeat && result.repeat !== 'none') {
    if (result.repeat.type === 'custom') {
      $('#e-repeat').value = 'custom';
      $('#e-repeat-interval').value = result.repeat.interval;
      $('#e-repeat-unit').value = result.repeat.unit;
    } else {
      $('#e-repeat').value = result.repeat.type;
    }
    onRepeatChange(false);
  }
  const parts = [];
  if (result.date) parts.push(chipDateLabel(result.date, result.time));
  if (result.repeat && result.repeat !== 'none') parts.push(repeatLabel(result.repeat));
  $('#e-parse-text').textContent = parts.join(' · ') || 'Parsed';
  $('#e-parse-chip').hidden = false;
  syncEditorSubmit();
}

function clearParse() {
  if (parseSnapshot) {
    $('#e-date-on').checked = parseSnapshot.dateOn;
    $('#e-time-on').checked = parseSnapshot.timeOn;
    $('#e-date').value = parseSnapshot.date;
    $('#e-time').value = parseSnapshot.time;
    $('#e-repeat').value = parseSnapshot.repeat;
    $('#e-repeat-interval').value = parseSnapshot.interval;
    $('#e-repeat-unit').value = parseSnapshot.unit;
    syncDateTimeRows();
    syncRepeatRows();
  }
  parseSnapshot = null;
  scheduleLocked = true;
  hideParseChip();
  syncEditorSubmit();
}

async function deleteReminder() {
  if (!state.editingId) return;
  if (!window.confirm('Delete this item?')) return;
  try {
    await api('/api/reminders/' + state.editingId, { method: 'DELETE' });
    closeSheet('#editor');
    await loadState();
    render();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------- Lists ---------------- */

function nextListColor() {
  // Pre-select the first palette color no list uses yet, so every list
  // starts distinct. When all 15 are taken, rotate through the palette.
  const used = new Set(state.lists.map((list) => list.color));
  const free = COLORS.find((color) => !used.has(color));
  if (free) return free;
  return COLORS[state.lists.length % COLORS.length];
}

let listSnapshot = null;
let listSaving = false;

function listCanSubmit() {
  if (listSaving) return false;
  const name = $('#l-name').value.trim();
  if (!name) return false;
  if (!listSnapshot) return true;
  return name !== listSnapshot.name || state.selectedColor !== listSnapshot.color;
}

function syncListSubmit() {
  const submit = $('#list-save');
  if (submit) submit.disabled = !listCanSubmit();
}

function openListSheet(list) {
  const system = Boolean(list && list.is_system);
  state.editingListId = list ? list.id : null;
  state.selectedColor = list ? list.color : nextListColor();
  $('#list-heading').textContent = list ? (system ? 'Unlisted' : 'Edit List') : 'New List';
  $('#l-name').value = list ? list.name : '';
  clearFieldError($('#l-name'), $('#l-name-error'));
  $('#l-name').disabled = system;
  $('#l-delete').hidden = !list || system;
  $('#list-save').textContent = 'Save';
  $('#list-sheet').removeAttribute('aria-busy');
  renderSwatches();
  listSnapshot = list
    ? { name: $('#l-name').value.trim(), color: state.selectedColor }
    : null;
  syncListSubmit();
  openSheet('#list-sheet');
  if (!system) setTimeout(() => $('#l-name').focus(), 80);
}

function renderSwatches() {
  const wrap = $('#swatches');
  wrap.replaceChildren();
  for (const color of COLORS) {
    wrap.append(el('button', {
      type: 'button',
      class: 'swatch' + (color === state.selectedColor ? ' selected' : ''),
      style: { '--c': colorVar(color) },
      'aria-label': 'Color ' + color,
      onclick: () => {
        state.selectedColor = color;
        renderSwatches();
        syncListSubmit();
      },
    }));
  }
}

async function saveList(event) {
  event.preventDefault();
  if (listSaving || $('#list-save').disabled) return;
  const existing = state.editingListId ? listById(state.editingListId) : null;
  const system = Boolean(existing && existing.is_system);
  const nameInput = $('#l-name');
  const name = nameInput.value.trim();
  if (!name) {
    showFieldError(nameInput, $('#l-name-error'), 'List name is required');
    return;
  }
  clearFieldError(nameInput, $('#l-name-error'));

  const body = system
    ? { color: state.selectedColor }
    : { name, color: state.selectedColor };
  const startedAt = Date.now();
  let created = null;
  listSaving = true;
  $('#list-save').textContent = 'Saving...';
  $('#list-save').disabled = true;
  $('#list-sheet').setAttribute('aria-busy', 'true');
  try {
    if (system) {
      await api('/api/lists/' + existing.id, { method: 'PATCH', body });
    } else if (state.editingListId) {
      await api('/api/lists/' + state.editingListId, { method: 'PATCH', body });
    } else {
      created = await api('/api/lists', { method: 'POST', body });
    }
    listSnapshot = { name, color: state.selectedColor };
    await settleSubmit(startedAt);
    closeSheet('#list-sheet');
    await loadState();
    if (!system && !state.editingListId) go('list/' + created.id);
    else render();
  } catch (err) {
    toast(err.message);
  } finally {
    listSaving = false;
    $('#list-save').textContent = 'Save';
    $('#list-sheet').removeAttribute('aria-busy');
    syncListSubmit();
  }
}

async function deleteList() {
  if (!state.editingListId) return;
  if (!window.confirm('Delete this list and all of its items?')) return;
  const id = state.editingListId;
  try {
    await api('/api/lists/' + id, { method: 'DELETE' });
    closeSheet('#list-sheet');
    await loadState();
    if (state.view === id) go('home');
    else render();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------- Push notifications ---------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('Service worker registration failed:', err.message);
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function syncPushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    state.subscription = await registration.pushManager.getSubscription();
  } catch {
    state.subscription = null;
  }
  renderSidebar();
  updateNotifyUI();
}

function updateNotifyUI() {
  const enabled = Boolean(state.subscription);
  $('#notify-status').textContent = enabled
    ? 'Notifications are on for this device. You will be notified when an item is due.'
    : 'Allow ToDo to send a notification when an item is due.';
  $('#notify-enable').hidden = enabled;
  $('#notify-test').hidden = !enabled;
  $('#notify-disable').hidden = !enabled;
  $('#notifications-label').textContent = enabled ? 'Notifications On' : 'Notifications';
}

function openNotifySheet() {
  closeAccountMenu();
  const standalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const hint = $('#notify-hint');
  const enable = $('#notify-enable');

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    hint.hidden = false;
    hint.textContent = 'This browser does not support web push notifications.';
    enable.disabled = true;
  } else if (isIOS && !standalone) {
    hint.hidden = false;
    hint.textContent = 'On iPhone or iPad, notifications only work after adding ToDo to your Home Screen: tap Share, then Add to Home Screen, and open it from there.';
    enable.disabled = true;
  } else {
    hint.hidden = true;
    enable.disabled = false;
  }

  updateNotifyUI();
  openSheet('#notify-sheet');
}

async function enableNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notification permission was not granted');
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey),
    });
    await api('/api/push/subscribe', {
      method: 'POST',
      body: { subscription: subscription.toJSON() },
    });
    state.subscription = subscription;
    updateNotifyUI();
    toast('Notifications enabled');
  } catch (err) {
    toast(err.message || 'Could not enable notifications');
  }
}

async function disableNotifications() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = state.subscription || await registration.pushManager.getSubscription();
    if (subscription) {
      await api('/api/push/unsubscribe', {
        method: 'POST',
        body: { endpoint: subscription.endpoint },
      });
      await subscription.unsubscribe();
    }
    state.subscription = null;
    updateNotifyUI();
    toast('Notifications turned off');
  } catch (err) {
    toast(err.message);
  }
}

async function sendTestNotification() {
  try {
    const result = await api('/api/push/test', { method: 'POST' });
    if (!result.sent) toast('No device is subscribed for notifications');
    else toast('Test notification sent');
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------- Sheets ---------------- */

let lastFocused = null;

function syncSheetState() {
  const anyOpen = $$('.sheet').some((sheet) => !sheet.hidden);
  document.body.classList.toggle('sheet-open', anyOpen);
  if (!anyOpen && lastFocused && document.contains(lastFocused)) {
    try { lastFocused.focus({ preventScroll: true }); } catch { /* ignore */ }
    lastFocused = null;
  }
}

// Sheets are anchored to browser History so Back closes them like Escape:
// each open pushes one same-URL marker entry (no hashchange, so the background
// never re-renders); one Back press pops one marker and closes the topmost
// sheet with the same cancel semantics as Escape.
let sheetPopGuard = false;

function openSheet(selector) {
  if (!$$('.sheet').some((sheet) => !sheet.hidden)) {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  $(selector).hidden = false;
  try {
    const depth = (history.state && history.state.todoSheet || 0) + 1;
    history.pushState({ todoSheet: depth }, '', location.href);
  } catch { /* history unavailable (sandboxed frame): sheets still work */ }
  syncSheetState();
}

// App-initiated close of one sheet: consume exactly one marker entry so the
// user's next Back navigates the background as usual.
function consumeSheetMarker() {
  if (history.state && history.state.todoSheet) {
    sheetPopGuard = true;
    history.back();
  }
}

function closeSheet(selector) {
  $(selector).hidden = true;
  syncSheetState();
  consumeSheetMarker();
}

// Close the topmost sheet without touching History — composed by the
// user-facing paths below and used directly by the popstate handler (the
// traversal has already consumed that map's entry).
function closeTopSheetInPlace() {
  const open = $$('.sheet').filter((sheet) => !sheet.hidden);
  if (open.length) {
    const sheet = open[open.length - 1];
    if (sheet.id === 'settings-sheet') revertSettingsPreview();
    sheet.hidden = true;
  }
  syncSheetState();
  return open.length > 0;
}

function closeTopSheet() {
  const closed = closeTopSheetInPlace();
  if (closed) consumeSheetMarker();
  return closed;
}

function focusableIn(sheet) {
  return $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', sheet)
    .filter((node) => !node.disabled && node.offsetParent !== null);
}

// Keep Tab inside the topmost sheet (WCAG 2.2 AA): focus wraps instead of
// escaping to the page behind.
function trapSheetTab(event) {
  const open = $$('.sheet').filter((sheet) => !sheet.hidden);
  if (!open.length) return;
  const sheet = open[open.length - 1];
  if (!sheet.contains(event.target)) return;
  const focusable = focusableIn(sheet);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && event.target === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && event.target === last) {
    event.preventDefault();
    first.focus();
  }
}

// Interactive swipe: the card follows the pointer and reveals Delete beneath
// it. Completion lives on the checkbox, so there is no Done swipe action.
// Releasing past the threshold asks to delete; otherwise the card springs
// back. Works with touch and mouse (pointer events), vertical scrolling
// passes through untouched (rows declare touch-action: pan-y), and links /
// buttons opt out.
let swipe = null;
let lastSwipeEnd = 0;
let mouseDrag = null;

function swipeContentOf(row) {
  return row ? row.querySelector('.swipe-content') : null;
}

function resetSwipe(row) {
  const content = swipeContentOf(row);
  if (content) {
    content.classList.remove('swiping');
    content.style.transform = '';
  }
  if (row) row.classList.remove('swipe-open', 'swipe-active');
  const action = row ? row.querySelector('.swipe-act.del') : null;
  if (action) {
    action.dataset.confirm = '';
    const label = action.querySelector('.del-label');
    if (label) label.textContent = 'Delete';
    action.setAttribute('aria-label', 'Delete item');
  }
}

function snapSwipeOpen(row) {
  const content = swipeContentOf(row);
  if (!content) return;
  const max = Math.min(140, (row.offsetWidth || 300) * 0.45);
  content.classList.remove('swiping');
  content.style.transform = `translateX(-${max}px)`;
  row.classList.remove('swipe-active');
  row.classList.add('swipe-open');
  const action = row.querySelector('.swipe-act.del');
  if (action) {
    action.dataset.confirm = '';
    const label = action.querySelector('.del-label');
    if (label) label.textContent = 'Delete';
    action.setAttribute('aria-label', 'Delete item');
  }
}

function releaseSwipePointer(current) {
  if (!current || !current.row) return;
  try { current.row.releasePointerCapture(current.pointerId); } catch { /* already released */ }
}

$('#content').addEventListener('pointerdown', (event) => {
  // Swipe-to-reveal is a touch gesture. On the web, the × is the delete path.
  if (event.pointerType === 'mouse') {
    mouseDrag = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    return;
  }
  if (event.button !== undefined && event.button !== 0) return;
  // Starting a gesture elsewhere closes any parked row.
  $$('.reminder.swipe-open').forEach((node) => {
    if (!node.contains(event.target)) resetSwipe(node);
  });
  const row = event.target.closest('.reminder');
  if (!row || event.target.closest('a, button, input, textarea, select')) {
    swipe = null;
    return;
  }
  swipe = {
    id: Number(row.dataset.reminderId),
    row,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  try { row.setPointerCapture(event.pointerId); } catch { /* ignore */ }
});

$('#content').addEventListener('pointermove', (event) => {
  // A mouse drag is not a gesture, but it must not become a click on release.
  if (event.pointerType === 'mouse' && mouseDrag) {
    if (Math.abs(event.clientX - mouseDrag.x) > 8 || Math.abs(event.clientY - mouseDrag.y) > 8) {
      lastSwipeEnd = Date.now();
    }
    return;
  }
  if (!swipe || event.pointerId !== swipe.pointerId) return;
  if (!document.contains(swipe.row)) {
    swipe = null;
    return;
  }
  const dx = event.clientX - swipe.startX;
  const dy = event.clientY - swipe.startY;
  if (!swipe.active) {
    if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
    // A rightward drag closes a parked row (revealed Delete) and otherwise
    // is ignored; either way it must not become a click on release.
    if (dx > 0) {
      if (swipe.row.classList.contains('swipe-open')) resetSwipe(swipe.row);
      lastSwipeEnd = Date.now();
      swipe = null;
      return;
    }
    swipe.active = true;
    const content = swipeContentOf(swipe.row);
    if (content) content.classList.add('swiping');
    swipe.row.classList.add('swipe-active');
  }
  event.preventDefault();
  const content = swipeContentOf(swipe.row);
  if (!content) return;
  const max = Math.min(140, (swipe.row.offsetWidth || 300) * 0.45);
  const clamped = Math.max(-max, Math.min(0, dx));
  content.style.transform = clamped ? `translateX(${clamped}px)` : '';
});

async function endSwipe(commit) {
  const current = swipe;
  swipe = null;
  if (!current || !current.active) return;
  lastSwipeEnd = Date.now();
  releaseSwipePointer(current);
  const reminder = findReminder(current.id);
  if (!reminder || commit === 0) {
    resetSwipe(current.row);
    return;
  }
  // Park the row on the red Delete action. The user must tap Delete, then
  // Confirm? — no browser dialog. Completed rows can be deleted too.
  snapSwipeOpen(current.row);
}

$('#content').addEventListener('pointerup', (event) => {
  if (event.pointerType === 'mouse') {
    mouseDrag = null;
    return;
  }
  if (!swipe || event.pointerId !== swipe.pointerId) return;
  if (!swipe.active) {
    swipe = null;
    return;
  }
  const dx = event.clientX - swipe.startX;
  const width = swipe.row.offsetWidth || 300;
  const threshold = Math.min(100, width * 0.35);
  endSwipe(Math.abs(dx) < threshold ? 0 : dx);
});

$('#content').addEventListener('pointercancel', () => {
  mouseDrag = null;
  if (swipe && swipe.active) {
    resetSwipe(swipe.row);
    releaseSwipePointer(swipe);
  }
  swipe = null;
});


/* ---------------- Theme & settings ---------------- */

const THEME_PREF_KEY = 'theme-preference';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let themePreference = localStorage.getItem(THEME_PREF_KEY) || 'auto';

function applyTheme(pref, persist = true) {
  themePreference = ['auto', 'light', 'dark'].includes(pref) ? pref : 'auto';
  if (persist) localStorage.setItem(THEME_PREF_KEY, themePreference);
  const dark = themePreference === 'dark' || (themePreference === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#000000' : '#f5efe6');
  $$('.theme-option-btn').forEach((btn) => {
    const active = btn.dataset.themePref === themePreference;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderDeviceZoneRow() {
  const s = state.settings;
  const serverZone = s.device_zone || '';
  $('#device-zone-label').textContent = serverZone
    ? `Floating items follow ${serverZone} — the last zone a device confirmed${s.device_zone_updated_at ? ` (${new Date(s.device_zone_updated_at).toLocaleString()})` : ''}.`
    : 'No device has confirmed its time zone yet — open the app once online.';
  const device = deviceZone();
  const useDevice = $('#zone-use-device');
  useDevice.hidden = !device || device === canonicalZone(serverZone);
  if (!useDevice.hidden) useDevice.textContent = `Use this device's time zone (${device})`;
}

const SETTINGS_DEFAULT_KEYS = ['default_time_model', 'default_time_zone', 'default_time'];
const SETTINGS_NOTIFY_KEYS = ['repush_enabled', 'repush_cadence_min', 'repush_max', 'quiet_start', 'quiet_end'];
let settingsSnapshot = null;
let sortSnapshot = null;
let appearanceSnapshot = null;
let settingsSaving = false;

function appearanceValues() {
  return {
    theme: themePreference,
    density: localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable',
  };
}

function appearanceIsDirty() {
  if (!appearanceSnapshot) return false;
  const current = appearanceValues();
  return current.theme !== appearanceSnapshot.theme
    || current.density !== appearanceSnapshot.density;
}

function revertSettingsAppearance() {
  if (!appearanceSnapshot) return;
  const current = appearanceValues();
  if (current.theme !== appearanceSnapshot.theme) applyTheme(appearanceSnapshot.theme);
  if (current.density !== appearanceSnapshot.density) {
    localStorage.setItem(DENSITY_KEY, appearanceSnapshot.density);
    applyDensity();
  }
  appearanceSnapshot = null;
}

// Cancel/backdrop/Escape: undo the live previews that are not committed by
// Save — device appearance (theme/density) and the server-backed list
// progress choices.
function revertSettingsPreview() {
  revertSettingsAppearance();
  if (settingsSnapshot) {
    for (const key of SETTINGS_PROGRESS_KEYS) {
      if (key in settingsSnapshot) state.settings[key] = settingsSnapshot[key];
    }
    $('#set-list-progress').value = getListProgress();
    $('#set-list-progress-range').value = getListProgressRange();
    renderSidebar();
  }
}

function settingsValues() {
  return {
    default_time_model: $('#set-default-model').value,
    default_time_zone: $('#set-default-zone').value,
    default_time: $('#set-default-time').value,
    repush_enabled: $('#set-repush').checked ? '1' : '0',
    repush_cadence_min: $('#set-repush-cadence').value,
    repush_max: $('#set-repush-max').value,
    quiet_start: $('#set-quiet-start').value,
    quiet_end: $('#set-quiet-end').value,
    list_progress: $('#set-list-progress').value,
    list_progress_range: $('#set-list-progress-range').value,
  };
}

function sortValues() {
  return {
    field: $('#set-sort-field').value,
    dir: $('#set-sort-dir').value,
  };
}

function sortIsDirty() {
  if (!sortSnapshot) return false;
  const current = sortValues();
  return current.field !== sortSnapshot.field || current.dir !== sortSnapshot.dir;
}

function updateSettingsDirty(preserveMessage = false) {
  if (!settingsSnapshot) return;
  const current = settingsValues();
  const dirty = appearanceIsDirty()
    || sortIsDirty()
    || Object.keys(current).some((key) => current[key] !== settingsSnapshot[key]);
  $('#settings-save').disabled = settingsSaving || !dirty;
  if (dirty && !preserveMessage) $('#settings-msg').hidden = true;
}

async function openSettings() {
  closeAccountMenu();
  applyTheme(themePreference, false);
  $('#pw-msg').hidden = true;
  $('#settings-msg').hidden = true;
  try {
    Object.assign(state.settings, await api('/api/settings'));
  } catch {
    // Offline: show last-known values.
  }
  const s = state.settings;
  $('#set-density').value = localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  $('#set-default-model').value = ['floating', 'anchored'].includes(s.default_time_model)
    ? s.default_time_model : 'floating';
  renderSettingsZones(s.default_time_zone || '');
  $('#set-default-time').value = s.default_time || '09:00';
  $('#set-repush').checked = s.repush_enabled === '1';
  $('#set-repush-cadence').value = s.repush_cadence_min || '60';
  $('#set-repush-max').value = s.repush_max || '3';
  $('#set-quiet-start').value = s.quiet_start || '23:00';
  $('#set-quiet-end').value = s.quiet_end || '07:00';
  $('#set-list-progress').value = getListProgress();
  $('#set-list-progress-range').value = getListProgressRange();
  $('#set-sort-field').value = state.sortDefault.field;
  $('#set-sort-dir').value = state.sortDefault.dir;
  syncSortDirLabels($('#set-sort-field'), $('#set-sort-dir'));
  renderDeviceZoneRow();
  $('#token-once').hidden = true;
  $('#token-name').value = '';
  await renderTokenList();
  $('#settings-save').textContent = 'Save';
  $('#settings-sheet').removeAttribute('aria-busy');
  appearanceSnapshot = appearanceValues();
  settingsSnapshot = settingsValues();
  sortSnapshot = sortValues();
  updateSettingsDirty();
  openSheet('#settings-sheet');
}

function settingsMessage(message, ok = false) {
  const node = $('#settings-msg');
  node.textContent = message;
  node.classList.toggle('ok', ok);
  node.hidden = false;
}

async function saveAppSettings() {
  if (settingsSaving) return;
  const current = settingsValues();
  const previous = settingsSnapshot || {};
  const changed = (keys) => keys.some((key) => current[key] !== previous[key]);
  const defaultsChanged = changed(SETTINGS_DEFAULT_KEYS);
  const notifyChanged = changed(SETTINGS_NOTIFY_KEYS);
  const progressChanged = changed(SETTINGS_PROGRESS_KEYS);
  const appearanceDirty = appearanceIsDirty();
  const sortChanged = sortIsDirty();
  if (!defaultsChanged && !notifyChanged && !progressChanged && !appearanceDirty && !sortChanged) return;

  const saveBtn = $('#settings-save');
  const startedAt = Date.now();
  settingsSaving = true;
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;
  $('#settings-sheet').setAttribute('aria-busy', 'true');
  try {
    let message = '';
    if (defaultsChanged || notifyChanged || progressChanged) {
      try {
        const result = await api('/api/settings', {
          method: 'POST',
          body: { settings: current },
        });
        state.settings = result.settings || state.settings;
        settingsSnapshot = current;
        cacheListProgress();
        renderSidebar();
        if (defaultsChanged && notifyChanged) {
          message = 'Saved. New item defaults apply to new items only; notification changes apply to all items from now on.';
        } else if (notifyChanged) {
          message = 'Saved — applies to how all items notify from now on.';
        } else if (defaultsChanged) {
          message = 'Saved. Applies to new items only — existing items were not changed.';
        } else {
          message = 'Saved — list progress now follows you on all devices.';
        }
        $('#settings-msg').hidden = true;
      } catch (err) {
        settingsMessage(err.message);
        return;
      }
    }
    if (sortChanged) {
      const sort = sortValues();
      state.sortDefault = sort;
      state.sortOverrides = {};
      localStorage.setItem('todo.sortField', sort.field);
      localStorage.setItem('todo.sortDir', sort.dir);
      saveSortOverrides();
      await pushSortWrite({ apply_all: true, field: sort.field, dir: sort.dir }, { applyAll: sort });
      sortSnapshot = sort;
      render();
      message = message
        ? `${message} Sorting applied to all lists.`
        : 'Saved — sorting applied to all lists.';
    }
    if (appearanceDirty) {
      message = message
        ? `${message} Appearance applies to this device.`
        : 'Saved — appearance applies to this device.';
    }
    if (!message) message = 'Saved.';
    toast(message);
    appearanceSnapshot = null;
    saveBtn.disabled = true;
    await settleSubmit(startedAt);
    closeSheet('#settings-sheet');
  } finally {
    settingsSaving = false;
    saveBtn.textContent = 'Save';
    $('#settings-sheet').removeAttribute('aria-busy');
    updateSettingsDirty(true);
  }
}

async function renderTokenList() {
  const wrap = $('#token-list');
  wrap.replaceChildren();
  let tokens = [];
  try {
    const data = await api('/api/tokens');
    tokens = data.tokens || [];
  } catch (err) {
    wrap.append(el('p', { class: 'form-msg', text: err.message }));
    return;
  }
  if (!tokens.length) {
    wrap.append(el('p', { class: 'notify-hint', text: 'No tokens yet.' }));
    return;
  }
  for (const token of tokens) {
    const profileLabel = token.profile === 'write' ? 'read + write'
      : token.profile === 'legacy' ? 'legacy (pre-profiles)'
      : 'read only';
    const row = el('div', { class: 'token-row' }, [
      el('span', { class: 'token-name', text: token.name || 'token' }),
      el('span', {
        class: 'token-meta',
        text: token.revoked_at
          ? `revoked · ${profileLabel}`
          : `${profileLabel} · used ${token.last_used_at ? new Date(token.last_used_at).toLocaleDateString() : 'never'}`,
      }),
    ]);
    if (!token.revoked_at) {
      const targets = token.profile === 'legacy' ? ['read', 'write']
        : token.profile === 'write' ? ['read']
        : ['write'];
      const select = el('select', {
        class: 'secondary-btn small-btn',
        'aria-label': `Change access for ${token.name || 'token'}`,
      });
      for (const target of targets) {
        select.append(el('option', {
          value: target,
          text: target === 'write' ? 'read + write' : 'read only',
        }));
      }
      row.append(select);
      row.append(el('button', {
        type: 'button',
        class: 'secondary-btn small-btn',
        text: 'Change access',
        onclick: async () => {
          if (!window.confirm(`Change "${token.name || 'token'}" to "${select.value === 'write' ? 'read + write' : 'read only'}"? Capability changes apply immediately.`)) return;
          try {
            await api('/api/tokens/' + token.id + '/profile', { method: 'POST', body: { profile: select.value } });
            await renderTokenList();
            toast('Token access changed');
          } catch (err) {
            toast(err.message);
          }
        },
      }));
      row.append(el('button', {
        type: 'button',
        class: 'secondary-btn small-btn',
        text: 'Revoke',
        onclick: async () => {
          if (!window.confirm(`Revoke the token "${token.name || 'token'}"? Agents using it stop working immediately.`)) return;
          try {
            await api('/api/tokens/' + token.id + '/revoke', { method: 'POST' });
            await renderTokenList();
            toast('Token revoked');
          } catch (err) {
            toast(err.message);
          }
        },
      }));
    }
    wrap.append(row);
  }
}

async function generateToken() {
  const name = $('#token-name').value.trim() || 'agent';
  const profile = $('#token-profile') ? $('#token-profile').value : 'read';
  try {
    const result = await api('/api/tokens', { method: 'POST', body: { name, profile } });
    $('#token-value').textContent = result.token;
    $('#token-once').hidden = false;
    $('#token-name').value = '';
    await renderTokenList();
  } catch (err) {
    toast(err.message);
  }
}

async function exportBackup() {
  try {
    const res = await fetch('/api/export', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `todo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Backup downloaded');
  } catch (err) {
    toast(err.message || 'Export failed');
  }
}

function importMessage(message, ok = false) {
  const node = $('#import-msg');
  node.textContent = message;
  node.classList.toggle('ok', ok);
  node.hidden = false;
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const result = await api('/api/import', { method: 'POST', body: { data } });
    importMessage(
      `Imported ${result.listsAdded} lists and ${result.remindersAdded} items ` +
      `(${result.listsSkipped + result.remindersSkipped + result.occurrencesSkipped} skipped as already present).`,
      true
    );
    await loadState();
    render();
  } catch (err) {
    importMessage(err.message);
  }
}

function passwordMessage(message, ok = false) {
  const node = $('#pw-msg');
  node.textContent = message;
  node.classList.toggle('ok', ok);
  node.hidden = false;
}

async function changePassword(event) {
  event.preventDefault();
  const current = $('#pw-current').value;
  const next = $('#pw-new').value;
  const confirm = $('#pw-confirm').value;
  if (next.length < 8) return passwordMessage('Use at least 8 characters');
  if (next !== confirm) return passwordMessage('New passwords do not match');
  try {
    await api('/api/password', {
      method: 'POST',
      body: { current_password: current, new_password: next, confirm_password: confirm },
    });
    $('#password-form').reset();
    passwordMessage('Password updated', true);
  } catch (err) {
    passwordMessage(err.message);
  }
}

applyTheme(themePreference, false);
darkQuery.addEventListener('change', () => {
  if (themePreference === 'auto') applyTheme('auto', false);
});

/* ---------------- Events ---------------- */

$('#auth-form').addEventListener('submit', submitAuth);

$('#smart-nav').addEventListener('click', (event) => {
  const row = event.target.closest('.nav-row');
  if (!row) return;
  clearSearch();
  go(row.dataset.view);
  closeAccountMenu();
});

$('#new-list-2').addEventListener('click', () => openListSheet(null));
$('#back-btn').addEventListener('click', () => {
  clearSearch();
  go('home');
});
$('#logout-btn').addEventListener('click', logout);
$('#notifications-btn').addEventListener('click', openNotifySheet);
$('#settings-btn').addEventListener('click', openSettings);
$('#password-form').addEventListener('submit', changePassword);
$$('.theme-option-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyTheme(btn.dataset.themePref);
    updateSettingsDirty();
  });
});
$('#notify-enable').addEventListener('click', enableNotifications);
$('#notify-disable').addEventListener('click', disableNotifications);
$('#notify-test').addEventListener('click', sendTestNotification);
$('#settings-save').addEventListener('click', saveAppSettings);
$('#settings-sheet').addEventListener('input', () => updateSettingsDirty());
$('#settings-sheet').addEventListener('change', () => updateSettingsDirty());
$('#set-density').addEventListener('change', () => {
  const density = $('#set-density').value === 'compact' ? 'compact' : 'comfortable';
  localStorage.setItem(DENSITY_KEY, density);
  applyDensity();
});
$('#set-list-progress').addEventListener('change', () => {
  previewListProgress($('#set-list-progress').value);
});
$('#set-list-progress-range').addEventListener('change', () => {
  previewListProgressRange($('#set-list-progress-range').value);
});
$('#zone-use-device').addEventListener('click', useThisDeviceZone);
$('#zone-keep').addEventListener('click', keepDeviceZone);
$('#zone-move').addEventListener('click', moveDeviceZone);
$('#token-generate').addEventListener('click', generateToken);
$('#token-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#token-value').textContent);
    toast('Token copied');
  } catch {
    toast('Copy failed — select the token manually');
  }
});
$('#export-btn').addEventListener('click', exportBackup);
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (event) => {
  importBackupFile(event.target.files[0]);
  event.target.value = '';
});

$('#fab-add').addEventListener('click', () => openEditor(null));
$('#menu-btn').addEventListener('click', handleMenuButton);
$('#sidebar-menu-btn').addEventListener('click', toggleAccountMenu);
$('#account-notifications').addEventListener('click', () => { closeAccountMenu(); openNotifySheet(); });
$('#account-settings').addEventListener('click', () => { closeAccountMenu(); openSettings(); });
$('#account-logout').addEventListener('click', () => { closeAccountMenu(); logout(); });
document.addEventListener('click', (event) => {
  const menu = getAccountMenu();
  if (!menu || menu.hidden) return;
  if (event.target.closest('#account-menu, #menu-btn, #sidebar-menu-btn')) return;
  closeAccountMenu();
});
$$('.refresh-btn').forEach((btn) => btn.addEventListener('click', refreshState));

let searchTimer = null;

function clearSearchResults() {
  state.searchSeq += 1;
  state.searchOpen = [];
  state.searchCompleted = [];
  state.searchTotals = { open: 0, completed: 0 };
  state.searchTruncated = false;
  state.searchLoading = false;
  state.searchOffline = false;
  state.searchQuery = '';
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  if (!state.search) {
    clearSearchResults();
    return;
  }
  state.searchLoading = true;
  searchTimer = setTimeout(async () => {
    const ok = await runSearch(state.search);
    if (ok) render();
  }, 220);
}

// Open items are all in /api/state, but completed history is not (30-day
// cutoff), so the server searches the database. On a network failure fall
// back to the loaded reminders and say the history is incomplete.
async function runSearch(query) {
  const seq = ++state.searchSeq;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}&limit=500`);
    if (seq !== state.searchSeq || query !== state.search) return false;
    state.searchQuery = query;
    state.searchOpen = data.open || [];
    state.searchCompleted = data.completed || [];
    state.searchTotals = data.totals || {
      open: state.searchOpen.length,
      completed: state.searchCompleted.length,
    };
    state.searchTruncated = Boolean(data.truncated);
    state.searchOffline = false;
  } catch {
    if (seq !== state.searchSeq || query !== state.search) return false;
    state.searchQuery = query;
    const local = state.reminders.filter(matchesSearch);
    state.searchOpen = sortItems(local.filter((reminder) => !reminder.completed));
    state.searchCompleted = local
      .filter((reminder) => reminder.completed)
      .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0));
    state.searchTotals = {
      open: state.searchOpen.length,
      completed: state.searchCompleted.length,
    };
    state.searchTruncated = false;
    state.searchOffline = true;
  }
  if (seq === state.searchSeq) state.searchLoading = false;
  return true;
}

function setSearch(value, source) {
  state.search = value.trim();
  if (source !== 'sidebar') $('#search').value = value;
  if (source !== 'main') $('#main-search').value = value;
  scheduleSearch();
  if (state.search && state.view === 'home') {
    state.searchKeepNavigation = true;
    go('all');
    return;
  }
  render();
}

$('#search').addEventListener('input', (event) => setSearch(event.target.value, 'sidebar'));
$('#main-search').addEventListener('input', (event) => setSearch(event.target.value, 'main'));

$('#main-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#main-search').blur();
});

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#search').blur();
});

$('#editor-form').addEventListener('submit', saveEditor);
$('#e-delete').addEventListener('click', deleteReminder);
$('#e-completed').addEventListener('change', syncRecordRows);
$('#e-date-on').addEventListener('change', () => { syncDateTimeRows(); markScheduleManual(); });
$('#e-time-on').addEventListener('change', () => { syncDateTimeRows(); markScheduleManual(); });
$('#e-repeat').addEventListener('change', () => onRepeatChange(true));
$('#e-repeat-interval').addEventListener('change', () => { syncRepeatRows(); markScheduleManual(); });
$('#e-repeat-unit').addEventListener('change', () => { syncRepeatRows(); markScheduleManual(); });
$('#e-model').addEventListener('change', syncModelRows);
$('#e-zone').addEventListener('change', () => { updateZoneVisual(); syncModelRows(); });
$('#e-snooze-btn').addEventListener('click', toggleEditorSnooze);$('#e-skip-btn').addEventListener('click', skipCurrentOccurrence);
$('#scope-occurrence').addEventListener('click', () => setScope('occurrence'));
$('#scope-series').addEventListener('click', () => setScope('series'));
$('#e-parse-chip').addEventListener('click', clearParse);
$('#e-date').addEventListener('change', () => {
  if (!$('#e-date').value) {
    $('#e-date-on').checked = false;
    $('#e-time-on').checked = false;
    syncDateTimeRows();
  } else {
    markScheduleManual();
  }
});
$('#e-time').addEventListener('change', () => {
  if (!$('#e-time').value) {
    $('#e-time-on').checked = false;
    syncDateTimeRows();
  } else {
    markScheduleManual();
  }
});
$('#e-list').addEventListener('change', updateEditorListVisual);
$('#e-title').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  if (state.editingId) return; // editing keeps Enter as a plain newline
  event.preventDefault();
  if ($('#editor-submit').disabled) return;
  $('#editor-form').requestSubmit();
});

$('#e-more-toggle').addEventListener('click', toggleEditorMore);

$('#e-title').addEventListener('input', () => {
  autoGrowTitle();
  clearFieldError($('#e-title'), $('#e-title-error'));
  scheduleParse();
  syncEditorSubmit();
});

$('#editor-form').addEventListener('input', syncEditorSubmit);
$('#editor-form').addEventListener('change', syncEditorSubmit);
$('#e-notes').addEventListener('input', () => {
  autoGrowNotes();
  renderEditorLinks();
});
$('#sort-field').addEventListener('change', (event) => {
  const field = event.target.value;
  const patch = { field };
  if (field === 'due') patch.dir = 'asc';
  setViewSort(state.view, patch);
  render();
});
$('#sort-dir').addEventListener('change', (event) => {
  setViewSort(state.view, { dir: event.target.value });
  render();
});
$('#set-sort-field').addEventListener('change', () => {
  if ($('#set-sort-field').value === 'due') $('#set-sort-dir').value = 'asc';
  syncSortDirLabels($('#set-sort-field'), $('#set-sort-dir'));
});
$('#list-form').addEventListener('submit', saveList);
$('#l-name').addEventListener('input', () => {
  clearFieldError($('#l-name'), $('#l-name-error'));
  syncListSubmit();
});
$('#l-name').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  if ($('#list-save').disabled) event.preventDefault();
});
$('#l-delete').addEventListener('click', deleteList);

document.addEventListener('click', (event) => {
  const closer = event.target.closest('[data-close]');
  if (closer) {
    const sheet = closer.closest('.sheet');
    if (sheet) {
      if (sheet.id === 'settings-sheet') revertSettingsPreview();
      sheet.hidden = true;
      syncSheetState();
      consumeSheetMarker();
    }
  }
});

// Browser/hardware Back: one pop = one sheet closed (cancel semantics), or —
// once every sheet marker is popped — leave app-initiated sheets untouched
// (already closed). History-anchored sheets, see openSheet.
window.addEventListener('popstate', (event) => {
  if (sheetPopGuard) {
    sheetPopGuard = false;
    return;
  }
  const depth = event.state && event.state.todoSheet ? event.state.todoSheet : 0;
  if (!depth) {
    while (closeTopSheetInPlace()) { /* back past all sheet markers */ }
    return;
  }
  while ($$('.sheet').filter((sheet) => !sheet.hidden).length > depth) {
    if (!closeTopSheetInPlace()) break;
  }
});

document.addEventListener('pointerdown', (event) => {
  $$('.row-delete.confirming').forEach((button) => {
    if (!button.contains(event.target)) resetRowDelete(button);
  });
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    trapSheetTab(event);
    return;
  }
  if (event.key === 'Escape') {
    if (closeTopSheet()) return;
    if ((document.activeElement === $('#search') || document.activeElement === $('#main-search')) && state.search) {
      setSearch('', 'both');
    }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    const target = $('#main-search').offsetParent ? $('#main-search') : $('#search');
    target.focus();
  } else if (event.key === 'n') {
    event.preventDefault();
    openEditor(null);
  }
});

async function refreshOnResume() {
  if (!state.authenticated) return;
  try {
    await loadState();
    render();
  } catch { /* offline — keep showing cached state */ }
  syncDeviceZone();
}

window.addEventListener('hashchange', route);
window.addEventListener('focus', refreshOnResume);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshOnResume();
});

applyDensity();
syncMenuButtons();
boot();
