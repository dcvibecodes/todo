'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const ICON = (name, cls = 'ic') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;


const COLORS = ['red', 'rose', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'slate', 'gray'];
const colorVar = (color) => `var(--list-${COLORS.includes(color) ? color : 'blue'})`;

const state = {
  authenticated: false,
  needsSetup: false,
  username: null,
  needsUsername: false,
  usernameRequired: false,
  vapidPublicKey: null,
  lists: [],
  reminders: [],
  notes: [],
  docs: [],
  docFormats: [],
  attachments: [],
  storage: null,
  tenant: ['reminders', 'notes', 'docs'].includes(localStorage.getItem('todo.tenant'))
    ? localStorage.getItem('todo.tenant') : 'reminders',
  settings: {},
  view: 'today',
  search: '',
  searchOpen: [],
  searchCompleted: [],
  searchNotes: [],
  searchDocs: [],
  searchTotals: { open: 0, completed: 0, notes: 0, docs: 0 },
  searchTruncated: false,
  searchLoading: false,
  searchOffline: false,
  searchSeq: 0,
  searchQuery: '',
  searchKeepNavigation: false,
  showCompleted: false,
  editingId: null,
  editingListId: null,
  listTenant: 'reminders',
  noteEditingId: null,
  noteSnapshot: null,
  docEditingId: null,
  docSnapshot: null,
  notePendingFiles: [],
  noteRemovedFiles: [],
  editorPendingFiles: [],
  editorRemovedFiles: [],
  docsUploadFolder: null,
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


const DENSITY_KEY = 'todo-density';
const LIST_PROGRESS_KEY = 'todo.listProgress';
const LIST_PROGRESS_RANGE_KEY = 'todo.listProgressRange';
const LIST_PROGRESS_SYNCED_KEY = 'todo.listProgressSynced';
const LIST_PROGRESS_MODES = ['bar', 'ring', 'off'];
const LIST_PROGRESS_RANGES = ['all', '30d'];
const SETTINGS_PROGRESS_KEYS = ['list_progress', 'list_progress_range'];
const RETENTION_ORDER = { '1m': 1, '3m': 3, '6m': 6, '12m': 12, forever: Infinity };
const RETENTION_DAYS = { '1m': 30, '3m': 90, '6m': 180, '12m': 365 };
const RETENTION_LABELS = { '1m': '1 month', '3m': '3 months', '6m': '6 months', '12m': '1 year', forever: 'indefinitely' };

function listRetention(list) {
  const value = list && list.completed_retention;
  return value in RETENTION_ORDER ? value : 'forever';
}

function retentionLabel(value = 'forever') {
  return RETENTION_LABELS[value] || RETENTION_LABELS.forever;
}

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

let activeViewTransition = null;

function runViewTransition(update) {
  if (MOTION_REDUCED.matches || typeof document.startViewTransition !== 'function' || activeViewTransition) {
    update();
    return;
  }
  try {
    const transition = document.startViewTransition(update);
    activeViewTransition = transition;
    transition.ready.catch(() => {});
    transition.finished.catch(() => {}).finally(() => {
      if (activeViewTransition === transition) activeViewTransition = null;
    });
  } catch {
    update();
  }
}

function applyDensity(animate = false) {
  const update = () => {
    const density = localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
    document.documentElement.dataset.density = density;
    if (document.readyState !== 'loading') syncNoteExpanders();
  };
  if (animate) runViewTransition(update);
  else update();
  return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
}

function updateBadge() {
  try {
    const limit = endOfToday();
    const count = incompleteReminders()
      .filter((reminder) => reminder.due_at && new Date(reminder.due_at) <= limit && !isSnoozed(reminder)).length;
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

async function requestJson(res) {
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON proxy/error page */ }
  if (!res.ok) {
    if (res.status === 401 && state.authenticated) {
      state.authenticated = false;
      showAuth();
    }
    const requestId = (data && data.request_id) || res.headers.get('x-request-id');
    let message = data && data.error;
    if (!message) {
      if (res.status === 413) message = 'Upload is too large for the server or proxy limit';
      else if (res.status === 502 || res.status === 504) message = 'The server did not respond in time';
      else message = `Request failed (HTTP ${res.status})`;
    }
    if (requestId && (!data || !data.error || res.status >= 500)) message += ` (request ${requestId})`;
    throw new Error(message);
  }
  return data;
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
  return requestJson(await fetch(path, init));
}

let toastTimer = null;

function hideToast(instant = false) {
  const node = $('#toast');
  if (!node || node.hidden) return;
  clearTimeout(toastTimer);
  node.getAnimations().forEach((animation) => animation.cancel());
  if (instant || MOTION_REDUCED.matches) {
    node.hidden = true;
    return;
  }
  const anim = node.animate(
    [{ opacity: 1, transform: 'translate(-50%, 0)' }, { opacity: 0, transform: 'translate(-50%, 6px)' }],
    { duration: 150, easing: 'ease-out' },
  );
  anim.onfinish = () => { node.hidden = true; };
}

function toast(message, actionLabel, action) {
  const node = $('#toast');
  clearTimeout(toastTimer);
  node.getAnimations().forEach((animation) => animation.cancel());
  node.replaceChildren(el('span', { text: message }));
  if (actionLabel && action) {
    const button = el('button', { type: 'button', class: 'toast-action', text: actionLabel });
    button.addEventListener('click', () => {
      hideToast(true);
      action();
    });
    node.append(button);
  }
  node.hidden = false;
  toastTimer = setTimeout(() => hideToast(), action ? 10000 : 3200);
}

function showFieldError(input, messageNode, message) {
  messageNode.textContent = message;
  messageNode.hidden = false;
  if (!MOTION_REDUCED.matches) {
    messageNode.getAnimations().forEach((animation) => animation.cancel());
    messageNode.animate(
      [{ opacity: 0, transform: 'translateY(-2px)' }, { opacity: 1, transform: 'none' }],
      { duration: 160, easing: 'ease-out' },
    );
  }
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
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';
  const overdue = !reminder.completed && (
    reminder.has_time ? date.getTime() < Date.now() : dueDay.getTime() < today.getTime()
  );
  return { day, time, text: time ? day + ' ' + time : day, overdue, dayDiff };
}

// Relative wording for the due line: "in 5 days" or "3 days overdue".
// Today and tomorrow are skipped: formatDue already renders those as the words
// "Today" / "Tomorrow", so a countdown there would just repeat the date.
// Completed items never say overdue — a finished item is not late.
function dueCountdown(due, completed) {
  if (!due || typeof due.dayDiff !== 'number') return '';
  const diff = due.dayDiff;
  if (diff >= 2) return `in ${diff} days`;
  if (diff >= 0) return '';
  if (completed) return '';
  const late = Math.abs(diff);
  return late === 1 ? '1 day overdue' : `${late} days overdue`;
}

function formatAddedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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

function tenantOf(list) {
  return list && (list.tenant === 'notes' || list.tenant === 'docs') ? list.tenant : 'reminders';
}

function foldersFor(tenant) {
  return state.lists.filter((list) => tenantOf(list) === tenant);
}

function systemFolder(tenant) {
  return foldersFor(tenant).find((list) => list.is_system) || null;
}

function noteById(id) {
  return state.notes.find((note) => note.id === id) || null;
}

function docById(id) {
  return state.docs.find((doc) => doc.id === id) || null;
}

function attachmentsFor(ownerType, ownerId) {
  return state.attachments.filter((file) => file.owner_type === ownerType && file.owner_id === ownerId);
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function defaultListId() {
  if (state.view !== 'home' && typeof state.view === 'number' && listById(state.view)
    && tenantOf(listById(state.view)) === 'reminders') {
    return state.view;
  }
  const unlisted = foldersFor('reminders').find((list) => list.is_system);
  if (unlisted) return unlisted.id;
  if (state.lastListId && listById(state.lastListId)
    && tenantOf(listById(state.lastListId)) === 'reminders') return state.lastListId;
  const first = foldersFor('reminders')[0];
  return first ? first.id : null;
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
    state.usernameRequired = Boolean(session.usernameRequired);
    if (!session.authenticated) return showAuth();
    await enterAuthenticatedApp(session);
  } catch (err) {
    // Replace skeletons with real (empty) views so the screen never hangs on them.
    if (state.authenticated) render();
    toast(err.message);
  }
}

function hideUsernameGate() {
  const gate = $('#username-gate');
  if (gate) gate.hidden = true;
  document.body.classList.remove('gate-open');
  if ($('#shell')) $('#shell').inert = false;
}

function showAuth() {
  state.authenticated = false;
  state.needsUsername = false;
  hideUsernameGate();
  $$('.sheet').forEach((sheet) => { sheet.hidden = true; });
  syncSheetState();
  $('#auth').hidden = false;
  $('#shell').hidden = true;
  const askUsername = state.needsSetup || state.usernameRequired;
  $('#auth-username').hidden = !askUsername;
  $('#auth-confirm').hidden = !state.needsSetup;
  $('#auth-sub').textContent = state.needsSetup
    ? 'Choose a username and password to protect your items'
    : state.usernameRequired
      ? 'Enter your username and password to continue'
      : 'Enter your password to continue';
  $('#auth-submit').textContent = state.needsSetup ? 'Create Account' : 'Unlock';
  $('#auth-password').setAttribute('autocomplete', state.needsSetup ? 'new-password' : 'current-password');
  $('#auth-username').value = '';
  $('#auth-password').value = '';
  $('#auth-confirm').value = '';
  $('#auth-error').hidden = true;
  setTimeout(() => (askUsername ? $('#auth-username') : $('#auth-password')).focus(), 50);
}

function authError(message) {
  const node = $('#auth-error');
  node.textContent = message;
  node.hidden = false;
}

async function enterAuthenticatedApp(session) {
  state.needsSetup = false;
  state.authenticated = true;
  state.usernameRequired = Boolean(session.usernameRequired);
  state.username = session.username || null;
  state.needsUsername = Boolean(session.needsUsername);
  state.csrfToken = session.csrfToken;
  state.vapidPublicKey = session.vapidPublicKey;
  showAppLoading();
  await loadState();
  showApp();
  syncPushState();
  if (!state.needsUsername) syncDeviceZone();
  updateUsernameGate();
}

async function submitAuth(event) {
  event.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  const confirm = $('#auth-confirm').value;
  if (state.needsSetup) {
    if (!username) return authError('Choose a username');
    if (username.length > 50) return authError('Username must be 50 characters or fewer');
    if (password.length < 8) return authError('Use at least 8 characters');
    if (password !== confirm) return authError('Passwords do not match');
  } else if (state.usernameRequired && !username) {
    return authError('Enter your username and password');
  }
  try {
    await api(state.needsSetup ? '/api/setup' : '/api/login', {
      method: 'POST',
      body: state.needsSetup
        ? { username, password, confirm }
        : state.usernameRequired ? { username, password } : { password },
    });
    await enterAuthenticatedApp(await api('/api/session'));
  } catch (err) {
    authError(err.message);
  }
}

function updateUsernameGate() {
  const show = state.authenticated && state.needsUsername;
  const gate = $('#username-gate');
  if (!gate) return;
  gate.hidden = !show;
  document.body.classList.toggle('gate-open', show);
  if ($('#shell')) $('#shell').inert = show;
  if (show) {
    $('#gate-error').hidden = true;
    $('#gate-form').reset();
    setTimeout(() => $('#gate-username').focus(), 60);
  }
}

function usernameGateError(message) {
  const node = $('#gate-error');
  node.textContent = message;
  node.hidden = false;
}

async function submitUsernameGate(event) {
  event.preventDefault();
  const username = $('#gate-username').value.trim();
  const password = $('#gate-password').value;
  if (!username) return usernameGateError('Choose a username');
  if (username.length > 50) return usernameGateError('Username must be 50 characters or fewer');
  if (!password) return usernameGateError('Enter your current password');
  try {
    const result = await api('/api/account/username', {
      method: 'POST',
      body: { username, currentPassword: password },
    });
    state.username = result.username;
    state.needsUsername = false;
    state.usernameRequired = true;
    updateUsernameGate();
    updateUsernameDisplay();
    syncDeviceZone();
    toast('Username saved');
  } catch (err) {
    usernameGateError(err.message);
  }
}

function showApp() {
  state.authenticated = true;
  $('#auth').hidden = true;
  $('#shell').hidden = false;
  route();
  if (!MOTION_REDUCED.matches) {
    [$('#content'), $('#lists')].forEach((node) => {
      if (!node) return;
      node.animate(
        [{ opacity: 0.35 }, { opacity: 1 }],
        { duration: 200, easing: 'ease-out' },
      );
    });
  }
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
  state.username = null;
  state.needsUsername = false;
  state.lists = [];
  state.reminders = [];
  state.notes = [];
  state.docs = [];
  state.attachments = [];
  state.storage = null;
  state.subscription = null;
  showAuth();
}

/* ---------------- Data ---------------- */

async function loadState() {
  const data = await api('/api/state');
  state.lists = data.lists || [];
  state.reminders = data.reminders || [];
  state.notes = data.notes || [];
  state.docs = data.docs || [];
  state.docFormats = data.docs_formats || [];
  state.attachments = data.attachments || [];
  applyDocsFormatUI();
  state.settings = data.settings || {};
  await syncListProgressWithServer();
  await syncSortWithServer();
  if (state.lastListId && !listById(state.lastListId)) {
    state.lastListId = state.lists[0] ? state.lists[0].id : null;
  }
  // Mutations reload state; keep an active search in sync with them.
  if (state.search) await runSearch(state.search);
}

let refreshing = false;

async function refreshState() {
  if (refreshing) return false;
  refreshing = true;
  const buttons = $$('.refresh-btn');
  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.classList.add('loading');
  });
  try {
    await loadState();
    render();
    toast('Refreshed');
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  } finally {
    refreshing = false;
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('loading');
    });
  }
}

/* ---------------- Pull to refresh (touch phones) ----------------
   Desktop/web keeps the refresh icon. On touch devices in the mobile layout,
   pulling down at the top of either scroller (Home's .sidebar or a view's
   #content) drives the same refreshState(). The pill is fixed; the content
   itself is never transformed, so sticky headers and scrolling stay intact. */

const PULL_MEDIA = window.matchMedia('(max-width: 899px) and (pointer: coarse)');
const MOTION_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
// On touch phones the document itself is the scroller (so iOS status-bar
// tap-to-top works); desktop and narrow desktop windows keep the nested
// .content / .sidebar scrollers.
const PAGE_SCROLL_MEDIA = window.matchMedia('(max-width: 899px) and (pointer: coarse)');

function pageScroller() {
  return document.scrollingElement || document.documentElement;
}

function screenScroller() {
  return PAGE_SCROLL_MEDIA.matches ? pageScroller() : $('#content');
}
const PULL_THRESHOLD = 56;
const PULL_MAX = 90;
const PULL_RESISTANCE = 0.7;
const PULL_MIN_SPIN = 500;
const PULL_START_OFFSET = -36;

let pullGesture = null;
let pullBusy = false;

function pullElements() {
  return { pill: $('#pull-refresh'), label: $('#pull-refresh-label') };
}

function hidePullIndicator() {
  const { pill, label } = pullElements();
  if (!pill) return;
  pill.classList.remove('pulling', 'armed', 'refreshing');
  pill.style.opacity = '0';
  pill.style.transform = `translate(-50%, ${PULL_START_OFFSET}px)`;
  if (label) label.textContent = 'Pull to refresh';
}

function paintPullIndicator(distance, gesture) {
  const { pill, label } = pullElements();
  if (!pill) return;
  const armed = distance >= PULL_THRESHOLD;
  pill.classList.add('pulling');
  pill.classList.remove('refreshing');
  pill.classList.toggle('armed', armed);
  pill.style.opacity = String(Math.min(1, distance / 48));
  pill.style.transform = `translate(-50%, ${PULL_START_OFFSET + distance}px)`;
  if (label && label.textContent !== (armed ? 'Release to refresh' : 'Pull to refresh')) {
    label.textContent = armed ? 'Release to refresh' : 'Pull to refresh';
  }
  if (gesture) gesture.armed = armed;
}

// Walk from the touch target up to the page scroller and remember every
// vertical scroller in the chain. Refresh only arms when the whole chain is at
// its top; otherwise the gesture belongs to scrolling.
function pullScrollChain(target, root) {
  const chain = [];
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
        chain.push(node);
      }
    }
    node = node.parentElement;
  }
  // On phones the root is not a scroller — the document is — so guard on the
  // document position instead of the element's always-zero scrollTop.
  chain.push(PAGE_SCROLL_MEDIA.matches ? pageScroller() : root);
  return chain;
}

function pullChainAtTop(chain) {
  return chain.every((node) => node.scrollTop <= 0);
}

function pullAllowed() {
  if (!PULL_MEDIA.matches) return false;
  if (!state.authenticated || refreshing || pullBusy) return false;
  if (document.body.classList.contains('sheet-open')) return false;
  if (listDrag) return false;
  return true;
}

function onPullStart(event) {
  if (event.touches.length !== 1) return;
  const scroller = event.currentTarget;
  if (!pullAllowed()) return;
  const chain = pullScrollChain(event.target, scroller);
  // Only arm refresh when the gesture starts with the chain at the top. A drag
  // that starts while Home is scrolled belongs to scrolling, never a
  // mid-gesture refresh takeover.
  if (!pullChainAtTop(chain)) return;
  const touch = event.touches[0];
  pullGesture = {
    scroller,
    chain,
    id: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    distance: 0,
    armed: false,
    mode: null,
  };
}

function onPullMove(event) {
  const gesture = pullGesture;
  if (!gesture || event.currentTarget !== gesture.scroller) return;
  if (listDrag || event.touches.length > 1) {
    pullGesture = null;
    hidePullIndicator();
    return;
  }
  const touch = Array.from(event.touches).find((item) => item.identifier === gesture.id);
  if (!touch) return;

  const dx = touch.clientX - gesture.startX;
  const dy = touch.clientY - gesture.startY;

  if (!gesture.mode) {
    // Let horizontal swipes and upward scrolls behave normally.
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      pullGesture = null;
      return;
    }
    if (dy < -6) {
      pullGesture = null;
      return;
    }
    if (dy <= 6) return;
    if (!pullChainAtTop(gesture.chain)) {
      pullGesture = null;
      return;
    }
    gesture.mode = 'pull';
  }

  if (!pullChainAtTop(gesture.chain)) {
    pullGesture = null;
    hidePullIndicator();
    return;
  }

  if (event.cancelable) event.preventDefault();
  gesture.distance = Math.max(0, Math.min(PULL_MAX, dy * PULL_RESISTANCE));
  paintPullIndicator(gesture.distance, gesture);
}

function onPullEnd(event) {
  const gesture = pullGesture;
  if (!gesture || event.currentTarget !== gesture.scroller) return;
  pullGesture = null;
  if (gesture.mode !== 'pull') return;
  if (gesture.distance >= PULL_THRESHOLD) {
    runPullRefresh();
  } else {
    hidePullIndicator();
  }
}

function onPullCancel(event) {
  if (!pullGesture || event.currentTarget !== pullGesture.scroller) return;
  pullGesture = null;
  hidePullIndicator();
}

async function runPullRefresh() {
  const { pill, label } = pullElements();
  if (!pill) return;
  pullBusy = true;
  pill.classList.remove('pulling');
  pill.classList.add('armed', 'refreshing');
  pill.style.opacity = '1';
  pill.style.transform = `translate(-50%, ${PULL_START_OFFSET + PULL_THRESHOLD}px)`;
  if (label) label.textContent = 'Refreshing…';

  const startedAt = Date.now();
  await refreshState();
  const remaining = PULL_MIN_SPIN - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

  hidePullIndicator();
  pullBusy = false;
}

function initPullToRefresh() {
  [$('.sidebar'), $('#content')].filter(Boolean).forEach((scroller) => {
    scroller.addEventListener('touchstart', onPullStart, { passive: true });
    scroller.addEventListener('touchmove', onPullMove, { passive: false });
    scroller.addEventListener('touchend', onPullEnd, { passive: true });
    scroller.addEventListener('touchcancel', onPullCancel, { passive: true });
  });
  PULL_MEDIA.addEventListener('change', () => {
    if (PULL_MEDIA.matches) return;
    pullGesture = null;
    hidePullIndicator();
  });
}

/* ---------------- Routing ---------------- */

function go(view) {
  const hash = '#/' + view;
  programmaticHash = hash;
  programmaticUntil = performance.now() + 500;
  location.hash = hash;
}

function viewKeyForPath(path) {
  const raw = String(path);
  if (raw.startsWith('list/')) return Number(raw.slice(5));
  if (raw.startsWith('notes/folder/')) return 'notes-folder-' + raw.slice(13);
  if (raw.startsWith('docs/folder/')) return 'docs-folder-' + raw.slice(12);
  return raw;
}

function goOrRender(view) {
  const target = viewKeyForPath(view);
  const sameView = state.view === target;
  go(view);
  if (sameView) render();
}

function clearSearch() {
  if (!state.search) return;
  state.search = '';
  $('#search').value = '';
  $('#main-search').value = '';
  clearSearchResults();
  setSearchOverlay(false);
  render();
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return 'home';
  if (raw === 'home') return 'home';
  if (raw.startsWith('list/')) {
    const id = Number(raw.slice(5));
    const folder = listById(id);
    return folder && tenantOf(folder) === 'reminders' ? id : 'all';
  }
  if (raw === 'notes') return 'notes';
  if (raw === 'docs') return 'docs';
  if (raw.startsWith('notes/folder/')) {
    const id = Number(raw.slice(13));
    const folder = listById(id);
    return folder && tenantOf(folder) === 'notes' ? 'notes-folder-' + id : 'notes';
  }
  if (raw.startsWith('docs/folder/')) {
    const id = Number(raw.slice(12));
    const folder = listById(id);
    return folder && tenantOf(folder) === 'docs' ? 'docs-folder-' + id : 'docs';
  }
  if (raw === 'today' || raw === 'scheduled' || raw === 'all' || raw === 'flagged' || raw === 'completed') return raw;
  return 'today';
}

function routeTenant(view) {
  if (view === 'notes' || String(view).startsWith('notes-folder-')) return 'notes';
  if (view === 'docs' || String(view).startsWith('docs-folder-')) return 'docs';
  if (view === 'home') return state.tenant;
  return 'reminders';
}

function viewFolderId(view) {
  const match = String(view).match(/^(?:notes|docs)-folder-(\d+)$/);
  return match ? Number(match[1]) : null;
}


function setTenant(tenant) {
  const next = ['reminders', 'notes', 'docs'].includes(tenant) ? tenant : 'reminders';
  state.tenant = next;
  localStorage.setItem('todo.tenant', next);
  state.search = '';
  $('#search').value = '';
  $('#main-search').value = '';
  clearSearchResults();
  setSearchOverlay(false);
  if (state.view !== 'home') {
    go('home');
    return;
  }
  render();
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

const NAV_MOBILE = window.matchMedia('(max-width: 899px)');
// On phones both screens share the document scroller, so keep one position
// per screen (the old nested scrollers each remembered their own).
const screenScroll = { home: 0, detail: 0 };

function recordScreenScroll() {
  const screen = document.body.dataset.screen;
  if (!screen) return;
  const scroller = PAGE_SCROLL_MEDIA.matches
    ? pageScroller()
    : (screen === 'home' ? $('.sidebar') : $('#content'));
  if (scroller) screenScroll[screen] = scroller.scrollTop;
}
let activeNavSnapshot = null;
let historyBackHash = null;
let lastRenderedHash = location.hash;
let programmaticHash = null;
let programmaticUntil = 0;

function finishNavAnimation() {
  if (!activeNavSnapshot) return;
  activeNavSnapshot.getAnimations().forEach((animation) => animation.cancel());
  activeNavSnapshot.remove();
  activeNavSnapshot = null;
  document.body.classList.remove('nav-animating');
  const main = $('.main');
  if (main) {
    main.getAnimations().forEach((animation) => animation.cancel());
    main.classList.remove('nav-incoming');
    main.style.transform = '';
  }
}

function screenSnapshot(selector, zIndex) {
  const source = $(selector);
  if (!source) return null;
  const clone = source.cloneNode(true);
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  clone.classList.add('nav-snapshot');
  clone.removeAttribute('hidden');
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  clone.style.display = 'flex';
  clone.style.zIndex = String(zIndex);
  document.body.append(clone);
  if (PAGE_SCROLL_MEDIA.matches) {
    // The phone layout scrolls the document, so the clone is its own page
    // scroller pinned to the same position as the real screen.
    clone.classList.add('nav-snapshot-page');
    clone.scrollTop = pageScroller().scrollTop;
  } else if (selector === '.sidebar') {
    clone.scrollTop = source.scrollTop;
  } else {
    const from = source.querySelector('.content');
    const to = clone.querySelector('.content');
    if (from && to) to.scrollTop = from.scrollTop;
  }
  return clone;
}

function animateScreenTransition(push, snapshot) {
  const duration = 260;
  // A fast-start ease-out reads as a smooth push into a new screen, but makes
  // the same duration feel like a snap when leaving. Use a gentler ease-in-out
  // for the pop so Back matches the entry's sense of motion.
  const easing = push
    ? 'cubic-bezier(0.22, 1, 0.36, 1)'
    : 'cubic-bezier(0.4, 0, 0.2, 1)';
  document.body.classList.add('nav-animating');
  activeNavSnapshot = snapshot;
  let animation;
  if (push) {
    const main = $('.main');
    if (!main) { finishNavAnimation(); return; }
    main.classList.add('nav-incoming');
    animation = main.animate(
      [{ transform: 'translateX(100%)' }, { transform: 'none' }],
      { duration, easing },
    );
  } else {
    animation = snapshot.animate(
      [{ transform: 'none' }, { transform: 'translateX(100%)' }],
      { duration, easing },
    );
  }
  const finish = () => finishNavAnimation();
  animation.onfinish = finish;
  animation.oncancel = finish;
}

function route() {
  finishNavAnimation();
  const fromHistoryBack = historyBackHash !== null && historyBackHash === location.hash;
  historyBackHash = null;
  const view = parseRoute();
  if (view !== 'home') setSearchOverlay(false);
  const previousView = state.view;
  const previousScreen = document.body.dataset.screen;
  if (PAGE_SCROLL_MEDIA.matches && previousScreen) {
    screenScroll[previousScreen] = pageScroller().scrollTop;
  }
  const slidePush = previousView === 'home' && previousScreen === 'home'
    && view !== 'home' && !state.search;
  const slidePop = previousView !== 'home' && previousScreen === 'detail'
    && view === 'home' && !state.search && !fromHistoryBack;
  const canSlide = (slidePush || slidePop) && NAV_MOBILE.matches
    && !MOTION_REDUCED.matches
    && !$$('.sheet').some((sheet) => !sheet.hidden);
  const snapshot = canSlide
    ? screenSnapshot(slidePush ? '.sidebar' : '.main', slidePush ? 20 : 35)
    : null;
  if (view !== state.view) {
    expandedNoteId = null;
  }
  // Search is global now, so navigating to a list or smart view leaves the
  // results behind unless the search itself caused the jump to All.
  if (state.search && view !== state.view) {
    if (state.searchKeepNavigation) state.searchKeepNavigation = false;
    else {
      state.search = '';
      $('#search').value = '';
      $('#main-search').value = '';
      clearSearchResults();
      setSearchOverlay(false);
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
  if (view !== 'home') {
    const tenant = routeTenant(view);
    if (tenant !== state.tenant) {
      state.tenant = tenant;
      localStorage.setItem('todo.tenant', tenant);
    }
  }
  document.body.dataset.screen = view === 'home' ? 'home' : 'detail';
  render();
  if (PAGE_SCROLL_MEDIA.matches) {
    pageScroller().scrollTop = screenScroll[document.body.dataset.screen] || 0;
  }
  if (snapshot) {
    animateScreenTransition(slidePush, snapshot);
  } else if (previousView !== view && view !== 'home' && !state.search && !MOTION_REDUCED.matches) {
    const content = $('#content');
    if (content) {
      content.animate(
        [{ opacity: 0.55, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        { duration: 180, easing: 'ease-out' },
      );
    }
  }
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
  lastRenderedHash = location.hash;
}

/* ---------------- Render ---------------- */

function incompleteReminders() {
  return state.reminders.filter((reminder) => !reminder.completed);
}

function matchesSearch(reminder) {
  if (!state.search) return true;
  if (window.TodoFuzzy) return window.TodoFuzzy.matchOne(reminder, state.search) != null;
  // Fallback for a stale cached app.js whose fuzzy-search.js has not arrived.
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
  completed: { asc: 'Oldest on top', desc: 'Newest on top' },
  name: { asc: 'A–Z', desc: 'Z–A' },
};

// "Date completed" is only meaningful in the Completed view, so the option is
// inserted there and removed everywhere else instead of haunting open lists.
function syncSortFieldOptions(view) {
  const select = $('#sort-field');
  if (!select) return;
  const tenant = tenantForView(view);
  let due = select.querySelector('option[value="due"]');
  if (tenant === 'reminders') {
    if (!due) {
      due = document.createElement('option');
      due.value = 'due';
      due.textContent = 'Due date';
      select.prepend(due);
    }
  } else if (due) {
    due.remove();
  }
  let option = select.querySelector('option[value="completed"]');
  if (view === 'completed') {
    if (!option) {
      option = document.createElement('option');
      option.value = 'completed';
      option.textContent = 'Date completed';
      const created = select.querySelector('option[value="created"]');
      if (created) created.after(option);
      else select.append(option);
    }
  } else if (option) {
    option.remove();
  }
}

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
  const raw = String(view);
  const folder = raw.match(/^(notes|docs)-folder-(\d+)$/);
  if (folder) return `${folder[1]}:${folder[2]}`;
  return raw;
}

const DATED_VIEW_SORT = { field: 'due', dir: 'asc' };
const COMPLETED_VIEW_SORT = { field: 'completed', dir: 'desc' };

function defaultSortFor(view) {
  if (view === 'completed') return COMPLETED_VIEW_SORT;
  return view === 'today' || view === 'scheduled' ? DATED_VIEW_SORT : state.sortDefault;
}

function tenantForView(view) {
  if (view === 'notes' || String(view).startsWith('notes-folder-')) return 'notes';
  if (view === 'docs' || String(view).startsWith('docs-folder-')) return 'docs';
  return 'reminders';
}

function effectiveSort(view) {
  const key = viewSortKey(view);
  const override = key ? state.sortOverrides[key] : null;
  const fallback = defaultSortFor(view);
  const tenant = tenantForView(view);
  let field = override && override.field ? override.field : fallback.field;
  if (tenant !== 'reminders' && field !== 'name' && field !== 'created') field = 'created';
  return {
    field,
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
  if (sort.field === 'completed') {
    const av = a.completed_at ? new Date(a.completed_at).getTime() : null;
    const bv = b.completed_at ? new Date(b.completed_at).getTime() : null;
    // Legacy completed rows without a stamp stay last in either direction.
    if (av === null && bv === null) return fallback;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av === bv ? fallback : direction * (av - bv);
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

function sortByNameOrCreated(items, sort, nameOf) {
  const direction = sort.dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const fallback = (a.id || 0) - (b.id || 0);
    if (sort.field === 'name') {
      const cmp = String(nameOf(a) || '').localeCompare(String(nameOf(b) || ''), undefined, {
        sensitivity: 'base', numeric: true,
      });
      return cmp ? direction * cmp : fallback;
    }
    const av = new Date(a.created_at || 0).getTime();
    const bv = new Date(b.created_at || 0).getTime();
    return av === bv ? fallback : direction * (av - bv);
  });
}

function sortNotes(items, sort) {
  return sortByNameOrCreated(items, sort, (note) => note.title);
}

function sortDocs(items, sort) {
  return sortByNameOrCreated(items, sort, (doc) => doc.name);
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

function sortCompleted(items) {
  return sortItems(items, { field: 'completed', dir: 'desc' });
}

function completedInList(listId) {
  // Completed history always reads newest completion first, independent of
  // the list's sort for active items.
  return sortCompleted(state.reminders
    .filter((reminder) => reminder.list_id === listId && reminder.completed));
}

// A search result can be older than the 30-day completed window that
// /api/state loads, so editor lookups must also check the search groups.
function findReminder(id) {
  return state.reminders.find((reminder) => reminder.id === id)
    || state.searchOpen.find((reminder) => reminder.id === id)
    || state.searchCompleted.find((reminder) => reminder.id === id)
    || null;
}

function pulseValue(node) {
  if (!node || MOTION_REDUCED.matches) return;
  node.classList.remove('value-pop');
  void node.offsetWidth;
  node.classList.add('value-pop');
}

function setPulseText(node, text) {
  if (!node) return;
  const value = String(text == null ? '' : text);
  if (node.textContent === value) return;
  node.textContent = value;
  pulseValue(node);
}

let animateNextRender = false;
let animateNextSidebar = false;
let flipWindowTimer = null;

function requestRowAnimation() { animateNextRender = true; }
function requestListAnimation() { animateNextSidebar = true; }

function beginFlipWindow() {
  if (MOTION_REDUCED.matches) return;
  document.body.classList.add('flipping');
  clearTimeout(flipWindowTimer);
  flipWindowTimer = setTimeout(() => document.body.classList.remove('flipping'), 340);
}

function captureRects(selector, key) {
  const map = new Map();
  for (const node of $$(selector)) {
    if (!node.offsetParent) continue;
    const id = key(node);
    if (!id) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom < -240 || rect.top > window.innerHeight + 240) continue;
    map.set(id, rect);
  }
  return map;
}

function animateRowRects(before) {
  if (!before || !before.size || MOTION_REDUCED.matches) return;
  let animated = false;
  for (const node of $$('#content .reminder[data-reminder-id]')) {
    if (!node.offsetParent) continue;
    const id = node.dataset.reminderId;
    const prev = before.get(id);
    if (!prev) {
      if (node.classList.contains('entering')) continue;
      const rect = node.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      node.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      animated = true;
      continue;
    }
    const rect = node.getBoundingClientRect();
    const dx = prev.left - rect.left;
    const dy = prev.top - rect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    if (Math.abs(dy) > window.innerHeight * 1.25 || Math.abs(dx) > window.innerWidth) continue;
    node.classList.add('flip-moving');
    const anim = node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    const cleanup = () => node.classList.remove('flip-moving');
    anim.onfinish = cleanup;
    anim.oncancel = cleanup;
    animated = true;
  }
  if (animated) beginFlipWindow();
}

function animateListRects(before) {
  if (!before || !before.size || MOTION_REDUCED.matches) return;
  let animated = false;
  for (const node of $$('#lists .list-row[data-list-id]')) {
    const id = node.dataset.listId;
    if (!id) continue;
    const prev = before.get(id);
    if (!prev) {
      node.animate(
        [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }],
        { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      animated = true;
      continue;
    }
    const rect = node.getBoundingClientRect();
    const dx = prev.left - rect.left;
    const dy = prev.top - rect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    node.classList.add('flip-moving');
    const anim = node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    const cleanup = () => node.classList.remove('flip-moving');
    anim.onfinish = cleanup;
    anim.oncancel = cleanup;
    animated = true;
  }
  if (animated) beginFlipWindow();
}

function render() {
  const flip = animateNextRender
    ? captureRects('#content .reminder[data-reminder-id]', (node) => node.dataset.reminderId)
    : null;
  animateNextRender = false;
  renderSidebar();
  renderMain();
  updateBadge();
  if (flip) animateRowRects(flip);
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

async function refreshAccountStorage() {
  const node = $('#account-storage-total');
  if (!node) return;
  if (state.storage) node.textContent = formatBytes(state.storage.total);
  try {
    state.storage = await api('/api/storage');
    node.textContent = formatBytes(state.storage.total);
  } catch { /* keep the cached total */ }
}

function toggleAccountMenu() {
  const menu = getAccountMenu();
  if (!menu) return;
  if (menu.hidden) {
    menu.getAnimations().forEach((animation) => animation.cancel());
    menu.hidden = false;
    refreshAccountStorage();
    if (!MOTION_REDUCED.matches) {
      menu.animate(
        [{ opacity: 0, transform: 'translateY(-4px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 160, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
  } else {
    closeAccountMenu();
    return;
  }
  syncMenuButtons();
}

function closeAccountMenu() {
  const menu = getAccountMenu();
  if (!menu || menu.hidden) return;
  menu.getAnimations().forEach((animation) => animation.cancel());
  syncMenuButtons();
  if (MOTION_REDUCED.matches) {
    menu.hidden = true;
    return;
  }
  const anim = menu.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px) scale(0.98)' }],
    { duration: 130, easing: 'ease-out' },
  );
  anim.onfinish = () => {
    menu.hidden = true;
    menu.style.transform = '';
    menu.style.opacity = '';
    syncMenuButtons();
  };
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
  const siblings = foldersFor(state.tenant);
  if (event.button !== undefined && event.button !== 0) return;
  if (list.is_system || siblings.length < 2 || listDrag) return;
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
    targetIndex: siblings.findIndex((item) => item.id === list.id),
    minIndex: siblings[0] && siblings[0].is_system ? 1 : 0,
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
    const current = foldersFor(state.tenant);
    const index = drag.targetIndex;
    const ids = current.map((item) => item.id).filter((id) => id !== list.id);
    ids.splice(Math.max(drag.minIndex, Math.min(index, ids.length)), 0, list.id);
    const changed = ids.some((id, i) => id !== current[i].id);
    cleanupListDrag();
    if (!changed) return;

    const reordered = ids.map((id) => listById(id));
    state.lists = [...state.lists.filter((item) => tenantOf(item) !== state.tenant), ...reordered];
    requestListAnimation();
    renderSidebar();
    persistListOrder(ids, state.tenant);
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

function persistListOrder(ids, tenant = state.tenant) {
  api('/api/lists/order', { method: 'PUT', body: { ids, tenant } }).catch(async (err) => {
    toast(err.message);
    await loadState();
    render();
  });
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

/* ---------------- Day Peek ---------------- */

const DAY_MS = 86400000;
const DAY_PEEK_EXPAND_MS = 220;
const DAY_PEEK_COLLAPSE_MS = 210;
const DAY_PEEK_FADE_MS = 150;
const DAY_PEEK_EASE = 'cubic-bezier(0.22, 0.8, 0.3, 1)';
const DAY_PEEK_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

let dayPeekSelected = null;
let dayPeekOpen = false;
let dayPeekSignature = '';
let dayPeekCardAnimating = false;
let dayPeekTodayKey = localDateValue(new Date());
let dayRolloverTimer = null;

function dayPeekReduced() {
  return DAY_PEEK_REDUCED.matches;
}

function dayKeyIndex(key) {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function dayKeyDiff(key) {
  return dayKeyIndex(key) - dayKeyIndex(localDateValue(new Date()));
}

function parseDayKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dayPeekDates() {
  const now = new Date();
  const dates = [];
  for (let offset = 0; offset < 7; offset += 1) {
    dates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  }
  return dates;
}

function dayPeekCounts() {
  const counts = new Map();
  for (const reminder of incompleteReminders()) {
    if (!reminder.due_at || isOverdue(reminder)) continue;
    const key = localDateValue(new Date(reminder.due_at));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function dayPeekItems(key) {
  return sortItems(
    incompleteReminders().filter((reminder) => reminder.due_at
      && !isOverdue(reminder)
      && localDateValue(new Date(reminder.due_at)) === key),
    effectiveSort('scheduled'),
  );
}

function dayPeekRelativeLabel(key) {
  const diff = dayKeyDiff(key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

function dayPeekDateLabel(date) {
  const options = { weekday: 'long', month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(undefined, options);
}

function dayPeekItemWord(count) {
  return `${count} item${count === 1 ? '' : 's'}`;
}

function fillDayIndicator(node, count) {
  node.replaceChildren();
  node.classList.toggle('is-count', count > 4);
  if (count <= 4) {
    for (let index = 0; index < count; index += 1) node.append(el('span', { class: 'day-dot' }));
    return;
  }
  node.textContent = String(count);
}

function dayPeekCellLabel(date, key, count) {
  const today = dayKeyDiff(key) === 0;
  const year = date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined;
  const dateText = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year,
  });
  const countText = count === 0 ? 'no items' : dayPeekItemWord(count);
  return `${today ? 'Today, ' : ''}${dateText} — ${countText}`;
}

function resetDayPeek() {
  dayPeekOpen = false;
  dayPeekSelected = null;
  dayPeekSignature = '';
  dayPeekCardAnimating = false;
  const card = $('#day-card');
  if (!card) return;
  card.getAnimations().forEach((animation) => animation.cancel());
  const scroll = $('#day-card-scroll');
  if (scroll) scroll.getAnimations().forEach((animation) => animation.cancel());
  card.hidden = true;
  card.inert = true;
  card.setAttribute('aria-hidden', 'true');
  card.style.transition = 'none';
  card.style.height = '';
}

function updateDayStrip() {
  const strip = $('#day-strip');
  if (!strip) return;
  const today = localDateValue(new Date());
  if (today !== dayPeekTodayKey) {
    dayPeekTodayKey = today;
    if (dayPeekSelected && dayKeyDiff(dayPeekSelected) < 0) resetDayPeek();
  }
  const dates = dayPeekDates();
  const signature = dates.map((date) => localDateValue(date)).join('|');
  const previousDays = strip.dataset.days;
  if (previousDays !== signature) {
    strip.dataset.days = signature;
    strip.replaceChildren();
    for (const date of dates) {
      const key = localDateValue(date);
      const cell = el('button', {
        type: 'button',
        class: 'day-cell',
        'data-day': key,
        'aria-expanded': 'false',
        'aria-controls': 'day-card',
      }, [
        el('span', { class: 'day-weekday', text: date.toLocaleDateString(undefined, { weekday: 'short' }) }),
        el('span', { class: 'day-date', text: String(date.getDate()) }),
        el('span', { class: 'day-indicator' }),
      ]);
      cell.addEventListener('click', () => toggleDayPeek(key));
      strip.append(cell);
    }
    if (previousDays && !MOTION_REDUCED.matches) {
      strip.classList.add('rolling');
      setTimeout(() => strip.classList.remove('rolling'), 300);
    }
  }
  const counts = dayPeekCounts();
  for (const cell of $$('#day-strip .day-cell')) {
    const key = cell.dataset.day;
    const count = counts.get(key) || 0;
    const countText = String(count);
    if (cell.dataset.count !== countText) {
      const hadCount = cell.dataset.count !== undefined;
      cell.dataset.count = countText;
      const indicator = cell.querySelector('.day-indicator');
      if (indicator) {
        fillDayIndicator(indicator, count);
        if (hadCount) pulseValue(indicator);
      }
    }
    const isToday = dayKeyDiff(key) === 0;
    const isSelected = dayPeekOpen && key === dayPeekSelected;
    cell.classList.toggle('is-today', isToday);
    cell.classList.toggle('is-selected', isSelected);
    cell.setAttribute('aria-expanded', isSelected ? 'true' : 'false');
    const label = dayPeekCellLabel(parseDayKey(key), key, count);
    cell.setAttribute('aria-label', isSelected ? `${label}, expanded` : label);
  }
}

function homeScreenVisible() {
  const sidebar = $('.sidebar');
  return Boolean(sidebar && sidebar.getClientRects().length);
}

function dayCardTargetHeight(card) {
  const height = card.style.height;
  const transition = card.style.transition;
  card.style.transition = 'none';
  card.style.height = 'auto';
  const target = card.getBoundingClientRect().height;
  card.style.height = height;
  card.style.transition = transition;
  return target;
}

function syncDayCardHeight(card, animate) {
  if (!card || card.hidden || !homeScreenVisible()) return;
  const current = card.getBoundingClientRect().height;
  const target = dayCardTargetHeight(card);
  if (!animate || dayPeekReduced() || Math.abs(target - current) < 0.5) {
    dayPeekCardAnimating = false;
    card.style.transition = 'none';
    card.style.height = 'auto';
    return;
  }
  dayPeekCardAnimating = true;
  card.style.transition = 'none';
  card.style.height = current + 'px';
  void card.offsetHeight;
  card.style.transition = `height ${DAY_PEEK_EXPAND_MS}ms ${DAY_PEEK_EASE}`;
  card.style.height = target + 'px';
}

function fadeDayPeekContent(inbound) {
  const scroll = $('#day-card-scroll');
  if (!scroll) return;
  scroll.getAnimations().forEach((animation) => animation.cancel());
  if (dayPeekReduced()) return;
  const frames = inbound ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  scroll.animate(frames, {
    duration: DAY_PEEK_FADE_MS,
    easing: 'ease-out',
    fill: inbound ? 'none' : 'forwards',
  });
}

function reminderSignature(reminder) {
  return [
    reminder.id,
    reminder.title,
    reminder.notes || '',
    reminder.due_at || '',
    reminder.has_time ? 1 : 0,
    reminder.completed ? 1 : 0,
    reminder.urgent ? 1 : 0,
    reminder.list_id,
    reminder.sort_order,
    reminder.repeat_rule || '',
    reminder.snoozed_until || '',
    reminder.time_model || '',
    reminder.occurrence_edited ? 1 : 0,
  ].join(':');
}

function renderDayPeek(options = {}) {
  if (!dayPeekOpen || !dayPeekSelected) return;
  const card = $('#day-card');
  const scroll = $('#day-card-scroll');
  if (!card || !scroll) return;
  const key = dayPeekSelected;
  const items = dayPeekItems(key);
  const lists = state.lists.map((list) => `${list.id}:${list.name}:${list.color}`).join(',');
  const signature = [key, String(dayKeyDiff(key)), lists, items.map(reminderSignature).join('~')].join('|');
  const changed = signature !== dayPeekSignature;
  if (!changed) {
    if (!dayPeekCardAnimating) syncDayCardHeight(card, false);
    return;
  }
  dayPeekSignature = signature;
  const date = parseDayKey(key);
  $('#day-card-title').textContent = dayPeekDateLabel(date);
  $('#day-card-meta').textContent = `${dayPeekRelativeLabel(key)} · ${dayPeekItemWord(items.length)}`;
  const list = el('div', { class: 'day-card-list' });
  if (items.length) {
    for (const reminder of items) {
      list.append(reminderRow(reminder, { showList: true, dayPeek: true }));
    }
  } else {
    list.append(el('p', { class: 'day-peek-empty', text: 'Nothing due' }));
  }
  scroll.replaceChildren(list);
  syncNoteExpanders();
  if (options.crossfade) fadeDayPeekContent(true);
  syncDayCardHeight(card, true);
}

function openDayPeek(key) {
  const card = $('#day-card');
  updateDayStrip();
  const wasOpen = dayPeekOpen;
  dayPeekSelected = key;
  dayPeekOpen = true;
  if (card) {
    card.hidden = false;
    card.inert = false;
    card.setAttribute('aria-hidden', 'false');
    if (!wasOpen) {
      card.style.transition = 'none';
      card.style.height = '0px';
    }
  }
  updateDayStrip();
  renderDayPeek({ crossfade: true });
}

function closeDayPeek(instant = false) {
  const card = $('#day-card');
  const shouldAnimate = !instant && !dayPeekReduced() && homeScreenVisible();
  dayPeekOpen = false;
  dayPeekSelected = null;
  dayPeekSignature = '';
  updateDayStrip();
  if (!card) return;
  if (!shouldAnimate) {
    resetDayPeek();
    return;
  }
  card.inert = true;
  fadeDayPeekContent(false);
  dayPeekCardAnimating = true;
  const current = card.getBoundingClientRect().height;
  card.getAnimations().forEach((animation) => animation.cancel());
  card.style.transition = 'none';
  card.style.height = current + 'px';
  void card.offsetHeight;
  card.style.transition = `height ${DAY_PEEK_COLLAPSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
  card.style.height = '0px';
}

function toggleDayPeek(key) {
  if (dayPeekOpen && dayPeekSelected === key) {
    closeDayPeek();
    return;
  }
  openDayPeek(key);
}

function scheduleDayRollover() {
  clearTimeout(dayRolloverTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  dayRolloverTimer = setTimeout(() => {
    checkDayRollover();
    scheduleDayRollover();
  }, Math.max(1000, next.getTime() - now.getTime()));
}

function checkDayRollover() {
  if (localDateValue(new Date()) === dayPeekTodayKey) return;
  if (!state.authenticated) {
    dayPeekTodayKey = localDateValue(new Date());
    return;
  }
  render();
}

function initDayPeek() {
  const card = $('#day-card');
  if (card) {
    card.addEventListener('transitionend', (event) => {
      if (event.target !== card || event.propertyName !== 'height') return;
      dayPeekCardAnimating = false;
      if (dayPeekOpen) {
        card.style.height = 'auto';
      } else {
        resetDayPeek();
      }
    });
  }
  scheduleDayRollover();
}

function renderSidebar() {
  const tenant = state.tenant;
  const folders = foldersFor(tenant);
  $$('#tenant-switch .tenant-btn').forEach((btn) => {
    const active = btn.dataset.tenant === tenant;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('#smart-nav .nav-row').forEach((row) => {
    const view = row.dataset.view;
    const reminderView = ['today', 'scheduled', 'all', 'flagged', 'completed'].includes(view);
    row.hidden = reminderView ? tenant !== 'reminders'
      : view === 'notes' ? tenant !== 'notes'
        : view === 'docs' ? tenant !== 'docs' : false;
  });
  $('#day-peek').hidden = tenant !== 'reminders';
  $('#folders-label').textContent = 'Folders';
  const newFolder = $('#new-list-2');
  newFolder.title = 'New Folder';
  newFolder.setAttribute('aria-label', 'New Folder');
  updateDayStrip();
  const listFlip = animateNextSidebar
    ? captureRects('#lists .list-row[data-list-id]', (node) => node.dataset.listId)
    : null;
  animateNextSidebar = false;
  const todayLimit = endOfToday();
  const incomplete = incompleteReminders();
  const todayCount = incomplete
    .filter((reminder) => reminder.due_at && new Date(reminder.due_at) <= todayLimit).length;
  const overdueCount = incomplete.filter(isOverdue).length;
  const allCount = incomplete.length;
  const scheduledCount = incomplete.filter((reminder) => reminder.due_at).length;
  const flaggedCount = incomplete.filter((reminder) => reminder.urgent).length;

  const todayBadge = $('#count-today');
  todayBadge.replaceChildren();
  if (!todayCount) {
    todayBadge.textContent = 'Nothing due';
  } else if (!overdueCount) {
    todayBadge.textContent = String(todayCount);
  } else if (overdueCount >= todayCount) {
    todayBadge.append(el('span', { class: 'badge-overdue', text: `${overdueCount} overdue` }));
  } else {
    todayBadge.append(
      el('span', { text: String(todayCount) }),
      el('span', { class: 'badge-sep', text: ' \u00b7 ' }),
      el('span', { class: 'badge-overdue', text: `${overdueCount} overdue` }),
    );
  }
  const todaySignature = todayBadge.textContent;
  if (todayBadge.dataset.signature !== undefined && todayBadge.dataset.signature !== todaySignature) {
    pulseValue(todayBadge);
  }
  todayBadge.dataset.signature = todaySignature;
  const todayRow = $('#smart-nav .nav-row[data-view="today"]');
  if (todayRow) {
    const itemWord = todayCount === 1 ? 'item' : 'items';
    todayRow.setAttribute('aria-label', todayCount
      ? `Today, ${todayCount} ${itemWord}${overdueCount ? `, ${overdueCount} overdue` : ''}`
      : 'Today, nothing due');
  }
  setPulseText($('#count-scheduled'), scheduledCount ? String(scheduledCount) : '');
  setPulseText($('#count-all'), allCount ? String(allCount) : '');
  setPulseText($('#count-flagged'), flaggedCount ? String(flaggedCount) : '');
  setPulseText($('#count-notes'), state.notes.length ? String(state.notes.length) : '');
  setPulseText($('#count-docs'), state.docs.length ? String(state.docs.length) : '');

  $$('#smart-nav .nav-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.view === state.view);
  });

  const wrap = $('#lists');
  wrap.replaceChildren();
  if (!folders.length) {
    wrap.append(el('p', { class: 'section-empty', text: 'No folders yet' }));
    renderDayPeek();
    return;
  }

  const progressMode = getListProgress();
  const progressRange = getListProgressRange();

  for (const list of folders) {
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
        go(list.tenant === 'notes' ? 'notes/folder/' + list.id
          : list.tenant === 'docs' ? 'docs/folder/' + list.id : 'list/' + list.id);
      },
    }, [
      dot,
      el('span', { class: 'list-name', text: list.name }),
      el('span', { class: 'badge', text: list.count ? String(list.count) : '' }),
    ]);
    if (list.is_system) {
      row.append(el('span', {
        class: 'list-lock',
        title: 'Unfiled is always first',
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
      row.append(grip);
    }
    if (progressMode === 'bar' && total > 0 && tenant === 'reminders') {
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
  if (listFlip) animateListRects(listFlip);
  renderDayPeek();
}

function renderSearchResults(content) {
  document.title = 'Workspace — Search';
  $('#view-title').textContent = 'Search';
  $('#view-menu').hidden = true;
  const totals = state.searchTotals || { open: 0, completed: 0, notes: 0, docs: 0 };
  const open = state.searchOpen || [];
  const completed = state.searchCompleted || [];
  const notes = state.searchNotes || [];
  const docs = state.searchDocs || [];
  const total = (totals.open || 0) + (totals.completed || 0)
    + (totals.notes || 0) + (totals.docs || 0);
  setPulseText($('#view-count'), total ? String(total) : '');

  if (state.searchLoading && state.searchQuery !== state.search) {
    content.append(el('p', { class: 'search-status', text: 'Searching…' }));
    return;
  }
  if (!open.length && !completed.length && !notes.length && !docs.length) {
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
    content.append(el('h3', { class: 'group-title', text: `Open reminders (${totals.open})` }));
    const group = el('div', { class: 'reminder-group' });
    for (const reminder of open) group.append(reminderRow(reminder, { showList: true }));
    content.append(group);
  }
  if (completed.length) {
    content.append(el('h3', { class: 'group-title', text: `Completed reminders (${totals.completed})` }));
    const group = el('div', { class: 'reminder-group' });
    for (const reminder of completed) group.append(reminderRow(reminder, { showList: true }));
    content.append(group);
  }
  if (notes.length) {
    content.append(el('h3', { class: 'group-title', text: `Notes (${totals.notes})` }));
    const group = el('div', { class: 'reminder-group' });
    for (const note of notes) group.append(noteRow(note, { showFolder: true }));
    content.append(group);
  }
  if (docs.length) {
    content.append(el('h3', { class: 'group-title', text: `Docs (${totals.docs})` }));
    const group = el('div', { class: 'reminder-group' });
    for (const doc of docs) group.append(docRow(doc, { showFolder: true }));
    content.append(group);
  }
}
function emptySearchState() {
  return el('div', { class: 'empty' }, [
    el('span', { html: ICON('search') }),
    el('h3', { class: 'empty-heading', text: 'No matches' }),
    el('p', { text: `Nothing matches “${state.search}” here.` }),
    el('button', {
      type: 'button',
      class: 'primary-btn',
      text: 'Clear search',
      onclick: () => setSearch('', 'both'),
    }),
  ]);
}

function syncCompletedFilter() {
  const view = state.view;
  const show = typeof view === 'number' && !state.search;
  const filter = $('#sort-completed');
  if (!filter) return;
  filter.hidden = !show;
  if (!show) return;
  const count = state.reminders.filter((reminder) => reminder.list_id === view && reminder.completed).length;
  const noun = count === 1 ? 'item' : 'items';
  filter.disabled = count === 0;
  filter.setAttribute('aria-pressed', state.showCompleted ? 'true' : 'false');
  filter.setAttribute('aria-label', count
    ? `${state.showCompleted ? 'Hide' : 'Show'} ${count} completed ${noun}`
    : 'No completed items');
  filter.title = count
    ? `${state.showCompleted ? 'Hide' : 'Show'} completed ${noun}`
    : 'No completed items';
  $('#sort-completed-count').textContent = String(count);
}

function renderMain() {
  const view = state.view;
  const content = $('#content');
  content.replaceChildren();
  $('#view-menu').hidden = true;
  const sortBar = $('#sort-bar');
  // Relevance-ranked search owns the order, so the Sort/Order bar steps aside.
  sortBar.hidden = view === 'home' || Boolean(state.search);
  syncSortFieldOptions(view);
  if (!sortBar.hidden) {
    const sort = effectiveSort(view);
    $('#sort-field').value = sort.field;
    $('#sort-dir').value = sort.dir;
    syncSortDirLabels($('#sort-field'), $('#sort-dir'));
  }

  // "Show completed" lives in the sort bar for individual lists (the only
  // views that have completed items to reveal). It stays visible on every
  // list page so the bar keeps its shape, and is disabled — not hidden — when
  // the list has nothing completed. Hidden during search and on Home.
  const isList = typeof view === 'number';
  syncCompletedFilter();

  if (state.search) {
    renderSearchResults(content);
    syncNoteExpanders();
    return;
  }

  if (view === 'home') {
    document.title = 'Workspace';
    syncNoteExpanders();
    return;
  }

  if (view === 'notes' || String(view).startsWith('notes-folder-')) {
    renderNotesView(content, view);
    syncNoteExpanders();
    return;
  }
  if (view === 'docs' || String(view).startsWith('docs-folder-')) {
    renderDocsView(content, view);
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
  const completed = isList && state.showCompleted ? completedInList(view) : [];

  $('#view-title').textContent = title;
  const shownCount = typeof view === 'number'
    ? items.length + (state.showCompleted && !state.search ? completed.length : 0)
    : items.length;
  setPulseText($('#view-count'), shownCount ? String(shownCount) : '');
  if (typeof view === 'number') {
    $('#view-menu').hidden = false;
    $('#view-menu').onclick = () => openListSheet(list);
  }
  document.title = `Workspace — ${title}`;

  if (!items.length) {
    content.append(emptyState(view));
    if (state.search) return;
  } else if (view === 'scheduled') {
    renderScheduled(content, items);
  } else if (view === 'today') {
    renderToday(content, items);
  } else {
    if (view === 'completed') {
      content.append(el('p', {
        class: 'completed-retention generic',
        text: 'Completed retention is set per folder. Open a folder to change it.',
      }));
    }
    const group = el('div', { class: 'reminder-group' });
    for (const reminder of items) {
      group.append(reminderRow(reminder, { reschedule: view === 'flagged' && isOverdue(reminder) }));
    }
    content.append(group);
  }

  if (isList && state.showCompleted && completed.length) {
    const retention = listRetention(list);
    const group = el('div', { class: 'reminder-group' });
    for (const reminder of completed) group.append(reminderRow(reminder));
    content.append(el('div', { class: 'completed-section' }, [
      el('h3', { class: 'group-title', text: 'Completed' }),
      el('div', { class: 'completed-retention' }, [
        el('span', {
          text: retention === 'forever'
            ? 'Completed items are kept indefinitely.'
            : `Completed items are kept for ${retentionLabel(retention)}.`,
        }),
        el('button', {
          type: 'button',
          class: 'text-btn completed-retention-edit',
          text: 'Edit folder',
          onclick: () => openListSheet(list),
        }),
      ]),
      group,
    ]));
  }

  if (!state.lists.length) {
    content.append(el('button', {
      class: 'toggle-completed',
      text: 'Create a folder to start adding items',
      onclick: () => openListSheet(null),
    }));
  }
  syncNoteExpanders();
}

function notesForView(view) {
  const folderId = viewFolderId(view);
  return folderId ? state.notes.filter((note) => note.folder_id === folderId) : state.notes;
}

function docsForView(view) {
  const folderId = viewFolderId(view);
  return folderId ? state.docs.filter((doc) => doc.folder_id === folderId) : state.docs;
}

function renderNotesView(content, view) {
  const folderId = viewFolderId(view);
  const folder = folderId ? listById(folderId) : null;
  const title = folder ? folder.name : 'All';
  $('#view-title').textContent = title;
  document.title = `Workspace — ${title}`;
  const notes = sortNotes(notesForView(view), effectiveSort(view));
  setPulseText($('#view-count'), notes.length ? String(notes.length) : '');
  if (folder) {
    $('#view-menu').hidden = false;
    $('#view-menu').onclick = () => openListSheet(folder);
  }
  if (!notes.length) {
    content.append(el('div', { class: 'empty' }, [
      el('span', { html: ICON('note') }),
      el('h3', { class: 'empty-heading', text: 'No notes yet' }),
      el('p', { text: 'Notes live in folders and can carry file attachments.' }),
      el('button', {
        type: 'button',
        class: 'primary-btn',
        text: 'New Note',
        onclick: () => openNoteEditor(null),
      }),
    ]));
    return;
  }
  const group = el('div', { class: 'reminder-group' });
  for (const note of notes) group.append(noteRow(note, { showFolder: !folder }));
  content.append(group);
}

function renderDocsView(content, view) {
  const folderId = viewFolderId(view);
  const folder = folderId ? listById(folderId) : null;
  const title = folder ? folder.name : 'All';
  $('#view-title').textContent = title;
  document.title = `Workspace — ${title}`;
  const docs = sortDocs(docsForView(view), effectiveSort(view));
  setPulseText($('#view-count'), docs.length ? String(docs.length) : '');
  if (folder) {
    $('#view-menu').hidden = false;
    $('#view-menu').onclick = () => openListSheet(folder);
  }
  if (!docs.length) {
    content.append(el('div', { class: 'empty' }, [
      el('span', { html: ICON('file') }),
      el('h3', { class: 'empty-heading', text: 'No files yet' }),
      el('p', { class: 'docs-format-list', text: docsFormatMessage() }),
      el('p', { class: 'notify-hint', text: 'New images and PDFs may be stored as smaller optimized copies; downloads return the optimized bytes. Text files are compressed losslessly. HEIC/HEIF photos are converted to JPG. Change this in Settings → Uploads.' }),
      el('button', {
        type: 'button',
        class: 'primary-btn',
        text: 'Add files',
        onclick: chooseDocsFiles,
      }),
    ]));
    return;
  }
  const group = el('div', { class: 'reminder-group' });
  for (const doc of docs) group.append(docRow(doc, { showFolder: !folder }));
  content.append(group);
}


function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
  doc.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  doc.querySelectorAll('div,p,h1,h2,h3,li,blockquote').forEach((node) => node.append('\n'));
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

async function copyRichItem(title, plainBody, htmlBody) {
  const plain = [title, String(plainBody || '').trim()].filter(Boolean).join('\n\n');
  const html = `<h1>${escapeHtml(title)}</h1>`
    + (htmlBody ? `<p><br></p>${htmlBody}` : '');
  try {
    if (htmlBody && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    toast('Copied');
  } catch {
    try {
      await navigator.clipboard.writeText(plain);
      toast('Copied');
    } catch {
      toast('Copy failed');
    }
  }
}

function noteMarkdownHtml(value) {
  let html = escapeHtml(String(value || ''));
  html = html.replace(/^(#{1,3})[ \t]+(.+)$/gm, (match, hashes, text) => (
    `<span class="note-md-heading note-md-h${hashes.length}">${text}</span>`
  ));
  html = html.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (match, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return html.replace(/\n/g, '<br>');
}

function safeNoteHtml(value, preview = false) {
  const doc = new DOMParser().parseFromString(`<div>${String(value || '')}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || '').replace(/\n/g, '<br>');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    const inner = Array.from(node.childNodes).map(walk).join('');
    if (tag === 'BR') return '<br>';
    if (tag === 'B' || tag === 'STRONG') return `<strong>${inner}</strong>`;
    if (tag === 'I' || tag === 'EM') return `<em>${inner}</em>`;
    if (tag === 'U') return `<u>${inner}</u>`;
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (!/^(https?:\/\/|mailto:)/i.test(href)) return inner;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
      return preview
        ? `<span class="note-md-heading note-md-h${tag[1]}">${inner}</span>`
        : `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    }
    if (tag === 'P' || tag === 'DIV') {
      if (!preview) return `<div>${inner}</div>`;
      const block = inner.replace(/(?:<br>\s*)+$/, '');
      return block ? `${block}<br>` : '<br>';
    }
    if (tag === 'UL' || tag === 'OL') {
      return preview ? inner : `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    }
    if (tag === 'LI') return preview ? `• ${inner}<br>` : `<li>${inner}</li>`;
    if (tag === 'SPAN') return `<span>${inner}</span>`;
    return inner;
  };
  return walk(root)
    .replace(/(?:\s*<br>){3,}/g, '<br><br>')
    .replace(/^(?:\s*<br>)+/, '')
    .replace(/(?:\s*<br>)+$/, '');
}

function normalizeNoteHtml(value) {
  const doc = new DOMParser().parseFromString(`<div>${String(value || '')}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || '').replace(/\n/g, '<br>');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    const inner = Array.from(node.childNodes).map(walk).join('');
    if (tag === 'BR') return '<br>';
    if (tag === 'B' || tag === 'STRONG') return `<strong>${inner}</strong>`;
    if (tag === 'I' || tag === 'EM') return `<em>${inner}</em>`;
    if (tag === 'U') return `<u>${inner}</u>`;
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (!/^(https?:\/\/|mailto:)/i.test(href)) return inner;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
      return `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    }
    if (tag === 'P' || tag === 'DIV') {
      const block = inner.replace(/(?:<br>\s*)+$/, '');
      return block ? `${block}<br>` : '<br>';
    }
    if (tag === 'UL' || tag === 'OL') {
      return `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    }
    if (tag === 'LI') return `<li>${inner}</li>`;
    if (tag === 'SPAN') return `<span>${inner}</span>`;
    return inner;
  };
  return walk(root)
    .replace(/(?:\s*<br>){3,}/g, '<br><br>')
    .replace(/^(?:\s*<br>)+/, '')
    .replace(/(?:\s*<br>)+$/, '');
}

function noteRow(note, options = {}) {
  const folder = listById(note.folder_id);
  const attachments = attachmentsFor('note', note.id);
  const body = el('div', { class: 'reminder-body' }, [
    el('div', { class: 'reminder-title', text: note.title }),
    el('div', { class: 'reminder-meta' }, [
      options.showFolder && folder
        ? el('span', { class: 'meta-list', style: { '--c': colorVar(folder.color) } }, [
          el('span', { class: 'meta-dot' }),
          el('span', { text: folder.name }),
        ])
        : null,
      attachments.length
        ? el('span', { class: 'meta-files', text: `${attachments.length} file${attachments.length === 1 ? '' : 's'}` })
        : null,
    ]),
    note.body ? el('div', {
      class: 'reminder-notes',
      html: note.body_format === 'html' ? safeNoteHtml(note.body, true) : noteMarkdownHtml(note.body),
    }) : null,
  ]);
  const extras = attachmentExtras(attachments);
  if (extras) body.append(extras);
  const copy = el('button', {
    type: 'button',
    class: 'row-copy',
    title: 'Copy note',
    'aria-label': `Copy ${note.title}`,
    html: ICON('copy', 'ic'),
    onclick: async (event) => {
      event.stopPropagation();
      const htmlBody = note.body_format === 'html'
        ? safeNoteHtml(note.body, false)
        : noteMarkdownHtml(note.body);
      await copyRichItem(note.title, htmlToPlainText(htmlBody), htmlBody);
    },
  });
  const edit = el('button', {
    type: 'button',
    class: 'row-edit',
    title: 'Edit note',
    'aria-label': `Edit ${note.title}`,
    html: ICON('pencil', 'ic'),
    onclick: (event) => { event.stopPropagation(); openNoteEditor(note.id); },
  });
  const remove = el('button', {
    type: 'button',
    class: 'row-delete',
    'aria-label': `Delete ${note.title}`,
    html: ICON('x', 'ic'),
    onclick: (event) => { event.stopPropagation(); handleNoteDelete(note, event.currentTarget); },
  });
  const tools = el('div', { class: 'row-tools' }, [copy, edit, remove]);
  return swipeRow({
    class: 'note-row',
    color: folder ? colorVar(folder.color) : colorVar('gray'),
    data: { 'data-note-id': note.id, 'data-reminder-id': 'note-' + note.id },
    label: note.title,
    onDelete: (button) => handleNoteDelete(note, button),
    onClick: (event) => {
      const row = event.currentTarget;
      if (event.target.closest('a, button, input, textarea, select')) return;
      if (Date.now() - lastSwipeEnd < 400) return;
      if (row.classList.contains('swipe-open')) {
        resetSwipe(row);
        return;
      }
      if (!row.classList.contains('has-long-note')) return;
      const noteEl = row.querySelector('.reminder-notes');
      if (noteEl) toggleNoteForRow(row, noteEl);
    },
    content: [body, tools],
  });
}

function docRow(doc, options = {}) {
  const folder = listById(doc.folder_id);
  const body = el('div', { class: 'doc-body' }, [
    el('div', { class: 'doc-main' }, [
      el('div', { class: 'reminder-title', text: doc.name }),
      folder ? el('div', { class: 'doc-folder meta-list', style: { '--c': colorVar(folder.color) } }, [
        el('span', { class: 'meta-dot' }),
        el('span', { text: folder.name }),
      ]) : null,
      doc.description
        ? el('div', { class: 'doc-description', text: doc.description, title: doc.description })
        : null,
      formatAddedDate(doc.created_at)
        ? el('div', { class: 'doc-added', text: `Added ${formatAddedDate(doc.created_at)}`, title: formatRecordDate(doc.created_at) })
        : null,
    ]),
  ]);
  const storedSize = Number(doc.stored_size || doc.size || 0);
  const uploadSize = Number(doc.original_size || doc.size || 0);
  const side = el('div', { class: 'doc-side' }, [
    el('span', {
      class: 'doc-size',
      text: formatBytes(storedSize),
      title: storedSize !== uploadSize ? `Stored size · upload size ${formatBytes(uploadSize)}` : '',
    }),
    el('a', {
      class: 'doc-download',
      href: '/api/files/' + doc.id,
      download: doc.name,
      title: 'Download',
      'aria-label': `Download ${doc.name}`,
      html: ICON('download', 'ic'),
    }),
  ]);
  const remove = el('button', {
    type: 'button',
    class: 'row-delete',
    'aria-label': `Delete ${doc.name}`,
    html: ICON('x', 'ic'),
    onclick: (event) => { event.stopPropagation(); handleDocDelete(doc, event.currentTarget); },
  });
  const tools = el('div', { class: 'row-tools' }, [remove]);
  const row = swipeRow({
    class: 'doc-row',
    color: folder ? colorVar(folder.color) : colorVar('gray'),
    data: { 'data-doc-id': doc.id },
    label: doc.name,
    icon: docIconForName(doc.name),
    onDelete: (button) => handleDocDelete(doc, button),
    onClick: (event) => {
      if (event.target.closest('a, button, input, textarea, select')) return;
      if (Date.now() - lastSwipeEnd < 400 || Date.now() - lastDocDragEnd < 400) return;
      if (event.currentTarget.classList.contains('swipe-open')) {
        resetSwipe(event.currentTarget);
        return;
      }
      openDocSheet(doc);
    },
    content: [body, side, tools],
  });
  makeDocDraggable(row, doc);
  return row;
}

function makeDocDraggable(row, doc) {
  if (!window.matchMedia('(pointer: fine)').matches) return;
  row.draggable = true;
  row.addEventListener('dragstart', (event) => {
    if (event.target.closest('a, button, input, textarea, select')) {
      event.preventDefault();
      return;
    }
    try {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData(
        'DownloadURL',
        `${doc.mime || 'application/octet-stream'}:${doc.name}:${location.origin}/api/files/${doc.id}`,
      );
    } catch { /* DownloadURL is a Chromium extension; Share/Download remain */ }
  });
  row.addEventListener('dragend', () => { lastDocDragEnd = Date.now(); });
}

function syncDocFolderVisual() {
  const folder = listById(Number($('#doc-folder').value));
  $('#doc-folder-value').textContent = folder ? folder.name : '';
  $('#doc-folder-icon').style.setProperty('--c', colorVar(folder ? folder.color : 'gray'));
}

function syncDocSave() {
  const doc = state.docEditingId ? docById(state.docEditingId) : null;
  const button = $('#doc-save');
  if (!doc || !button) return;
  const name = $('#doc-name').value.trim();
  const description = $('#doc-description').value.trim();
  button.disabled = !name || (Number($('#doc-folder').value) === doc.folder_id
    && name === doc.name
    && description === (state.docSnapshot ? state.docSnapshot.description : (doc.description || '')));
}

function autoGrowDocName() {
  const name = $('#doc-name');
  if (!name) return;
  name.style.height = 'auto';
  name.style.height = `${name.scrollHeight}px`;
}

function syncDocSheetInfo() {
  const doc = state.docEditingId ? docById(state.docEditingId) : null;
  if (!doc) return;
  const name = $('#doc-name').value.trim() || doc.name;
  const storedSize = Number(doc.stored_size || doc.size || 0);
  const uploadSize = Number(doc.original_size || doc.size || 0);
  $('#doc-meta').textContent = `${fileTypeLabel(name)} · ${formatBytes(storedSize)}${storedSize !== uploadSize ? ' stored' : ''}`;
  const storage = $('#doc-storage');
  if (storage) {
    storage.textContent = docStorageSummary(doc);
    storage.hidden = !storage.textContent;
  }
  const docIcon = $('#doc-sheet-icon-use');
  if (docIcon) docIcon.setAttribute('href', '#i-' + docIconForName(name));
  autoGrowDocName();
  syncDocSave();
}

let docShareCache = null;

function docStorageSummary(doc) {
  const original = Number(doc.original_size || doc.size || 0);
  const stored = Number(doc.stored_size || doc.size || 0);
  const optimization = String(doc.optimization || '');
  if (optimization.startsWith('heic:')) {
    return `Converted from HEIC/HEIF: ${formatBytes(original)} → ${formatBytes(stored)}. Download returns the converted JPG.`;
  }
  if (doc.compression === 'gzip') {
    return stored && original && stored < original
      ? `Stored compressed at ${formatBytes(stored)}. Download returns the original ${formatBytes(original)} file.`
      : 'Download returns the original file.';
  }
  if (stored && original && stored < original * 0.99) {
    return `Stored at ${formatBytes(stored)} from the uploaded ${formatBytes(original)} file. Download returns the stored optimized copy.`;
  }
  if (optimization.endsWith(':disabled')) return 'Download returns the original file — optimization is off.';
  if (optimization.endsWith(':skipped-small')) return 'Original kept — the file was below the optimization threshold. Download returns the original.';
  if (optimization.endsWith(':kept')) return 'Original kept — no smaller copy was produced. Download returns the original.';
  if (optimization.endsWith(':unavailable')) return 'Original kept — the optimizer tool is unavailable. Download returns the original.';
  if (optimization.endsWith(':error') || optimization.endsWith(':skipped-invalid')) return 'Original kept — optimization could not process it. Download returns the original.';
  return '';
}

async function prepareDocShareFile(doc) {
  if (docShareCache && docShareCache.docId === doc.id && docShareCache.name === doc.name) {
    return docShareCache.file;
  }
  const res = await fetch('/api/files/' + doc.id, { credentials: 'same-origin' });
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON proxy error */ }
    throw new Error(data.error || `Could not prepare this file (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const file = new File([blob], doc.name, { type: doc.mime || blob.type || 'application/octet-stream' });
  docShareCache = { docId: doc.id, name: doc.name, file };
  return file;
}

async function shareDoc(button) {
  const doc = state.docEditingId ? docById(state.docEditingId) : null;
  if (!doc) return;
  if (typeof navigator.share !== 'function') {
    toast('Sharing is not available here. Use Download instead.');
    return;
  }
  const label = button.querySelector('span');
  const namedDoc = { ...doc, name: $('#doc-name').value.trim() || doc.name };
  const cached = docShareCache && docShareCache.docId === doc.id && docShareCache.name === namedDoc.name;
  if (!cached) {
    button.disabled = true;
    if (label) label.textContent = 'Preparing…';
  }
  try {
    const file = await prepareDocShareFile(namedDoc);
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      toast('This file cannot be shared here. Use Download instead.');
      return;
    }
    await navigator.share({ files: [file], title: namedDoc.name });
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    if (err && err.name === 'NotAllowedError' && docShareCache && docShareCache.docId === doc.id) {
      toast('Tap Share file again to open the share sheet');
      return;
    }
    toast(err.message || 'Sharing failed. Use Download instead.');
  } finally {
    button.disabled = false;
    if (label) label.textContent = 'Share file';
  }
}

function syncDocDescriptionCount() {
  const field = $('#doc-description');
  const count = $('#doc-description-count');
  if (!field || !count) return;
  count.textContent = `${field.value.length} / 1000`;
}

function openDocSheet(doc) {
  state.docEditingId = doc.id;
  state.docSnapshot = { name: doc.name, folder_id: doc.folder_id, description: doc.description || '' };
  if (!docShareCache || docShareCache.docId !== doc.id) docShareCache = null;
  $('#doc-name').value = doc.name;
  $('#doc-description').value = doc.description || '';
  syncDocDescriptionCount();
  autoGrowDocName();
  const preview = $('#doc-image-preview');
  const previewImg = $('#doc-image-preview-img');
  const previewable = isPreviewableImage(doc.name);
  preview.hidden = !previewable;
  if (previewable) {
    previewImg.src = '/api/files/' + doc.id + '/preview';
    previewImg.alt = doc.name;
    preview.onclick = () => openImagePreview({
      id: doc.id,
      name: $('#doc-name').value.trim() || doc.name,
    });
  } else {
    previewImg.removeAttribute('src');
    preview.onclick = null;
  }
  const select = $('#doc-folder');
  select.replaceChildren();
  for (const folder of foldersFor('docs')) {
    select.append(el('option', { value: String(folder.id), text: folder.name }));
  }
  select.value = String(doc.folder_id);
  syncDocFolderVisual();
  syncDocSheetInfo();
  const download = $('#doc-sheet-download');
  download.href = '/api/files/' + doc.id;
  download.setAttribute('download', doc.name);
  const share = $('#doc-sheet-share');
  share.hidden = typeof navigator.share !== 'function';
  share.onclick = () => shareDoc(share);
  const added = $('#doc-added');
  added.textContent = doc.created_at ? `Added ${formatRecordDate(doc.created_at)}` : '';
  added.title = doc.created_at ? formatRecordDate(doc.created_at) : '';
  const storage = $('#doc-storage');
  storage.textContent = docStorageSummary(doc);
  storage.hidden = !storage.textContent;
  syncDocSave();
  openSheet('#doc-sheet');
  requestAnimationFrame(autoGrowDocName);
}

async function saveDoc(event) {
  event.preventDefault();
  const doc = state.docEditingId ? docById(state.docEditingId) : null;
  if (!doc) return;
  const folderId = Number($('#doc-folder').value);
  const name = $('#doc-name').value.trim();
  if (!folderId) return toast('Choose a Docs folder');
  if (!name) return toast('File name is required');
  const description = $('#doc-description').value.trim();
  const renamed = name !== doc.name;
  const moved = folderId !== doc.folder_id;
  const described = description !== (doc.description || '');
  if (!renamed && !moved && !described) {
    closeSheet('#doc-sheet');
    return;
  }
  const button = $('#doc-save');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await api('/api/docs/' + doc.id, { method: 'PATCH', body: { folder_id: folderId, name, description } });
    docShareCache = null;
    state.storage = null;
    closeSheet('#doc-sheet');
    await loadState();
    render();
    toast(renamed ? 'File renamed' : moved ? 'File moved' : 'Description saved');
  } catch (err) {
    toast(err.message);
  } finally {
    button.textContent = 'Save';
    syncDocSave();
  }
}

function swipeRow({ class: extraClass, color, data, label, onDelete, content, icon, onClick }) {
  const background = el('div', { class: 'swipe-bg', 'aria-hidden': 'true' }, [
    el('button', {
      type: 'button',
      class: 'swipe-act del',
      tabindex: '-1',
      'aria-label': `Delete ${label}`,
      onclick: (event) => { event.stopPropagation(); onDelete(event.currentTarget); },
    }, [
      el('span', { class: 'del-label', text: 'Delete' }),
      el('span', { html: ICON('x', 'ic') }),
    ]),
  ]);
  const leading = icon ? [el('span', { class: 'doc-icon', html: ICON(icon, 'ic') })] : [];
  return el('div', {
    class: 'reminder ' + extraClass,
    style: { '--c': color },
    ...data,
    onclick: onClick,
  }, [background, el('div', { class: 'swipe-content' }, [...leading, ...content])]);
}

function docFormatInfo(name) {
  const ext = '.' + String(name || '').split('.').pop().toLowerCase();
  return (state.docFormats || []).find((format) => format.ext === ext) || null;
}

function applyDocsFormatUI() {
  const input = $('#docs-file-input');
  if (!input) return;
  const extensions = (state.docFormats || []).map((format) => format.ext);
  if (extensions.length) input.setAttribute('accept', extensions.join(','));
}

function docsFormatMessage() {
  const extensions = (state.docFormats || []).map((format) => format.ext).join(', ');
  const categories = [...new Set((state.docFormats || []).map((format) => format.category))];
  return `Supports ${categories.join(', ')} files (${extensions}).`;
}

function fileTypeLabel(name) {
  const format = docFormatInfo(name);
  if (format) return format.label;
  const ext = String(name || '').split('.').pop().toUpperCase();
  return ext || 'File';
}

function docIconForName(name) {
  const format = docFormatInfo(name);
  return format && format.icon ? format.icon : 'file';
}

// iOS Photos commonly returns .jpeg; Docs accepts it as an alias of .jpg.
// HEIC/HEIF are converted to JPG before storage and therefore preview as JPG.
const PREVIEW_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function isPreviewableImage(name) {
  const ext = '.' + String(name || '').split('.').pop().toLowerCase();
  return PREVIEW_IMAGE_EXTENSIONS.has(ext);
}

let imageGallery = [];
let imageIndex = 0;
let imageSwipeStart = null;

function renderImageViewer(direction = 0) {
  const image = $('#image-viewer-img');
  const status = $('#image-viewer-status');
  const title = $('#image-viewer-title');
  const count = $('#image-viewer-count');
  const prev = $('#image-prev');
  const next = $('#image-next');
  const file = imageGallery[imageIndex];
  if (!image || !status || !title || !count || !prev || !next || !file) return;
  title.textContent = file.name;
  const multiple = imageGallery.length > 1;
  count.hidden = !multiple;
  prev.hidden = !multiple;
  next.hidden = !multiple;
  if (multiple) {
    count.textContent = `${imageIndex + 1} / ${imageGallery.length}`;
    const previous = imageGallery[(imageIndex - 1 + imageGallery.length) % imageGallery.length];
    const following = imageGallery[(imageIndex + 1) % imageGallery.length];
    prev.setAttribute('aria-label', `Previous image: ${previous.name}`);
    next.setAttribute('aria-label', `Next image: ${following.name}`);
  }
  status.textContent = 'Loading…';
  status.hidden = false;
  image.hidden = true;
  image.onload = () => {
    image.hidden = false;
    status.hidden = true;
  };
  image.onerror = () => {
    image.hidden = true;
    status.textContent = 'Preview unavailable';
    status.hidden = false;
  };
  image.removeAttribute('src');
  image.src = '/api/files/' + file.id + '/preview';
  image.alt = file.name;
  if (direction) {
    const body = $('.image-viewer-body');
    if (body) {
      body.classList.remove('swipe-left', 'swipe-right');
      void body.offsetWidth;
      body.classList.add(direction > 0 ? 'swipe-left' : 'swipe-right');
    }
  }
}

function openImagePreview(file, gallery = null) {
  const viewer = $('#image-sheet');
  if (!viewer || !file) return;
  const files = (Array.isArray(gallery) ? gallery : [file])
    .filter((item) => item && item.id && isPreviewableImage(item.name));
  imageGallery = files.length ? files : [file];
  const found = imageGallery.findIndex((item) => String(item.id) === String(file.id));
  imageIndex = found >= 0 ? found : 0;
  renderImageViewer();
  openSheet('#image-sheet');
}

function stepImage(delta) {
  if (imageGallery.length < 2) return;
  imageIndex = (imageIndex + delta + imageGallery.length) % imageGallery.length;
  renderImageViewer(delta);
}


function fileChip(file) {
  return el('a', {
    class: 'link-chip',
    href: '/api/files/' + file.id,
    download: file.name,
    title: `Download ${file.name}`,
    'aria-label': `Download ${file.name}`,
    html: `${ICON(docIconForName(file.name), 'ic')}<span class="link-domain">${escapeHtml(file.name)}</span>`,
  });
}

function imageThumb(file, gallery) {
  const button = el('button', {
    type: 'button',
    class: 'attachment-thumb',
    title: `Preview ${file.name}`,
    'aria-label': `Preview ${file.name}`,
    onclick: (event) => {
      event.stopPropagation();
      openImagePreview(file, gallery);
    },
  });
  const image = el('img', {
    src: '/api/files/' + file.id + '/preview',
    alt: '',
    loading: 'lazy',
    decoding: 'async',
  });
  image.addEventListener('error', () => button.classList.add('is-error'));
  button.append(image, el('span', { class: 'thumb-fallback', html: ICON('image', 'ic') }));
  return button;
}

function attachmentExtras(files) {
  if (!files.length) return null;
  const box = el('div', { class: 'attachment-extras' });
  const images = files.filter((file) => isPreviewableImage(file.name));
  const others = files.filter((file) => !isPreviewableImage(file.name));
  if (images.length) {
    const strip = el('div', { class: 'attachment-thumbs', 'aria-label': 'Image attachments' });
    for (const file of images) strip.append(imageThumb(file, images));
    box.append(strip);
  }
  if (others.length) {
    const links = el('div', { class: 'reminder-links' });
    for (const file of others) links.append(fileChip(file));
    box.append(links);
  }
  return box;
}


async function handleNoteDelete(note, button) {
  if (button.dataset.confirm !== '1') {
    if (!button.dataset.origLabel) button.dataset.origLabel = button.getAttribute('aria-label') || 'Delete note';
    button.dataset.confirm = '1';
    button.classList.add('confirming');
    button.textContent = 'Confirm?';
    button.setAttribute('aria-label', 'Confirm delete note');
    clearTimeout(button._confirmTimer);
    button._confirmTimer = setTimeout(() => resetRowDelete(button), INLINE_CONFIRM_MS);
    return;
  }
  try {
    await api('/api/notes/' + note.id, { method: 'DELETE' });
    await loadState();
    render();
    toast('Note deleted');
  } catch (err) {
    toast(err.message);
    resetRowDelete(button);
  }
}

async function handleDocDelete(doc, button) {
  if (button.dataset.confirm !== '1') {
    if (!button.dataset.origLabel) button.dataset.origLabel = button.getAttribute('aria-label') || 'Delete file';
    button.dataset.confirm = '1';
    button.classList.add('confirming');
    button.textContent = 'Confirm?';
    button.setAttribute('aria-label', 'Confirm delete file');
    clearTimeout(button._confirmTimer);
    button._confirmTimer = setTimeout(() => resetRowDelete(button), INLINE_CONFIRM_MS);
    return;
  }
  try {
    await api('/api/docs/' + doc.id, { method: 'DELETE' });
    state.storage = null;
    await loadState();
    render();
    toast('File deleted');
  } catch (err) {
    toast(err.message);
    resetRowDelete(button);
  }
}


function renderStorageSettings() {
  const summary = $('#storage-summary');
  const breakdown = $('#storage-breakdown');
  const largest = $('#storage-largest');
  if (!summary || !breakdown || !largest) return;
  const storage = state.storage;
  if (!storage) {
    summary.textContent = 'Loading storage…';
    breakdown.replaceChildren();
    largest.replaceChildren();
    return;
  }
  summary.textContent = `${formatBytes(storage.total)} used in total — ${formatBytes(storage.files)} in files and ${formatBytes(storage.database)} in the app database.`;
  breakdown.replaceChildren();
  const rows = [
    ['Reminders', storage.tenants.reminders],
    ['Notes', storage.tenants.notes],
    ['Docs', storage.tenants.docs],
    ['Other app data', { total: storage.other }],
  ];
  for (const [label, value] of rows) {
    const detail = value.files === undefined
      ? formatBytes(value.total)
      : `${formatBytes(value.total)} (${formatBytes(value.files)} files + ${formatBytes(value.text)} text)`;
    breakdown.append(el('div', { class: 'storage-row' }, [
      el('strong', { text: label }),
      el('span', { text: detail }),
    ]));
  }
  largest.replaceChildren();
  if (!storage.largest.length) {
    largest.append(el('p', { class: 'notify-hint', text: 'No uploaded files yet.' }));
  }
  for (const file of storage.largest) {
    largest.append(el('div', { class: 'storage-file' }, [
      el('span', { class: 'storage-file-name', text: file.name }),
      el('span', {
        class: 'storage-file-meta',
        text: `${({ reminders: 'Reminders', notes: 'Notes', docs: 'Docs' })[file.tenant] || file.tenant} · ${file.folder_name || 'Unfiled'} · ${formatBytes(file.size)}`,
      }),
      el('button', {
        type: 'button',
        class: 'attach-remove',
        'aria-label': `Delete ${file.name}`,
        html: ICON('x', 'ic'),
        onclick: (event) => deleteStorageFile(file, event.currentTarget),
      }),
    ]));
  }
}

async function deleteStorageFile(file, button) {
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1';
    button.classList.add('confirming');
    button.textContent = 'Confirm?';
    clearTimeout(button._confirmTimer);
    button._confirmTimer = setTimeout(() => {
      button.dataset.confirm = '';
      button.classList.remove('confirming');
      button.innerHTML = ICON('x', 'ic');
    }, INLINE_CONFIRM_MS);
    return;
  }
  try {
    await api('/api/attachments/' + file.id, { method: 'DELETE' });
    state.storage = null;
    await loadState();
    render();
    await new Promise((resolve) => {
      api('/api/storage').then((data) => {
        state.storage = data;
        renderStorageSettings();
      }).finally(resolve);
    });
    toast('File deleted');
  } catch (err) {
    toast(err.message);
  }
}

function fileExtensionOf(name) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
}

function validateDocsFiles(files) {
  const allowed = new Set((state.docFormats || []).map((format) => format.ext));
  if (allowed.size) {
    const unsupported = files.find((file) => !allowed.has(fileExtensionOf(file.name)));
    if (unsupported) return `Unsupported file: ${unsupported.name}`;
  }
  if (files.length > 10) return 'Up to 10 files per upload';
  const oversized = files.find((file) => file.size > 25 * 1024 * 1024);
  if (oversized) return `${oversized.name} is larger than 25 MB`;
  return '';
}

function chooseDocsFiles() {
  const input = $('#docs-file-input');
  state.docsUploadFolder = viewFolderId(state.view)
    || (systemFolder('docs') ? systemFolder('docs').id : null);
  input.value = '';
  input.click();
}

function emptyState(view) {
  // Warmer empty states with a primary action where one makes sense.
  const copy = {
    today: { icon: 'calendar', heading: 'All clear', message: 'Nothing is due today. Enjoy the quiet — or get ahead.' },
    scheduled: { icon: 'clock', heading: 'Nothing scheduled', message: 'Give an item a date and it will show up here, grouped by when it is due.' },
    all: { icon: 'all', heading: 'A fresh start', message: 'No items yet. Capture the first thing on your mind.' },
    flagged: { icon: 'flag', heading: 'Nothing flagged', message: 'Mark an item urgent and it will wait for you here.' },
    completed: {
      icon: 'done',
      heading: 'No history yet',
      message: 'Finished items follow each folder’s completed retention.',
    },
  }[view] || { icon: 'all', heading: 'Nothing here', message: 'No items in this folder yet.' };
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
  const links = [];
  // Keep a marker where each URL was so removing the link cannot also remove
  // the line breaks around it. Joining the remaining text with spaces (the
  // old behaviour) collapsed an inline URL's paragraph break into a space.
  const MARK = '\u0000';
  let prose = '';
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = cleanUrl(raw);
    if (!url) continue;
    prose += text.slice(last, match.index) + MARK;
    last = match.index + raw.length;
    const href = toHref(url);
    if (!links.includes(href)) links.push(href);
  }
  prose += text.slice(last);
  const proseText = prose
    // Punctuation/space that merely joined the link goes with it, but never
    // a nearby newline.
    .replace(/[ \t]*[,;:!?.]*[ \t]*\u0000[ \t]*[,;:!?.]*[ \t]*/g, MARK)
    .replace(/\u0000/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: proseText, links };
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
    requestRowAnimation();
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
    requestRowAnimation();
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
    requestRowAnimation();
    render();
    toast(date === 'today' ? 'Due today' : 'Due tomorrow');
  } catch (err) {
    toast(err.message);
  }
}

let expandedNoteId = null;
let lastNoteScrollAt = 0;

function noteForId(id) {
  let fallback = null;
  for (const row of $$(`.reminder[data-reminder-id="${id}"]`)) {
    const note = row.querySelector('.reminder-notes');
    if (!note) continue;
    const found = { row, note };
    if (row.getClientRects().length) return found;
    fallback = fallback || found;
  }
  return fallback;
}

function ensureNoteRowVisible(row) {
  if (!row) return;
  const pageScroll = PAGE_SCROLL_MEDIA.matches;
  const scroller = pageScroll
    ? pageScroller()
    : (row.closest('#content') || row.closest('.sidebar'));
  if (!scroller) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const sticky = pageScroll
    ? (document.body.dataset.screen === 'home' ? $('.sidebar-top') : $('.main-top'))
    : (scroller.classList.contains('sidebar') ? scroller.querySelector('.sidebar-top') : null);
  let top = (pageScroll ? 0 : scrollerRect.top) + 8;
  if (sticky && sticky.getBoundingClientRect().bottom > (pageScroll ? 0 : scrollerRect.top)) {
    top = sticky.getBoundingClientRect().bottom + 8;
  }
  const bottom = pageScroll ? document.documentElement.clientHeight - 8 : scrollerRect.bottom - 8;
  const rect = row.getBoundingClientRect();
  if (rect.top >= top && rect.bottom <= bottom) return;
  const delta = rect.top < top ? rect.top - top : rect.bottom - bottom;
  scroller.scrollTo({
    top: Math.max(0, scroller.scrollTop + delta),
    behavior: MOTION_REDUCED.matches ? 'auto' : 'smooth',
  });
}

function animateNote(note, expand, onDone) {
  note.getAnimations().forEach((animation) => animation.cancel());
  note.style.height = '';
  note.style.overflow = '';
  const from = note.getBoundingClientRect().height;
  note.classList.toggle('is-expanded', expand);
  const to = note.getBoundingClientRect().height;
  if (MOTION_REDUCED.matches || Math.abs(to - from) < 1) {
    if (onDone) onDone();
    return;
  }
  note.style.overflow = 'hidden';
  note.style.height = `${from}px`;
  const anim = note.animate(
    [{ height: `${from}px` }, { height: `${to}px` }],
    { duration: 200, easing: 'ease-out' },
  );
  const cleanup = () => {
    note.style.height = '';
    note.style.overflow = '';
  };
  anim.onfinish = () => { cleanup(); if (onDone) onDone(); };
  anim.oncancel = cleanup;
}

function collapseExpandedNote() {
  if (!expandedNoteId) return;
  const found = noteForId(expandedNoteId);
  expandedNoteId = null;
  if (found) animateNote(found.note, false);
}

function toggleNoteForRow(row, note) {
  const id = row.dataset.reminderId;
  if (expandedNoteId === id) {
    expandedNoteId = null;
    animateNote(note, false, () => ensureNoteRowVisible(row));
  } else {
    if (expandedNoteId) collapseExpandedNote();
    expandedNoteId = id;
    animateNote(note, true);
  }
}

function syncNoteExpanders() {
  let expandedSeen = false;
  for (const note of $$('.reminder-notes')) {
    const row = note.closest('.reminder');
    if (!row) continue;
    const id = row.dataset.reminderId;
    const expanded = expandedNoteId === id;
    note.classList.toggle('is-expanded', expanded);
    if (!expanded) {
      note.style.height = '';
      note.style.overflow = '';
    }
    const expandable = expanded || note.scrollHeight > note.clientHeight + 1;
    row.classList.toggle('has-long-note', expandable);
    if (expandable && expanded) expandedSeen = true;
  }
  if (expandedNoteId && !expandedSeen) expandedNoteId = null;
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

  // The due date leads the card on its own line above the title so a scan
  // down the list reads dates first; the clock time stays quieter beside it.
  const body = el('div', { class: 'reminder-body' });
  if (due) {
    if (options.dayPeek) {
      if (due.time) {
        body.append(el('div', {
          class: 'reminder-due',
          html: ICON('clock', 'ic') + `<span>${escapeHtml(due.time)}</span>`,
        }));
      }
    } else {
      const countdown = dueCountdown(due, reminder.completed);
      body.append(el('div', {
        class: 'reminder-due' + (due.overdue ? ' overdue' : ''),
        html: ICON('calendar', 'ic') + `<span>${escapeHtml(due.day)}</span>`
          + (due.time ? `<span class="due-time">${escapeHtml(due.time)}</span>` : '')
          + (countdown ? `<span class="due-in">${escapeHtml(countdown)}</span>` : ''),
      }));
    }
  }
  body.append(
    el('div', { class: 'reminder-title', text: reminder.title }),
    meta,
  );
  if (reminder.notes) {
    const parts = noteParts(reminder.notes);
    if (parts.text) {
      const expanded = expandedNoteId === String(reminder.id);
      const note = el('div', {
        class: 'reminder-notes' + (expanded ? ' is-expanded' : ''),
        text: parts.text,
      });
      body.append(el('div', { class: 'note-wrap' }, [note]));
    }
    if (parts.links.length) {
      const links = el('div', { class: 'reminder-links' });
      for (const url of parts.links) links.append(linkChip(url));
      body.append(links);
    }
  }
  const files = attachmentsFor('reminder', reminder.id);
  const extras = attachmentExtras(files);
  if (extras) body.append(extras);

  if (!options.dayPeek) {
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
  }

  const check = el('button', {
    class: 'check',
    'aria-label': reminder.completed ? 'Mark incomplete' : 'Mark complete',
    html: ICON('check'),
  });
  check.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCompleted(reminder, event.currentTarget.closest('.reminder'));
  });

  // Copy puts the title on the clipboard, followed by the note on a new line
  // when one exists. It sits beside the pencil so both row controls are equal.
  const copy = el('button', {
    type: 'button',
    class: 'row-copy',
    title: 'Copy item',
    'aria-label': `Copy ${reminder.title}`,
    html: ICON('copy', 'ic'),
    onclick: async (event) => {
      event.stopPropagation();
      const note = (reminder.notes || '').trim();
      const htmlBody = note
        ? `<div>${escapeHtml(note).replace(/\n/g, '<br>')}</div>`
        : '';
      await copyRichItem(reminder.title, note, htmlBody);
    },
  });

  // Editing is explicit: the pencil is the only row control that opens the
  // editor. A tap anywhere else on the row is inert (or closes a parked swipe).
  const edit = el('button', {
    type: 'button',
    class: 'row-edit',
    title: 'Edit item',
    'aria-label': `Edit ${reminder.title}`,
    html: ICON('pencil', 'ic'),
    onclick: (event) => {
      event.stopPropagation();
      const row = event.currentTarget.closest('.reminder');
      if (row && row.classList.contains('swipe-open')) resetSwipe(row);
      openEditor(reminder.id);
    },
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

  const tools = el('div', { class: 'row-tools' }, [copy, edit, remove]);

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

  const content = el('div', { class: 'swipe-content' }, [check, body, tools]);
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
      // A swipe or scroll that just ended must not select/expand a note.
      if (Date.now() - lastSwipeEnd < 400) return;
      if (Date.now() - lastNoteScrollAt < 250) return;
      if (event.target.closest('a, button, input, textarea, select')) return;
      const row = event.currentTarget;
      // Tapping a parked row closes the reveal; it never opens the editor.
      if (row.classList.contains('swipe-open')) {
        resetSwipe(row);
        return;
      }
      if (!row.classList.contains('has-long-note')) return;
      const note = row.querySelector('.reminder-notes');
      if (!note) return;
      toggleNoteForRow(row, note);
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
  // Recurring series: an inline, acknowledged warning instead of the two-step
  // Confirm?. Deleting wipes the series and its whole history, so the message
  // must stay until the user chooses (never an auto-dismissing toast).
  if (isRecurringReminder(reminder)) {
    showRowSeriesWarning(reminder, button.closest('.reminder'), button);
    return;
  }
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
  if (isRecurringReminder(reminder)) {
    // Close the swipe first: the warning is full-width inside the row, so the
    // content must be back in its resting position before it is shown.
    const row = button.closest('.reminder');
    resetSwipe(row);
    showRowSeriesWarning(reminder, row, null);
    return;
  }
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1';
    const label = button.querySelector('.del-label');
    if (label) label.textContent = 'Confirm?';
    button.setAttribute('aria-label', 'Confirm delete');
    return;
  }
  deleteReminderInline(reminder, button.closest('.reminder'));
}

function isRecurringReminder(reminder) {
  const rule = reminder ? parseRuleClient(reminder.repeat_rule) : null;
  return Boolean(rule && rule.type !== 'none');
}

// Inline series-delete warning inside the row. Stays put until the user picks
// Delete everything or Cancel; nothing auto-dismisses and the row never moves
// out from under the finger.
function showRowSeriesWarning(reminder, row, button) {
  if (!row) return;
  const existing = row.querySelector('.row-series-warn');
  if (existing) { existing.querySelector('button').focus(); return; }
  const body = row.querySelector('.reminder-body');
  if (!body) return;
  const rule = parseRuleClient(reminder.repeat_rule);
  const panel = el('div', { class: 'row-series-warn', role: 'alert' }, [
    el('p', {
      class: 'row-series-warn-text',
      text: `This repeats (${repeatLabel(rule)}). Deleting removes the whole series and its history. To remove just this occurrence, use Skip.`,
    }),
    el('div', { class: 'row-series-warn-actions' }, [
      el('button', {
        type: 'button',
        class: 'mini-btn danger-mini',
        text: 'Delete everything',
        onclick: (event) => {
          event.stopPropagation();
          deleteReminderInline(reminder, row);
        },
      }),
      el('button', {
        type: 'button',
        class: 'mini-btn',
        text: 'Cancel',
        onclick: (event) => {
          event.stopPropagation();
          panel.remove();
          resetRowDelete(button);
          resetSwipe(row);
        },
      }),
    ]),
  ]);
  // Clicks inside the warning must never open the editor or re-close the swipe.
  panel.addEventListener('click', (event) => event.stopPropagation());
  body.append(panel);
}

function updateViewCount() {
  if (state.search) return;
  const count = $$('#content .reminder').length;
  setPulseText($('#view-count'), count ? String(count) : '');
}

function cleanupRemovedRow(row) {
  const view = state.view;
  const content = $('#content');
  const section = row.closest('.completed-section');
  const group = row.closest('.reminder-group');
  row.remove();
  if (group && !group.querySelector('.reminder')) {
    const title = group.previousElementSibling;
    if (title && title.classList.contains('group-title')) title.remove();
    group.remove();
  }
  if (section && !section.querySelector('.reminder')) section.remove();

  const rowCount = content.querySelectorAll('.reminder').length;
  if (typeof view === 'number') {
    const activeGroup = Array.from(content.children)
      .find((node) => node.classList.contains('reminder-group'));
    const hasActive = Boolean(activeGroup && activeGroup.querySelector('.reminder'));
    if (!hasActive && !content.querySelector('.empty')) {
      const empty = emptyState(view);
      const completed = content.querySelector('.completed-section');
      if (completed) content.insertBefore(empty, completed);
      else content.append(empty);
    }
  } else if (view === 'completed' && !rowCount) {
    const note = content.querySelector('.completed-retention.generic');
    if (note) note.remove();
    if (!content.querySelector('.empty')) content.append(emptyState('completed'));
  } else if (!rowCount && !content.querySelector('.empty')) {
    content.append(emptyState(view));
  }
  updateViewCount();
  syncCompletedFilter();
}

function removeReminderLocally(reminder, row) {
  const index = state.reminders.findIndex((item) => item.id === reminder.id);
  if (index !== -1) state.reminders.splice(index, 1);
  const list = state.lists.find((item) => item.id === reminder.list_id);
  if (list) {
    if (reminder.completed) {
      list.done_count = Math.max(0, (list.done_count || 0) - 1);
      const completed = reminder.completed_at ? new Date(reminder.completed_at).getTime() : NaN;
      if (Number.isFinite(completed) && completed >= Date.now() - 30 * 24 * 60 * 60 * 1000) {
        list.done_count_30d = Math.max(0, (list.done_count_30d || 0) - 1);
      }
    } else {
      list.count = Math.max(0, (list.count || 0) - 1);
    }
  }
  cleanupRemovedRow(row);
  renderSidebar();
  updateBadge();
}

function restoreDeletingRow(row) {
  if (!row) return;
  row.classList.remove('removing');
  row.style.height = '';
  row.style.opacity = '';
  const content = swipeContentOf(row);
  if (content) content.style.transform = '';
  delete row.dataset.deleting;
  resetSwipe(row);
}

function deleteReminderInline(reminder, row) {
  if (!row || row.dataset.deleting) return;
  row.dataset.deleting = '1';
  const scroller = screenScroller();
  const startTop = scroller ? scroller.scrollTop : 0;
  const viewAtStart = state.view;
  const searchAtStart = Boolean(state.search);
  // Stop the browser from compensating for the collapsing row's height; that
  // is what nudged the row above by a pixel before it settled.
  document.documentElement.classList.add('deleting-row');
  const restoreScroll = () => {
    if (!scroller) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(startTop, max);
  };
  const canUpdateLocally = () => !searchAtStart && !state.search
    && state.view === viewAtStart && row.isConnected;
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
      state.storage = null;
      if (canUpdateLocally()) {
        removeReminderLocally(reminder, row);
        toast('Item deleted');
      } else {
        await loadState();
        requestRowAnimation();
        render();
        restoreScroll();
        toast('Item deleted');
      }
    } catch (err) {
      if (canUpdateLocally()) {
        restoreDeletingRow(row);
      } else {
        await loadState();
        render();
        restoreScroll();
      }
      toast(err.message);
    } finally {
      document.documentElement.classList.remove('deleting-row');
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

// Keep the check feedback on screen long enough to finish before the row moves
// (the halo runs for 0.32s, with a little buffer).
const TOGGLE_FEEDBACK_MS = 340;

async function toggleCompleted(reminder, row) {
  // Optimistic feedback only: the check fills/unfills while the request is
  // already in flight. A failure re-renders the row's real state.
  if (completingInFlight.has(reminder.id)) return;
  completingInFlight.add(reminder.id);
  const undoing = Boolean(reminder.completed);
  const startedAt = Date.now();
  if (row) row.classList.add(undoing ? 'uncompleting' : 'completing');
  try {
    const result = await api('/api/reminders/' + reminder.id, {
      method: 'PATCH',
      body: { completed: !reminder.completed },
    });
    if (row) {
      const remaining = TOGGLE_FEEDBACK_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    await loadState();
    requestRowAnimation();
    render();
    if (result && result.advanced && result.nextDue) {
      const next = new Date(result.nextDue);
      toast(`Done — next: ${next.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
    } else if (result && result.alreadyDone) {
      toast('Already recorded for this date — move the date to a new day to advance');
    }
  } catch (err) {
    if (row) row.classList.remove('completing', 'uncompleting');
    toast(err.message);
  } finally {
    completingInFlight.delete(reminder.id);
  }
}

/* ---------------- Editor ---------------- */

function revealRow(node, visible) {
  if (!node) return;
  node.getAnimations().forEach((animation) => animation.cancel());
  node.style.overflow = '';
  node.style.height = '';
  const currentlyVisible = !node.hidden;
  if (currentlyVisible === visible) {
    node.hidden = !visible;
    return;
  }
  if (visible) {
    node.hidden = false;
    if (MOTION_REDUCED.matches || !node.offsetParent) return;
    const height = node.offsetHeight;
    node.style.overflow = 'hidden';
    const anim = node.animate(
      [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }],
      { duration: 180, easing: 'ease-out' },
    );
    anim.onfinish = () => {
      node.style.overflow = '';
      node.style.height = '';
    };
    return;
  }
  if (MOTION_REDUCED.matches || !node.offsetParent) {
    node.hidden = true;
    return;
  }
  const height = node.offsetHeight;
  node.style.overflow = 'hidden';
  const anim = node.animate(
    [{ height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
    { duration: 150, easing: 'ease-out' },
  );
  anim.onfinish = () => {
    node.hidden = true;
    node.style.overflow = '';
    node.style.height = '';
  };
}

function syncDateTimeRows() {
  if ($('#e-time-on').checked) $('#e-date-on').checked = true;
  if (!$('#e-date-on').checked) $('#e-time-on').checked = false;
  if ($('#e-date-on').checked && !$('#e-date').value) $('#e-date').value = localDateValue(new Date());
  if ($('#e-time-on').checked && !$('#e-time').value) {
    $('#e-time').value = (state.settings && state.settings.default_time) || '09:00';
  }
  revealRow($('#e-date-row'), $('#e-date-on').checked);
  revealRow($('#e-time-row'), $('#e-time-on').checked);
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
  revealRow($('#e-repeat-custom'), value === 'custom');
  $('#e-repeat-value').textContent = value === 'custom'
    ? `Every ${Math.max(1, Number($('#e-repeat-interval').value) || 1)} ${$('#e-repeat-unit').value}`
    : repeatLabel({ type: value, interval: 1 });
  const editing = Boolean(state.editingId);
  const recurring = value !== 'none';
  revealRow($('#completed-row'), editing && !recurring);
  revealRow($('#series-section'), editing && recurring);
}

function syncRecordRows() {
  const reminder = state.editingId
    ? findReminder(state.editingId)
    : null;
  const added = reminder ? formatRecordDate(reminder.created_at) : '';
  revealRow($('#e-added-row'), Boolean(added));
  $('#e-added-value').textContent = added;
  const completed = reminder && reminder.completed && $('#e-completed').checked
    ? formatRecordDate(reminder.completed_at)
    : '';
  revealRow($('#e-completed-date-row'), Boolean(completed));
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
  revealRow($('#e-model-row'), timeOn);
  revealRow($('#e-zone-row'), timeOn && model === 'anchored');
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
  parseSuggestion = null;
  parseAppliedSnapshot = null;
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
  if (pendingSnooze === 'unsnooze') {
    $('#e-snooze-label').textContent = 'Snooze off (staged)';
    $('#e-snooze-btn').textContent = 'Unstage';
  } else if (pendingSnooze === 'snooze') {
    $('#e-snooze-label').textContent = 'Snooze 1h (staged)';
    $('#e-snooze-btn').textContent = 'Unstage';
  } else if (isSnoozed(reminder)) {
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
  // Staged like history undos: tapping records intent, Save applies it.
  const want = isSnoozed(reminder) ? 'unsnooze' : 'snooze';
  pendingSnooze = (pendingSnooze === want) ? null : want;
  syncSnoozeRow();
  syncEditorSubmit();
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
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadHistory(id) {
  const wrap = $('#e-history');
  wrap.replaceChildren();
  state.editingOccurrences = [];
  try {
    const data = await api('/api/reminders/' + id + '/occurrences');
    const rows = data.occurrences || [];
    state.editingOccurrences = rows;
    if (!rows.length) {
      wrap.append(el('p', { class: 'history-empty', text: 'No completions or skips yet.' }));
    } else {
      wrap.append(el('p', { class: 'history-title', text: 'History' }));
    }
    for (const occurrence of rows) {
      const label = occurrence.status === 'completed' ? 'Done'
        : occurrence.status === 'skipped' ? 'Skipped' : 'Edited';
      const row = el('div', { class: 'history-row' }, [
        el('span', { class: 'history-status', text: label }),
        el('span', { class: 'history-date', text: formatOccurrenceDate(occurrence.occurrence_at) }),
      ]);
      if (occurrence.status === 'skipped') {
        if (isOpStaged('unskip', occurrence.occurrence_at)) row.classList.add('history-staged');
        row.append(historyUndoButton(id, 'unskip', occurrence.occurrence_at, 'Undo skip', row));
      }
      if (occurrence.status === 'completed') {
        if (isOpStaged('uncomplete', occurrence.occurrence_at)) row.classList.add('history-staged');
        row.append(historyUndoButton(id, 'uncomplete', occurrence.occurrence_at, 'Undo', row));
      }
      wrap.append(row);
    }
    wrap.hidden = false;
    syncDateHistoryHint();
  } catch {
    wrap.hidden = true;
  }
}

// Warn when the editor's picked date lands on an already-completed
// occurrence: completing will re-record it and move the series forward (the
// old "nothing happens" dead end is gone server-side, but the date may not
// be what the user expects). The candidate instant mirrors saveEditor's
// construction exactly (default time, preserved date-only instant).
function editorPickedDueISO() {
  if (!$('#e-date-on').checked || !$('#e-date').value) return null;
  const [year, month, day] = $('#e-date').value.split('-').map(Number);
  if ($('#e-time-on').checked && $('#e-time').value) {
    const [hours, minutes] = $('#e-time').value.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes).toISOString();
  }
  const [defHours, defMinutes] = String((state.settings && state.settings.default_time) || '09:00').split(':').map(Number);
  let dueAt = new Date(year, month - 1, day, defHours, defMinutes).toISOString();
  const current = state.editingId ? findReminder(state.editingId) : null;
  if (current && current.due_at && !current.has_time
    && $('#e-date').value === localDateValue(new Date(current.due_at))) {
    dueAt = current.due_at;
  }
  return dueAt;
}

function syncDateHistoryHint() {
  const hint = $('#e-date-history-hint');
  if (!hint) return;
  // Zero-shift rule: when the series section is open, the line always keeps
  // its space (visibility, not display) so showing/hiding the warning never
  // moves the rows below. Otherwise the element stays out of layout entirely.
  if (!state.editingId || $('#series-section').hidden) {
    hint.style.display = 'none';
    return;
  }
  hint.style.display = '';
  hint.style.visibility = 'hidden';
  const candidate = editorPickedDueISO();
  if (!candidate) return;
  const match = (state.editingOccurrences || []).some((o) => o.status === 'completed' && o.occurrence_at === candidate);
  if (match) {
    hint.textContent = 'Already completed — completing again moves to the next date.';
    hint.style.visibility = 'visible';
  }
}

// Pending occurrence ops: history undos (and the editor snooze toggle) are
// STAGED, not applied. Tapping one only records intent ({kind,
// occurrence_at}); Save applies them first (newest first, so the server's
// most-recent-first rule is satisfied), then the field PATCH. Cancel or
// closing the sheet drops the list — nothing was ever sent. The list is tiny
// (history is capped at 25 rows), so staging any number of undos is trivial.
let pendingOccurrenceOps = [];
let pendingSnooze = null; // null | 'snooze' | 'unsnooze'

function isOpStaged(kind, occurrenceAt) {
  return pendingOccurrenceOps.some((o) => o.kind === kind
    && (o.occurrence_at || null) === (occurrenceAt || null));
}

function historyUndoButton(id, kind, occurrenceAt, label, row) {
  const staged = isOpStaged(kind, occurrenceAt);
  const btn = el('button', {
    class: 'history-undo' + (staged ? ' staged' : ''),
    type: 'button',
    text: staged ? 'Staged ✓' : label,
  });
  btn.title = staged ? 'Staged — tap to unstage, Save to apply' : 'Stage this undo — applies when you Save';
  btn.addEventListener('click', (e) => toggleStagedOp(kind, id, occurrenceAt, e.currentTarget, row));
  return btn;
}

function toggleStagedOp(kind, id, occurrenceAt, btn, row) {
  // Sequence is enforced HERE, at tap time — never silently staged for a
  // surprise at Save. A completion can only stage when every newer completed
  // occurrence is already staged (those undo first at Save, so the server's
  // most-recent-first rule is satisfied). Skips have no order rule.
  if (kind === 'uncomplete') {
    const blocked = (state.editingOccurrences || []).some((o) =>
      o.status === 'completed' && o.occurrence_at > occurrenceAt
      && !isOpStaged('uncomplete', o.occurrence_at));
    if (blocked) {
      toast('Undo the most recent completion first');
      return;
    }
  }
  const i = pendingOccurrenceOps.findIndex((o) => o.kind === kind
    && (o.occurrence_at || null) === (occurrenceAt || null));
  if (i >= 0) {
    pendingOccurrenceOps.splice(i, 1);
  } else {
    if (state.editScope === 'occurrence') {
      setScope('series');
      toast('Switched to Whole series — staged undos apply to the series');
    }
    pendingOccurrenceOps.push({ kind, occurrence_at: occurrenceAt });
  }
  // Paint this row in place: no list re-fetch, no rebuild, no scroll jump.
  const staged = isOpStaged(kind, occurrenceAt);
  if (row) row.classList.toggle('history-staged', staged);
  if (btn) {
    btn.classList.toggle('staged', staged);
    btn.textContent = staged ? 'Staged ✓' : (kind === 'unskip' ? 'Undo skip' : 'Undo');
    btn.title = staged ? 'Staged — tap to unstage, Save to apply' : 'Stage this undo — applies when you Save';
  }
  syncStagedDate(id);
  syncDateHistoryHint();
  syncEditorSubmit();
}

// The date field previews the outcome: the earliest staged date wins (each
// undo moves the series back only when earlier), so the field shows the
// minimum of the server date and the staged dates.
function syncStagedDate(id) {
  const reminder = findReminder(id);
  if (!reminder || !reminder.due_at) return;
  let iso = reminder.due_at;
  for (const o of pendingOccurrenceOps) {
    if (o.occurrence_at && o.occurrence_at < iso) iso = o.occurrence_at;
  }
  const d = new Date(iso);
  $('#e-date-on').checked = true;
  $('#e-date').value = localDateValue(d);
  if (reminder.has_time) {
    $('#e-time-on').checked = true;
    $('#e-time').value = localTimeValue(d);
  }
  syncDateTimeRows();
}

// Apply staged ops newest-first (LIFO — the server refuses anything else),
// then the staged snooze toggle. Applied ops leave the list as they land;
// on the first failure the rest stay staged and the error propagates.
async function applyPendingOps(id) {
  const ops = [...pendingOccurrenceOps]
    .sort((a, b) => ((a.occurrence_at || '') < (b.occurrence_at || '') ? 1 : -1));
  for (const op of ops) {
    const route = op.kind === 'unskip' ? 'unskip' : 'uncomplete';
    await api('/api/reminders/' + id + '/' + route, {
      method: 'POST',
      body: { occurrence_at: op.occurrence_at },
    });
    pendingOccurrenceOps.splice(pendingOccurrenceOps.indexOf(op), 1);
  }
  if (pendingSnooze) {
    const want = pendingSnooze;
    await api('/api/reminders/' + id + '/snooze', {
      method: 'POST',
      body: want === 'snooze' ? { hours: 1 } : { clear: true },
    });
    pendingSnooze = null;
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
  if (pendingOccurrenceOps.length || pendingSnooze) return true;
  if (state.editorPendingFiles.length || state.editorRemovedFiles.length) return true;
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

function attachmentRow(file, onRemove, gallery = null) {
  const row = el('div', { class: 'attach-item' });
  const previewable = Boolean(file.id) && isPreviewableImage(file.name);
  const icon = previewable ? docIconForName(file.name) : 'files';
  if (previewable) {
    row.append(el('button', {
      type: 'button',
      class: 'attach-preview',
      title: `Preview ${file.name}`,
      'aria-label': `Preview ${file.name}`,
      onclick: (event) => {
        event.stopPropagation();
        openImagePreview(file, gallery);
      },
    }, [
      el('span', { html: ICON(icon, 'ic') }),
      el('span', { class: 'attach-name', text: file.name }),
    ]));
  } else {
    row.append(
      el('span', { html: ICON(icon, 'ic') }),
      el('span', { class: 'attach-name', text: file.name }),
    );
  }
  row.append(el('span', { class: 'attach-size', text: formatBytes(file.size) }));
  if (file.id) {
    row.append(el('a', {
      class: 'attach-download',
      href: '/api/files/' + file.id,
      download: file.name,
      title: `Download ${file.name}`,
      'aria-label': `Download ${file.name}`,
      html: ICON('download', 'ic'),
    }));
  }
  row.append(el('button', {
    type: 'button',
    class: 'attach-remove',
    'aria-label': `Remove ${file.name}`,
    html: ICON('x', 'ic'),
    onclick: onRemove,
  }));
  return row;
}

function renderEditorAttachments() {
  const wrap = $('#e-attachments');
  wrap.replaceChildren();
  const existing = state.editingId
    ? attachmentsFor('reminder', state.editingId).filter((file) => !state.editorRemovedFiles.includes(file.id))
    : [];
  const imageGallery = existing.filter((file) => isPreviewableImage(file.name));
  for (const file of existing) {
    wrap.append(attachmentRow(file, () => {
      state.editorRemovedFiles.push(file.id);
      renderEditorAttachments();
    }, imageGallery));
  }
  for (const file of state.editorPendingFiles) {
    wrap.append(attachmentRow(file, () => {
      state.editorPendingFiles = state.editorPendingFiles.filter((item) => item !== file);
      renderEditorAttachments();
    }));
  }
  if (!wrap.childElementCount) wrap.append(el('p', { class: 'notify-hint', text: 'No attachments.' }));
  syncEditorSubmit();
}

function openEditor(id) {
  const reminder = id ? findReminder(id) : null;
  if (!foldersFor('reminders').length) {
    toast('Create a folder first');
    openListSheet(null);
    return;
  }

  clearTimeout(parseTimer);
  scheduleLocked = false;
  parseSuggestion = null;
  parseAppliedSnapshot = null;
  hideParseChip();

  state.editingId = reminder ? reminder.id : null;
  state.editorPendingFiles = [];
  state.editorRemovedFiles = [];
  pendingOccurrenceOps = [];
  pendingSnooze = null;
  resetEditorDelete();
  $('#editor-heading').textContent = reminder ? 'Edit Item' : 'New Item';
  $('#e-title').value = reminder ? reminder.title : '';
  clearFieldError($('#e-title'), $('#e-title-error'));
  $('#e-notes').value = reminder ? reminder.notes : '';

  const select = $('#e-list');
  select.replaceChildren();
  for (const list of foldersFor('reminders')) {
    select.append(el('option', { value: String(list.id), text: list.name }));
  }
  select.value = String(reminder ? reminder.list_id : defaultListId());
  updateEditorListVisual();
  renderEditorAttachments();

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
  // Staged undos are series-level by definition; scope toggles can't split them.
  const scope = (editingSeries && !pendingOccurrenceOps.length && !pendingSnooze) ? state.editScope : 'series';
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
  let savedId = state.editingId;
  try {
    if (state.editingId) {
      // Staged occurrence undos (and the snooze toggle) apply first, newest
      // first; then the field PATCH lands on top. A mid-way failure keeps
      // the sheet open with the remaining ops still staged.
      const stagedCount = pendingOccurrenceOps.length + (pendingSnooze ? 1 : 0);
      if (stagedCount) await applyPendingOps(state.editingId);
      await api('/api/reminders/' + state.editingId, { method: 'PATCH', body });
      if (stagedCount) {
        toast(`Saved — ${stagedCount} staged change${stagedCount === 1 ? '' : 's'} applied`);
      }
    } else {
      const created = await api('/api/reminders', { method: 'POST', body });
      savedId = created && created.id ? created.id : null;
      state.justAddedId = savedId;
    }
    if (savedId) {
      for (const fileId of state.editorRemovedFiles) {
        await api('/api/attachments/' + fileId, { method: 'DELETE' });
      }
      if (state.editorPendingFiles.length) {
        await uploadFiles('/api/reminders/' + savedId + '/attachments', state.editorPendingFiles);
      }
    }
    state.editorPendingFiles = [];
    state.editorRemovedFiles = [];
    state.storage = null;
    setLastList(listId);
    await settleSubmit(startedAt);
    closeSheet('#editor');
    await loadState();
    requestRowAnimation();
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
let parseSuggestion = null;
let parseAppliedSnapshot = null;
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
  if ($('#editor').hidden || scheduleLocked) return;
  if (text.trim().length < 3) {
    parseSuggestion = null;
    parseAppliedSnapshot = null;
    hideParseChip();
    return;
  }
  const seq = ++parseSeq;
  let result;
  try {
    result = await api('/api/parse', { method: 'POST', body: { text, timeZone: deviceZone() } });
  } catch {
    // Offline: clear a stale suggestion rather than showing one for old text.
    parseSuggestion = null;
    parseAppliedSnapshot = null;
    hideParseChip();
    return;
  }
  if (seq !== parseSeq || $('#editor').hidden || scheduleLocked) return;
  showParseSuggestion(result);
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

function parseLabel(result) {
  const parts = [];
  if (result.date) parts.push(chipDateLabel(result.date, result.time));
  if (result.repeat && result.repeat !== 'none') parts.push(repeatLabel(result.repeat));
  return parts.join(' · ');
}

function scheduleSnapshot() {
  return {
    dateOn: $('#e-date-on').checked,
    timeOn: $('#e-time-on').checked,
    date: $('#e-date').value,
    time: $('#e-time').value,
    repeat: $('#e-repeat').value,
    interval: $('#e-repeat-interval').value,
    unit: $('#e-repeat-unit').value,
  };
}

function restoreSchedule(snapshot) {
  if (!snapshot) return;
  $('#e-date-on').checked = snapshot.dateOn;
  $('#e-time-on').checked = snapshot.timeOn;
  $('#e-date').value = snapshot.date;
  $('#e-time').value = snapshot.time;
  $('#e-repeat').value = snapshot.repeat;
  $('#e-repeat-interval').value = snapshot.interval;
  $('#e-repeat-unit').value = snapshot.unit;
  syncDateTimeRows();
  syncRepeatRows();
  syncEditorSubmit();
}

// Natural language never writes the form by itself: it offers a chip ("Use
// Tomorrow · 9:00 AM") and only the user's tap applies it. This keeps a
// quick-add from silently becoming dated.
function showParseSuggestion(result) {
  const label = parseLabel(result);
  parseSuggestion = label ? result : null;
  parseAppliedSnapshot = null;
  if (!label) {
    hideParseChip();
    return;
  }
  $('#e-parse-text').textContent = `Use ${label}`;
  $('#e-parse-icon').setAttribute('href', '#i-plus');
  $('#e-parse-chip').setAttribute('aria-label', `Use suggested schedule: ${label}`);
  $('#e-parse-chip').hidden = false;
}

function applyParseToForm(result) {
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
  syncEditorSubmit();
}

function toggleParseSuggestion() {
  const result = parseSuggestion;
  if (!result) return;
  const label = parseLabel(result);
  if (parseAppliedSnapshot) {
    restoreSchedule(parseAppliedSnapshot);
    parseAppliedSnapshot = null;
    scheduleLocked = false;
    $('#e-parse-text').textContent = `Use ${label}`;
    $('#e-parse-icon').setAttribute('href', '#i-plus');
    $('#e-parse-chip').setAttribute('aria-label', `Use suggested schedule: ${label}`);
    return;
  }
  parseAppliedSnapshot = scheduleSnapshot();
  applyParseToForm(result);
  // Freeze further parsing while the applied values are in place; editing the
  // title again must not silently replace what the user just accepted.
  scheduleLocked = true;
  $('#e-parse-text').textContent = label;
  $('#e-parse-icon').setAttribute('href', '#i-x');
  $('#e-parse-chip').setAttribute('aria-label', `Remove suggested schedule: ${label}`);
}

const INLINE_CONFIRM_MS = 4000;
let deleteArmed = false; // second tap confirms the item delete
let deleteResetTimer = null;

function resetEditorDelete() {
  deleteArmed = false;
  clearTimeout(deleteResetTimer);
  deleteResetTimer = null;
  if ($('#e-delete')) {
    $('#e-delete').textContent = 'Delete Item';
    $('#e-delete').setAttribute('aria-label', 'Delete item');
  }
  if ($('#e-delete-warn')) $('#e-delete-warn').hidden = true;
}

async function deleteReminder() {
  if (!state.editingId) return;
  // Deleting a series wipes it and its whole history (ON DELETE CASCADE),
  // so a recurring item needs an acknowledged warning — not a toast, not a
  // native confirm. A one-off item uses the same inline Delete → Confirm?
  // pattern as the list rows.
  const reminder = findReminder(state.editingId);
  const rule = reminder ? parseRuleClient(reminder.repeat_rule) : { type: 'none' };
  if (!rule || rule.type === 'none') {
    if (!deleteArmed) {
      deleteArmed = true;
      $('#e-delete').textContent = 'Confirm?';
      $('#e-delete').setAttribute('aria-label', 'Confirm delete item');
      clearTimeout(deleteResetTimer);
      deleteResetTimer = setTimeout(resetEditorDelete, INLINE_CONFIRM_MS);
      return;
    }
  } else if (!deleteArmed) {
    deleteArmed = true;
    const warn = $('#e-delete-warn');
    warn.textContent = `This repeats (${repeatLabel(rule)}). Deleting removes the whole series and its history. To remove just this occurrence, use Skip instead.`;
    warn.hidden = false;
    $('#e-delete').textContent = 'Delete everything';
    $('#e-delete').setAttribute('aria-label', 'Delete the repeating series');
    return;
  }
  const id = state.editingId;
  resetEditorDelete();
  try {
    await api('/api/reminders/' + id, { method: 'DELETE' });
    state.storage = null;
    closeSheet('#editor');
    await loadState();
    requestRowAnimation();
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
let listRetentionWarningOpen = false;

function listCanSubmit() {
  if (listSaving || listRetentionWarningOpen) return false;
  const name = $('#l-name').value.trim();
  if (!name) return false;
  if (!listSnapshot) return true;
  return name !== listSnapshot.name
    || state.selectedColor !== listSnapshot.color
    || (state.listTenant === 'reminders'
      && ($('#l-retention').value || 'forever') !== listSnapshot.completed_retention);
}

function syncListSubmit() {
  const submit = $('#list-save');
  if (submit) submit.disabled = !listCanSubmit();
}

function completedOlderThan(list, retention) {
  const days = RETENTION_DAYS[retention];
  if (!days) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return state.reminders.filter((reminder) => (
    reminder.list_id === list.id
    && reminder.completed
    && reminder.completed_at
    && new Date(reminder.completed_at).getTime() < cutoff
  )).length;
}

function hideListRetentionWarning({ focus = false } = {}) {
  const warn = $('#l-retention-warn');
  if (!warn) return;
  if (warn.hidden) {
    listRetentionWarningOpen = false;
    return;
  }
  warn.hidden = true;
  warn.querySelector('.list-retention-warn-text').textContent = '';
  listRetentionWarningOpen = false;
  syncListSubmit();
  if (focus) $('#l-retention').focus();
}

function showListRetentionWarning(retention, count) {
  const warn = $('#l-retention-warn');
  const noun = count === 1 ? 'item' : 'items';
  listRetentionWarningOpen = true;
  warn.querySelector('.list-retention-warn-text').textContent =
    `Changing completed retention to ${retentionLabel(retention)} will permanently delete ${count} completed ${noun} older than ${retentionLabel(retention)} in this folder. This cannot be undone.`;
  warn.hidden = false;
  syncListSubmit();
  warn.scrollIntoView({
    block: 'nearest',
    behavior: MOTION_REDUCED.matches ? 'auto' : 'smooth',
  });
  $('#l-retention-cancel').focus({ preventScroll: true });
}

let uploadProgressSeq = 0;

function beginUploadProgress(files) {
  const panel = $('#upload-progress');
  const label = $('#upload-progress-label');
  const pct = $('#upload-progress-pct');
  const track = $('#upload-progress-track');
  const bar = $('#upload-progress-bar');
  const seq = ++uploadProgressSeq;
  if (!panel || !label || !pct || !track || !bar) return { set() {}, processing() {}, end() {} };
  const name = files.length === 1 ? files[0].name : `${files.length} files`;
  label.textContent = `Uploading ${name}…`;
  pct.textContent = '0%';
  track.setAttribute('aria-valuenow', '0');
  bar.style.transform = 'scaleX(0)';
  panel.hidden = false;
  return {
    set(value) {
      if (seq !== uploadProgressSeq) return;
      const percent = Math.max(0, Math.min(100, Math.round(value)));
      pct.textContent = `${percent}%`;
      track.setAttribute('aria-valuenow', String(percent));
      bar.style.transform = `scaleX(${percent / 100})`;
    },
    processing() {
      if (seq !== uploadProgressSeq) return;
      label.textContent = `Processing ${name}…`;
      pct.textContent = '100%';
      track.setAttribute('aria-valuenow', '100');
      bar.style.transform = 'scaleX(1)';
    },
    end() {
      if (seq !== uploadProgressSeq) return;
      panel.hidden = true;
    },
  };
}

function uploadFiles(path, files, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  for (const file of files) form.append('files', file);
  const progress = beginUploadProgress(files);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    if (state.csrfToken) xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) progress.set((event.loaded / event.total) * 100);
    };
    xhr.upload.onload = () => progress.processing();
    xhr.onload = async () => {
      try {
        const headers = new Headers();
        const requestId = xhr.getResponseHeader('X-Request-Id');
        if (requestId) headers.set('X-Request-Id', requestId);
        const res = new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers,
        });
        resolve(await requestJson(res));
      } catch (err) {
        reject(err);
      } finally {
        progress.end();
      }
    };
    xhr.onerror = () => {
      progress.end();
      reject(new Error('Upload failed — check your connection'));
    };
    xhr.onabort = () => {
      progress.end();
      reject(new Error('Upload cancelled'));
    };
    try {
      xhr.send(form);
    } catch (err) {
      progress.end();
      reject(err);
    }
  });
}

function noteEditorFolderId() {
  return Number($('#n-folder').value) || (systemFolder('notes') ? systemFolder('notes').id : null);
}

let noteLinkRange = null;
let noteSavedRange = null;

function noteSelectedRange() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const body = $('#n-body');
  if (!body || !body.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

function restoreNoteRange(range) {
  if (!range) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function applyNoteFormat(kind) {
  const body = $('#n-body');
  if (!body) return;
  const saved = noteSavedRange;
  body.focus();
  if (saved) restoreNoteRange(saved);
  if (kind === 'link') {
    noteLinkRange = noteSelectedRange() || saved;
    $('#note-link-url').value = '';
    $('#note-link-row').hidden = false;
    $('#note-link-url').focus();
    return;
  }
  if (kind === 'heading') {
    const current = document.queryCommandValue('formatBlock').toLowerCase();
    document.execCommand('formatBlock', false, current === 'h2' ? 'p' : 'h2');
    return;
  }
  const command = kind === 'ul' ? 'insertUnorderedList' : kind === 'ol' ? 'insertOrderedList' : kind;
  document.execCommand(command, false, null);
}

function applyNoteLink() {
  const body = $('#n-body');
  if (!body) return;
  let url = $('#note-link-url').value.trim();
  if (!url) return;
  if (!/^(https?:\/\/|mailto:)/i.test(url)) url = 'https://' + url;
  body.focus();
  const link = document.createElement('a');
  link.href = url;
  if (noteLinkRange && !noteLinkRange.collapsed) {
    link.textContent = noteLinkRange.toString();
    noteLinkRange.deleteContents();
    noteLinkRange.insertNode(link);
  } else {
    link.textContent = url;
    if (noteLinkRange) {
      noteLinkRange.insertNode(link);
    } else {
      body.append(link);
    }
  }
  noteLinkRange = null;
  $('#note-link-row').hidden = true;
}

function resetNoteMore() {
  const more = $('#n-more');
  const toggle = $('#n-more-toggle');
  clearTimeout(more._hideTimer);
  more.classList.remove('expanded');
  more.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  $('#n-more-label').textContent = 'More options';
}

function toggleNoteMore() {
  const more = $('#n-more');
  const toggle = $('#n-more-toggle');
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  clearTimeout(more._hideTimer);
  if (expanded) {
    toggle.setAttribute('aria-expanded', 'false');
    $('#n-more-label').textContent = 'More options';
    more.classList.remove('expanded');
    more._hideTimer = setTimeout(() => {
      if (toggle.getAttribute('aria-expanded') === 'false') more.hidden = true;
    }, 260);
  } else {
    toggle.setAttribute('aria-expanded', 'true');
    $('#n-more-label').textContent = 'Fewer options';
    more.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => more.classList.add('expanded')));
  }
}

function openNoteEditor(id) {
  const note = id ? noteById(id) : null;
  noteLinkRange = null;
  noteSavedRange = null;
  $('#note-link-row').hidden = true;
  resetNoteMore();
  state.noteEditingId = note ? note.id : null;
  state.notePendingFiles = [];
  state.noteRemovedFiles = [];
  $('#note-heading').textContent = note ? 'Edit Note' : 'New Note';
  $('#n-title').value = note ? note.title : '';
  $('#n-body').innerHTML = note
    ? (note.body_format === 'html' ? normalizeNoteHtml(note.body) : noteMarkdownHtml(note.body))
    : '';
  $('#n-delete').hidden = !note;
  $('#n-delete').textContent = 'Delete Note';
  const folderSelect = $('#n-folder');
  folderSelect.replaceChildren();
  for (const folder of foldersFor('notes')) {
    folderSelect.append(el('option', { value: folder.id, text: folder.name }));
  }
  const preferred = note ? note.folder_id
    : (viewFolderId(state.view) || (systemFolder('notes') ? systemFolder('notes').id : null));
  if (preferred) folderSelect.value = String(preferred);
  syncNoteFolderVisual();
  state.noteSnapshot = note ? { title: note.title, body: note.body, folder_id: note.folder_id } : null;
  renderNoteAttachments();
  openSheet('#note-editor');
  if (!note) setTimeout(() => $('#n-title').focus(), 80);
}

function syncNoteFolderVisual() {
  const folder = listById(Number($('#n-folder').value));
  $('#n-folder-value').textContent = folder ? folder.name : '';
  $('#n-folder-icon').style.setProperty('--c', colorVar(folder ? folder.color : 'gray'));
}

function renderNoteAttachments() {
  const wrap = $('#n-attachments');
  wrap.replaceChildren();
  const existing = state.noteEditingId
    ? attachmentsFor('note', state.noteEditingId).filter((file) => !state.noteRemovedFiles.includes(file.id))
    : [];
  const imageGallery = existing.filter((file) => isPreviewableImage(file.name));
  for (const file of existing) {
    wrap.append(attachmentRow(file, () => {
      state.noteRemovedFiles.push(file.id);
      renderNoteAttachments();
    }, imageGallery));
  }
  for (const file of state.notePendingFiles) {
    wrap.append(attachmentRow(file, () => {
      state.notePendingFiles = state.notePendingFiles.filter((item) => item !== file);
      renderNoteAttachments();
    }));
  }
  if (!wrap.childElementCount) wrap.append(el('p', { class: 'notify-hint', text: 'No attachments.' }));
}

async function saveNote(event) {
  event.preventDefault();
  const title = $('#n-title').value.trim();
  if (!title) {
    toast('Add a note title');
    return;
  }
  const folderId = noteEditorFolderId();
  if (!folderId) {
    toast('Choose a Notes folder');
    return;
  }
  const body = normalizeNoteHtml($('#n-body').innerHTML);
  const submit = $('#note-submit');
  submit.disabled = true;
  submit.textContent = 'Saving…';
  try {
    let id = state.noteEditingId;
    if (id) {
      await api('/api/notes/' + id, { method: 'PATCH', body: { title, body, body_format: 'html', folder_id: folderId } });
    } else {
      const created = await api('/api/notes', { method: 'POST', body: { title, body, body_format: 'html', folder_id: folderId } });
      id = created.id;
    }
    for (const fileId of state.noteRemovedFiles) {
      await api('/api/attachments/' + fileId, { method: 'DELETE' });
    }
    if (state.notePendingFiles.length) {
      await uploadFiles('/api/notes/' + id + '/attachments', state.notePendingFiles);
    }
    state.notePendingFiles = [];
    state.noteRemovedFiles = [];
    state.storage = null;
    closeSheet('#note-editor');
    await loadState();
    goOrRender('notes/folder/' + folderId);
    toast(state.noteEditingId ? 'Note saved' : 'Note added');
  } catch (err) {
    toast(err.message);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Save';
  }
}

let noteDeleteArmed = false;
let noteDeleteTimer = null;

function resetNoteDelete() {
  noteDeleteArmed = false;
  clearTimeout(noteDeleteTimer);
  noteDeleteTimer = null;
  const button = $('#n-delete');
  if (button) {
    button.textContent = 'Delete Note';
    button.setAttribute('aria-label', 'Delete note');
  }
}

async function deleteNoteFromEditor() {
  if (!state.noteEditingId) return;
  const button = $('#n-delete');
  if (!noteDeleteArmed) {
    noteDeleteArmed = true;
    button.textContent = 'Confirm?';
    button.setAttribute('aria-label', 'Confirm delete note');
    noteDeleteTimer = setTimeout(resetNoteDelete, INLINE_CONFIRM_MS);
    return;
  }
  resetNoteDelete();
  try {
    await api('/api/notes/' + state.noteEditingId, { method: 'DELETE' });
    state.storage = null;
    closeSheet('#note-editor');
    state.noteEditingId = null;
    await loadState();
    render();
    toast('Note deleted');
  } catch (err) {
    toast(err.message);
  }
}

function openListSheet(list) {
  const system = Boolean(list && list.is_system);
  const tenant = list ? tenantOf(list) : state.tenant;
  const retention = list ? listRetention(list) : 'forever';
  hideListRetentionWarning();
  state.editingListId = list ? list.id : null;
  state.listTenant = tenant;
  state.selectedColor = list ? list.color : nextListColor();
  $('#list-heading').textContent = list ? (system ? 'Unfiled' : 'Edit Folder') : 'New Folder';
  $('#l-name').value = list ? list.name : '';
  $('#l-name').placeholder = 'Folder name';
  clearFieldError($('#l-name'), $('#l-name-error'));
  $('#l-name').disabled = system;
  $('#l-delete').hidden = !list || system;
  resetListDelete();
  $('#list-save').textContent = 'Save';
  $('#list-sheet').removeAttribute('aria-busy');
  $('#l-retention').value = retention;
  const retentionRow = $('.list-retention-row', $('#list-sheet'));
  const retentionHint = $('.list-retention-hint', $('#list-sheet'));
  if (retentionRow) retentionRow.hidden = tenant !== 'reminders';
  if (retentionHint) retentionHint.hidden = tenant !== 'reminders';
  renderSwatches();
  listSnapshot = list
    ? { name: $('#l-name').value.trim(), color: state.selectedColor, completed_retention: retention }
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
        hideListRetentionWarning();
        state.selectedColor = color;
        renderSwatches();
        syncListSubmit();
      },
    }));
  }
}

async function saveList(event, options = {}) {
  if (event) event.preventDefault();
  if (listSaving) return;
  if (listRetentionWarningOpen && !options.retentionConfirmed) return;
  if ($('#list-save').disabled && !options.retentionConfirmed) return;
  const existing = state.editingListId ? listById(state.editingListId) : null;
  const system = Boolean(existing && existing.is_system);
  const nameInput = $('#l-name');
  const name = nameInput.value.trim();
  if (!name) {
    showFieldError(nameInput, $('#l-name-error'), 'Folder name is required');
    return;
  }
  clearFieldError(nameInput, $('#l-name-error'));

  const retention = $('#l-retention').value || 'forever';
  const previousRetention = existing ? listRetention(existing) : 'forever';
  if (state.listTenant === 'reminders' && existing
    && RETENTION_ORDER[retention] < RETENTION_ORDER[previousRetention]
    && !options.retentionConfirmed) {
    const purgeCount = completedOlderThan(existing, retention);
    if (purgeCount > 0) {
      showListRetentionWarning(retention, purgeCount);
      return;
    }
  }
  hideListRetentionWarning();
  const body = state.listTenant === 'reminders'
    ? (system
      ? { color: state.selectedColor, completed_retention: retention }
      : { name, color: state.selectedColor, completed_retention: retention, tenant: state.listTenant })
    : (system
      ? { color: state.selectedColor }
      : { name, color: state.selectedColor, tenant: state.listTenant });
  const startedAt = Date.now();
  let created = null;
  let result = null;
  listSaving = true;
  $('#list-save').textContent = 'Saving...';
  $('#list-save').disabled = true;
  $('#list-sheet').setAttribute('aria-busy', 'true');
  try {
    if (system) {
      result = await api('/api/lists/' + existing.id, { method: 'PATCH', body });
    } else if (state.editingListId) {
      result = await api('/api/lists/' + state.editingListId, { method: 'PATCH', body });
    } else {
      created = await api('/api/lists', { method: 'POST', body });
    }
    listSnapshot = { name, color: state.selectedColor, completed_retention: retention };
    await settleSubmit(startedAt);
    closeSheet('#list-sheet');
    await loadState();
    if (!system && !state.editingListId) {
      go(state.listTenant === 'notes' ? 'notes/folder/' + created.id
        : state.listTenant === 'docs' ? 'docs/folder/' + created.id : 'list/' + created.id);
    } else {
      requestListAnimation();
      render();
    }
    const purged = result && result.purged || 0;
    if (purged) {
      toast(`${purged} old completed item${purged === 1 ? '' : 's'} deleted`);
    }
  } catch (err) {
    toast(err.message);
  } finally {
    listSaving = false;
    $('#list-save').textContent = 'Save';
    $('#list-sheet').removeAttribute('aria-busy');
    syncListSubmit();
  }
}

let listDeleteArmed = false;
let listDeleteTimer = null;

function resetListDelete() {
  listDeleteArmed = false;
  clearTimeout(listDeleteTimer);
  listDeleteTimer = null;
  if ($('#l-delete')) {
    $('#l-delete').textContent = 'Delete Folder';
    $('#l-delete').setAttribute('aria-label', 'Delete folder');
  }
  if ($('#l-delete-warn')) $('#l-delete-warn').hidden = true;
}

async function deleteList() {
  if (!state.editingListId) return;
  if (!listDeleteArmed) {
    listDeleteArmed = true;
    $('#l-delete').textContent = 'Confirm?';
    $('#l-delete').setAttribute('aria-label', 'Confirm delete folder');
    const warn = $('#l-delete-warn');
    warn.textContent = 'This also deletes every item in this folder.';
    warn.hidden = false;
    warn.scrollIntoView({
      block: 'nearest',
      behavior: MOTION_REDUCED.matches ? 'auto' : 'smooth',
    });
    clearTimeout(listDeleteTimer);
    listDeleteTimer = setTimeout(resetListDelete, INLINE_CONFIRM_MS);
    return;
  }
  const id = state.editingListId;
  resetListDelete();
  try {
    await api('/api/lists/' + id, { method: 'DELETE' });
    state.storage = null;
    closeSheet('#list-sheet');
    await loadState();
    if (state.view === id || viewFolderId(state.view) === id) {
      requestListAnimation();
      go('home');
    } else {
      requestListAnimation();
      render();
    }
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
    : 'Allow Workspace to send a notification when an item is due.';
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
    hint.textContent = 'On iPhone or iPad, notifications only work after adding Workspace to your Home Screen: tap Share, then Add to Home Screen, and open it from there.';
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
// The page-behind lock fixes <body>; on phones the document is the scroller,
// so keep the background visually in place while the sheet is open and put
// the page back where it was on close.
let sheetPageScroll = null;

function syncSheetState() {
  const anyOpen = $$('.sheet').some((sheet) => !sheet.hidden);
  const wasOpen = document.body.classList.contains('sheet-open');
  if (PAGE_SCROLL_MEDIA.matches && anyOpen && !wasOpen) {
    sheetPageScroll = pageScroller().scrollTop;
    document.body.style.top = `-${sheetPageScroll}px`;
  }
  document.body.classList.toggle('sheet-open', anyOpen);
  if (!anyOpen && wasOpen) {
    const restore = sheetPageScroll;
    sheetPageScroll = null;
    document.body.style.top = '';
    if (restore != null) pageScroller().scrollTop = restore;
  }
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

const closingSheets = new WeakSet();
const sheetCloseTimers = new WeakMap();
const SHEET_MOBILE = window.matchMedia('(max-width: 899px)');

function finishSheetClose(sheet) {
  const timer = sheetCloseTimers.get(sheet);
  if (timer) clearTimeout(timer);
  sheetCloseTimers.delete(sheet);
  closingSheets.delete(sheet);
  sheet.hidden = true;
  sheet.classList.remove('is-visible');
  syncSheetState();
}

function openSheet(selector) {
  if (!$$('.sheet').some((sheet) => !sheet.hidden)) {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  const sheet = $(selector);
  const timer = sheetCloseTimers.get(sheet);
  if (timer) clearTimeout(timer);
  sheetCloseTimers.delete(sheet);
  closingSheets.delete(sheet);
  sheet.hidden = false;
  if (MOTION_REDUCED.matches || !SHEET_MOBILE.matches) {
    sheet.classList.add('is-visible');
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!sheet.hidden) sheet.classList.add('is-visible');
    }));
  }
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
  const sheet = $(selector);
  if (!sheet) return;
  if (sheet.hidden) {
    consumeSheetMarker();
    syncSheetState();
    return;
  }
  if (closingSheets.has(sheet)) return;
  closingSheets.add(sheet);
  consumeSheetMarker();
  if (MOTION_REDUCED.matches || !SHEET_MOBILE.matches) {
    finishSheetClose(sheet);
    return;
  }
  sheet.classList.remove('is-visible');
  sheetCloseTimers.set(sheet, setTimeout(() => finishSheetClose(sheet), 280));
}

// Close the topmost sheet without touching History — composed by the
// user-facing paths below and used directly by the popstate handler (the
// traversal has already consumed that map's entry).
function closeTopSheetInPlace() {
  const open = $$('.sheet').filter((sheet) => !sheet.hidden);
  if (open.length) {
    const sheet = open[open.length - 1];
    if (sheet.id === 'settings-sheet') revertSettingsPreview();
    const timer = sheetCloseTimers.get(sheet);
    if (timer) clearTimeout(timer);
    sheetCloseTimers.delete(sheet);
    closingSheets.delete(sheet);
    sheet.hidden = true;
    sheet.classList.remove('is-visible');
  }
  syncSheetState();
  return open.length > 0;
}

function closeTopSheet() {
  const open = $$('.sheet').filter((sheet) => !sheet.hidden);
  if (!open.length) return false;
  const sheet = open[open.length - 1];
  if (sheet.id === 'settings-sheet') revertSettingsPreview();
  closeSheet('#' + sheet.id);
  return true;
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
let lastDocDragEnd = 0;
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
  if (!row || event.target.closest('a, button, input, textarea, select, .attachment-thumbs')) {
    swipe = null;
    return;
  }
  swipe = {
    kind: row.dataset.noteId ? 'note' : row.dataset.docId ? 'doc' : 'reminder',
    id: Number(row.dataset.noteId || row.dataset.docId || row.dataset.reminderId),
    row,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    fromOpen: row.classList.contains('swipe-open'),
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
    // A closed row only opens with a leftward drag. From a parked-open row,
    // either direction is a real gesture so the rightward drag can close it
    // under the finger instead of snapping shut on the first few pixels.
    if (!swipe.fromOpen && dx > 0) {
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
  const base = swipe.fromOpen ? -max : 0;
  const clamped = Math.max(-max, Math.min(0, base + dx));
  content.style.transform = clamped ? `translateX(${clamped}px)` : '';
});

async function endSwipe(commit) {
  const current = swipe;
  swipe = null;
  if (!current || !current.active) return;
  lastSwipeEnd = Date.now();
  releaseSwipePointer(current);
  const exists = current.kind === 'note' ? Boolean(noteById(current.id))
    : current.kind === 'doc' ? Boolean(docById(current.id))
      : Boolean(findReminder(current.id));
  if (!exists || commit === 0) {
    resetSwipe(current.row);
    return;
  }
  // Park the row on the red Delete action. The user must tap Delete, then
  // Confirm? — no browser dialog. Completed rows can be deleted too.
  snapSwipeOpen(current.row);
}

function endSwipeFromOpen(close) {
  const current = swipe;
  swipe = null;
  if (!current || !current.active) return;
  lastSwipeEnd = Date.now();
  releaseSwipePointer(current);
  if (close) resetSwipe(current.row);
  else snapSwipeOpen(current.row);
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
  if (swipe.fromOpen) {
    endSwipeFromOpen(dx >= threshold);
    return;
  }
  endSwipe(Math.abs(dx) < threshold ? 0 : dx);
});

$('#content').addEventListener('pointercancel', () => {
  mouseDrag = null;
  if (swipe && swipe.active) {
    if (swipe.fromOpen) snapSwipeOpen(swipe.row);
    else resetSwipe(swipe.row);
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
  const update = () => {
    const dark = themePreference === 'dark' || (themePreference === 'auto' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#000000' : '#f5efe6');
    $$('.theme-option-btn').forEach((btn) => {
      const active = btn.dataset.themePref === themePreference;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };
  if (persist) runViewTransition(update);
  else update();
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
const SETTINGS_UPLOAD_KEYS = ['optimize_uploads'];
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
    applyDensity(true);
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
    optimize_uploads: $('#set-optimize-uploads').checked ? '1' : '0',
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
  $('#username-msg').hidden = true;
  $('#username-form').reset();
  updateUsernameDisplay();
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
  $('#set-optimize-uploads').checked = s.optimize_uploads !== '0';
  $('#set-list-progress').value = getListProgress();
  $('#set-list-progress-range').value = getListProgressRange();
  $('#set-sort-field').value = state.sortDefault.field;
  $('#set-sort-dir').value = state.sortDefault.dir;
  syncSortDirLabels($('#set-sort-field'), $('#set-sort-dir'));
  renderDeviceZoneRow();
  renderStorageSettings();
  try { state.storage = await api('/api/storage'); } catch { /* keep cached usage */ }
  renderStorageSettings();
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
  const uploadChanged = changed(SETTINGS_UPLOAD_KEYS);
  const appearanceDirty = appearanceIsDirty();
  const sortChanged = sortIsDirty();
  if (!defaultsChanged && !notifyChanged && !progressChanged && !uploadChanged && !appearanceDirty && !sortChanged) return;

  const saveBtn = $('#settings-save');
  const startedAt = Date.now();
  settingsSaving = true;
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;
  $('#settings-sheet').setAttribute('aria-busy', 'true');
  try {
    let message = '';
    if (defaultsChanged || notifyChanged || progressChanged || uploadChanged) {
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
        } else if (uploadChanged) {
          message = 'Saved. Upload optimization applies to new uploads only.';
        } else {
          message = 'Saved — folder progress now follows you on all devices.';
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
        ? `${message} Sorting applied to all folders and views.`
        : 'Saved — sorting applied to all folders.';
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

const TOKEN_ACCESS_TENANTS = [
  { key: 'reminders', label: 'Reminders', levels: [['read', 'Read only'], ['write', 'Read + write']], deletable: false },
  { key: 'notes', label: 'Notes', levels: [['none', 'No access'], ['read', 'Read only'], ['write', 'Read + write']], deletable: true },
  { key: 'docs', label: 'Docs', levels: [['none', 'No access'], ['read', 'Read only'], ['write', 'Read + write']], deletable: true },
];
const TOKEN_OTHER_SCOPES = [['storage:read', 'Storage usage'], ['search:read', 'Search']];

function tokenLevelFor(tenant, token) {
  if (tenant === 'reminders') {
    return token && (token.profile === 'write' || token.profile === 'legacy') ? 'write' : 'read';
  }
  const permissions = new Set((token && token.permissions) || []);
  if (permissions.has(`${tenant}:write`)) return 'write';
  if (permissions.has(`${tenant}:read`)) return 'read';
  return 'none';
}

function buildTokenAccessEditor(container, token = null) {
  container.replaceChildren();
  for (const tenant of TOKEN_ACCESS_TENANTS) {
    const select = el('select', { 'aria-label': `${tenant.label} access` });
    for (const [value, label] of tenant.levels) select.append(el('option', { value, text: label }));
    select.value = tokenLevelFor(tenant.key, token);
    const children = [
      el('span', { class: 'token-access-name', text: tenant.label }),
      select,
    ];
    if (tenant.deletable) {
      children.push(el('label', { class: 'token-access-delete' }, [
        el('input', { type: 'checkbox', value: `${tenant.key}:delete`, checked: Boolean(token && (token.permissions || []).includes(`${tenant.key}:delete`)) }),
        el('span', { text: 'Allow delete' }),
      ]));
    }
    container.append(el('div', { class: 'token-access-row' }, children));
  }
  const other = el('div', { class: 'token-access-row token-access-other' }, [
    el('span', { class: 'token-access-name', text: 'Other' }),
  ]);
  const extras = el('div', { class: 'token-access-options' });
  for (const [scope, label] of TOKEN_OTHER_SCOPES) {
    extras.append(el('label', { class: 'token-scope-option' }, [
      el('input', { type: 'checkbox', value: scope, checked: Boolean(token && (token.permissions || []).includes(scope)) }),
      el('span', { text: label }),
    ]));
  }
  other.append(extras);
  container.append(other);
}

function tokenAccessValues(container) {
  const profile = container.querySelector('[aria-label="Reminders access"]').value === 'write' ? 'write' : 'read';
  const permissions = [];
  for (const tenant of TOKEN_ACCESS_TENANTS.filter((item) => item.key !== 'reminders')) {
    const select = container.querySelector(`[aria-label="${tenant.label} access"]`);
    const level = select ? select.value : 'none';
    if (level === 'read') permissions.push(`${tenant.key}:read`);
    if (level === 'write') permissions.push(`${tenant.key}:read`, `${tenant.key}:write`);
    const deleteInput = container.querySelector(`input[type="checkbox"][value="${tenant.key}:delete"]`);
    if (deleteInput && deleteInput.checked) permissions.push(`${tenant.key}:delete`);
  }
  for (const [scope] of TOKEN_OTHER_SCOPES) {
    const input = container.querySelector(`input[type="checkbox"][value="${scope}"]`);
    if (input && input.checked) permissions.push(scope);
  }
  return { profile, permissions };
}

function tokenAccessSummary(token) {
  const reminders = tokenLevelFor('reminders', token) === 'write' ? 'read + write' : 'read';
  const parts = [`Reminders ${reminders}`];
  for (const tenant of ['notes', 'docs']) {
    const level = tokenLevelFor(tenant, token);
    const hasDelete = (token.permissions || []).includes(`${tenant}:delete`);
    if (level === 'none') {
      parts.push(`${tenant === 'notes' ? 'Notes' : 'Docs'} ${hasDelete ? 'delete only' : 'no access'}`);
      continue;
    }
    const label = level === 'write' ? 'read + write' : 'read only';
    parts.push(`${tenant === 'notes' ? 'Notes' : 'Docs'} ${label}${hasDelete ? ' + delete' : ''}`);
  }
  const extras = (token.permissions || []).filter((scope) => scope === 'storage:read' || scope === 'search:read')
    .map((scope) => scope === 'storage:read' ? 'Storage' : 'Search');
  if (extras.length) parts.push(extras.join(' + '));
  return parts.join(' · ');
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
    const tokenName = token.name || 'token';
    const summary = tokenAccessSummary(token);
    const row = el('div', { class: 'token-row' }, [
      el('span', { class: 'token-name', text: tokenName }),
      el('span', {
        class: 'token-meta',
        text: token.revoked_at
          ? `revoked · ${summary}`
          : `used ${token.last_used_at ? new Date(token.last_used_at).toLocaleDateString() : 'never'}`,
      }),
    ]);
    if (!token.revoked_at) {
      const revokeButton = el('button', {
        type: 'button',
        class: 'secondary-btn small-btn',
        text: 'Revoke',
        'aria-label': `Revoke token ${tokenName}`,
      });
      let revokeArmed = false;
      let revokeTimer = null;
      const resetRevoke = () => {
        revokeArmed = false;
        clearTimeout(revokeTimer);
        revokeTimer = null;
        revokeButton.textContent = 'Revoke';
        revokeButton.setAttribute('aria-label', `Revoke token ${tokenName}`);
      };
      revokeButton.addEventListener('click', async () => {
        if (!revokeArmed) {
          revokeArmed = true;
          revokeButton.textContent = 'Confirm?';
          revokeButton.setAttribute('aria-label', `Confirm revoke token ${tokenName}`);
          clearTimeout(revokeTimer);
          revokeTimer = setTimeout(resetRevoke, INLINE_CONFIRM_MS);
          return;
        }
        resetRevoke();
        try {
          await api('/api/tokens/' + token.id + '/revoke', { method: 'POST' });
          await renderTokenList();
          toast('Token revoked');
        } catch (err) {
          toast(err.message);
        }
      });

      const accessGrid = el('div', { class: 'token-access-grid' });
      buildTokenAccessEditor(accessGrid, token);
      const accessSave = el('button', {
        type: 'button',
        class: 'secondary-btn small-btn',
        text: 'Save access',
        'aria-label': `Save access for ${tokenName}`,
      });
      accessSave.addEventListener('click', async () => {
        accessSave.disabled = true;
        try {
          const values = tokenAccessValues(accessGrid);
          await api('/api/tokens/' + token.id + '/profile', { method: 'POST', body: { profile: values.profile } });
          await api('/api/tokens/' + token.id + '/permissions', { method: 'POST', body: { permissions: values.permissions } });
          await renderTokenList();
          toast('Token access saved');
        } catch (err) {
          toast(err.message);
        } finally {
          accessSave.disabled = false;
        }
      });
      row.append(revokeButton, el('details', { class: 'token-scope-details' }, [
        el('summary', { text: `Access: ${summary}` }),
        accessGrid,
        accessSave,
      ]));
    }
    wrap.append(row);
  }
}

async function generateToken() {
  const name = $('#token-name').value.trim() || 'agent';
  const access = tokenAccessValues($('#token-access-new'));
  const profile = access.profile;
  const permissions = access.permissions;
  try {
    const result = await api('/api/tokens', { method: 'POST', body: { name, profile, permissions } });
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
    link.download = `workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

function updateUsernameDisplay() {
  const node = $('#username-display');
  if (node) node.textContent = state.username ? `Username: ${state.username}` : 'Username: not set';
}

function usernameMessage(message, ok = false) {
  const node = $('#username-msg');
  node.textContent = message;
  node.classList.toggle('ok', ok);
  node.hidden = false;
}

async function changeUsername(event) {
  event.preventDefault();
  const username = $('#username-new').value.trim();
  const current = $('#username-current-password').value;
  if (!username) return usernameMessage('Choose a username');
  if (username.length > 50) return usernameMessage('Username must be 50 characters or fewer');
  if (!current) return usernameMessage('Enter your current password');
  try {
    const result = await api('/api/account/username', {
      method: 'POST',
      body: { username, currentPassword: current },
    });
    state.username = result.username;
    state.needsUsername = false;
    state.usernameRequired = true;
    updateUsernameDisplay();
    updateUsernameGate();
    $('#username-form').reset();
    usernameMessage('Username updated', true);
  } catch (err) {
    usernameMessage(err.message);
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
    passwordMessage('Password updated — other sessions signed out', true);
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

$('#tenant-switch').addEventListener('click', (event) => {
  const btn = event.target.closest('.tenant-btn');
  if (!btn) return;
  setTenant(btn.dataset.tenant);
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
$('#username-form').addEventListener('submit', changeUsername);
$('#gate-form').addEventListener('submit', submitUsernameGate);
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
  applyDensity(true);
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

$('#fab-add').addEventListener('click', () => {
  if (state.tenant === 'notes') openNoteEditor(null);
  else if (state.tenant === 'docs') chooseDocsFiles();
  else openEditor(null);
});
$('#menu-btn').addEventListener('click', handleMenuButton);
$('#sidebar-menu-btn').addEventListener('click', toggleAccountMenu);
$('#account-notifications').addEventListener('click', () => { closeAccountMenu(); openNotifySheet(); });
$('#account-storage').addEventListener('click', async () => {
  closeAccountMenu();
  await openSettings();
  const summary = $('#storage-summary');
  if (summary) summary.scrollIntoView({ block: 'center', behavior: MOTION_REDUCED.matches ? 'auto' : 'smooth' });
});
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

function setSearchOverlay(open) {
  const overlay = $('#search-form');
  if (!overlay) return;
  overlay.classList.toggle('open', open);
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  overlay.inert = !open;
  const button = $('#search-open-btn');
  if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) setTimeout(() => $('#search').focus(), 80);
}

function closeSearchOverlay(clear = true) {
  setSearchOverlay(false);
  if (clear && state.search) setSearch('', 'both');
}

function clearSearchResults() {
  state.searchSeq += 1;
  state.searchOpen = [];
  state.searchCompleted = [];
  state.searchNotes = [];
  state.searchDocs = [];
  state.searchTotals = { open: 0, completed: 0, notes: 0, docs: 0 };
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
  const includeReminders = true;
  const includeNotes = true;
  const includeDocs = true;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}&limit=500&scope=all`);
    if (seq !== state.searchSeq || query !== state.search) return false;
    state.searchQuery = query;
    state.searchOpen = data.open || [];
    state.searchCompleted = data.completed || [];
    state.searchNotes = data.notes || [];
    state.searchDocs = data.docs || [];
    state.searchTotals = data.totals || {
      open: state.searchOpen.length,
      completed: state.searchCompleted.length,
      notes: state.searchNotes.length,
      docs: state.searchDocs.length,
    };
    state.searchTruncated = Boolean(data.truncated);
    state.searchOffline = false;
  } catch {
    if (seq !== state.searchSeq || query !== state.search) return false;
    state.searchQuery = query;
    const needle = query.toLowerCase();
    const local = includeReminders
      ? (window.TodoFuzzy
        ? window.TodoFuzzy.rank(state.reminders, state.search).map((entry) => entry.reminder)
        : sortItems(state.reminders.filter(matchesSearch), effectiveSort(state.view)))
      : [];
    state.searchOpen = local.filter((reminder) => !reminder.completed);
    state.searchCompleted = local.filter((reminder) => reminder.completed);
    state.searchNotes = includeNotes
      ? state.notes.filter((note) => note.title.toLowerCase().includes(needle)
        || (note.body || '').toLowerCase().includes(needle))
      : [];
    state.searchDocs = includeDocs
      ? state.docs.filter((doc) => doc.name.toLowerCase().includes(needle))
      : [];
    state.searchTotals = {
      open: state.searchOpen.length,
      completed: state.searchCompleted.length,
      notes: state.searchNotes.length,
      docs: state.searchDocs.length,
    };
    state.searchTruncated = false;
    state.searchOffline = true;
  }
  if (seq === state.searchSeq) state.searchLoading = false;
  return true;
}

function setSearch(value, source) {
  const wasSearching = Boolean(state.search);
  state.search = value.trim();
  if (Boolean(state.search) !== wasSearching) {
    expandedNoteId = null;
  }
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
$('#search-open-btn').addEventListener('click', () => setSearchOverlay(true));
$('#search-close').addEventListener('click', () => closeSearchOverlay(true));

$('#main-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#main-search').blur();
});

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#search').blur();
});

$('#editor-form').addEventListener('submit', saveEditor);
$('#note-form').addEventListener('submit', saveNote);
$('#n-more-toggle').addEventListener('click', toggleNoteMore);
$$('.note-format-btn').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => applyNoteFormat(button.dataset.noteFormat));
});
$('#note-link-apply').addEventListener('click', applyNoteLink);
$('#note-link-cancel').addEventListener('click', () => {
  noteLinkRange = null;
  $('#note-link-row').hidden = true;
});
$('#n-body').addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (link) event.preventDefault();
});
$('#n-body').addEventListener('paste', (event) => {
  event.preventDefault();
  const text = event.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
});
document.addEventListener('selectionchange', () => {
  const body = $('#n-body');
  if (!body || !body.contains(window.getSelection()?.anchorNode)) return;
  const range = noteSelectedRange();
  if (range) noteSavedRange = range;
});
$('#note-link-url').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  applyNoteLink();
});
$('#doc-form').addEventListener('submit', saveDoc);
$('#doc-folder').addEventListener('change', () => { syncDocFolderVisual(); syncDocSave(); });
$('#doc-name').addEventListener('input', syncDocSheetInfo);
$('#image-prev').addEventListener('click', () => stepImage(-1));
$('#image-next').addEventListener('click', () => stepImage(1));
const imageViewerBody = $('.image-viewer-body');
imageViewerBody.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch' || event.target.closest('button')) return;
  imageSwipeStart = { x: event.clientX, y: event.clientY };
});
imageViewerBody.addEventListener('pointerup', (event) => {
  if (!imageSwipeStart || event.pointerType !== 'touch') return;
  const dx = event.clientX - imageSwipeStart.x;
  const dy = event.clientY - imageSwipeStart.y;
  imageSwipeStart = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
  stepImage(dx < 0 ? 1 : -1);
});
imageViewerBody.addEventListener('pointercancel', () => { imageSwipeStart = null; });
document.addEventListener('keydown', (event) => {
  if ($('#image-sheet').hidden) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); stepImage(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); stepImage(1); }
});
$('#doc-description').addEventListener('input', () => { syncDocDescriptionCount(); syncDocSave(); });
$('#doc-image-preview-img').addEventListener('error', () => {
  $('#doc-image-preview').hidden = true;
});
$('#doc-name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') event.preventDefault();
});
$('#n-delete').addEventListener('click', deleteNoteFromEditor);
$('#n-folder').addEventListener('change', syncNoteFolderVisual);
$('#e-files').addEventListener('change', (event) => {
  state.editorPendingFiles.push(...Array.from(event.target.files || []));
  event.target.value = '';
  renderEditorAttachments();
});
$('#n-files').addEventListener('change', (event) => {
  state.notePendingFiles.push(...Array.from(event.target.files || []));
  event.target.value = '';
  renderNoteAttachments();
});
$('#docs-file-input').addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  const invalid = validateDocsFiles(files);
  if (invalid) return toast(invalid);
  const folderId = state.docsUploadFolder
    || (systemFolder('docs') ? systemFolder('docs').id : null);
  if (!folderId) return toast('Create a Docs folder first');
  try {
    const result = await uploadFiles('/api/docs', files, { folder_id: folderId });
    state.storage = null;
    await loadState();
    goOrRender('docs/folder/' + folderId);
    const converted = (result.docs || []).filter((doc) => String(doc.optimization || '').startsWith('heic:')).length;
    toast(`${files.length} file${files.length === 1 ? '' : 's'} added${converted ? ` · ${converted} HEIC converted to JPG` : ''}`);
  } catch (err) {
    toast(err.message);
  }
});
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
$('#e-parse-chip').addEventListener('click', toggleParseSuggestion);
$('#e-date').addEventListener('change', () => {
  if (!$('#e-date').value) {
    $('#e-date-on').checked = false;
    $('#e-time-on').checked = false;
    syncDateTimeRows();
  } else {
    markScheduleManual();
  }
  syncDateHistoryHint();
});
$('#e-time').addEventListener('change', () => {
  if (!$('#e-time').value) {
    $('#e-time-on').checked = false;
    syncDateTimeRows();
  } else {
    markScheduleManual();
  }
  syncDateHistoryHint();
});
$('#e-list').addEventListener('change', updateEditorListVisual);

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
  else if (field === 'completed') patch.dir = 'desc';
  setViewSort(state.view, patch);
  requestRowAnimation();
  render();
});
$('#sort-dir').addEventListener('change', (event) => {
  setViewSort(state.view, { dir: event.target.value });
  requestRowAnimation();
  render();
});
// Same outcome as the old "Show N Completed" link: reveal this list's
// completed items and remember the choice per list (localStorage), so every
// visit to that list restores it.
let completedToggleToken = 0;

function animateCompletedSectionOpen() {
  const section = $('.completed-section');
  if (!section || MOTION_REDUCED.matches) return;
  section.getAnimations().forEach((animation) => animation.cancel());
  const height = section.getBoundingClientRect().height;
  section.style.overflow = 'hidden';
  const anim = section.animate(
    [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }],
    { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
  anim.onfinish = () => {
    section.style.overflow = '';
    section.style.height = '';
  };
}

function animateCompletedSectionClose(done) {
  const section = $('.completed-section');
  if (!section || MOTION_REDUCED.matches) { done(); return; }
  section.getAnimations().forEach((animation) => animation.cancel());
  const rect = section.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) { done(); return; }
  const height = rect.height;
  section.style.overflow = 'hidden';
  const anim = section.animate(
    [{ height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
    { duration: 180, easing: 'ease-out' },
  );
  anim.onfinish = done;
}

function preserveContentScroll(action, mode = 'keep') {
  const scroller = screenScroller();
  if (!scroller) { action(); return; }
  const top = scroller.scrollTop;
  action();
  scroller.scrollTop = mode === 'clamp'
    ? Math.min(top, Math.max(0, scroller.scrollHeight - scroller.clientHeight))
    : top;
}

$('#sort-completed').addEventListener('click', (event) => {
  if (typeof state.view !== 'number' || event.currentTarget.disabled) return;
  const token = ++completedToggleToken;
  state.showCompleted = !state.showCompleted;
  setShowCompleted(state.view, state.showCompleted);
  event.currentTarget.setAttribute('aria-pressed', state.showCompleted ? 'true' : 'false');
  if (state.showCompleted) {
    preserveContentScroll(() => renderMain());
    animateCompletedSectionOpen();
    return;
  }
  const previous = screenScroller();
  const previousScroll = previous ? previous.scrollTop : 0;
  animateCompletedSectionClose(() => {
    if (token === completedToggleToken && $('.completed-section')) {
      renderMain();
      const scroller = screenScroller();
      if (scroller) scroller.scrollTop = Math.min(previousScroll, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    }
  });
});
$('#set-sort-field').addEventListener('change', () => {
  if ($('#set-sort-field').value === 'due') $('#set-sort-dir').value = 'asc';
  syncSortDirLabels($('#set-sort-field'), $('#set-sort-dir'));
});
$('#list-form').addEventListener('submit', saveList);
$('#l-name').addEventListener('input', () => {
  hideListRetentionWarning();
  clearFieldError($('#l-name'), $('#l-name-error'));
  syncListSubmit();
});
$('#l-retention').addEventListener('change', () => {
  hideListRetentionWarning();
  syncListSubmit();
});
$('#l-retention-cancel').addEventListener('click', () => {
  hideListRetentionWarning({ focus: true });
});
$('#l-retention-confirm').addEventListener('click', () => {
  saveList(null, { retentionConfirmed: true });
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
      closeSheet('#' + sheet.id);
    }
  }
});

// Browser/hardware Back: one pop = one sheet closed (cancel semantics), or —
// once every sheet marker is popped — leave app-initiated sheets untouched
// (already closed). History-anchored sheets, see openSheet.
window.addEventListener('popstate', (event) => {
  const fromProgrammatic = programmaticHash !== null
    && location.hash === programmaticHash
    && performance.now() < programmaticUntil;
  programmaticHash = null;
  programmaticUntil = 0;
  if (sheetPopGuard) {
    sheetPopGuard = false;
    return;
  }
  const depth = event.state && event.state.todoSheet ? event.state.todoSheet : 0;
  if (!depth) {
    let closed = false;
    while (closeTopSheetInPlace()) closed = true;
    const hashChanged = location.hash !== lastRenderedHash;
    if (!closed && !fromProgrammatic && hashChanged) {
      historyBackHash = location.hash;
    } else if (!closed && !fromProgrammatic && activeNavSnapshot) {
      finishNavAnimation();
    }
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
  const toast = $('#toast');
  if (toast && !toast.hidden && !event.target.closest('.toast-action')) hideToast(true);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  if ($('#username-gate') && !$('#username-gate').hidden) return;
  trapSheetTab(event);
});

async function refreshOnResume() {
  if (!state.authenticated) return;
  checkDayRollover();
  try {
    await loadState();
    render();
  } catch { /* offline — keep showing cached state */ }
  syncDeviceZone();
}

window.addEventListener('hashchange', route);
window.addEventListener('focus', refreshOnResume);
let noteSyncTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(noteSyncTimer);
  noteSyncTimer = setTimeout(() => {
    syncNoteExpanders();
    if (dayPeekOpen) syncDayCardHeight($('#day-card'), false);
  }, 120);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshOnResume();
});

applyDensity();
syncMenuButtons();
buildTokenAccessEditor($('#token-access-new'));

initPullToRefresh();
initDayPeek();
function onScrollActivity() {
  lastNoteScrollAt = Date.now();
}

// Only trust the scroller that belongs to the current layout: when a resize
// swaps scrollers, the old one clamps to 0 and would otherwise overwrite the
// saved position with that clamp.
[$('.sidebar'), $('#content')].forEach((scroller) => {
  if (!scroller) return;
  scroller.addEventListener('scroll', () => {
    onScrollActivity();
    if (!PAGE_SCROLL_MEDIA.matches) recordScreenScroll();
  }, { passive: true });
});
// The phone layout scrolls the document rather than those elements.
window.addEventListener('scroll', () => {
  onScrollActivity();
  if (PAGE_SCROLL_MEDIA.matches) recordScreenScroll();
}, { passive: true });

// Crossing the layout breakpoint (e.g. rotating a large iPhone) swaps which
// element scrolls; carry the position across once the new styles settle.
PAGE_SCROLL_MEDIA.addEventListener('change', () => {
  requestAnimationFrame(() => {
    const screen = document.body.dataset.screen;
    if (!screen) return;
    const scroller = PAGE_SCROLL_MEDIA.matches
      ? pageScroller()
      : (screen === 'home' ? $('.sidebar') : $('#content'));
    if (scroller) scroller.scrollTop = screenScroll[screen] || 0;
  });
});

/* iOS keeps sticky elements on the layout viewport, so opening the keyboard
   can push a focused search bar above what the user can see (and leave search
   results starting at an old list position). Bring the screen to its top when
   search is focused, then nudge the active sticky header down if the visual
   viewport is still offset. */
function searchHasFocus() {
  const active = document.activeElement;
  return active === $('#search') || active === $('#main-search');
}

function activeTopBar() {
  return document.body.dataset.screen === 'home' ? $('.sidebar-top') : $('.main-top');
}

function resetTopBarTransforms() {
  for (const bar of [$('.sidebar-top'), $('.main-top')]) {
    if (bar) bar.style.transform = '';
  }
}

let searchHeaderFrame = 0;
function syncSearchHeaderShift() {
  if (searchHeaderFrame) return;
  searchHeaderFrame = requestAnimationFrame(() => {
    searchHeaderFrame = 0;
    resetTopBarTransforms();
    if (!PAGE_SCROLL_MEDIA.matches || !searchHasFocus()) return;
    const bar = activeTopBar();
    if (!bar) return;
    const viewport = window.visualViewport;
    const shift = Math.max(
      0,
      -bar.getBoundingClientRect().top,
      viewport ? viewport.offsetTop : 0,
    );
    if (shift > 0.5) bar.style.transform = `translateY(${shift}px)`;
  });
}

function bringSearchToTop() {
  if (!PAGE_SCROLL_MEDIA.matches) return;
  pageScroller().scrollTop = 0;
  syncSearchHeaderShift();
}

document.addEventListener('focusin', (event) => {
  if (event.target === $('#search') || event.target === $('#main-search')) {
    bringSearchToTop();
    // The keyboard animation reports its viewport after focus; re-check once.
    setTimeout(syncSearchHeaderShift, 300);
  }
});

document.addEventListener('focusout', (event) => {
  if (event.target === $('#search') || event.target === $('#main-search')) {
    setTimeout(syncSearchHeaderShift, 0);
  }
});

window.addEventListener('scroll', syncSearchHeaderShift, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncSearchHeaderShift);
  window.visualViewport.addEventListener('scroll', syncSearchHeaderShift);
}

boot();
