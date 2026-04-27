const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');

const width = 640;
const height = 400;
const padding = { top: 50, right: 25, bottom: 65, left: 80 };
const chartWidth = width - padding.left - padding.right;
const chartHeight = height - padding.top - padding.bottom;

const c = createCanvas(width, height);
const ctx = c.getContext('2d');

// Clear white background
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, width, height);

// Draw border to see canvas edges
ctx.strokeStyle = '#ff0000';
ctx.lineWidth = 2;
ctx.strokeRect(0, 0, width, height);

// Draw chart area border
ctx.strokeStyle = '#00ff00';
ctx.lineWidth = 1;
ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);

// Test text rendering
ctx.fillStyle = '#000000';
ctx.font = '14px Arial';
ctx.textAlign = 'left';
ctx.fillText('Test Arial 14px', 100, 100);

ctx.font = 'bold 12px Arial';
ctx.fillText('Test Bold 12px Arial', 100, 130);

ctx.font = '11px Arial';
ctx.fillText('Test 11px Arial', 100, 160);

ctx.font = 'bold 11px Arial';
ctx.fillText('Test Bold 11px Arial', 100, 190);

// Y-axis labels test
ctx.fillStyle = '#444444';
ctx.font = 'bold 11px Arial';
ctx.textAlign = 'right';

const prices = [17.75, 17.80, 17.85, 17.90];
const minPrice = 17.75;
const maxPrice = 17.90;
const priceRange = maxPrice - minPrice;

prices.forEach((price, i) => {
  const y = padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  ctx.fillText(price.toFixed(4), padding.left - 6, y + 4);
});

// X-axis labels test
ctx.fillStyle = '#555555';
ctx.font = '10px Arial';
ctx.textAlign = 'center';

const labels = ['Mon 4/27 13:00', 'Tue 4/28 09:00', 'Wed 4/29 13:00'];
labels.forEach((label, i) => {
  const x = padding.left + (i / (labels.length - 1)) * chartWidth;
  ctx.fillText(label, x, height - padding.bottom + 18);
});

// Title
ctx.fillStyle = '#1a1a1a';
ctx.font = 'bold 16px Arial';
ctx.textAlign = 'center';
ctx.fillText('YAM - PRICE HISTORY', width / 2, 22);

const buf = c.toBuffer('image/png');
fs.writeFileSync('full_chart_debug.png', buf);
console.log('Done, size:', buf.length);