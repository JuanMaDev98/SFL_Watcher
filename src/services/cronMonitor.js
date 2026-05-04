const SNAPSHOT_INTERVAL_MINUTES = 15;
const MONITOR_MAX_AGE_MINUTES = 25;
const DAILY_LOOKBACK_HOURS = 24;

function floorToInterval(dateInput, intervalMinutes = SNAPSHOT_INTERVAL_MINUTES) {
  const date = new Date(dateInput);
  date.setUTCSeconds(0, 0);
  const minutes = date.getUTCMinutes();
  date.setUTCMinutes(minutes - (minutes % intervalMinutes));
  return date;
}

function toIsoMinute(dateInput) {
  return floorToInterval(dateInput).toISOString();
}

function extractCoveredWindows(rows = [], intervalMinutes = SNAPSHOT_INTERVAL_MINUTES) {
  const covered = new Set();
  for (const row of rows) {
    const createdAt = row?.created_at || row;
    if (!createdAt) continue;
    covered.add(floorToInterval(createdAt, intervalMinutes).toISOString());
  }
  return covered;
}

function buildExpectedWindows(endDate = new Date(), lookbackHours = DAILY_LOOKBACK_HOURS, intervalMinutes = SNAPSHOT_INTERVAL_MINUTES) {
  const end = floorToInterval(endDate, intervalMinutes);
  const totalWindows = Math.ceil((lookbackHours * 60) / intervalMinutes);
  const windows = [];

  for (let i = totalWindows - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCMinutes(d.getUTCMinutes() - (i * intervalMinutes));
    windows.push(d.toISOString());
  }

  return windows;
}

function analyzeSnapshotWindows(rows = [], options = {}) {
  const {
    endDate = new Date(),
    lookbackHours = DAILY_LOOKBACK_HOURS,
    intervalMinutes = SNAPSHOT_INTERVAL_MINUTES,
    maxAgeMinutes = MONITOR_MAX_AGE_MINUTES,
  } = options;

  const expectedWindows = buildExpectedWindows(endDate, lookbackHours, intervalMinutes);
  const covered = extractCoveredWindows(rows, intervalMinutes);
  const missingWindows = expectedWindows.filter(window => !covered.has(window));

  const timestamps = rows
    .map(row => new Date(row?.created_at || row))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);

  const lastSnapshotAt = timestamps.length ? timestamps[timestamps.length - 1].toISOString() : null;
  const lastAgeMinutes = lastSnapshotAt
    ? Math.floor((new Date(endDate).getTime() - new Date(lastSnapshotAt).getTime()) / 60000)
    : null;

  return {
    expectedCount: expectedWindows.length,
    observedCount: expectedWindows.length - missingWindows.length,
    missingCount: missingWindows.length,
    missingWindows,
    lastSnapshotAt,
    lastAgeMinutes,
    healthy: lastAgeMinutes !== null && lastAgeMinutes <= maxAgeMinutes,
  };
}

function formatMonitorAlert(summary, locale = 'es') {
  if (locale === 'en') {
    return [
      '⚠️ <b>Snapshot cron issue detected</b>',
      '',
      `Last snapshot age: <b>${summary.lastAgeMinutes ?? 'n/a'} min</b>`,
      `Missing windows in last 24h: <b>${summary.missingCount}</b>`,
      summary.lastSnapshotAt ? `Last snapshot at: <code>${summary.lastSnapshotAt}</code>` : 'Last snapshot at: <code>none</code>',
    ].join('\n');
  }

  return [
    '⚠️ <b>Problema detectado en el cron de snapshots</b>',
    '',
    `Edad del último snapshot: <b>${summary.lastAgeMinutes ?? 'n/a'} min</b>`,
    `Ventanas faltantes en las últimas 24h: <b>${summary.missingCount}</b>`,
    summary.lastSnapshotAt ? `Último snapshot en: <code>${summary.lastSnapshotAt}</code>` : 'Último snapshot en: <code>ninguno</code>',
  ].join('\n');
}

function formatDailySummary(summary, locale = 'es') {
  const missingPreview = summary.missingWindows.slice(0, 8).join(', ') || (locale === 'en' ? 'none' : 'ninguna');
  if (locale === 'en') {
    return [
      '📘 <b>Daily snapshot audit</b>',
      '',
      `Expected windows: <b>${summary.expectedCount}</b>`,
      `Observed windows: <b>${summary.observedCount}</b>`,
      `Missing windows: <b>${summary.missingCount}</b>`,
      `Last snapshot age: <b>${summary.lastAgeMinutes ?? 'n/a'} min</b>`,
      `Missing sample: <code>${missingPreview}</code>`,
    ].join('\n');
  }

  return [
    '📘 <b>Auditoría diaria de snapshots</b>',
    '',
    `Ventanas esperadas: <b>${summary.expectedCount}</b>`,
    `Ventanas observadas: <b>${summary.observedCount}</b>`,
    `Ventanas faltantes: <b>${summary.missingCount}</b>`,
    `Edad del último snapshot: <b>${summary.lastAgeMinutes ?? 'n/a'} min</b>`,
    `Muestra de faltantes: <code>${missingPreview}</code>`,
  ].join('\n');
}

module.exports = {
  SNAPSHOT_INTERVAL_MINUTES,
  MONITOR_MAX_AGE_MINUTES,
  DAILY_LOOKBACK_HOURS,
  floorToInterval,
  extractCoveredWindows,
  buildExpectedWindows,
  analyzeSnapshotWindows,
  formatMonitorAlert,
  formatDailySummary,
  toIsoMinute,
};
