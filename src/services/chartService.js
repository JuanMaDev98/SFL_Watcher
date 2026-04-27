/**
 * Chart generation service using QuickChart.io
 * Free, no API key required
 */

const QUICKCHART_URL = 'https://quickchart.io/chart';

/**
 * Generate a line chart URL for price history
 * Simplified version - URL must be < 1024 chars for Telegram
 */
function generateChartUrl(resource, history, width = 500, height = 300) {
  if (!history || history.length === 0) {
    return null;
  }

  // Prepare labels (dates) and data (prices)
  const labels = history.map(h => {
    const date = new Date(h.created_at);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const prices = history.map(h => parseFloat(h.price));

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
          pointRadius: 3
        }]
      }
    },
    width: width,
    height: height,
    format: 'png',
    scale: {
      y: {
        min: minPrice * 0.9,
        max: maxPrice * 1.1
      }
    },
    devicePixelRatio: 1
  };

  // Encode more efficiently
  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `${QUICKCHART_URL}?c=${encodedConfig}`;
}

module.exports = {
  generateChartUrl
};