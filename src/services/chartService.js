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

  const width = 500;
  const height = 250;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const prices = history.map(h => parseFloat(h.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // Sample to max 60 points
  const sampled = sampleData(history, 60);
  const sampledPrices = sampled.map(h => parseFloat(h.price));

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale functions
  const xScale = (i) => padding.left + (i / (sampled.length - 1)) * chartWidth;
  const yScale = (p) => padding.top + chartHeight - ((p - minPrice) / priceRange) * chartHeight;

  // Draw grid lines
  ctx.strokeStyle = '#eeeeee';
  ctx.lineWidth = 1;
  const numYLabels = 5;
  for (let i = 0; i <= numYLabels; i++) {
    const y = yScale(minPrice + (priceRange * i) / numYLabels);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // Y-axis labels
  ctx.fillStyle = '#666666';
  ctx.font = '10px Arial';
  ctx.textAlign = 'right';
  for (let i = 0; i <= numYLabels; i++) {
    const price = minPrice + (priceRange * i) / numYLabels;
    const y = yScale(price);
    ctx.fillText(price.toFixed(4), padding.left - 5, y + 4);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  const xLabelIndices = [0, Math.floor(sampled.length / 2), sampled.length - 1];
  xLabelIndices.forEach(i => {
    const date = new Date(sampled[i].created_at);
    const x = xScale(i);
    ctx.fillText(`${date.getMonth() + 1}/${date.getDate()}`, x, height - 10);
  });

  // Draw line
  ctx.strokeStyle = '#4CAF50';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  sampledPrices.forEach((p, i) => {
    const x = xScale(i);
    const y = yScale(p);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // Current price dot
  const lastX = xScale(sampledPrices.length - 1);
  const lastY = yScale(sampledPrices[sampledPrices.length - 1]);
  ctx.fillStyle = '#4CAF50';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Title
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(resource.toUpperCase(), width / 2, 15);

  // Convert to PNG buffer → base64 data URL
  const buffer = canvas.toBuffer('image/png');
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Sample array to maxPoints - evenly distributed
 */
function sampleData(data, maxPoints) {
  if (data.length <= maxPoints) {
    return data;
  }
  const step = data.length / maxPoints;
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    const index = Math.floor(i * step);
    sampled.push(data[index]);
  }
  if (sampled[sampled.length - 1] !== data[data.length - 1]) {
    sampled[sampled.length - 1] = data[data.length - 1];
  }
  return sampled;
}

/**
 * Calculate price stats from history
 */
function calculateStats(history) {
  if (!history || history.length === 0) {
    return null;
  }
  const prices = history.map(h => parseFloat(h.price));
  const current = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const pct = ((current - avg) / avg * 100).toFixed(2);
  return {
    current, min, max, avg, pct,
    count: history.length,
    oldest: history[0].created_at,
    newest: history[history.length - 1].created_at
  };
}

module.exports = { generateChartDataUrl, calculateStats };