const express = require('express');
const router = express.Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Fire-and-forget Telegram sender (for simple responses)
 */
function sendTelegram(chatId, text) {
  setImmediate(() => {
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    }).catch(e => console.error('Telegram error:', e.message));
  });
}

/**
 * Awaited Telegram sender (waits for response before Vercel cuts off)
 */
async function sendTelegramAwait(chatId, text) {
  try {
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    return resp.ok;
  } catch (e) {
    console.error('Telegram error:', e.message);
    return false;
  }
}

/**
 * Send photo with caption using sendPhoto API
 */
async function sendPhoto(chatId, photoUrl, caption) {
  try {
    // photoUrl can be a data URL (data:image/svg+xml;base64,...) or HTTP URL
    const resp = await fetch(`${TELEGRAM_API}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        document: photoUrl,
        caption: caption,
        parse_mode: 'HTML'
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[sendPhoto] Telegram error:', data);
    }
    return resp.ok;
  } catch (e) {
    console.error('[sendPhoto] error:', e.message);
    return false;
  }
}

// ============================================
// WEBHOOK HANDLER
// ============================================
router.post('/webhook', async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.text) {
    res.json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

  console.log(`[webhook] ${command} from ${chatId}`);

  if (command === '/start') {
    await sendTelegramAwait(chatId,
      '🦉 <b>SFL Watcher</b>\n\n' +
      '/price &lt;resource&gt; - Current price\n' +
      '/priceall - All prices\n' +
      '/graph &lt;resource&gt; - Chart\n' +
      '/list - Resource list'
    );
  }
  else if (command === '/help') {
    await sendTelegramAwait(chatId,
      '📊 <b>Commands:</b>\n' +
      '/price &lt;resource&gt; - Current price\n' +
      '/priceall - All prices\n' +
      '/graph &lt;resource&gt; - Chart\n' +
      '/list - Resource list'
    );
  }
  else if (command === '/list') {
    const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
    await sendTelegramAwait(chatId, '📋 <b>Resources:</b>\n' + resources.join(', '));
  }
  else if (command === '/price') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /price &lt;resource&gt;\nExample: /price yam');
      res.json({ ok: true });
      return;
    }
    await processPriceSimple(chatId, resource);
  }
  else if (command === '/priceall') {
    await processAllPrices(chatId);
  }
  else if (command === '/graph' || command === '/graph@sflwatcher_bot') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /graph &lt;resource&gt;\nExample: /graph yam');
      res.json({ ok: true });
      return;
    }
    await processGraph(chatId, resource);
  }
  else if (command === '/debug') {
    await processDebug(chatId);
  }
  else {
    await sendTelegramAwait(chatId, '❌ Unknown command.\nUse /help to see commands.');
  }

  res.json({ ok: true });
});

// ============================================
// COMMAND PROCESSORS
// ============================================

async function processPriceSimple(chatId, resource) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');

    // Use 90 days of data
    const history = await getResourceHistory(resource, 90);

    if (!history || history.length === 0) {
      await sendTelegramAwait(chatId, `❌ No data for ${resource}.\nWait for cron to collect data.`);
      return;
    }

    const prices = history.map(h => parseFloat(h.price));
    const current = prices[prices.length - 1];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const pct = ((current - avg) / avg * 100).toFixed(2);

    const emoji = pct >= 0 ? '📈' : '📉';
    const sign = pct >= 0 ? '+' : '';

    await sendTelegramAwait(chatId,
      `<b>${resource.toUpperCase()}</b>\n\n` +
      `💰 Current: <code>${current.toFixed(6)}</code>\n` +
      `📊 Min: ${min.toFixed(6)} | Max: ${max.toFixed(6)}\n` +
      `📐 Avg: ${avg.toFixed(6)}\n` +
      `${emoji} vs Avg: ${sign}${pct}%\n\n` +
      `📈 Data Points: ${history.length}`
    );
  } catch (error) {
    console.error('[price] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processAllPrices(chatId) {
  try {
    const { getAllPrices } = require('../services/priceFetcher');
    const prices = await getAllPrices();

    if (!prices || prices.length === 0) {
      await sendTelegramAwait(chatId, '❌ No prices available.');
      return;
    }

    const lines = prices.map(r => {
      const pct = r.percent_vs_avg || 0;
      const sign = pct >= 0 ? '+' : '';
      return `• ${r.resource}: ${parseFloat(r.current_price).toFixed(4)} (${sign}${pct.toFixed(1)}%)`;
    });

    await sendTelegramAwait(chatId, '💰 <b>Current Prices:</b>\n' + lines.join('\n'));
  } catch (error) {
    console.error('[priceall] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processGraph(chatId, resource) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartDataUrl, calculateStats } = require('../services/chartService');

    // Use all available data (up to 90 days)
    const history = await getResourceHistory(resource, 90);

    if (!history || history.length === 0) {
      await sendTelegramAwait(chatId, `❌ No data for ${resource}.\nWait for cron to collect data.`);
      return;
    }

    // Calculate stats
    const stats = calculateStats(history);
    const emoji = stats.pct >= 0 ? '📈' : '📉';
    const sign = stats.pct >= 0 ? '+' : '';

    // Caption with stats
    const caption =
      `<b>${resource.toUpperCase()}</b>\n\n` +
      `💰 Current: <code>${stats.current.toFixed(6)}</code>\n` +
      `📊 Min: ${stats.min.toFixed(6)} | Max: ${stats.max.toFixed(6)}\n` +
      `📐 Avg: ${stats.avg.toFixed(6)}\n` +
      `${emoji} vs Avg: ${sign}${stats.pct}%\n\n` +
      `📈 Data Points: ${history.length}`;

    // Generate chart as data URL (SVG base64)
    const chartUrl = generateChartDataUrl(resource, history);
    const sent = await sendPhoto(chatId, chartUrl, caption);
    if (!sent) {
      // Fallback: send QuickChart URL
      await sendTelegramAwait(chatId, `📊 Chart: ${chartUrl.substring(0, 200)}...`);
    }
  } catch (error) {
    console.error('[graph] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processDebug(chatId) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartUrl } = require('../services/chartService');

    const history = await getResourceHistory('yam', 90);
    const chartUrl = generateChartUrl('yam', history);
    await sendTelegramAwait(chatId, `🔧 Debug:\nHistory: ${history.length} points\nURL: ${chartUrl.length} chars`);
  } catch (error) {
    console.error('[debug] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

// ============================================
// TEST & SETUP ENDPOINTS
// ============================================

router.get('/test', async (req, res) => {
  const ok = await sendTelegramAwait('1166287745', '🐣 Test from SFL Watcher API!');
  res.json({ ok });
});

router.get('/setwebhook', async (req, res) => {
  const webhookUrl = `${process.env.APP_URL || 'https://sfl-watcher.vercel.app'}/api/telegram/webhook`;

  try {
    const resp = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] })
    });
    const data = await resp.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
