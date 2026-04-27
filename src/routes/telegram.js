const express = require('express');
const router = express.Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * POST /api/telegram/webhook
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
    if (command === '/start') {
      console.log('[start] Sending welcome message...');
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
      console.log('[start] Result:', JSON.stringify(result));
      return res.json({ ok: true });
    }
    
    if (command === '/help') {
      const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
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
      const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
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
    
    // Commands that need DB - use a separate endpoint pattern
    if (command === '/debug' || command === '/graph' || command === '/graph@sflwatcher_bot') {
      // Redirect to a background handler via separate API call
      // This allows Vercel to complete the webhook response quickly
      const resource = command.startsWith('/graph') ? (parts[1] || 'yam') : 'yam';
      
      // Fire and forget to background endpoint
      const bgUrl = `${process.env.APP_URL || 'https://sfl-watcher.vercel.app'}/api/telegram/process?chatId=${chatId}&cmd=${command}&resource=${resource}`;
      fetch(bgUrl).catch(e => console.error('[bg] error:', e.message));
      
      return res.json({ ok: true });
    }
    
    return res.json({ ok: true });
    
  } catch (error) {
    console.error('[webhook] Error:', error.message);
    return res.json({ ok: true });
  }
});

/**
 * GET /api/telegram/process
 * Background processor for DB-heavy commands
 */
router.get('/process', async (req, res) => {
  const { chatId, cmd, resource } = req.query;
  
  console.log(`[process] ${cmd} for ${chatId}, resource: ${resource}`);
  
  try {
    if (cmd === '/debug') {
      // Simple test with mock data
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '🔧 Debug: Bot is working!\nDB check pending...', 
          parse_mode: 'HTML' 
        })
      });
    }
    
    if (cmd === '/graph') {
      // Import here to avoid issues
      const { getResourceHistory } = require('../services/priceFetcher');
      const { generateChartUrl } = require('../services/chartService');
      
      const history = await getResourceHistory(resource || 'yam', 365);
      
      if (!history || history.length === 0) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            chat_id: chatId, 
            text: `❌ No hay datos para ${resource}.`, 
            parse_mode: 'HTML' 
          })
        });
        return res.json({ ok: true });
      }
      
      const chartUrl = generateChartUrl(resource || 'yam', history);
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: `📊 ${(resource || 'yam').toUpperCase()}\n${history.length} puntos\n\n${chartUrl}`, 
          parse_mode: 'HTML' 
        })
      });
    }
    
  } catch (error) {
    console.error('[process] Error:', error.message);
    try {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `Error: ${error.message}` })
      });
    } catch (e) {}
  }
  
  res.json({ ok: true });
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
