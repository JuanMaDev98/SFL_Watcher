const express = require('express');
const router = express.Router();
const { getResourceHistory } = require('../services/priceFetcher');
const { generateChartUrl } = require('../services/chartService');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Debug test endpoint
router.get('/test', async (req, res) => {
  const chatId = '1166287745';
  try {
    console.log('[TEST] Sending test message...');
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🐣 Test from SFL Watcher API!'
      })
    });
    const result = await response.json();
    console.log('[TEST] Result:', JSON.stringify(result));
    res.json(result);
  } catch (error) {
    console.error('[TEST] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Debug test with DB
router.get('/testdb', async (req, res) => {
  const chatId = '1166287745';
  try {
    console.log('[TESTDB] Step 1: Fetch history');
    const { getResourceHistory } = require('../services/priceFetcher');
    const history = await getResourceHistory('yam', 90);
    console.log('[TESTDB] History count:', history.length);
    
    console.log('[TESTDB] Step 2: Send to Telegram');
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `DB Test: ${history.length} history points found`
      })
    });
    const result = await response.json();
    console.log('[TESTDB] Telegram result:', JSON.stringify(result));
    
    res.json({ success: true, historyLength: history.length, telegram: result });
  } catch (error) {
    console.error('[TESTDB] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

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
      const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
      if (!resource) {
        await sendTelegramMessage(chatId, '❌ Usage: /graph <resource>\nExample: /graph yam');
        return res.json({ ok: true });
      }
      
      try {
        const history = await getResourceHistory(resource, 90);
        if (!history || history.length === 0) {
          await sendTelegramMessage(chatId, `❌ No data for ${resource}. Wait for cron.`);
          return res.json({ ok: true });
        }
        
        const chartUrl = generateChartUrl(resource, history);
        const msg = `📊 ${resource.toUpperCase()}\n${history.length} points\n${chartUrl}`;
        
        const tgResponse = await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg })
        });
        const tgResult = await tgResponse.json();
        console.log('[graph] Result:', JSON.stringify(tgResult));
        
      } catch (error) {
        console.error('[graph] Error:', error.message);
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `Error: ${error.message}` })
        });
      }
      return res.json({ ok: true });
    }

    // Command: /debug
    if (parts[0] === '/debug') {
      try {
        const history = await getResourceHistory('yam', 90);
        const chartUrl = generateChartUrl('yam', history);
        await sendTelegramMessage(chatId, `Debug: ${history.length} pts, URL: ${chartUrl.length} chars`);
      } catch (error) {
        await sendTelegramMessage(chatId, `Error: ${error.message}`);
      }
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
 * DEBUG: Send text message in graph handler
 */
async function handleGraphCommandText(chatId, resource) {
  try {
    const history = await getResourceHistory(resource, 90);
    if (!history || history.length === 0) {
      await sendTelegramMessage(chatId, `No data for ${resource}`);
      return;
    }
    
    const chartUrl = generateChartUrl(resource, history);
    
    // Send as text message with URL instead of photo
    await sendTelegramMessage(chatId, `📊 ${resource.toUpperCase()}\nHistory: ${history.length} points\nChart: ${chartUrl}`);
  } catch (error) {
    console.error('[handleGraphCommandText] Error:', error.message);
    await sendTelegramMessage(chatId, `Error: ${error.message}`);
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
  console.log(`[sendTelegramPhoto] URL length: ${photoUrl.length}`);
  
  try {
    // Send photo using URL (QuickChart is public, Telegram should fetch it)
    const response = await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption: caption
      })
    });
    
    const result = await response.json();
    console.log(`[sendTelegramPhoto] Result: ok=${result.ok}`);
    
    if (!result.ok) {
      console.error('[sendTelegramPhoto] Error:', result.description);
      // Fallback: send chart URL as text
      await sendTelegramMessage(chatId, `📈 ${caption}\n
Chart: ${photoUrl}`);
    }
  } catch (error) {
    console.error('[sendTelegramPhoto] Error:', error.message);
    await sendTelegramMessage(chatId, `📊 Chart: ${photoUrl}`);
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