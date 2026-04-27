const express = require('express');
const router = express.Router();
const { getResourceHistory } = require('../services/priceFetcher');
const { generateChartUrl } = require('../services/chartService');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * POST /api/telegram/webhook
 * Receives Telegram updates - responds quickly to avoid timeout
 */
router.post('/webhook', async (req, res) => {
  // Respond immediately to Telegram
  res.json({ ok: true });
  
  try {
    const { message } = req.body;
    if (!message || !message.text) return;
    
    const chatId = message.chat.id;
    const text = message.text.trim();
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    
    console.log(`[Webhook] Command: ${command} from ${chatId}`);
    
    // Handle commands asynchronously
    if (command === '/graph' || command === '/graph@sflwatcher_bot') {
      const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
      if (resource) {
        // Process in background - don't await
        processGraph(chatId, resource).catch(e => console.error('[graph] Error:', e.message));
      }
    } else if (command === '/start') {
      sendMessage(chatId, '🦉 <b>SFL Watcher</b>\n\n/graph <recurso> - Ver gráfica\n/list - Recursos\n/alerts - Tus alertas').catch(e => console.error('[start] Error:', e.message));
    } else if (command === '/help') {
      sendMessage(chatId, '📊 <b>Comandos:</b>\n/graph <recurso> - Gráfica\n/list - Recursos\n/alerts - Alertas').catch(e => console.error('[help] Error:', e.message));
    } else if (command === '/list') {
      const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
      sendMessage(chatId, '📋 <b>Recursos:</b>\n' + resources.join(', ')).catch(e => console.error('[list] Error:', e.message));
    } else if (command === '/debug') {
      processDebug(chatId).catch(e => console.error('[debug] Error:', e.message));
    }
  } catch (error) {
    console.error('[Webhook] Error:', error.message);
  }
});

/**
 * Process /graph command
 */
async function processGraph(chatId, resource) {
  try {
    const history = await getResourceHistory(resource, 90);
    
    if (!history || history.length === 0) {
      await sendMessage(chatId, `❌ No hay datos para ${resource}. Espera a que el cron collecte datos.`);
      return;
    }
    
    const chartUrl = generateChartUrl(resource, history);
    
    // Send URL as text message (Telegram will make it clickable)
    await sendMessage(chatId, `📊 ${resource.toUpperCase()}\n${history.length} puntos\n\n${chartUrl}`);
    
  } catch (error) {
    console.error('[processGraph] Error:', error.message);
    await sendMessage(chatId, `Error: ${error.message}`);
  }
}

/**
 * Process /debug command
 */
async function processDebug(chatId) {
  try {
    const history = await getResourceHistory('yam', 90);
    const chartUrl = generateChartUrl('yam', history);
    await sendMessage(chatId, `Debug: ${history.length} pts, URL: ${chartUrl.length} chars`);
  } catch (error) {
    await sendMessage(chatId, `Error: ${error.message}`);
  }
}

/**
 * Send message to Telegram
 */
async function sendMessage(chatId, text) {
  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    const result = await response.json();
    console.log('[sendMessage] Result:', result.ok);
    return result;
  } catch (error) {
    console.error('[sendMessage] Error:', error.message);
    throw error;
  }
}

/**
 * GET /api/telegram/test - Test endpoint
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
 * GET /api/telegram/setwebhook - Configure webhook
 */
router.get('/setwebhook', async (req, res) => {
  const webhookUrl = `${process.env.APP_URL || 'https://sfl-watcher.vercel.app'}/api/telegram/webhook`;
  
  try {
    const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;