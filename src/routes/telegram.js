const express = require('express');
const router = express.Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * POST /api/telegram/webhook
 */
router.post('/webhook', async (req, res) => {
  // ALWAYS respond first
  res.json({ ok: true });
  
  const { message } = req.body || {};
  const chatId = message?.chat?.id || '1166287745';
  const text = message?.text?.trim() || '';
  const parts = text.split(' ');
  const command = parts[0]?.toLowerCase() || '';
  
  console.log(`[webhook] cmd: ${command}, chatId: ${chatId}`);
  
  // Send a test message to confirm webhook is working
  fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: '1166287745', 
      text: `🔔 Webhook received: ${command || '(no command)'}
ChatID: ${chatId}`, 
      parse_mode: 'HTML' 
    })
  }).catch(e => console.error('[webhook test] Error:', e.message));
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
