const express = require('express');
const router = express.Router();
const { getResourceHistory } = require('../services/priceFetcher');
const { generateChartUrl } = require('../services/chartService');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Handle incoming Telegram updates (webhook)
 * POST /api/telegram/webhook
 */
router.post('/webhook', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.text) {
      return res.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const parts = text.split(' ');

    // Command: /graph <resource>
    if (parts[0] === '/graph' || parts[0] === '/graph@sflwatcher_bot') {
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, '❌ Uso: /graph <recurso>\nEjemplo: /graph yam\n\nRecursos disponibles: sunflower, potato, pumpkin, carrot, cabbage, beetroot, cauliflower, parsnip, radish, wheat, kale, apple, blueberry, orange, eggplant, corn, banana, soybean, grape, rice, olive, tomato, lemon, barley, rhubarb, zucchini, yam, broccoli, pepper, onion, turnip, artichoke');
        return res.json({ ok: true });
      }

      const resource = parts[1].toLowerCase();
      await handleGraphCommand(chatId, resource);
      return res.json({ ok: true });
    }

    // Command: /start
    if (parts[0] === '/start') {
      await sendTelegramMessage(chatId, '🦉 <b>SFL Watcher</b>\n\nMonitorea precios de Sunflower Land.\n\nComandos:\n/graph <recurso> - Ver gráfica de precio\n/alerts - Ver tus alertas activas\n/help - Ayuda\n\nEjemplo: /graph broccoli');
      return res.json({ ok: true });
    }

    // Command: /help
    if (parts[0] === '/help') {
      await sendTelegramMessage(chatId, '📊 <b>SFL Watcher - Comandos</b>\n\n/graph <recurso> - Gráfica de precio (90 días)\n/list - Recursos disponibles\n/alerts - Ver alertas\n\nEjemplo: /graph yam');
      return res.json({ ok: true });
    }

    // Command: /list
    if (parts[0] === '/list') {
      const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
      await sendTelegramMessage(chatId, '📋 <b>Recursos disponibles:</b>\n\n' + resources.join(', '));
      return res.json({ ok: true });
    }

    res.json({ ok: true });

  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

/**
 * Handle /graph command
 */
async function handleGraphCommand(chatId, resource) {
  console.log(`[handleGraphCommand] Called with resource=${resource}, chatId=${chatId}`);
  
  try {
    // Get price history (90 days)
    console.log(`[handleGraphCommand] Fetching history for ${resource}...`);
    const history = await getResourceHistory(resource, 90);
    console.log(`[handleGraphCommand] History count: ${history?.length || 0}`);

    if (!history || history.length === 0) {
      console.log(`[handleGraphCommand] No data for ${resource}`);
      await sendTelegramMessage(chatId, `❌ No hay datos para <b>${resource}</b>. Intenta de nuevo en unos minutos cuando el cron haya colectado datos.`);
      return;
    }

    // Generate chart URL
    console.log(`[handleGraphCommand] Generating chart...`);
    const chartUrl = generateChartUrl(resource, history);
    console.log(`[handleGraphCommand] Chart URL length: ${chartUrl?.length || 'undefined'}`);

    // Send chart image
    console.log(`[handleGraphCommand] Sending photo...`);
    await sendTelegramPhoto(chatId, chartUrl, `📈 ${resource.toUpperCase()} - 90 días`);
    console.log(`[handleGraphCommand] Done!`);

  } catch (error) {
    console.error('[handleGraphCommand] Error:', error.message);
    await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
  }
}

/**
 * Send text message via Telegram
 */
async function sendTelegramMessage(chatId, text) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    });
  } catch (error) {
    console.error('Telegram send error:', error.message);
  }
}

/**
 * Send photo via Telegram (chart image)
 */
async function sendTelegramPhoto(chatId, photoUrl, caption) {
  console.log(`[sendTelegramPhoto] Starting for chatId=${chatId}`);
  console.log(`[sendTelegramPhoto] PhotoUrl length: ${photoUrl?.length || 'undefined'}`);
  
  try {
    // Download image first
    console.log('[sendTelegramPhoto] Downloading from QuickChart...');
    const response = await fetch(photoUrl);
    console.log(`[sendTelegramPhoto] QuickChart response: ${response.status}`);
    
    if (!response.ok) {
      throw new Error(`QuickChart fetch failed: ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    console.log(`[sendTelegramPhoto] Buffer size: ${buffer.byteLength} bytes`);
    
    const base64 = Buffer.from(buffer).toString('base64');
    console.log(`[sendTelegramPhoto] Base64 length: ${base64.length}`);
    
    // Send to Telegram
    console.log('[sendTelegramPhoto] Sending to Telegram...');
    const telegramResponse = await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: `data:image/png;base64,${base64}`,
        caption: caption
      })
    });
    
    const result = await telegramResponse.json();
    console.log(`[sendTelegramPhoto] Telegram response:`, JSON.stringify(result));
    
  } catch (error) {
    console.error('[sendTelegramPhoto] Error:', error.message);
  }
}

/**
 * Set webhook URL (call once to configure)
 * GET /api/telegram/setwebhook
 */
router.get('/setwebhook', async (req, res) => {
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || `${process.env.APP_URL}/api/telegram/webhook`;

  try {
    const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message']
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;