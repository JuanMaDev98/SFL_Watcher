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
  // Respond immediately to Telegram
  res.json({ ok: true });
  
  try {
    const { message } = req.body || {};
    if (!message || !message.text) return;
    
    const chatId = message.chat.id;
    const text = message.text.trim();
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    
    console.log(`[webhook] ${command} from ${chatId}`);
    
    // Simple commands - fire and forget with .catch()
    if (command === '/start') {
      fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '🦉 <b>SFL Watcher</b>\n\n/graph <recurso> - Ver gráfica\n/list - Recursos\n/alerts - Tus alertas', 
          parse_mode: 'HTML' 
        })
      }).catch(e => console.error('[start] error:', e.message));
    }
    else if (command === '/help') {
      fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '📊 <b>Comandos:</b>\n/graph <recurso> - Gráfica\n/list - Recursos\n/alerts - Alertas', 
          parse_mode: 'HTML' 
        })
      }).catch(e => console.error('[help] error:', e.message));
    }
    else if (command === '/list') {
      const resources = ['sunflower','potato','pumpkin','carrot','cabbage','beetroot','cauliflower','parsnip','radish','wheat','kale','apple','blueberry','orange','eggplant','corn','banana','soybean','grape','rice','olive','tomato','lemon','barley','rhubarb','zucchini','yam','broccoli','pepper','onion','turnip','artichoke'];
      fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '📋 <b>Recursos:</b>\n' + resources.join(', '), 
          parse_mode: 'HTML' 
        })
      }).catch(e => console.error('[list] error:', e.message));
    }
    else if (command === '/graph' || command === '/graph@sflwatcher_bot') {
      const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
      if (!resource) {
        fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            chat_id: chatId, 
            text: '❌ Usage: /graph <resource>\nExample: /graph yam', 
            parse_mode: 'HTML' 
          })
        }).catch(e => console.error('[graph] error:', e.message));
        return;
      }
      // Process async but don't await
      processGraphCommand(chatId, resource);
    }
    else if (command === '/debug') {
      processDebugCommand(chatId);
    }
    else if (command === '/prices') {
      processPricesCommand(chatId);
    }
  } catch (error) {
    console.error('[webhook] Error:', error.message);
  }
});

/**
 * Handle /graph command - works with ANY amount of data
 */
async function processGraphCommand(chatId, resource) {
  try {
    // Get ALL available history (no minimum requirement)
    const history = await getResourceHistory(resource, 365); // request up to 1 year
    
    if (!history || history.length === 0) {
      fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: `❌ No hay datos para ${resource}.\nEspera a que el cron collecte datos.`, 
          parse_mode: 'HTML' 
        })
      }).catch(e => console.error('[graph] send error:', e.message));
      return;
    }
    
    const chartUrl = generateChartUrl(resource, history);
    
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: `📊 ${resource.toUpperCase()}\n${history.length} puntos disponibles\n\nChart: ${chartUrl}`, 
        parse_mode: 'HTML' 
      })
    }).catch(e => console.error('[graph] send error:', e.message));
    
  } catch (error) {
    console.error('[graph] error:', error.message);
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: `Error: ${error.message}`, 
        parse_mode: 'HTML' 
      })
    }).catch(e => console.error('[graph] error:', e.message));
  }
}

/**
 * Handle /debug command
 */
async function processDebugCommand(chatId) {
  try {
    const history = await getResourceHistory('yam', 365);
    const chartUrl = generateChartUrl('yam', history);
    
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: `🔧 Debug:\nHistory: ${history.length} puntos\nURL length: ${chartUrl.length} chars`, 
        parse_mode: 'HTML' 
      })
    }).catch(e => console.error('[debug] send error:', e.message));
  } catch (error) {
    console.error('[debug] error:', error.message);
  }
}

/**
 * Handle /prices command - show all current prices
 */
async function processPricesCommand(chatId) {
  try {
    const response = await fetch(`${process.env.APP_URL || 'https://sfl-watcher.vercel.app'}/api/prices`);
    const data = await response.json();
    
    if (data.success && data.data) {
      const prices = data.data.slice(0, 10).map(r => 
        `• ${r.resource}: ${r.current_price} SFL`
      ).join('\n');
      
      fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: `💰 <b>Precios actuales:</b>\n${prices}\n\nUsa /list para ver todos los recursos.`, 
          parse_mode: 'HTML' 
        })
      }).catch(e => console.error('[prices] send error:', e.message));
    }
  } catch (error) {
    console.error('[prices] error:', error.message);
  }
}

/**
 * GET /api/telegram/test - Test endpoint
 */
router.get('/test', async (req, res) => {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: '1166287745', 
        text: '🐣 Test desde SFL Watcher API!', 
        parse_mode: 'HTML' 
      })
    });
    res.json({ ok: true, sent: true });
  } catch (error) {
    console.error('[test] Error:', error.message);
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
