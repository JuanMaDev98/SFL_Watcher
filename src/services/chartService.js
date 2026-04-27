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

  const width = 600;
  const height = 350;
  const padding = { top: 40, right: 30, bottom: 50, left: 70 };

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

  // Sample to max 60 points
  const sampled = sampleDataWithIndices(history, 60);
  const sampledPrices = sampled.map(h => parseFloat(h.price));
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale functions
  const xScale = (i) => padding.left + (i / (sampled.length - 1)) * chartWidth;
  const yScale = (p) => padding.top + chartHeight - ((p - minPrice) / priceRange) * chartHeight;

  // Draw grid lines
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  const numYLabels = 6;
  for (let i = 0; i <= numYLabels; i++) {
    const y = yScale(minPrice + (priceRange * i) / numYLabels);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // Y-axis labels
  ctx.fillStyle = '#555555';
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  for (let i = 0; i <= numYLabels; i++) {
    const price = minPrice + (priceRange * i) / numYLabels;
    const y = yScale(price);
    ctx.fillText(price.toFixed(4), padding.left - 8, y + 4);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#666666';
  const xLabelIndices = [0, Math.floor(sampled.length / 2), sampled.length - 1];
  xLabelIndices.forEach(i => {
    const date = new Date(sampled[i].created_at);
    const x = xScale(i);
    ctx.fillText(`${date.getMonth() + 1}/${date.getDate()}`, x, height - 15);
  });

  // Average line (dashed red)
  const avgY = yScale(avgPrice);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#e53935';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding.left, avgY);
  ctx.lineTo(width - padding.right, avgY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Average label
  ctx.fillStyle = '#e53935';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`AVG: ${avgPrice.toFixed(4)}`, padding.left + 5, avgY - 5);

  // Draw the price line
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
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

  // Area fill under the line
  ctx.fillStyle = 'rgba(46, 125, 50, 0.08)';
  ctx.beginPath();
  ctx.moveTo(xScale(0), yScale(sampledPrices[0]));
  sampledPrices.forEach((p, i) => ctx.lineTo(xScale(i), yScale(p)));
  ctx.lineTo(xScale(sampledPrices.length - 1), height - padding.bottom);
  ctx.lineTo(xScale(0), height - padding.bottom);
  ctx.closePath();
  ctx.fill();

  // Min point (blue triangle down)
  const minOrigIdx = sampled[minIdx]?.origIdx ?? minIdx;
  const minX = xScale(minIdx);
  const minY = yScale(minPrice);
  ctx.fillStyle = '#1565c0';
  ctx.beginPath();
  ctx.moveTo(minX, minY + 8);
  ctx.lineTo(minX - 6, minY - 5);
  ctx.lineTo(minX + 6, minY - 5);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#1565c0';
  ctx.textAlign = 'center';
  ctx.fillText(`MIN: ${minPrice.toFixed(4)}`, minX, minY - 10);

  // Max point (orange triangle up)
  const maxX = xScale(maxIdx);
  const maxY = yScale(maxPrice);
  ctx.fillStyle = '#e65100';
  ctx.beginPath();
  ctx.moveTo(maxX, maxY - 8);
  ctx.lineTo(maxX - 6, maxY + 5);
  ctx.lineTo(maxX + 6, maxY + 5);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#e65100';
  ctx.textAlign = 'center';
  ctx.fillText(`MAX: ${maxPrice.toFixed(4)}`, maxX, maxY + 18);

  // Current price dot (green circle)
  const lastX = xScale(sampledPrices.length - 1);
  const lastY = yScale(sampledPrices[sampledPrices.length - 1]);
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 10px Arial';
  ctx.fillStyle = '#2e7d32';
  ctx.textAlign = 'left';
  ctx.fillText(`NOW: ${sampledPrices[sampledPrices.length - 1].toFixed(4)}`, lastX + 8, lastY + 4);

  // Title
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${resource.toUpperCase()} - Price History`, width / 2, 22);

  // Data points label
  ctx.fillStyle = '#888888';
  ctx.font = '11px Arial';
  ctx.fillText(`${sampledPrices.length} data points`, width / 2, 38);

  // Legend
  ctx.font = '10px Arial';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e53935';
  ctx.fillText('— AVG', width - 10, 22);

  // Convert to PNG buffer → base64 data URL
  const buffer = canvas.toBuffer('image/png');
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Sample array to maxPoints - evenly distributed, keeping track of original indices
 */
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