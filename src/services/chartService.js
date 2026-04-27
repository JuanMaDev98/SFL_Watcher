/**
 * Chart generation service using @napi-rs/canvas
 * Works in Vercel serverless (Node.js 18+)
 */
const { createCanvas } = require('@napi-rs/canvas');

function generateChartDataUrl(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  // Chart dimensions
  const canvasW = 640;
  const canvasH = 400;
  const padL = 80;
  const padR = 30;
  const padT = 50;
  const padB = 70;

  const chartW = canvasW - padL - padR;
  const chartH = canvasH - padT - padB;

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Collect data
  const n = history.length;
  const prices = history.map(h => parseFloat(h.price));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const avgP = prices.reduce((a, b) => a + b, 0) / prices.length;
  const range = maxP - minP || 1;

  // Find min/max positions in the sampled data
  let minIdx = 0, maxIdx = 0;
  prices.forEach((p, i) => { if (p === minP) minIdx = i; if (p === maxP) maxIdx = i; });

  // Sample data for rendering (max 50 points)
  const sampled = sampleData(history, 50);
  const sampledPrices = sampled.map(h => parseFloat(h.price));
  const sampledN = sampled.length;

  // Scaling helpers
  const xPx = (i) => padL + (i / Math.max(sampledN - 1, 1)) * chartW;
  const yPx = (p) => padT + chartH - ((p - minP) / range) * chartH;

  // === DRAW EVERYTHING ===

  // Grid lines (horizontal)
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = yPx(minP + (range * i) / 6);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
  }

  // Y-axis (left black line)
  ctx.strokeStyle = '#aaaaaa';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + chartH);
  ctx.stroke();

  // Y-axis labels (price values on the left)
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 6; i++) {
    const price = minP + (range * i) / 6;
    const y = yPx(price);
    ctx.fillText(price.toFixed(4), padL - 5, y);
  }

  // Y-axis title (rotated)
  ctx.save();
  ctx.translate(12, padT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#555555';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PRICE (SFL)', 0, 0);
  ctx.restore();

  // X-axis (bottom black line)
  ctx.strokeStyle = '#aaaaaa';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT + chartH);
  ctx.lineTo(padL + chartW, padT + chartH);
  ctx.stroke();

  // X-axis labels (dates)
  ctx.fillStyle = '#555555';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Show up to 5 date labels evenly
  const maxXLabels = 5;
  const xStep = Math.max(1, Math.floor(sampledN / maxXLabels));
  for (let i = 0; i < sampledN; i += xStep) {
    const date = new Date(sampled[i].created_at);
    const x = xPx(i);
    const label = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    ctx.fillText(label, x, padT + chartH + 8);
  }
  // Always label last point
  const lastDate = new Date(sampled[sampledN - 1].created_at);
  ctx.fillText(`${lastDate.getMonth() + 1}/${lastDate.getDate()} ${lastDate.getHours().toString().padStart(2, '0')}:${lastDate.getMinutes().toString().padStart(2, '0')}`, xPx(sampledN - 1), padT + chartH + 8);

  // X-axis title
  ctx.fillStyle = '#555555';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('DATE / TIME', padL + chartW / 2, canvasH - 5);

  // Average line (dashed red)
  const avgY = yPx(avgP);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, avgY);
  ctx.lineTo(padL + chartW, avgY);
  ctx.stroke();
  ctx.setLineDash([]);

  // AVG label
  ctx.fillStyle = '#c62828';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`AVG ${avgP.toFixed(4)}`, padL + 3, avgY - 4);

  // Price line (green)
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  sampledPrices.forEach((p, i) => {
    const x = xPx(i);
    const y = yPx(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill under price line
  ctx.fillStyle = 'rgba(46, 125, 50, 0.07)';
  ctx.beginPath();
  ctx.moveTo(xPx(0), yPx(sampledPrices[0]));
  sampledPrices.forEach((p, i) => ctx.lineTo(xPx(i), yPx(p)));
  ctx.lineTo(xPx(sampledN - 1), padT + chartH);
  ctx.lineTo(xPx(0), padT + chartH);
  ctx.closePath();
  ctx.fill();

  // MIN marker (blue triangle pointing down)
  const minX = xPx(minIdx);
  const minY = yPx(minP);
  ctx.fillStyle = '#1565c0';
  ctx.beginPath();
  ctx.moveTo(minX, minY + 10);
  ctx.lineTo(minX - 7, minY - 6);
  ctx.lineTo(minX + 7, minY - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1565c0';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`MIN ${minP.toFixed(4)}`, minX, minY - 9);

  // MAX marker (orange triangle pointing up)
  const maxX = xPx(maxIdx);
  const maxY = yPx(maxP);
  ctx.fillStyle = '#e65100';
  ctx.beginPath();
  ctx.moveTo(maxX, maxY - 10);
  ctx.lineTo(maxX - 7, maxY + 6);
  ctx.lineTo(maxX + 7, maxY + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e65100';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`MAX ${maxP.toFixed(4)}`, maxX, maxY + 18);

  // CURRENT price dot (green filled circle)
  const lastX = xPx(sampledN - 1);
  const lastY = yPx(sampledPrices[sampledN - 1]);
  ctx.fillStyle = '#1b5e20';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#1b5e20';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`NOW ${sampledPrices[sampledN - 1].toFixed(4)}`, lastX + 9, lastY + 3);

  // Title
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${resource.toUpperCase()} - Price History`, canvasW / 2, 12);

  // Subtitle (data points count)
  ctx.fillStyle = '#888888';
  ctx.font = '11px Arial';
  ctx.fillText(`${sampledN} data points`, canvasW / 2, 32);

  // Legend top-right
  ctx.font = '10px Arial';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#c62828';
  ctx.fillText('— AVG', canvasW - 8, 12);

  // Convert to PNG buffer
  const buffer = canvas.toBuffer('image/png');
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

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