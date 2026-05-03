function normalizeLanguage(language) {
  return String(language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
}

function pick(language, esText, enText) {
  return normalizeLanguage(language) === 'en' ? enText : esText;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatFixed(value, digits = 5) {
  const num = Number(value || 0);
  return num.toFixed(digits);
}

function formatTrimmed(value, maxDigits = 9) {
  const num = Number(value || 0);
  return num.toFixed(maxDigits).replace(/\.?0+$/, '');
}

function formatSignedPercent(value, digits = 2) {
  const num = Number(value || 0);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(digits)}%`;
}

function formatGraphCaption(resource, stats, language, options = {}) {
  const locale = normalizeLanguage(language);
  const title = escapeHtml(String(resource || '').toUpperCase());
  const currentLabel = pick(locale, '💰 Precio actual', '💰 Current price');
  const vsLabel = pick(locale, '📊 vs promedio', '📊 vs average');
  const avgLabel = pick(locale, '📈 Promedio (90D)', '📈 Average (90D)');
  const minMaxLabel = pick(locale, '📍 Mín/Máx', '📍 Min/Max');
  const snapshotsLabel = pick(locale, '📋 Snapshots', '📋 Snapshots');

  const lines = [
    `<b>${title}</b>`,
    `${currentLabel}: <code>${formatFixed(stats?.current_price, options.currentDigits ?? 5)}</code>`,
    `${vsLabel}: <code>${formatSignedPercent(stats?.percent_vs_avg, 2)}</code>`,
    `${avgLabel}: <code>${formatFixed(stats?.avg_price, options.avgDigits ?? 5)}</code>`,
    `${minMaxLabel}: <code>${formatTrimmed(stats?.min_price, 9)}</code> / <code>${formatTrimmed(stats?.max_price, 9)}</code>`,
    `${snapshotsLabel}: <code>${Number(stats?.snapshot_count || 0)}</code>`
  ];

  return lines.join('\n');
}

function formatPercentAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow, language) {
  const locale = normalizeLanguage(language);
  const isRise = Number(currentPct) >= 0;
  const emoji = isRise ? '🚨📈' : '🚨📉';
  const directionLine = pick(
    locale,
    `${emoji} <b>${escapeHtml(resource.toUpperCase())}</b> ${isRise ? 'subió' : 'bajó'} ${formatSignedPercent(currentPct)}`,
    `${emoji} <b>${escapeHtml(resource.toUpperCase())}</b> ${isRise ? 'moved up' : 'moved down'} ${formatSignedPercent(currentPct)}`
  );
  const thresholdLabel = pick(locale, '⚙️ Umbrales', '⚙️ Thresholds');

  return [
    directionLine,
    '',
    formatGraphCaption(resource, stats, locale),
    '',
    `${thresholdLabel}: ▲ +${Number(thresholdHigh || 0)}% | ▼ ${Number(thresholdLow || 0)}%`
  ].join('\n');
}

function formatPriceAlertMessage(resource, direction, targetPrice, stats, language) {
  const locale = normalizeLanguage(language);
  const isAbove = direction === 'above';
  const actionText = pick(
    locale,
    isAbove ? 'subió hasta tu precio objetivo' : 'bajó hasta tu precio objetivo',
    isAbove ? 'reached your sell target' : 'reached your buy target'
  );
  const targetLabel = pick(locale, '🎯 Precio objetivo', '🎯 Target price');

  return [
    `${isAbove ? '🚨📈' : '🚨📉'} <b>${escapeHtml(resource.toUpperCase())}</b> ${actionText}`,
    '',
    formatGraphCaption(resource, stats, locale),
    '',
    `${targetLabel}: <code>${formatTrimmed(targetPrice, 9)}</code> (${isAbove ? 'above' : 'below'})`
  ].join('\n');
}

function formatNtfyPercentAlert(resource, currentPct, stats, thresholdHigh, thresholdLow, language) {
  const locale = normalizeLanguage(language);
  const trendWord = pick(locale, Number(currentPct) >= 0 ? 'sube' : 'baja', Number(currentPct) >= 0 ? 'up' : 'down');
  const thresholdWord = pick(locale, 'Umbrales', 'Thresholds');

  return [
    `${resource.toUpperCase()} ${trendWord} ${formatSignedPercent(currentPct)}`,
    `${pick(locale, 'Precio', 'Price')} ${formatFixed(stats?.current_price, 5)} | ${pick(locale, 'Promedio', 'Average')} ${formatFixed(stats?.avg_price, 5)}`,
    `${thresholdWord}: +${Number(thresholdHigh || 0)}% / ${Number(thresholdLow || 0)}%`
  ].join('\n');
}

function formatNtfyPriceAlert(resource, direction, targetPrice, stats, language) {
  const locale = normalizeLanguage(language);
  const action = pick(locale, direction === 'above' ? 'subió' : 'bajó', direction === 'above' ? 'went above' : 'went below');
  return [
    `${resource.toUpperCase()} ${action} ${formatTrimmed(targetPrice, 9)}`,
    `${pick(locale, 'Precio', 'Price')} ${formatFixed(stats?.current_price, 5)} | ${pick(locale, 'Promedio', 'Average')} ${formatFixed(stats?.avg_price, 5)}`
  ].join('\n');
}

function getChartLocaleStrings(language) {
  const locale = normalizeLanguage(language);
  return {
    current: pick(locale, 'Precio actual', 'Current price'),
    min: 'MIN',
    max: 'MAX',
    avg: 'AVG',
    spring: pick(locale, 'Primavera', 'Spring'),
    summer: pick(locale, 'Verano', 'Summer'),
    autumn: pick(locale, 'Otoño', 'Autumn'),
    winter: pick(locale, 'Invierno', 'Winter'),
    vsAvg: pick(locale, 'vs promedio', 'vs avg'),
    mondayBands: pick(locale, 'Separadores semanales + fondo estacional', 'Weekly separators + seasonal bands'),
    hourlyNormalized: pick(locale, 'Normalizado por hora para vista 90d • precio actual exacto', 'Hourly normalized for 90d view • exact current price'),
    rawTimestamps: pick(locale, 'Timestamps reales • precio actual exacto', 'Raw timestamps • exact current price'),
    snapshotsRange: pick(locale, 'snapshots', 'snapshots'),
    hourlyPointsFrom: pick(locale, 'puntos horarios desde', 'hourly points from'),
    points: pick(locale, 'puntos', 'points')
  };
}

module.exports = {
  normalizeLanguage,
  pick,
  escapeHtml,
  formatFixed,
  formatTrimmed,
  formatSignedPercent,
  formatGraphCaption,
  formatPercentAlertMessage,
  formatPriceAlertMessage,
  formatNtfyPercentAlert,
  formatNtfyPriceAlert,
  getChartLocaleStrings,
};
