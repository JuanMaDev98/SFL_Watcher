const test = require('node:test');
const assert = require('node:assert/strict');

const {
  joinResourceTokens,
  parsePercentAlertInput,
  parseTargetAlertArgs,
} = require('../src/services/commandParser');

test('joinResourceTokens keeps multiword resources normalized', () => {
  assert.equal(joinResourceTokens([' Frost', 'Pebble ']), 'frost pebble');
  assert.equal(joinResourceTokens(['bumpkin', 'emblem']), 'bumpkin emblem');
});

test('parsePercentAlertInput understands multiword resources', () => {
  assert.deepEqual(parsePercentAlertInput('bumpkin emblem 30 30'), {
    ok: true,
    resource: 'bumpkin emblem',
    thresholdHigh: 30,
    thresholdLow: -30,
  });
});

test('parseTargetAlertArgs understands multiword resources and decimal target', () => {
  assert.deepEqual(parseTargetAlertArgs(['frost', 'pebble', 'below', '0.01']), {
    ok: true,
    resource: 'frost pebble',
    direction: 'below',
    targetPrice: 0.01,
  });
});
