const crypto = require('crypto');

function normalizeSecret(value) {
  return String(value || '').trim();
}

function hasConfiguredSecret(value) {
  return normalizeSecret(value).length > 0;
}

function safeEqual(left, right) {
  const a = Buffer.from(normalizeSecret(left));
  const b = Buffer.from(normalizeSecret(right));
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isSecretAuthorized(provided, expected) {
  if (!hasConfiguredSecret(expected)) return false;
  return safeEqual(provided, expected);
}

module.exports = {
  normalizeSecret,
  hasConfiguredSecret,
  safeEqual,
  isSecretAuthorized,
};
