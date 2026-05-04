const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeSnapshotWindows,
  buildExpectedWindows,
} = require('../src/services/cronMonitor');
const { extractUniqueResources } = require('../src/services/resourceCatalog');

test('extractUniqueResources normalizes, sorts, and deduplicates resources', () => {
  assert.deepEqual(
    extractUniqueResources([
      { resource: 'Salt' },
      { resource: 'apple' },
      { resource: 'salt' },
      { resource: 'Bumpkin Emblem' },
    ]),
    ['apple', 'bumpkin emblem', 'salt']
  );
});

test('analyzeSnapshotWindows detects healthy recent snapshots with no gaps', () => {
  const endDate = new Date('2026-05-04T12:00:00.000Z');
  const expectedWindows = buildExpectedWindows(endDate, 1, 15);
  const rows = expectedWindows.map(created_at => ({ created_at }));
  const summary = analyzeSnapshotWindows(rows, { endDate, lookbackHours: 1, maxAgeMinutes: 25 });

  assert.equal(summary.healthy, true);
  assert.equal(summary.missingCount, 0);
  assert.equal(summary.observedCount, expectedWindows.length);
});

test('analyzeSnapshotWindows detects missing windows and stale latest snapshot', () => {
  const endDate = new Date('2026-05-04T12:00:00.000Z');
  const rows = [
    { created_at: '2026-05-04T11:00:00.000Z' },
    { created_at: '2026-05-04T11:15:00.000Z' },
  ];
  const summary = analyzeSnapshotWindows(rows, { endDate, lookbackHours: 1, maxAgeMinutes: 25 });

  assert.equal(summary.healthy, false);
  assert.ok(summary.missingCount > 0);
  assert.equal(summary.lastAgeMinutes, 45);
});
