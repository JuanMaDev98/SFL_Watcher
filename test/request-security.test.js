const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasConfiguredSecret,
  safeEqual,
  isSecretAuthorized,
} = require('../src/services/requestSecurity');

test('hasConfiguredSecret only accepts non-empty trimmed values', () => {
  assert.equal(hasConfiguredSecret('secret'), true);
  assert.equal(hasConfiguredSecret('  secret  '), true);
  assert.equal(hasConfiguredSecret('   '), false);
  assert.equal(hasConfiguredSecret(''), false);
});

test('safeEqual compares secrets safely and rejects empty/length mismatch', () => {
  assert.equal(safeEqual('abc123', 'abc123'), true);
  assert.equal(safeEqual('abc123', 'abc124'), false);
  assert.equal(safeEqual('abc123', 'abc1234'), false);
  assert.equal(safeEqual('', ''), false);
});

test('isSecretAuthorized requires configured expected secret', () => {
  assert.equal(isSecretAuthorized('token', 'token'), true);
  assert.equal(isSecretAuthorized('token', 'other'), false);
  assert.equal(isSecretAuthorized('token', ''), false);
});
