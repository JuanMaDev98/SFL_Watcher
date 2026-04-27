/**
 * Chart generation service - SVG based, no external dependencies
 * Works in Vercel serverless environment
 */

/**
 * Generate an SVG chart and return as data URL
 */
function generateChartDataUrl(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  const width = 500;
  const height = 250;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const prices = history.map(h => parseFloat(h.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // Sample to max 60 points to prevent URL length issues
  const sampled = sampleData(history, 60);
  const sampledPrices = sampled.map(h => parseFloat(h.price));

  // Scale functions
  const xScale = (i) => padding.left + (i / (sampled.length - 1)) * chartWidth;
  const yScale = (p) => padding.top + chartHeight - ((p - minPrice) / priceRange) * chartHeight;

  // Build polyline points
  const points = sampledPrices.map((p, i) => `${xScale(i).toFixed(1)},${yScale(p).toFixed(1)}`).join(' ');

  // Y-axis labels
  const yLabels = [];
  const numYLabels = 5;
  for (let i = 0; i <= numYLabels; i++) {
    const price = minPrice + (priceRange * i) / numYLabels;
    const y = yScale(price);
    yLabels.push(`<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#666">${price.toFixed(4)}</text>`);
  }

  // X-axis labels (first, middle, last)
  const xLabels = [];
  const xLabelIndices = [0, Math.floor(sampled.length / 2), sampled.length - 1];
  xLabelIndices.forEach(i => {
    const date = new Date(sampled[i].created_at);
    const x = xScale(i);
    xLabels.push(`<text x="${x}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#666">${date.getMonth() + 1}/${date.getDate()}</text>`);
  });

  // Grid lines
  const gridLines = [];
  for (let i = 0; i <= numYLabels; i++) {
    const y = yScale(minPrice + (priceRange * i) / numYLabels);
    gridLines.push(`<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#eee" stroke-width="1"/>`);
  }

  // Current price dot (last point)
  const lastX = xScale(sampledPrices.length - 1);
  const lastY = yScale(sampledPrices[sampledPrices.length - 1]);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="background:#fff">
  <style>
    text { font-family: Arial, sans-serif; }
  </style>
  <!-- Grid -->
  ${gridLines.join('\n')}
  <!-- Y-axis labels -->
  ${yLabels.join('\n')}
  <!-- X-axis labels -->
  ${xLabels.join('\n')}
  <!-- Line -->
  <polyline points="${points}" fill="none" stroke="#4CAF50" stroke-width="2" stroke-linejoin="round"/>
  <!-- Current price dot -->
  <circle cx="${lastX}" cy="${lastY}" r="4" fill="#4CAF50"/>
  <!-- Title -->
  <text x="${width / 2}" y="15" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${resource.toUpperCase()}</text>
</svg>`;

  // Return as data URL
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
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

  // Always include the last point
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
    current,
    min,
    max,
    avg,
    pct,
    count: history.length,
    oldest: history[0].created_at,
    newest: history[history.length - 1].created_at
  };
}

module.exports = {
  generateChartDataUrl,
  calculateStats
};
