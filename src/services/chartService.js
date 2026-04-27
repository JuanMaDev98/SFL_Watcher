/**
 * Chart generation service using QuickChart.io
 * Free, no API key required
 */

const QUICKCHART_URL = 'https://quickchart.io/chart';

/**
 * Generate a line chart URL for price history
 * @param {string} resource - Resource name (e.g., 'yam')
 * @param {Array} history - Array of { price, created_at } objects
 * @param {number} width - Chart width (default 600)
 * @param {number} height - Chart height (default 350)
 * @returns {string} URL to the chart image
 */
function generateChartUrl(resource, history, width = 600, height = 350) {
  if (!history || history.length === 0) {
    return null;
  }

  // Prepare labels (dates) and data (prices)
  const labels = history.map(h => {
    const date = new Date(h.created_at);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const prices = history.map(h => parseFloat(h.price));

  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `${resource.toUpperCase()} Price (SFL)`,
        data: prices,
        borderColor: '#4CAF50',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: false,
      animation: {
        duration: 0
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            font: {
              size: 14,
              family: 'Arial'
            },
            color: '#333'
          }
        },
        title: {
          display: true,
          text: `SFL Watcher - ${resource.toUpperCase()} Price (90 days)`,
          font: {
            size: 18,
            family: 'Arial'
          },
          color: '#222'
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => `Price: ${context.parsed.y.toFixed(6)} SFL`
          }
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Date'
          },
          ticks: {
            maxTicksLimit: 10,
            color: '#666'
          }
        },
        y: {
          display: true,
          title: {
            display: true,
            text: 'Price (SFL)'
          },
          ticks: {
            callback: (value) => value.toFixed(6),
            color: '#666'
          }
        }
      }
    }
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `${QUICKCHART_URL}?c=${encodedConfig}&w=${width}&h=${height}&format=png`;
}

/**
 * Get chart as base64 (for Telegram photo upload)
 * @param {string} chartUrl - URL of the chart
 * @returns {Promise<string>} base64 encoded image
 */
async function getChartBase64(chartUrl) {
  const response = await fetch(chartUrl);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

module.exports = {
  generateChartUrl,
  getChartBase64
};