const express = require('express');
const router = express.Router();
const { getResourceHistory, getAllPrices } = require('../services/priceFetcher');
const { generateChartUrl } = require('../services/chartService');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * GET /api/telegram/poll
 * Cron job that runs every minute to check for new messages
 * This avoids the webhook timeout issue in Vercel
 */
router.get('/poll', async (req, res) => {
  try {
    // Get updates from Telegram
    const response = await fetch(`${TELEGRAM_API}/getUpdates?limit=100&timeout=0`);
    const data = await response.json();
    
    if (!data.ok || !data.result || data.result.length === 0) {
      return res.json({ ok: true, messages: 0 });
    }
    
    // Process each update
    let processed = 0;
    for (const update of data.result) {
      if (update.message && update.message.text) {
        await processMessage(update.message);
        processed++;
      }
    }
    
    // Acknowledge we've processed these updates
    if (processed > 0) {
      const lastUpdateId = data.result[data.result.length - 1].update_id;
      // Call getUpdates with offset to acknowledge
      await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}`);
    }
    
    res.json({ ok: true, processed });
  } catch (error) {
    console.error('[poll] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process a single message
 */
async function processMessage(message) {
  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  
  console.log(`[poll] ${command} from ${chatId}`);
  
  try {
    if (command === '/start') {
      await sendMessage(chatId, '🦉 <b>SFL Watcher</b>\n\n/graph <recurso> - Ver gráfica\n/list - Recursos\n/prices - Precios actuales');
    }
    else if (command === '/help') {
      await sendMessage(chatId, '📊 <b>Comandos:</b>\n/graph <recurso> - Gráfica\n/list - Recursos\n/prices - Precios actuales');
    }
    else if (command === '/list') {
      const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
      await sendMessage(chatId, '📋 <b>Recursos:</b>\n' + resources.join(', '));
    }
    else if (command === '/prices') {
      const prices = await getAllPrices();
      if (prices.length === 0) {
        await sendMessage(chatId, '❌ No hay precios disponibles.');
      } else {
        const text = prices.slice(0, 10).map(r => `• ${r.resource}: ${r.current_price} SFL`).join('\n');
        await sendMessage(chatId, `💰 <b>Precios:</b>\n${text}`);
      }
    }
    else if (command === '/graph' || command === '/graph@sflwatcher_bot') {
      const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
      if (!resource) {
        await sendMessage(chatId, '❌ Usage: /graph <resource>\nExample: /graph yam');
        return;
      }
      
      try {
        const history = await getResourceHistory(resource, 365);
        
        if (!history || history.length === 0) {
          await sendMessage(chatId, `❌ No hay datos para ${resource}.\nEspera a que el cron collecte datos.`);
          return;
        }
        
        const chartUrl = generateChartUrl(resource, history);
        await sendMessage(chatId, `📊 ${resource.toUpperCase()}\n${history.length} puntos\n\n${chartUrl}`);
      } catch (error) {
        console.error('[graph] error:', error.message);
        await sendMessage(chatId, `Error: ${error.message}`);
      }
    }
    else if (command === '/debug') {
      try {
        const history = await getResourceHistory('yam', 365);
        const chartUrl = generateChartUrl('yam', history);
        await sendMessage(chatId, `🔧 Debug:\nHistory: ${history.length} puntos\nURL: ${chartUrl.length} chars`);
      } catch (error) {
        await sendMessage(chatId, `Error: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('[processMessage] error:', error.message);
  }
}

/**
 * Send message to Telegram
 */
async function sendMessage(chatId, text) {
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  const result = await response.json();
  if (!result.ok) {
    console.error('[sendMessage] Telegram error:', result.description);
  }
  return result;
}

/**
 * GET /api/telegram/test
 */
router.get('/test', async (req, res) => {
  try {
    await sendMessage('1166287745', '🐣 Test desde SFL Watcher API!');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/telegram/setwebhook
 */
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
