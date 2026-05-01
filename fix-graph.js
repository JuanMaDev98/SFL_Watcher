const fs = require('fs');
let c = fs.readFileSync('src/routes/telegram.js', 'utf8');

const start = c.indexOf('async function processGraph(chatId, resource)');
const end = c.indexOf('async function processAllPrices(chatId)');
let block = c.substring(start, end);

// Find where the function ends
const catchEnd = block.lastIndexOf('}');
const oldFunction = block.substring(0, catchEnd + 1);

const newFunction = `async function processGraph(chatId, resource) {
  try {
    const { getResourceHistory, getResourceStats } = require('../services/priceFetcher');
    const { generateChartBuffer } = require('../services/chartService');

    // Get stats from full 90-day SQL function (accurate avg/min/max)
    const stats = await getResourceStats(resource);
    
    // Get history for chart (90 days of data)
    const history = await getResourceHistory(resource, 90);

    if (!history || history.length < 2) {
      await sendTelegramAwait(chatId, \`❌ Not enough data for \${resource} (\${history?.length || 0} points). Wait for cron to collect more data.\`);
      return;
    }

    // Downsample to max 400 points for QuickChart (avoid 400 errors from too many points)
    const MAX_CHART_POINTS = 400;
    let chartData = history;
    if (history.length > MAX_CHART_POINTS) {
      const step = Math.ceil(history.length / MAX_CHART_POINTS);
      chartData = history.filter((_, i) => i % step === 0);
      logger.info(\`[graph] \${resource}: downsampled from \${history.length} to \${chartData.length} points for chart\`);
    }

    const pct = stats ? stats.percent_vs_avg : 0;
    const emoji = pct >= 0 ? '📈' : '📉';
    const sign = pct >= 0 ? '+' : '';

    const caption =
      \`<b>\${resource.toUpperCase()}</b>\n\n\` +
      \`💰 Current: <code>\${(stats ? stats.current_price : 0).toFixed(6)}</code>\n\` +
      \`📊 Min: \${(stats ? stats.min_price : 0).toFixed(6)} | Max: \${(stats ? stats.max_price : 0).toFixed(6)}\n\` +
      \`📐 Avg: \${(stats ? stats.avg_price : 0).toFixed(6)}\n\` +
      \`\${emoji} vs Avg: \${sign}\${pct.toFixed(2)}%\n\n\` +
      \`📈 Data Points: \${chartData.length} of \${history.length} shown\`;

    const { generateChartDataUrl } = require('../services/chartService');
    const { chartConfig } = generateChartDataUrl(resource, chartData);
    const arrayBuffer = await generateChartBuffer(chartConfig);
    
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('QuickChart returned empty buffer');
    }
    
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const chartUrl = \`data:image/png;base64,\${base64}\`;
    
    if (chartUrl.length > 20 * 1024 * 1024) {
      throw new Error('Chart image too large to send');
    }
    
    const sent = await sendPhoto(chatId, chartUrl, caption);
    if (!sent) {
      logger.error('[graph] sendPhoto failed, attempting sendDocument fallback')
      const resp = await fetch(\`\${TELEGRAM_API}/sendDocument\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, document: chartUrl, caption, parse_mode: 'HTML' })
      });
      const data = await resp.json();
      if (!resp.ok) {
        logger.error('[graph] sendDocument fallback also failed: ' + data);
        await sendTelegramAwait(chatId, \`❌ Chart failed to send. Try /price \${resource} for text data.\`);
      }
    }
  } catch (error) {
    logger.error('[graph] error: ' + error.message);
    await sendTelegramAwait(chatId, \`❌ Error: \${error.message}\`);
  }
}`;

c = c.replace(oldFunction, newFunction);
fs.writeFileSync('src/routes/telegram.js', c, 'utf8');
console.log('DONE');