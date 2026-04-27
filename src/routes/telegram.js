const express = require('express');
const router = express.Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Fire-and-forget pattern - doesn't wait for response
function sendTelegram(chatId, text) {
  // Use setImmediate to ensure response is sent first
  setImmediate(() => {
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    }).catch(e => console.error('Telegram error:', e.message));
  });
}

/**
 * POST /api/telegram/webhook
 * Receives Telegram updates
 */
router.post('/webhook', async (req, res) => {
  // Respond immediately
  res.json({ ok: true });
  
  const { message } = req.body || {};
  if (!message || !message.text) return;
  
  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  
  console.log(`[webhook] ${command} from ${chatId}`);
  
  // Handle commands with fire-and-forget
  if (command === '/start') {
    sendTelegram(chatId, '🦉 <b>SFL Watcher</b>\n\n/graph <recurso> - Ver gráfica\n/list - Recursos\n/prices - Precios');
  }
  else if (command === '/help') {
    sendTelegram(chatId, '📊 <b>Comandos:</b>\n/graph <recurso> - Gráfica\n/list - Recursos\n/prices - Precios');
  }
  else if (command === '/list') {
    const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
    sendTelegram(chatId, '📋 <b>Recursos:</b>\n' + resources.join(', '));
  }
  else if (command === '/prices') {
    // For /prices we need DB access - use processPrices
    processPrices(chatId);
  }
  else if (command === '/graph' || command === '/graph@sflwatcher_bot') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      sendTelegram(chatId, '❌ Usage: /graph <resource>\nExample: /graph yam');
      return;
    }
    processGraph(chatId, resource);
  }
  else if (command === '/debug') {
    processDebug(chatId);
  }
});

/**
 * Process /graph command
 */
async function processGraph(chatId, resource) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartUrl } = require('../services/chartService');
    
    const history = await getResourceHistory(resource, 365);
    
    if (!history || history.length === 0) {
      sendTelegram(chatId, `❌ No hay datos para ${resource}.\nEspera a que el cron collecte datos.`);
      return;
    }
    
    const chartUrl = generateChartUrl(resource, history);
    sendTelegram(chatId, `📊 ${resource.toUpperCase()}\n${history.length} puntos\n\n${chartUrl}`);
  } catch (error) {
    console.error('[graph] error:', error.message);
    sendTelegram(chatId, `Error: ${error.message}`);
  }
}

/**
 * Process /debug command
 */
async function processDebug(chatId) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartUrl } = require('../services/chartService');
    
    const history = await getResourceHistory('yam', 365);
    const chartUrl = generateChartUrl('yam', history);
    sendTelegram(chatId, `🔧 Debug:\nHistory: ${history.length} puntos\nURL: ${chartUrl.length} chars`);
  } catch (error) {
    console.error('[debug] error:', error.message);
    sendTelegram(chatId, `Error: ${error.message}`);
  }
}

/**
 * Process /prices command
 */
async function processPrices(chatId) {
  try {
    const { getAllPrices } = require('../services/priceFetcher');
    const prices = await getAllPrices();
    
    if (!prices || prices.length === 0) {
      sendTelegram(chatId, '❌ No hay precios disponibles.');
      return;
    }
    
    const text = prices.slice(0, 10).map(r => `• ${r.resource}: ${r.current_price} SFL`).join('\n');
    sendTelegram(chatId, `💰 <b>Precios:</b>\n${text}`);
  } catch (error) {
    console.error('[prices] error:', error.message);
    sendTelegram(chatId, `Error: ${error.message}`);
  }
}

/**
 * GET /api/telegram/test
 */
router.get('/test', async (req, res) => {
  sendTelegram('1166287745', '🐣 Test desde SFL Watcher API!');
  res.json({ ok: true });
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
