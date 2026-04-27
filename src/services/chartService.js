/**
 * Chart generation service using @napi-rs/canvas
 * Works in Vercel serverless (Node.js 18+)
 */
const { createCanvas } = require('@napi-rs/canvas');

/**
 * Generate a PNG chart buffer and return as base64 data URL
 */
function generateChartDataUrl(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  const width = 640;
  const height = 380;
  const padding = { top: 45, right: 25, bottom: 55, left: 75 };

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const prices = history.map(h => parseFloat(h.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const priceRange = maxPrice - minPrice || 1;

  // Find min/max indices
  let minIdx = 0, maxIdx = 0;
  prices.forEach((p, i) => {
    if (p === minPrice) minIdx = i;
    if (p === maxPrice) maxIdx = i;
  });

  const sampled = sampleDataWithIndices(history, 60);
  const sampledPrices = sampled.map(h => parseFloat(h.price));
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale functions
  const xScale = (i) => padding.left + (i / (sampled.length - 1)) * chartWidth;
  const yScale = (p) => padding.top + chartHeight - ((p - minPrice) / priceRange) * chartHeight;

  // ---- GRID ----
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 1;
  const numYLabels = 6;
  for (let i = 0; i <= numYLabels; i++) {
    const y = yScale(minPrice + (priceRange * i) / numYLabels);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // ---- Y-AXIS ----
  ctx.strokeStyle = '#bbbbbb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.stroke();

  ctx.fillStyle = '#555555';
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  for (let i = 0; i <= numYLabels; i++) {
    const price = minPrice + (priceRange * i) / numYLabels;
    const y = yScale(price);
    ctx.fillText(price.toFixed(4), padding.left - 8, y + 4);
  }

  // Y-axis title
  ctx.save();
  ctx.translate(15, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#555555';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('PRICE (SFL)', 0, 0);
  ctx.restore();

  // ---- X-AXIS ----
  ctx.strokeStyle = '#bbbbbb';
  ctx.beginPath();
  ctx.moveTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  // X-axis labels - show timestamps for all points where space allows
  // We'll show every N labels depending on data density
  ctx.fillStyle = '#666666';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';

  const maxXLabels = Math.floor(chartWidth / 70); // max ~70px between labels
  const stepX = Math.max(1, Math.floor(sampled.length / maxXLabels));

  for (let i = 0; i < sampled.length; i += stepX) {
    const date = new Date(sampled[i].created_at);
    const x = xScale(i);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    const label = `${dayName} ${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    ctx.fillText(label, x, height - padding.bottom + 18);
  }

  // Last X label
  const lastDate = new Date(sampled[sampled.length - 1].created_at);
  const lastDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][lastDate.getDay()];
  const lastLabel = `${lastDayName} ${lastDate.getMonth() + 1}/${lastDate.getDate()} ${lastDate.getHours().toString().padStart(2, '0')}:${lastDate.getMinutes().toString().padStart(2, '0')}`;
  ctx.fillText(lastLabel, xScale(sampled.length - 1), height - padding.bottom + 18);

  // ---- AVERAGE LINE (dashed red) ----
  const avgY = yScale(avgPrice);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding.left, avgY);
  ctx.lineTo(width - padding.right, avgY);
  ctx.stroke();
  ctx.setLineDash([]);

  // AVG label
  ctx.fillStyle = '#c62828';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`AVG: ${avgPrice.toFixed(4)}`, padding.left + 4, avgY - 5);

  // ---- PRICE LINE ----
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  sampledPrices.forEach((p, i) => {
    const x = xScale(i);
    const y = yScale(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Area fill under line
  ctx.fillStyle = 'rgba(46, 125, 50, 0.07)';
  ctx.beginPath();
  ctx.moveTo(xScale(0), yScale(sampledPrices[0]));
  sampledPrices.forEach((p, i) => ctx.lineTo(xScale(i), yScale(p)));
  ctx.lineTo(xScale(sampledPrices.length - 1), height - padding.bottom);
  ctx.lineTo(xScale(0), height - padding.bottom);
  ctx.closePath();
  ctx.fill();

  // ---- MIN POINT (blue triangle down) ----
  const minX = xScale(minIdx);
  const minY = yScale(minPrice);
  ctx.fillStyle = '#1565c0';
  ctx.beginPath();
  ctx.moveTo(minX, minY + 9);
  ctx.lineTo(minX - 7, minY - 4);
  ctx.lineTo(minX + 7, minY - 4);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#1565c0';
  ctx.textAlign = 'center';
  ctx.fillText(`MIN ${minPrice.toFixed(4)}`, minX, minY - 9);

  // ---- MAX POINT (orange triangle up) ----
  const maxX = xScale(maxIdx);
  const maxY = yScale(maxPrice);
  ctx.fillStyle = '#e65100';
  ctx.beginPath();
  ctx.moveTo(maxX, maxY - 9);
  ctx.lineTo(maxX - 7, maxY + 4);
  ctx.lineTo(maxX + 7, maxY + 4);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#e65100';
  ctx.textAlign = 'center';
  ctx.fillText(`MAX ${maxPrice.toFixed(4)}`, maxX, maxY + 18);

  // ---- CURRENT PRICE DOT (green) ----
  const lastX = xScale(sampledPrices.length - 1);
  const lastY = yScale(sampledPrices[sampledPrices.length - 1]);
  ctx.fillStyle = '#1b5e20';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#1b5e20';
  ctx.textAlign = 'left';
  ctx.fillText(`NOW: ${sampledPrices[sampledPrices.length - 1].toFixed(4)}`, lastX + 9, lastY + 3);

  // ---- TITLE ----
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 15px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${resource.toUpperCase()} - Price History`, width / 2, 20);

  // Data points
  ctx.fillStyle = '#888888';
  ctx.font = '11px Arial';
  ctx.fillText(`${sampledPrices.length} data points`, width / 2, 36);

  // ---- LEGEND (top right) ----
  ctx.font = '10px Arial';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#c62828';
  ctx.fillText('— AVG', width - 10, 22);

  // Convert to PNG
  const buffer = canvas.toBuffer('image/png');
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function sampleDataWithIndices(data, maxPoints) {
  if (data.length <= maxPoints) {
    return data.map((h, i) => ({ ...h, origIdx: i }));
  }
  const step = data.length / maxPoints;
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    const index = Math.floor(i * step);
    sampled.push({ ...data[index], origIdx: index });
  }
  if (sampled[sampled.length - 1].origIdx !== data.length - 1) {
    sampled[sampled.length - 1] = { ...data[data.length - 1], origIdx: data.length - 1 };
  }
  return sampled;
}

function calculateStats(history) {
  if (!history || history.length === 0) return null;
  const prices = history.map(h => parseFloat(h.price));
  const current = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const pct = ((current - avg) / avg * 100).toFixed(2);
  return { current, min, max, avg, pct, count: history.length, oldest: history[0].created_at, newest: history[history.length - 1].created_at };
}

module.exports = { generateChartDataUrl, calculateStats };