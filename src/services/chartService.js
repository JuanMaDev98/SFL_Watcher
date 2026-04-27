/**
 * Chart generation service using QuickChart.io
 * Free, no API key required
 */

const QUICKCHART_URL = 'https://quickchart.io/chart';

/**
 * Generate a line chart URL for price history
 * Uses ALL available data points for accuracy
 */
function generateChartUrl(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  // Use all data - don't limit points
  const labels = history.map(h => {
    const date = new Date(h.created_at);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const prices = history.map(h => parseFloat(h.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // Hide points if too many (prevents cluttered chart)
  const pointRadius = prices.length > 50 ? 0 : 2;

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
          pointRadius: pointRadius
        }]
      }
    },
    width: 500,
    height: 250,
    format: 'png',
    scale: {
      y: {
        min: minPrice * 0.98,
        max: maxPrice * 1.02
      }
    }
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `${QUICKCHART_URL}?c=${encodedConfig}`;
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
  calculateStats
};
