const express = require('express');
const router = express.Router();
const { getResourceHistory } = require('../services/priceFetcher');
const { generateChartUrl } = require('../services/chartService');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * POST /api/telegram/webhook
 * Receives Telegram updates
 */
router.post('/webhook', async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.text) {
    return res.json({ ok: true });
  }
  
  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  
  console.log(`[webhook] ${command} from ${chatId}`);
  
  try {
    // Simple text commands - await each Telegram call
    if (command === '/start') {
      const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '🦉 <b>SFL Watcher</b>\n\n/graph <recurso> - Ver gráfica\n/list - Recursos\n/alerts - Tus alertas', 
          parse_mode: 'HTML' 
        })
      });
      const result = await resp.json();
      console.log('[start] sent:', result.ok);
      return res.json({ ok: true });
    }
    
    if (command === '/help') {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '📊 <b>Comandos:</b>\n/graph <recurso> - Gráfica\n/list - Recursos\n/alerts - Alertas', 
          parse_mode: 'HTML' 
        })
      });
      return res.json({ ok: true });
    }
    
    if (command === '/list') {
      const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '📋 <b>Recursos:</b>\n' + resources.join(', '), 
          parse_mode: 'HTML' 
        })
      });
      return res.json({ ok: true });
    }
    
    // Commands with DB access
    if (command === '/debug') {
      const history = await getResourceHistory('yam', 365);
      const chartUrl = generateChartUrl('yam', history);
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: `🔧 Debug:\nHistory: ${history.length} puntos\nURL len: ${chartUrl.length}`, 
          parse_mode: 'HTML' 
        })
      });
      return res.json({ ok: true });
    }
    
    if (command === '/graph' || command === '/graph@sflwatcher_bot') {
      const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
      
      if (!resource) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            chat_id: chatId, 
            text: '❌ Usage: /graph <resource>\nExample: /graph yam', 
            parse_mode: 'HTML' 
          })
        });
        return res.json({ ok: true });
      }
      
      const history = await getResourceHistory(resource, 365);
      
      if (!history || history.length === 0) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            chat_id: chatId, 
            text: `❌ No hay datos para ${resource}.\nEspera a que el cron collecte datos.`, 
            parse_mode: 'HTML' 
          })
        });
        return res.json({ ok: true });
      }
      
      const chartUrl = generateChartUrl(resource, history);
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: `📊 ${resource.toUpperCase()}\n${history.length} puntos\n\n${chartUrl}`, 
          parse_mode: 'HTML' 
        })
      });
      return res.json({ ok: true });
    }
    
    return res.json({ ok: true });
    
  } catch (error) {
    console.error('[webhook] Error:', error.message);
    // Try to send error to user
    try {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `Error: ${error.message}` })
      });
    } catch (e) {}
    return res.json({ ok: true });
  }
});

/**
 * GET /api/telegram/test
 */
router.get('/test', async (req, res) => {
  try {
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: '1166287745', 
        text: '🐣 Test desde SFL Watcher API!', 
        parse_mode: 'HTML' 
      })
    });
    const result = await resp.json();
    res.json({ ok: true, telegram: result.ok });
  } catch (error) {
    console.error('[test] Error:', error.message);
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
