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
      '/price <recurso> - Precio actual\n' +
      '/priceall - Todos los precios\n' +
      '/graph <recurso> - Gráfica\n' +
      '/list - Recursos'
    );
  }
  else if (command === '/help') {
    await sendTelegramAwait(chatId,
      '📊 <b>Comandos:</b>\n' +
      '/price <recurso> - Precio actual\n' +
      '/priceall - Todos los precios\n' +
      '/graph <recurso> - Gráfica\n' +
      '/list - Recursos'
    );
  }
  else if (command === '/list') {
    const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
    await sendTelegramAwait(chatId, '📋 <b>Recursos:</b>\n' + resources.join(', '));
  }
  else if (command === '/price') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /price <resource>\nExample: /price yam');
      res.json({ ok: true });
      return;
    }
    // Process and respond before finishing
    await processPriceSimple(chatId, resource);
  }
  else if (command === '/priceall') {
    await processAllPrices(chatId);
  }
  else if (command === '/graph' || command === '/graph@sflwatcher_bot') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /graph <recurso>\nExample: /graph yam');
      res.json({ ok: true });
      return;
    }
    await processGraph(chatId, resource);
  }
  else if (command === '/debug') {
    await processDebug(chatId);
  }
  else {
    await sendTelegramAwait(chatId, '❌ Comando no reconocido.\nUsa /help para ver comandos.');
  }

  res.json({ ok: true });
});

// ============================================
// COMMAND PROCESSORS
// ============================================

async function processPriceSimple(chatId, resource) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const history = await getResourceHistory(resource, 30);

    if (!history || history.length === 0) {
      await sendTelegramAwait(chatId, `❌ No hay datos para ${resource}.\nEspera a que el cron collecte datos.`);
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
      `🥕 <b>${resource.toUpperCase()}</b>\n\n` +
      `💰 Actual: <code>${current}</code>\n` +
      `📊 Mín: ${min} | Máx: ${max}\n` +
      `📐 Promedio: ${avg.toFixed(6)}\n` +
      `${emoji} vs Promedio: ${sign}${pct}%`
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
      await sendTelegramAwait(chatId, '❌ No hay precios disponibles.');
      return;
    }

    // Get top 15 by snapshot count
    const top = prices.slice(0, 15);
    const lines = top.map(r => {
      const pct = r.percent_vs_avg || 0;
      const sign = pct >= 0 ? '+' : '';
      return `• ${r.resource}: ${parseFloat(r.current_price).toFixed(4)} (${sign}${pct.toFixed(1)}%)`;
    });

    await sendTelegramAwait(chatId, '💰 <b>Precios Actuales:</b>\n' + lines.join('\n'));
  } catch (error) {
    console.error('[priceall] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processGraph(chatId, resource) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartUrl } = require('../services/chartService');

    const history = await getResourceHistory(resource, 365);

    if (!history || history.length === 0) {
      await sendTelegramAwait(chatId, `❌ No hay datos para ${resource}.\nEspera a que el cron collecte datos.`);
      return;
    }

    const chartUrl = generateChartUrl(resource, history);
    await sendTelegramAwait(chatId, `📊 ${resource.toUpperCase()}\n${history.length} puntos\n\n${chartUrl}`);
  } catch (error) {
    console.error('[graph] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processDebug(chatId) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartUrl } = require('../services/chartService');

    const history = await getResourceHistory('yam', 365);
    const chartUrl = generateChartUrl('yam', history);
    await sendTelegramAwait(chatId, `🔧 Debug:\nHistory: ${history.length} puntos\nURL: ${chartUrl.length} chars`);
  } catch (error) {
    console.error('[debug] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

// ============================================
// TEST & SETUP ENDPOINTS
// ============================================

router.get('/test', async (req, res) => {
  const ok = await sendTelegramAwait('1166287745', '🐣 Test desde SFL Watcher API!');
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
