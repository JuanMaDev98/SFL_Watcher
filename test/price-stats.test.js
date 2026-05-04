const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStatsFromSnapshots } = require('../src/services/priceStats');

test('buildStatsFromSnapshots computes current, avg, min, max and percent per resource', () => {
  const rows = [
    { resource: 'salt', price: 2, created_at: '2026-05-04T12:15:00.000Z' },
    { resource: 'salt', price: 1, created_at: '2026-05-04T12:00:00.000Z' },
    { resource: 'apple', price: 5, created_at: '2026-05-04T12:30:00.000Z' },
    { resource: 'apple', price: 3, created_at: '2026-05-04T12:00:00.000Z' },
  ];

  assert.deepEqual(buildStatsFromSnapshots(rows), [
    {
      resource: 'apple',
      current_price: 5,
      avg_price: 4,
      min_price: 3,
      max_price: 5,
      percent_vs_avg: 25,
      snapshot_count: 2,
    },
    {
      resource: 'salt',
      current_price: 2,
      avg_price: 1.5,
      min_price: 1,
      max_price: 2,
      percent_vs_avg: 33.33333333333333,
      snapshot_count: 2,
    },
  ]);
});

test('buildStatsFromSnapshots ignores invalid rows safely', () => {
  const rows = [
    { resource: 'salt', price: 1, created_at: '2026-05-04T12:00:00.000Z' },
    { resource: '', price: 2, created_at: '2026-05-04T12:15:00.000Z' },
    { resource: 'salt', price: 'oops', created_at: '2026-05-04T12:30:00.000Z' },
    { resource: 'salt', price: 3, created_at: 'bad-date' },
  ];

  assert.deepEqual(buildStatsFromSnapshots(rows), [
    {
      resource: 'salt',
      current_price: 1,
      avg_price: 1,
      min_price: 1,
      max_price: 1,
      percent_vs_avg: 0,
      snapshot_count: 1,
    },
  ]);
});
