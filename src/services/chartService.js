/**
 * Chart generation service using QuickChart POST API
 * No URL length limit - config sent as JSON body
 */
const QUICKCHART_URL = 'https://quickchart.io/chart';

function generateChartDataUrl(resource, history) {
  if (!history || history.length === 0) {
    return null;
  }

  const prices = history.map(h => parseFloat(h.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const currentPrice = prices[prices.length - 1];

  // Labels = dates
  const labels = history.map(h => {
    const d = new Date(h.created_at);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  });

  // Find min/max annotation positions
  const minIdx = prices.indexOf(minPrice);
  const maxIdx = prices.indexOf(maxPrice);

  // Build chart config with MIN/MAX arrow markers
  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Price (SFL)',
        data: prices,
        borderColor: '#2e7d32',
        backgroundColor: 'rgba(46, 125, 50, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointBackgroundColor: '#2e7d32',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1
      }, {
        // AVG line dataset
        label: 'AVG',
        data: prices.map(() => avgPrice),
        borderColor: '#c62828',
        borderWidth: 1.5,
        borderDash: [5, 4],
        fill: false,
        tension: 0,
        pointRadius: 0
      }, {
        // MIN marker - triangle pointing down (↓)
        label: 'MIN',
        data: prices.map((p, i) => i === minIdx ? minPrice : null),
        borderColor: '#0d47a1',
        backgroundColor: '#2196f3',
        pointRadius: 10,
        pointStyle: 'triangle',
        showLine: false,
        fill: true
      }, {
        // MAX marker - triangle pointing up (↑)
        label: 'MAX',
        data: prices.map((p, i) => i === maxIdx ? maxPrice : null),
        borderColor: '#bf360c',
        backgroundColor: '#ff5722',
        pointRadius: 10,
        pointStyle: 'triangle',
        rotation: 180, // Rotate 180° to point upward
        showLine: false,
        fill: true
      }]
    },
    options: {
      responsive: false,
      width: 640,
      height: 380,
      devicePixelRatio: 1,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y.toFixed(6)} SFL`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'DATE / TIME', color: '#555', font: { size: 11, bold: true } },
          ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#555' },
          grid: { color: '#e8e8e8' }
        },
        y: {
          title: { display: true, text: 'PRICE (SFL)', color: '#555', font: { size: 11, bold: true } },
          ticks: { font: { size: 11, bold: true }, color: '#444', callback: (v) => v.toFixed(4) },
          grid: { color: '#e8e8e8' }
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  };

  return { chartConfig };
}

function generateChartBuffer(chartConfig) {
  // This returns a promise - caller must await
  return fetch(QUICKCHART_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: chartConfig,
      format: 'png',
      width: 640,
      height: 380
    })
  }).then(res => {
    if (!res.ok) throw new Error(`QuickChart error: ${res.status}`);
    return res.arrayBuffer();
  });
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

module.exports = { generateChartDataUrl, generateChartBuffer, calculateStats };
