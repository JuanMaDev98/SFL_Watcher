/**
 * Chart generation service using QuickChart.io
 * Free, no API key required
 */

const QUICKCHART_URL = 'https://quickchart.io/chart';

/**
 * Generate a line chart URL for price history
 * - Samples data to max 30 points to keep URL under 1024 chars
 * - Works with whatever data is available (not fixed to 90 days)
 */
function generateChartUrl(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  // Sample data to max 30 points to keep URL short
  const sampled = sampleData(history, 30);

  // Prepare labels (dates) and data (prices)
  const labels = sampled.map(h => {
    const date = new Date(h.created_at);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  });

  const prices = sampled.map(h => parseFloat(h.price));

  // Calculate min/max for scale
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const chartConfig = {
    chart: {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: resource.toUpperCase(),
          data: prices,
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76,175,80,0.2)',
          fill: true,
          tension: 0.3,
          pointRadius: 2
        }]
      }
    },
    width: 400,
    height: 200,
    format: 'png',
    scale: {
      y: {
        min: minPrice * 0.95,
        max: maxPrice * 1.05
      }
    },
    devicePixelRatio: 1
  };

  // Encode efficiently
  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  const url = `${QUICKCHART_URL}?c=${encodedConfig}`;

  // If URL too long, try with even fewer points
  if (url.length > 1800) {
    const fewer = sampleData(history, 15);
    return generateChartUrlFromData(resource, fewer);
  }

  return url;
}

/**
 * Generate chart from pre-sampled data
 */
function generateChartUrlFromData(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  const labels = history.map(h => {
    const date = new Date(h.created_at);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const prices = history.map(h => parseFloat(h.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const chartConfig = {
    chart: {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: resource.toUpperCase(),
          data: prices,
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76,175,80,0.2)',
          fill: true,
          tension: 0.3,
          pointRadius: 2
        }]
      }
    },
    width: 400,
    height: 200,
    format: 'png',
    scale: {
      y: {
        min: minPrice * 0.95,
        max: maxPrice * 1.05
      }
    }
  };

  return `${QUICKCHART_URL}?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
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
  generateChartUrl,
  generateChartUrlFromData,
  calculateStats
};
