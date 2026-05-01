const fs = require('fs');
let c = fs.readFileSync('src/routes/telegram.js', 'utf8');

const start = c.indexOf('async function processPriceSimple');
const end = c.indexOf('async function processAllPrices');
let block = c.substring(start, end);

// The old function
const oldFunc = block.substring(0, block.indexOf('} catch') + 7 + 38); // includes catch block

// Find where the old function ends (after the catch block's closing })
const catchEnd = block.lastIndexOf('}');
const oldFunction = block.substring(0, catchEnd + 1);

console.log('Old function length:', oldFunction.length);
console.log('First 100 chars:', JSON.stringify(oldFunction.substring(0, 100)));

// New function
const newFunction = `async function processPriceSimple(chatId, resource) {
  try {
    const { getResourceStats } = require('../services/priceFetcher');
    const stats = await getResourceStats(resource);

    if (!stats) {
      await sendTelegramAwait(chatId, \`❌ No data for \${resource}.\nWait for cron to collect data.\`);
      return;
    }

    const { current_price, avg_price, min_price, max_price, percent_vs_avg, snapshot_count } = stats;
    const pct = percent_vs_avg;
    const emoji = pct >= 0 ? '📈' : '📉';
    const sign = pct >= 0 ? '+' : '';

    await sendTelegramAwait(chatId,
      \`<b>\${resource.toUpperCase()}</b>\n\n\` +
      \`💰 Current: <code>\${current_price.toFixed(6)}</code>\n\` +
      \`📊 Min: \${min_price.toFixed(6)} | Max: \${max_price.toFixed(6)}\n\` +
      \`📐 Avg: \${avg_price.toFixed(6)}\n\` +
      \`\${emoji} vs Avg: \${sign}\${pct.toFixed(2)}%\n\n\` +
      \`📈 Data Points: \${snapshot_count}\`
    );
  } catch (error) {
    logger.error('[price] error: ' + error.message);
    await sendTelegramAwait(chatId, \`Error: \${error.message}\`);
  }
}`;

// Replace
c = c.replace(oldFunction, newFunction);

fs.writeFileSync('src/routes/telegram.js', c, 'utf8');
console.log('DONE');
