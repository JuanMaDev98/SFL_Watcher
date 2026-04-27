const express = require('express');
const router = express.Router();
const { getResourceHistory } = require('../services/priceFetcher');
const { generateChartUrl } = require('../services/chartService');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * POST /api/telegram/webhook
 * Receives Telegram updates - MUST return quickly to avoid timeout
 */
router.post('/webhook', async (req, res) => {
  // Step 1: Respond immediately to Telegram
  res.json({ ok: true });
  
  // Step 2: Parse message in background
  const { message } = req.body || {};
  if (!message || !message.text) return;
  
  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  
  console.log(`[webhook] ${command} from ${chatId}`);
  
  // Step 3: Handle command asynchronously
  if (command === '/start') {
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: '🦉 <b>SFL Watcher</b>\n\n/graph &lt;recurso&gt; - Ver gráfica\n/list - Recursos\n/alerts - Tus alertas', 
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
        text: '📊 &lt;b&gt;Comandos:&lt;/b&gt;\n/graph &lt;recurso&gt; - Gráfica\n/list - Recursos\n/alerts - Alertas', 
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
        text: '📋 &lt;b&gt;Recursos:&lt;/b&gt;\n' + resources.join(', '), 
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
          text: '❌ Usage: /graph &lt;resource&gt;\nExample: /graph yam', 
          parse_mode: 'HTML' 
        })
      }).catch(e => console.error('[graph] error:', e.message));
      return;
    }
    // Process graph in background
    processGraph(chatId, resource).catch(e => console.error('[graph] error:', e.message));
  }
  else if (command === '/debug') {
    processDebug(chatId).catch(e => console.error('[debug] error:', e.message));
  }
  else if (command === '/prices') {
    processPrices(chatId).catch(e => console.error('[prices] error:', e.message));
  }
});

/**
 * Process /graph command
 */
async function processGraph(chatId, resource) {
  try {
    const history = await getResourceHistory(resource, 365);
    
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
        text: `📊 ${resource.toUpperCase()}\n${history.length} puntos\n\n${chartUrl}`, 
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
 * Process /debug command
 */
async function processDebug(chatId) {
  try {
    const history = await getResourceHistory('yam', 365);
    const chartUrl = generateChartUrl('yam', history);
    
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: `🔧 Debug:\nHistory: ${history.length} puntos\nURL: ${chartUrl.length} chars`, 
        parse_mode: 'HTML' 
      })
    }).catch(e => console.error('[debug] send error:', e.message));
  } catch (error) {
    console.error('[debug] error:', error.message);
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
      fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: '❌ No hay precios disponibles.', 
          parse_mode: 'HTML' 
        })
      }).catch(e => console.error('[prices] send error:', e.message));
      return;
    }
    
    const text = prices.slice(0, 10).map(r => 
      `• ${r.resource}: ${r.current_price} SFL`
    ).join('\n');
    
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: `💰 &lt;b&gt;Precios:&lt;/b&gt;\n${text}`, 
        parse_mode: 'HTML' 
      })
    }).catch(e => console.error('[prices] send error:', e.message));
  } catch (error) {
    console.error('[prices] error:', error.message);
  }
}

/**
 * GET /api/telegram/test
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
    res.json({ ok: true });
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
