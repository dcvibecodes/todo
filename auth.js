'use strict';

const crypto = require('crypto');

const USERNAME_MAX = 50;

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!username) return { ok: false, error: 'Username is required.', username };
  if (username.length > USERNAME_MAX) {
    return { ok: false, error: `Username must be ${USERNAME_MAX} characters or fewer.`, username };
  }
  return { ok: true, error: '', username };
}

// Trimmed, case-insensitive comparison. Hashing first gives both sides the
// same buffer length, so timingSafeEqual is used without leaking the stored
// username's length through an early exit.
function usernameMatches(submitted, stored) {
  const digest = (value) => crypto
    .createHash('sha256')
    .update(normalizeUsername(value).toLowerCase(), 'utf8')
    .digest();
  return crypto.timingSafeEqual(digest(submitted), digest(String(stored || '')));
}

module.exports = {
  USERNAME_MAX,
  normalizeUsername,
  validateUsername,
  usernameMatches,
};
