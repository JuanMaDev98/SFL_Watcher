const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPercentStep,
  getTargetStep,
  getCriticalStep,
  getPercentResetThreshold,
  getTargetResetPrice,
} = require('../src/services/alertMath');

test('percent alerts escalate in +20 point steps after threshold', () => {
  assert.equal(getPercentStep(29.9, 30, 'rise'), 0);
  assert.equal(getPercentStep(30, 30, 'rise'), 1);
  assert.equal(getPercentStep(49.9, 30, 'rise'), 1);
  assert.equal(getPercentStep(50, 30, 'rise'), 2);
  assert.equal(getPercentStep(-30, -30, 'fall'), 1);
  assert.equal(getPercentStep(-50, -30, 'fall'), 2);
});

test('target alerts escalate away from target and reset on crossing target', () => {
  assert.equal(getTargetStep(0.9, 1, 'above'), 0);
  assert.equal(getTargetStep(1.0, 1, 'above'), 1);
  assert.equal(getTargetStep(1.19, 1, 'above'), 1);
  assert.equal(getTargetStep(1.2, 1, 'above'), 2);
  assert.equal(getTargetStep(0.8, 1, 'below'), 2);
  assert.equal(getTargetResetPrice(1), 1);
});

test('critical alerts escalate from 50% in +20 point steps and reset at 0%', () => {
  assert.equal(getCriticalStep(49.99), 0);
  assert.equal(getCriticalStep(50), 1);
  assert.equal(getCriticalStep(70), 2);
  assert.equal(getCriticalStep(-90), 3);
  assert.equal(getPercentResetThreshold(), 0);
});
