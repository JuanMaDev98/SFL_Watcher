/**
 * Chart generation service using @napi-rs/canvas
 * Works in Vercel serverless (Node.js 18+)
 */
const { createCanvas } = require('@napi-rs/canvas');

function generateChartDataUrl(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  const width = 640;
  const height = 400;
  const padding = { top: 50, right: 25, bottom: 65, left: 80 };

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

  const sampled = sampleDataWithIndices(history, 50);
  const sampledPrices = sampled.map(h => parseFloat(h.price));
  const n = sampled.length;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const xScale = (i) => padding.left + (i / Math.max(n - 1, 1)) * chartWidth;
  const yScale = (p) => padding.top + chartHeight - ((p - minPrice) / priceRange) * chartHeight;

  // ---- GRID ----
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  const numY = 6;
  for (let i = 0; i <= numY; i++) {
    const y = yScale(minPrice + (priceRange * i) / numY);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // ---- Y-AXIS LINE ----
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.stroke();

  // ---- Y-AXIS LABELS (prices) ----
  ctx.fillStyle = '#444444';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'right';
  for (let i = 0; i <= numY; i++) {
    const price = minPrice + (priceRange * i) / numY;
    const y = yScale(price);
    ctx.fillText(price.toFixed(4), padding.left - 6, y + 4);
  }

  // Y-axis title
  ctx.save();
  ctx.translate(14, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#555555';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('PRICE (SFL)', 0, 0);
  ctx.restore();

  // ---- X-AXIS LINE ----
  ctx.strokeStyle = '#999999';
  ctx.beginPath();
  ctx.moveTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  // ---- X-AXIS LABELS (dates) ----
  ctx.fillStyle = '#555555';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';

  // Always show first, middle, last
  const labelIndices = [0, Math.floor(n / 2), n - 1];
  labelIndices.forEach(i => {
    const date = new Date(sampled[i].created_at);
    const x = xScale(i);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    const label = `${day} ${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    ctx.fillText(label, x, height - padding.bottom + 18);
  });

  // Also show second and second-to-last if there's room
  if (n > 4) {
    const x1 = xScale(1);
    const d1 = new Date(sampled[1].created_at);
    const day1 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d1.getDay()];
    ctx.fillText(`${day1} ${d1.getMonth() + 1}/${d1.getDate()} ${d1.getHours().toString().padStart(2, '0')}:${d1.getMinutes().toString().padStart(2, '0')}`, x1, height - padding.bottom + 18);

    const x2 = xScale(n - 2);
    const d2 = new Date(sampled[n - 2].created_at);
    const day2 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d2.getDay()];
    ctx.fillText(`${day2} ${d2.getMonth() + 1}/${d2.getDate()} ${d2.getHours().toString().padStart(2, '0')}:${d2.getMinutes().toString().padStart(2, '0')}`, x2, height - padding.bottom + 18);
  }

  // X-axis title
  ctx.fillStyle = '#555555';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('DATE & TIME', width / 2, height - 8);

  // ---- AVG LINE (dashed) ----
  const avgY = yScale(avgPrice);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding.left, avgY);
  ctx.lineTo(width - padding.right, avgY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#c62828';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`AVG ${avgPrice.toFixed(4)}`, padding.left + 4, avgY - 5);

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

  // Area fill
  ctx.fillStyle = 'rgba(46, 125, 50, 0.08)';
  ctx.beginPath();
  ctx.moveTo(xScale(0), yScale(sampledPrices[0]));
  sampledPrices.forEach((p, i) => ctx.lineTo(xScale(i), yScale(p)));
  ctx.lineTo(xScale(n - 1), height - padding.bottom);
  ctx.lineTo(xScale(0), height - padding.bottom);
  ctx.closePath();
  ctx.fill();

  // ---- MIN (blue triangle) ----
  const minX = xScale(minIdx);
  const minY = yScale(minPrice);
  ctx.fillStyle = '#1565c0';
  ctx.beginPath();
  ctx.moveTo(minX, minY + 10);
  ctx.lineTo(minX - 7, minY - 5);
  ctx.lineTo(minX + 7, minY - 5);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#1565c0';
  ctx.textAlign = 'center';
  ctx.fillText(`MIN ${minPrice.toFixed(4)}`, minX, minY - 9);

  // ---- MAX (orange triangle) ----
  const maxX = xScale(maxIdx);
  const maxY = yScale(maxPrice);
  ctx.fillStyle = '#e65100';
  ctx.beginPath();
  ctx.moveTo(maxX, maxY - 10);
  ctx.lineTo(maxX - 7, maxY + 5);
  ctx.lineTo(maxX + 7, maxY + 5);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#e65100';
  ctx.textAlign = 'center';
  ctx.fillText(`MAX ${maxPrice.toFixed(4)}`, maxX, maxY + 18);

  // ---- CURRENT (green dot) ----
  const lastX = xScale(n - 1);
  const lastY = yScale(sampledPrices[n - 1]);
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
  ctx.fillText(`NOW ${sampledPrices[n - 1].toFixed(4)}`, lastX + 9, lastY + 3);

  // ---- TITLE ----
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${resource.toUpperCase()} - Price History`, width / 2, 20);
  ctx.fillStyle = '#777777';
  ctx.font = '11px Arial';
  ctx.fillText(`${sampledPrices.length} data points`, width / 2, 36);

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