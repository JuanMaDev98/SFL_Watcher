/**
 * Local chart rendering service.
 *
 * Strategy:
 * - 90d view uses real timestamps on X axis.
 * - For long-range readability, data is normalized to hourly buckets.
 * - Render locally to SVG, then rasterize to PNG with Resvg.
 * - Cache key includes newest snapshot timestamp, so cache invalidates
 *   automatically when new snapshots arrive.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const logger = require('../utils/logger');

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 560;
const CACHE_MAX_ENTRIES = 120;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LONG_RANGE_HOURLY_THRESHOLD = 24 * 14; // aggregate when chart spans beyond ~2 weeks of hourly points

const chartCache = new Map();
const FONT_FILES = [
  path.resolve(__dirname, '../../assets/fonts/Inter-Variable.ttf'),
];
const FONT_BUFFERS = FONT_FILES
  .filter(file => fs.existsSync(file))
  .map(file => fs.readFileSync(file));
const FONT_DEBUG = FONT_FILES.map((file, index) => ({
  file,
  exists: fs.existsSync(file),
  bytes: FONT_BUFFERS[index]?.length || 0,
}));
const FONTKIT_MAIN = path.resolve(__dirname, '../../node_modules/fontkit/dist/main.cjs');
const fontkit = fs.existsSync(FONTKIT_MAIN) ? require(FONTKIT_MAIN) : null;
const PRIMARY_FONT = fontkit && fs.existsSync(FONT_FILES[0]) ? fontkit.openSync(FONT_FILES[0]) : null;

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function countMatches(source, token) {
  const matches = source.match(token);
  return matches ? matches.length : 0;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatPrice(value, digits = 6) {
  return Number(value || 0).toFixed(digits);
}

function formatDateLabel(iso) {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function formatDateTimeLabel(iso) {
  const d = new Date(iso);
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

function measureTextWidth(text, fontSize = 16) {
  if (!PRIMARY_FONT || text == null) return 0;
  const content = String(text);
  if (!content.trim()) return 0;

  const run = PRIMARY_FONT.layout(content);
  const unitsPerEm = PRIMARY_FONT.unitsPerEm || 1000;
  const scale = fontSize / unitsPerEm;
  return run.positions.reduce((sum, pos) => sum + (pos.xAdvance || 0), 0) * scale;
}

function buildTextPath(text, options = {}) {
  if (!PRIMARY_FONT || text == null) return '';

  const content = String(text);
  if (!content.trim()) return '';

  const fontSize = options.fontSize || 16;
  const fill = options.fill || '#ffffff';
  const opacity = options.opacity == null ? 1 : options.opacity;
  const anchor = options.anchor || 'start';
  const run = PRIMARY_FONT.layout(content);
  const unitsPerEm = PRIMARY_FONT.unitsPerEm || 1000;
  const scale = fontSize / unitsPerEm;
  const width = run.positions.reduce((sum, pos) => sum + (pos.xAdvance || 0), 0) * scale;

  let originX = options.x || 0;
  if (anchor === 'middle') originX -= width / 2;
  if (anchor === 'end') originX -= width;

  let cursor = 0;
  const y = options.y || 0;
  const parts = [];

  for (let i = 0; i < run.glyphs.length; i += 1) {
    const glyph = run.glyphs[i];
    const pos = run.positions[i] || {};
    const d = glyph?.path?.toSVG?.();
    if (d) {
      const dx = originX + (cursor + (pos.xOffset || 0)) * scale;
      const dy = y - (pos.yOffset || 0) * scale;
      parts.push(`<path d="${d}" transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(5)} -${scale.toFixed(5)})" fill="${fill}" opacity="${opacity}" />`);
    }
    cursor += pos.xAdvance || 0;
  }

  return parts.join('');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildTriangleMarker(x, y, direction = 'up', color = '#ffffff', size = 7) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';

  const half = size;
  const d = direction === 'down'
    ? `M ${x.toFixed(2)} ${y.toFixed(2)} L ${(x - half).toFixed(2)} ${(y - size * 1.45).toFixed(2)} L ${(x + half).toFixed(2)} ${(y - size * 1.45).toFixed(2)} Z`
    : `M ${x.toFixed(2)} ${y.toFixed(2)} L ${(x - half).toFixed(2)} ${(y + size * 1.45).toFixed(2)} L ${(x + half).toFixed(2)} ${(y + size * 1.45).toFixed(2)} Z`;

  return `<path d="${d}" fill="${color}" />`;
}

function buildLegendItem(x, y, options = {}) {
  const icon = options.icon || 'square';
  const color = options.color || '#ffffff';
  const label = options.label || '';
  const value = options.value || '';
  const labelText = `${label} ${value}`.trim();
  const parts = [];

  if (icon === 'up') {
    parts.push(buildTriangleMarker(x + 7, y - 6, 'up', color, 5));
  } else if (icon === 'down') {
    parts.push(buildTriangleMarker(x + 7, y + 1, 'down', color, 5));
  } else {
    parts.push(`<rect x="${x.toFixed(2)}" y="${(y - 11).toFixed(2)}" width="12" height="12" rx="3" fill="${color}" />`);
  }

  parts.push(buildTextPath(labelText, { x: x + 20, y, fontSize: 12, fill: color }));
  return parts.join('');
}

function calculateStats(history) {
  if (!history || history.length === 0) return null;
  const prices = history.map(h => parseFloat(h.price));
  const current = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const pct = ((current - avg) / avg * 100).toFixed(2);
  return {
    current,
    min,
    max,
    avg,
    pct,
    count: history.length,
    oldest: history[0].created_at,
    newest: history[history.length - 1].created_at,
  };
}

function startOfUtcHour(iso) {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function aggregateHistoryByHour(history) {
  if (!history || history.length === 0) return [];

  const buckets = [];
  let current = null;

  for (const row of history) {
    const price = parseFloat(row.price);
    const hourKey = startOfUtcHour(row.created_at);

    if (!current || current.hourKey !== hourKey) {
      if (current) buckets.push(current);
      current = {
        hourKey,
        created_at: row.created_at,
        price,
        min: price,
        max: price,
        count: 1,
      };
      continue;
    }

    current.created_at = row.created_at;
    current.price = price; // close / latest price in that hour
    current.min = Math.min(current.min, price);
    current.max = Math.max(current.max, price);
    current.count += 1;
  }

  if (current) buckets.push(current);

  return buckets.map(bucket => ({
    price: bucket.price,
    created_at: bucket.created_at,
    bucket_min: bucket.min,
    bucket_max: bucket.max,
    bucket_count: bucket.count,
  }));
}

function prepareDisplayHistory(history, options = {}) {
  const forceHourly = options.forceHourly === true;
  const disableHourly = options.forceHourly === false;

  if (!history || history.length === 0) {
    return { displayHistory: [], aggregated: false, rawCount: 0, displayCount: 0 };
  }

  const rawCount = history.length;
  const shouldAggregate = !disableHourly && (forceHourly || rawCount > LONG_RANGE_HOURLY_THRESHOLD);
  const displayHistory = shouldAggregate ? aggregateHistoryByHour(history) : history;

  return {
    displayHistory,
    aggregated: shouldAggregate,
    rawCount,
    displayCount: displayHistory.length,
  };
}

function buildLinePoints(history, plot, minPrice, maxPrice) {
  const range = Math.max(maxPrice - minPrice, minPrice * 0.01, 0.000001);
  const startMs = new Date(history[0].created_at).getTime();
  const endMs = new Date(history[history.length - 1].created_at).getTime();
  const duration = Math.max(endMs - startMs, 1);

  return history.map((row, index) => {
    const value = parseFloat(row.price);
    const timeMs = new Date(row.created_at).getTime();
    const timeRatio = (timeMs - startMs) / duration;
    const x = plot.left + timeRatio * plot.width;
    const normalized = (value - minPrice) / range;
    const y = plot.top + plot.height - normalized * plot.height;
    return { x, y, value, index, created_at: row.created_at };
  });
}

function buildTicks(history, stats, plot) {
  const yTicks = 7;
  const xTicks = 6;
  const yValues = Array.from({ length: yTicks }, (_, i) => {
    const ratio = i / (yTicks - 1);
    const value = stats.min + (stats.max - stats.min) * ratio;
    const y = plot.top + plot.height - ratio * plot.height;
    return { value, y };
  });

  const startMs = new Date(history[0].created_at).getTime();
  const endMs = new Date(history[history.length - 1].created_at).getTime();
  const duration = Math.max(endMs - startMs, 1);

  const xValues = Array.from({ length: xTicks }, (_, i) => {
    const ratio = i / Math.max(xTicks - 1, 1);
    const targetMs = startMs + duration * ratio;
    const x = plot.left + plot.width * ratio;
    const label = duration <= 7 * 24 * 60 * 60 * 1000
      ? formatDateTimeLabel(new Date(targetMs).toISOString())
      : formatDateLabel(new Date(targetMs).toISOString());
    return { x, label };
  });

  return { xValues, yValues };
}

function buildWeeklyMarkers(history, plot) {
  const markers = [];
  const startMs = new Date(history[0].created_at).getTime();
  const endMs = new Date(history[history.length - 1].created_at).getTime();
  const duration = Math.max(endMs - startMs, 1);

  const startDate = new Date(startMs);
  const utcStartDay = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  const offsetToMonday = (8 - utcStartDay.getUTCDay()) % 7;
  let mondayMs = utcStartDay.getTime() + (offsetToMonday * 24 * 60 * 60 * 1000);

  for (; mondayMs <= endMs; mondayMs += 7 * 24 * 60 * 60 * 1000) {
    if (mondayMs < startMs) continue;

    const x = plot.left + ((mondayMs - startMs) / duration) * plot.width;
    const date = new Date(mondayMs);
    const label = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    markers.push({ x, label, timestamp: mondayMs });
  }

  return markers;
}

function buildAreaPath(points, plot) {
  if (!points.length) return '';
  const line = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} ${(plot.top + plot.height).toFixed(2)} L ${first.x.toFixed(2)} ${(plot.top + plot.height).toFixed(2)} Z`;
}

function buildLinePath(points) {
  if (!points.length) return '';
  return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}

function findPointIndex(history, targetValue, pick = 'first') {
  const prices = history.map(h => parseFloat(h.price));
  if (pick === 'last') return prices.lastIndexOf(targetValue);
  return prices.indexOf(targetValue);
}

function buildChartSvg(resource, rawHistory, options = {}) {
  if (!rawHistory || rawHistory.length < 2) {
    throw new Error('Not enough history to render chart');
  }

  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const plot = { left: 88, right: 38, top: 122, bottom: 96 };
  plot.width = width - plot.left - plot.right;
  plot.height = height - plot.top - plot.bottom;

  const prepared = prepareDisplayHistory(rawHistory, options);
  const history = prepared.displayHistory;
  const rawStats = calculateStats(rawHistory);
  const displayStats = calculateStats(history);
  const stats = rawStats;
  const points = buildLinePoints(history, plot, stats.min, stats.max);
  const areaPath = buildAreaPath(points, plot);
  const linePath = buildLinePath(points);
  const avgY = plot.top + plot.height - ((stats.avg - stats.min) / Math.max(stats.max - stats.min, stats.min * 0.01, 0.000001)) * plot.height;

  const minIdx = findPointIndex(history, stats.min, 'first');
  const maxIdx = findPointIndex(history, stats.max, 'last');
  const minPoint = minIdx >= 0 ? points[minIdx] : null;
  const maxPoint = maxIdx >= 0 ? points[maxIdx] : null;
  const currentPoint = points[points.length - 1];
  const ticks = buildTicks(history, stats, plot);
  const weeklyMarkers = buildWeeklyMarkers(history, plot);
  const trendUp = rawStats.current >= rawStats.avg;
  const trendColor = trendUp ? '#26a69a' : '#ef5350';
  const title = `${resource.toUpperCase()} • 90D`;
  const subtitle = prepared.aggregated
    ? `${prepared.rawCount} raw snapshots → ${prepared.displayCount} hourly points • ${formatDateLabel(rawStats.oldest)} → ${formatDateLabel(rawStats.newest)}`
    : `${prepared.displayCount} snapshots • ${formatDateLabel(rawStats.oldest)} → ${formatDateLabel(rawStats.newest)}`;

  const yGrid = ticks.yValues.map((t, index) => `
    <line x1="${plot.left}" y1="${t.y.toFixed(2)}" x2="${plot.left + plot.width}" y2="${t.y.toFixed(2)}" stroke="#273142" stroke-width="${index === 0 || index === ticks.yValues.length - 1 ? '1.1' : '0.9'}" opacity="${index % 2 === 0 ? '1' : '0.72'}" />
    ${buildTextPath(formatPrice(t.value, 4), { x: plot.left - 12, y: t.y + 5, fontSize: 14, fill: '#9fb0c3', anchor: 'end' })}`).join('');

  const xGrid = ticks.xValues.map(t => `
    <line x1="${t.x.toFixed(2)}" y1="${plot.top}" x2="${t.x.toFixed(2)}" y2="${plot.top + plot.height}" stroke="#1d2633" stroke-width="1" />
    ${buildTextPath(t.label, { x: t.x, y: height - 40, fontSize: 13, fill: '#9fb0c3', anchor: 'middle' })}`).join('');

  const weeklyGrid = weeklyMarkers.map(marker => `
    <line x1="${marker.x.toFixed(2)}" y1="${plot.top}" x2="${marker.x.toFixed(2)}" y2="${plot.top + plot.height}" stroke="#3b82f6" stroke-width="1.2" stroke-dasharray="4 6" opacity="0.75" />`
  ).join('');

  const legendY = 86;
  const legendItems = [
    buildLegendItem(36, legendY, { icon: 'down', color: '#60a5fa', label: 'MIN', value: formatPrice(rawStats.min, 6) }),
    buildLegendItem(245, legendY, { icon: 'up', color: '#fb7185', label: 'MAX', value: formatPrice(rawStats.max, 6) }),
    buildLegendItem(456, legendY, { icon: 'square', color: '#fbbf24', label: 'AVG', value: formatPrice(rawStats.avg, 6) }),
  ].join('');

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="areaFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#26a69a" stop-opacity="0.35" />
        <stop offset="100%" stop-color="#26a69a" stop-opacity="0.02" />
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.25"/>
      </filter>
    </defs>

    <rect x="0" y="0" width="${width}" height="${height}" fill="#131722" rx="18" />
    <rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="#161d29" rx="16" stroke="#273142" />

    ${buildTextPath(title, { x: 36, y: 40, fontSize: 28, fill: '#f4f7fb' })}
    ${buildTextPath(subtitle, { x: 36, y: 62, fontSize: 14, fill: '#8fa0b5' })}

    ${buildTextPath('Current', { x: width - 36, y: 38, fontSize: 15, fill: '#8fa0b5', anchor: 'end' })}
    ${buildTextPath(formatPrice(rawStats.current), { x: width - 36, y: 62, fontSize: 26, fill: trendColor, anchor: 'end' })}
    ${legendItems}

    ${yGrid}
    ${xGrid}
    ${weeklyGrid}

    <line x1="${plot.left}" y1="${avgY.toFixed(2)}" x2="${plot.left + plot.width}" y2="${avgY.toFixed(2)}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="7 6" opacity="0.9" />

    <path d="${areaPath}" fill="url(#areaFade)" />
    <path d="${linePath}" fill="none" stroke="${trendColor}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" filter="url(#shadow)" />

    <circle cx="${currentPoint.x.toFixed(2)}" cy="${currentPoint.y.toFixed(2)}" r="4.8" fill="${trendColor}" stroke="#ffffff" stroke-width="1.5" />

    ${minPoint ? buildTriangleMarker(minPoint.x, minPoint.y, 'down', '#60a5fa', 6.5) : ''}
    ${maxPoint ? buildTriangleMarker(maxPoint.x, maxPoint.y, 'up', '#fb7185', 6.5) : ''}

    ${buildTextPath(`vs AVG: ${rawStats.pct >= 0 ? '+' : ''}${rawStats.pct}%`, { x: 36, y: height - 14, fontSize: 13, fill: '#8fa0b5' })}
    ${buildTextPath('Weekly separators every Monday - real-time X axis', { x: width / 2, y: height - 14, fontSize: 12, fill: '#93c5fd', anchor: 'middle' })}
    ${buildTextPath(prepared.aggregated ? 'Hourly normalized for 90d view • current exact' : 'Raw timestamps • current exact', { x: width - 36, y: height - 14, fontSize: 13, fill: '#8fa0b5', anchor: 'end' })}
  </svg>`;
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of chartCache.entries()) {
    if (now - value.createdAt > CACHE_TTL_MS) chartCache.delete(key);
  }

  if (chartCache.size <= CACHE_MAX_ENTRIES) return;
  const entries = [...chartCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const overflow = chartCache.size - CACHE_MAX_ENTRIES;
  for (let i = 0; i < overflow; i += 1) chartCache.delete(entries[i][0]);
}

function clearChartCache() {
  chartCache.clear();
}

function generateChartDataUrl(resource, history, options = {}) {
  if (!history || history.length === 0) return null;

  const prepared = prepareDisplayHistory(history, options);
  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const newest = history[history.length - 1]?.created_at || 'none';
  const aggregationKey = prepared.aggregated ? `hourly:${prepared.displayCount}` : `raw:${prepared.displayCount}`;

  const chartConfig = {
    resource,
    width,
    height,
    cacheKey: `${resource}:90d:${history.length}:${newest}:${aggregationKey}:${width}x${height}`,
    svg: buildChartSvg(resource, history, { ...options, width, height }),
  };

  logger.info('[chart] built svg', {
    resource,
    rawPoints: prepared.rawCount,
    displayPoints: prepared.displayCount,
    aggregated: prepared.aggregated,
    width,
    height,
    svgBytes: Buffer.byteLength(chartConfig.svg, 'utf8'),
    svgSha256: sha256(chartConfig.svg),
    textNodeCount: countMatches(chartConfig.svg, /<text\b/g),
    lineCount: countMatches(chartConfig.svg, /<line\b/g),
    pathCount: countMatches(chartConfig.svg, /<path\b/g),
    fontDebug: FONT_DEBUG,
    cacheKey: chartConfig.cacheKey,
  });

  return { chartConfig, pointsUsed: prepared.displayCount, rawPoints: prepared.rawCount, aggregated: prepared.aggregated };
}

async function generateChartBuffer(chartConfig, options = {}) {
  if (!chartConfig?.svg) throw new Error('Invalid local chart config');

  cleanupCache();

  const cacheKey = chartConfig.cacheKey || `${chartConfig.resource || 'chart'}:${chartConfig.width || DEFAULT_WIDTH}x${chartConfig.height || DEFAULT_HEIGHT}`;
  const cached = chartCache.get(cacheKey);
  if (cached) {
    logger.info('[chart] cache hit', {
      resource: chartConfig.resource,
      cacheKey,
      pngBytes: cached.buffer.length,
      pngSha256: sha256(cached.buffer),
    });
    return cached.buffer.buffer.slice(cached.buffer.byteOffset, cached.buffer.byteOffset + cached.buffer.byteLength);
  }

  logger.info('[chart] rendering png', {
    resource: chartConfig.resource,
    cacheKey,
    width: options.width || chartConfig.width || DEFAULT_WIDTH,
    background: options.backgroundColor || 'rgba(0,0,0,0)',
    fontBufferCount: FONT_BUFFERS.length,
    fontFileCount: FONT_FILES.length,
    fontDebug: FONT_DEBUG,
  });

  const resvg = new Resvg(chartConfig.svg, {
    fitTo: { mode: 'width', value: options.width || chartConfig.width || DEFAULT_WIDTH },
    background: options.backgroundColor || 'rgba(0,0,0,0)',
    font: {
      fontFiles: FONT_BUFFERS.length ? undefined : FONT_FILES,
      fontBuffers: FONT_BUFFERS.length ? FONT_BUFFERS : undefined,
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });

  const pngData = resvg.render();
  const buffer = pngData.asPng();
  logger.info('[chart] rendered png', {
    resource: chartConfig.resource,
    cacheKey,
    pngBytes: buffer.length,
    pngSha256: sha256(buffer),
    pngSignature: buffer.subarray(0, 8).toString('hex'),
  });
  chartCache.set(cacheKey, { buffer, createdAt: Date.now() });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function generateChartUrl(resource, history, options = {}) {
  const payload = generateChartDataUrl(resource, history, options);
  if (!payload?.chartConfig?.svg) return null;
  return `data:image/svg+xml;base64,${Buffer.from(payload.chartConfig.svg).toString('base64')}`;
}

module.exports = { generateChartDataUrl, generateChartBuffer, generateChartUrl, calculateStats, clearChartCache, prepareDisplayHistory, aggregateHistoryByHour };
