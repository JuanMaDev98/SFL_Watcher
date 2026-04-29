const express = require('express');
const router = express.Router();

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Fire-and-forget Telegram sender (for simple responses)
 */
function sendTelegram(chatId, text) {
  setImmediate(() => {
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    }).catch(e => console.error('Telegram error:', e.message));
  });
}

/**
 * Awaited Telegram sender (waits for response before Vercel cuts off)
 */
async function sendTelegramAwait(chatId, text) {
  try {
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    return resp.ok;
  } catch (e) {
    console.error('Telegram error:', e.message);
    return false;
  }
}

/**
 * Send photo with caption using sendPhoto API
 */
async function sendPhoto(chatId, photoUrl, caption) {
  try {
    if (photoUrl.startsWith('data:')) {
      const mimeMatch = photoUrl.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/svg+xml';
      const base64 = photoUrl.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const blob = new Blob([buffer], { type: mime });

      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', blob, 'chart.png');
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');

      const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: 'POST', body: form });
      const data = await resp.json();
      if (!resp.ok) console.error('[sendPhoto] Telegram error:', data);
      return resp.ok;
    } else {
      const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' })
      });
      const data = await resp.json();
      if (!resp.ok) console.error('[sendPhoto] Telegram error:', data);
      return resp.ok;
    }
  } catch (e) {
    console.error('[sendPhoto] error:', e.message);
    return false;
  }
}

// ============================================


// ============================================
// SUBSCRIPTION GATING
// ============================================
const { getSubscriptionStatus, getUserWallet, ensureSubscription } = require('../services/subscriptionService');

async function checkSubscription(chatId) {
  // First: ensure user has a subscription record (creates trial if new)
  await ensureSubscription(chatId.toString());
  
  // Check subscription status
  const sub = await getSubscriptionStatus(chatId.toString());
  
  // Trial users can use everything without wallet
  if (sub.status === 'trial') {
    return null; // Allow access
  }
  
  // Trial expired: wallet + payment required
  if (sub.status === 'trial_expired') {
    return 'Wallet Required:\\n\\nYour 7-day trial has ended.\\nConnect wallet to subscribe:\\n/connectwallet <your_address>\\n\\nExample: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687';
  }
  
  // Expired subscription: needs payment
  if (sub.status === 'expired') {
    return 'Subscription Expired:\\n\\nYour subscription has ended.\\nExtend: /subscribe';
  }
  
  // Active subscription: check wallet exists
  const wallet = await getUserWallet(chatId.toString());
  if (!wallet) {
    return 'Wallet Required:\\n\\nConnect your wallet to use the bot:\\n/connectwallet <your_address>\\n\\nExample: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687';
  }
  
  return null; // OK - user is subscribed with wallet
}



// WEBHOOK HANDLER
// ============================================
router.post('/webhook', async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.text) {
    res.json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

  console.log(`[webhook] ${command} from ${chatId}`);

  if (command === '/start') {
    await sendTelegramAwait(chatId,
      '🦉 <b>SFL Watcher</b>\n\n' +
      '📊 <b>Prices &amp; Charts:</b>\n' +
      '/price &lt;resource&gt; • /priceall • /graph &lt;resource&gt; • /list\n\n' +
      '🔔 <b>Alerts:</b>\n' +
      '/alerts • /alert &lt;res&gt; &lt;rise%&gt; &lt;fall%&gt; • /alertall &lt;rise%&gt; &lt;fall%&gt;\n' +
      '/removealert &lt;resource&gt; • /removeallalerts\n\n' +
      '💳 <b>Subscription:</b>\n' +
      '/connectwallet • /subscribe • /status • /pay\n\n' +
      'Type /help for more details.'
    );
  }
  else if (command === '/help') {
    await sendTelegramAwait(chatId,
      '📊 <b>SFL Watcher - Help</b>\n\n' +

      '━━━━━━━━━━━━━━━━━━━━\n' +
      '💳 <b>HOW TO SUBSCRIBE</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '1️⃣ /connectwallet &lt;your_wallet_address&gt;\n' +
      '   Link your wallet to your account\n\n' +
      '2️⃣ /subscribe\n' +
      '   Get payment address &amp; amount in FLOWER\n\n' +
      '3️⃣ Send FLOWER from YOUR wallet to the address shown\n\n' +
      '4️⃣ /pay\n' +
      '   Bot verifies payment and activates 30 days\n\n' +
      '💰 Cost: <b>$1 USD / 30 days</b>\n' +
      '⚠️ You MUST send from your linked wallet\n\n' +

      '━━━━━━━━━━━━━━━━━━━━\n' +
      '📈 <b>PRICE COMMANDS</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '/price &lt;resource&gt; - Price info (e.g. /price wood)\n' +
      '/priceall - All 60 resources prices\n' +
      '/graph &lt;resource&gt; - Chart image (e.g. /graph stone)\n' +
      '/list - List all 60 resources\n\n' +

      '━━━━━━━━━━━━━━━━━━━━\n' +
      '🔔 <b>ALERT COMMANDS</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '/alerts - View all your active alerts\n' +
      '/alert &lt;res&gt; &lt;high%&gt; &lt;low%&gt; - Set alert for ONE resource\n' +
      '/alertall &lt;high%&gt; &lt;low%&gt; - Set alerts for ALL resources\n' +
      '/alertall &lt;high%&gt; &lt;low%&gt; keep - Same but skips existing alerts\n' +
      '/removealert &lt;resource&gt; - Remove one resource alert\n' +
      '/removeallalerts - Remove ALL alerts\n\n' +
      '<b>Examples:</b>\n' +
      '/alert yam 10 15 → yam at +10% (rise) OR -15% (fall)\n' +
      '/alertall 20 15 → ALL resources at +20% OR -15%\n' +
      '/alertall 20 15 keep → Same, keeps existing alerts\n\n' +

      '━━━━━━━━━━━━━━━━━━━━\n' +
      '👛 <b>WALLET COMMANDS</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '/connectwallet &lt;address&gt; - Link your wallet\n' +
      '/wallet - See your linked wallet\n' +
      '/status - Days remaining &amp; subscription status\n' +
      '/subscribe - Get payment info\n' +
      '/pay - Verify FLOWER payment\n\n' +

      '━━━━━━━━━━━━━━━━━━━━\n' +
      '📱 <b>NTFY PHONE NOTIFICATIONS</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '/ntfy - Setup NTFY app for phone notifications\n' +
      '/ntfytest - Send test notification to phone\n' +
      '/ntfygraph on/off - Enable/disable graph images in NTFY\n' +
      '/ntfystatus - Check your NTFY settings\n\n' +
      '📋 <b>Note:</b> NTFY notifications are public. DO NOT share your topic.\n'
    );
  }
  else if (command === '/list') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const resources = ['apple','artichoke','banana','barley','beetroot','blueberry','broccoli','bumpkin emblem','cabbage','carrot','cauliflower','celestine','chewed bone','corn','crimstone','dewberry','duskberry','egg','eggplant','feather','frost pebble','goblin emblem','gold','grape','heart leaf','honey','iron','kale','leather','lemon','lunara','merino wool','milk','moonfur','nightshade emblem','obsidian','olive','onion','orange','parsnip','pepper','potato','pumpkin','radish','rhubarb','ribbon','rice','ruffroot','soybean','stone','sunflorian emblem','sunflower','tomato','turnip','wheat','wild grass','wood','wool','yam','zucchini'];
    await sendTelegramAwait(chatId, '📋 <b>60 Resources:</b>\n' + resources.join(', '));
  }
  else if (command === '/price') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /price &lt;resource&gt;\nExample: /price yam');
      res.json({ ok: true });
      return;
    }
    await processPriceSimple(chatId, resource);
  }
  else if (command === '/priceall') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processAllPrices(chatId);
  }
  else if (command === '/graph' || command === '/graph@sflwatcher_bot') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /graph &lt;resource&gt;\nExample: /graph yam');
      res.json({ ok: true });
      return;
    }
    await processGraph(chatId, resource);
  }
  else if (command === '/debug') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processDebug(chatId);
  }
  else if (command === '/alert' || command === '/alerts') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const rest = parts.slice(1).join(' ');
    await processAlertConfig(chatId, rest, parts[0] === '/alerts');
  }
  else if (command === '/removealert') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    await processRemoveAlert(chatId, resource);
  }
  else if (command === '/alertall' || command === '/setall') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const rest = parts.slice(1).join(' ');
    await processSetAllAlerts(chatId, rest);
  }
  else if (command === '/removeallalerts') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processRemoveAllAlerts(chatId);
  }
  else if (command === '/connectwallet') {
    const wallet = parts.length > 1 ? parts[1].trim() : null;
    await processConnectWallet(chatId, wallet);
  }
  else if (command === '/wallet') {
    await processShowWallet(chatId);
  }
  else if (command === '/subscribe') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processSubscribe(chatId);
  }
  else if (command === '/ntfy') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processNtfy(chatId);
  }
  else if (command === '/ntfytest') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processNtfyTest(chatId);
  }
  else if (command === '/ntfygraph') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processNtfyGraph(chatId, parts);
  }
  else if (command === '/ntfytestimg') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processNtfyTestImg(chatId);
  }
  else if (command === '/ntfystatus') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processNtfyStatus(chatId);
  }
  else if (command === '/status') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processStatus(chatId);
  }
  else if (command === '/pay') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processPay(chatId);
  }
  else {
    await sendTelegramAwait(chatId, '❌ Unknown command.\nUse /help to see commands.');
  }

  res.json({ ok: true });
});

// ============================================
// COMMAND PROCESSORS
// ============================================

async function processPriceSimple(chatId, resource) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const history = await getResourceHistory(resource, 90);

    if (!history || history.length === 0) {
      await sendTelegramAwait(chatId, `❌ No data for ${resource}.\nWait for cron to collect data.`);
      return;
    }

    const prices = history.map(h => parseFloat(h.price));
    const current = prices[prices.length - 1];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const pct = ((current - avg) / avg * 100).toFixed(2);

    const emoji = pct >= 0 ? '📈' : '📉';
    const sign = pct >= 0 ? '+' : '';

    await sendTelegramAwait(chatId,
      `<b>${resource.toUpperCase()}</b>\n\n` +
      `💰 Current: <code>${current.toFixed(6)}</code>\n` +
      `📊 Min: ${min.toFixed(6)} | Max: ${max.toFixed(6)}\n` +
      `📐 Avg: ${avg.toFixed(6)}\n` +
      `${emoji} vs Avg: ${sign}${pct}%\n\n` +
      `📈 Data Points: ${history.length}`
    );
  } catch (error) {
    console.error('[price] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processAllPrices(chatId) {
  try {
    const { getAllPrices } = require('../services/priceFetcher');
    const prices = await getAllPrices();

    if (!prices || prices.length === 0) {
      await sendTelegramAwait(chatId, '❌ No prices available.');
      return;
    }

    const lines = prices.map(r => {
      const pct = r.percent_vs_avg || 0;
      const sign = pct >= 0 ? '+' : '';
      return `• ${r.resource}: ${parseFloat(r.current_price).toFixed(4)} (${sign}${pct.toFixed(1)}%)`;
    });

    await sendTelegramAwait(chatId, '💰 <b>Current Prices:</b>\n' + lines.join('\n'));
  } catch (error) {
    console.error('[priceall] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processGraph(chatId, resource) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartBuffer, calculateStats } = require('../services/chartService');

    const history = await getResourceHistory(resource, 90);

    if (!history || history.length < 2) {
      await sendTelegramAwait(chatId, `❌ Not enough data for ${resource} (${history?.length || 0} points). Wait for cron to collect more data.`);
      return;
    }

    const stats = calculateStats(history);
    const emoji = stats.pct >= 0 ? '📈' : '📉';
    const sign = stats.pct >= 0 ? '+' : '';

    const caption =
      `<b>${resource.toUpperCase()}</b>\n\n` +
      `💰 Current: <code>${stats.current.toFixed(6)}</code>\n` +
      `📊 Min: ${stats.min.toFixed(6)} | Max: ${stats.max.toFixed(6)}\n` +
      `📐 Avg: ${stats.avg.toFixed(6)}\n` +
      `${emoji} vs Avg: ${sign}${stats.pct}%\n\n` +
      `📈 Data Points: ${history.length}`;

    const { generateChartDataUrl } = require('../services/chartService');
    const { chartConfig } = generateChartDataUrl(resource, history);
    const arrayBuffer = await generateChartBuffer(chartConfig);
    
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('QuickChart returned empty buffer');
    }
    
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const chartUrl = `data:image/png;base64,${base64}`;
    
    // Validate data URL isn't too large (Telegram has ~10MB limit for photos)
    if (chartUrl.length > 20 * 1024 * 1024) {
      throw new Error('Chart image too large to send');
    }
    
    const sent = await sendPhoto(chatId, chartUrl, caption);
    if (!sent) {
      console.error('[graph] sendPhoto failed, attempting sendDocument fallback');
      const resp = await fetch(`${TELEGRAM_API}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, document: chartUrl, caption, parse_mode: 'HTML' })
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[graph] sendDocument fallback also failed:', data);
        await sendTelegramAwait(chatId, `❌ Chart failed to send. Try /price ${resource} for text data.`);
      }
    }
  } catch (error) {
    console.error('[graph] error:', error.message);
    await sendTelegramAwait(chatId, `❌ Error: ${error.message}`);
  }
}

async function processDebug(chatId) {
  try {
    const { getResourceHistory } = require('../services/priceFetcher');
    const { generateChartUrl } = require('../services/chartService');
    const history = await getResourceHistory('yam', 90);
    const chartUrl = generateChartUrl('yam', history);
    await sendTelegramAwait(chatId, `🔧 Debug:\nHistory: ${history.length} points\nURL: ${chartUrl.length} chars`);
  } catch (error) {
    console.error('[debug] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processAlertConfig(chatId, input, isListMode) {
  const supabase = require('../lib/supabase');

  try {
    if (isListMode || !input.trim()) {
      const { data: alerts, error } = await supabase
        .from('user_alerts')
        .select('*')
        .eq('user_id', chatId)
        .eq('enabled', true)
        .order('resource');

      if (error) throw error;

      if (!alerts || alerts.length === 0) {
        await sendTelegramAwait(chatId,
          '🔔 <b>Your Alerts</b>\n\nNo alerts configured.\n' +
          'Use /alert &lt;resource&gt; &lt;high%&gt; &lt;low%&gt; to create one.\n' +
          'Example: /alert yam +10 -15'
        );
        return;
      }

      const lines = alerts.map(a => {
        const pctSign = a.threshold_high >= 0 ? '+' : '';
        const lowSign = a.threshold_low >= 0 ? '+' : '';
        return `• <b>${a.resource}</b>: ▲${pctSign}${a.threshold_high}% | ▼${lowSign}${a.threshold_low}%`;
      });

      await sendTelegramAwait(chatId,
        '🔔 <b>Your Alerts</b>\n\n' + lines.join('\n') + '\n\n' +
        'To add/modify: /alert &lt;resource&gt; &lt;high%&gt; &lt;low%&gt;\n' +
        'To remove: /removealert &lt;resource&gt;'
      );
      return;
    }

    const tokens = input.trim().split(/\s+/);
    if (tokens.length < 3) {
      await sendTelegramAwait(chatId,
        '❌ Usage: /alert &lt;resource&gt; &lt;high%&gt; &lt;low%&gt;\n' +
        'Example: /alert yam 10 15\n' +
        '→ Alert when yam is +10% above avg OR -15% below avg\n' +
        '(First number = rise %, Second number = fall % - no signs needed)'
      );
      return;
    }

    const resource = tokens[0].toLowerCase();
    const rawHigh = parseFloat(tokens[1]);
    const rawLow = parseFloat(tokens[2]);

    if (isNaN(rawHigh) || isNaN(rawLow)) {
      await sendTelegramAwait(chatId, '❌ Usage: /alert &lt;resource&gt; &lt;high%&gt; &lt;low%&gt;\nExample: /alert yam 10 15');
      return;
    }

    // First number = rise threshold (positive), second = fall threshold (will be negated)
    const thresholdHigh = Math.abs(rawHigh);
    const thresholdLow = -Math.abs(rawLow);

    const { data: existing } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', chatId)
      .eq('resource', resource)
      .eq('enabled', true)
      .single();

    let updated;
    if (existing) {
      const { error } = await supabase
        .from('user_alerts')
        .update({
          alert_type: 'dual',
          threshold_high: thresholdHigh,
          threshold_low: thresholdLow,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) throw error;
      updated = true;
    } else {
      const { error } = await supabase
        .from('user_alerts')
        .insert({
          user_id: chatId,
          resource,
          alert_type: 'dual',
          threshold_high: thresholdHigh,
          threshold_low: thresholdLow,
          enabled: true
        });

      if (error) throw error;
      updated = false;
    }

    const action = updated ? 'Updated' : 'Created';

    await sendTelegramAwait(chatId,
      `✅ ${action} alert for <b>${resource}</b>\n` +
      `▲ Rise: +${thresholdHigh}% | ▼ Fall: ${thresholdLow}%\n\n` +
      `You'll be notified when price crosses thresholds.`
    );

  } catch (error) {
    console.error('[alert] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processRemoveAlert(chatId, resource) {
  const supabase = require('../lib/supabase');

  try {
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /removealert &lt;resource&gt;\nExample: /removealert yam');
      return;
    }

    const { error } = await supabase
      .from('user_alerts')
      .delete()
      .eq('user_id', chatId)
      .eq('resource', resource.toLowerCase());

    if (error) throw error;
    await sendTelegramAwait(chatId, `🗑️ Alert for <b>${resource}</b> permanently deleted.`);

  } catch (error) {
    console.error('[removealert] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processSetAllAlerts(chatId, input) {
  const supabase = require('../lib/supabase');

  try {
    const tokens = input.trim().split(/\s+/);
    if (tokens.length < 2) {
      await sendTelegramAwait(chatId,
        '❌ Usage: /alertall &lt;high%&gt; &lt;low%&gt; [keep]\n' +
        'Example: /alertall 20 15\n' +
        '→ Set alerts for ALL 60 resources at +20% (rise) OR -15% (fall)\n\n' +
        'Add "keep" to skip resources that already have alerts:\n' +
        '/alertall 20 15 keep\n' +
        '→ Same as above, but preserves existing alerts.'
      );
      return;
    }

    const thresholdHigh = Math.abs(parseFloat(tokens[0].replace(',', '.')));
    const thresholdLow = -Math.abs(parseFloat(tokens[1].replace(',', '.')));
    const keepExisting = tokens[2]?.toLowerCase() === 'keep';

    if (isNaN(thresholdHigh) || isNaN(thresholdLow)) {
      await sendTelegramAwait(chatId, '❌ Invalid percentages. Use numbers like 20 or 15');
      return;
    }

    // Use hardcoded list of all 60 resources
    const allResources = ['apple','artichoke','banana','barley','beetroot','blueberry','broccoli','bumpkin emblem','cabbage','carrot','cauliflower','celestine','chewed bone','corn','crimstone','dewberry','duskberry','egg','eggplant','feather','frost pebble','goblin emblem','gold','grape','heart leaf','honey','iron','kale','leather','lemon','lunara','merino wool','milk','moonfur','nightshade emblem','obsidian','olive','onion','orange','parsnip','pepper','potato','pumpkin','radish','rhubarb','ribbon','rice','ruffroot','soybean','stone','sunflorian emblem','sunflower','tomato','turnip','wheat','wild grass','wood','wool','yam','zucchini'];

    const now = new Date().toISOString();

    // OPTIMIZATION: Batch query - get all existing alerts for this user in ONE query
    const { data: allExisting } = await supabase
      .from('user_alerts')
      .select('id, resource')
      .eq('user_id', chatId)
      .eq('enabled', true);

    const existingMap = new Map();
    (allExisting || []).forEach(a => existingMap.set(a.resource, a.id));

    // Separate resources into to-update and to-insert
    const toUpdate = [];
    const toInsert = [];

    for (const resource of allResources) {
      if (existingMap.has(resource)) {
        if (!keepExisting) {
          toUpdate.push({ id: existingMap.get(resource), resource });
        }
      } else {
        toInsert.push(resource);
      }
    }

    // Batch update existing alerts
    if (toUpdate.length > 0) {
      const updatePromises = toUpdate.map(({ id }) =>
        supabase
          .from('user_alerts')
          .update({
            threshold_high: thresholdHigh,
            threshold_low: thresholdLow,
            updated_at: now,
            last_notified_rise_at: null,
            last_notified_fall_at: null
          })
          .eq('id', id)
      );
      await Promise.all(updatePromises);
    }

    // Batch insert new alerts (in chunks of 50 to avoid payload limits)
    const chunkSize = 50;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const insertData = chunk.map(resource => ({
        user_id: chatId,
        resource,
        alert_type: 'dual',
        threshold_high: thresholdHigh,
        threshold_low: thresholdLow,
        enabled: true,
        created_at: now,
        updated_at: now
      }));
      await supabase.from('user_alerts').insert(insertData);
    }

    const created = toInsert.length;
    const updated = toUpdate.length;
    const skipped = keepExisting ? allResources.length - created - updated : 0;

    let response = '✅ <b>Alerts Set for All Resources</b>\n\n';
    response += `Resources: <b>${allResources.length}</b>\n`;
    response += `Created: <b>${created}</b> | Updated: <b>${updated}</b>`;
    if (keepExisting) response += ` | Skipped: <b>${skipped}</b>`;
    response += `\nThresholds: ▲ +${thresholdHigh}% | ▼ ${thresholdLow}%\n\n`;
    response += `Use /alerts to view your alerts.`;

    await sendTelegramAwait(chatId, response);

  } catch (error) {
    console.error('[alertall] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processRemoveAllAlerts(chatId) {
  const supabase = require('../lib/supabase');

  try {
    const { error } = await supabase
      .from('user_alerts')
      .delete()
      .eq('user_id', chatId);

    if (error) throw error;

    await sendTelegramAwait(chatId, '🗑️ <b>All Alerts Permanently Deleted</b>\n\nAll your price alerts have been removed from the database.');

  } catch (error) {
    console.error('[removeallalerts] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

// ============================================
// WALLET & SUBSCRIPTION COMMANDS
// ============================================

async function processConnectWallet(chatId, walletAddress) {
  const { connectWallet, ensureSubscription } = require('../services/subscriptionService');

  try {
    // Ensure subscription record first (creates trial if new)
    await ensureSubscription(chatId.toString());

    if (!walletAddress) {
      await sendTelegramAwait(chatId,
        '👛 <b>Connect Your Wallet</b>\n\n' +
        'Usage: /connectwallet &lt;your_eth_address&gt;\n\n' +
        'Example:\n' +
        '/connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687\n\n' +
        'This wallet will be used for subscription payments.'
      );
      return;
    }

    // Remove 0x prefix if provided without it - actually keep it, validate properly
    await connectWallet(chatId.toString(), walletAddress);

    await sendTelegramAwait(chatId,
      `✅ <b>Wallet Connected!</b>\n\n` +
      `Address: <code>${walletAddress.toLowerCase()}</code>\n\n` +
      `Now use /subscribe to see payment details.`
    );

  } catch (error) {
    console.error('[connectwallet] error:', error.message);
    if (error.message.includes('Invalid Ethereum')) {
      await sendTelegramAwait(chatId, '❌ Invalid Ethereum address format.\n\nExample: 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687');
    } else {
      await sendTelegramAwait(chatId, `Error: ${error.message}`);
    }
  }
}

async function processShowWallet(chatId) {
  const { getUserWallet } = require('../services/subscriptionService');

  try {
    const wallet = await getUserWallet(chatId.toString());

    if (!wallet) {
      await sendTelegramAwait(chatId,
        '👛 <b>Wallet Status</b>\n\n' +
        'No wallet connected.\n\n' +
        'Use /connectwallet &lt;address&gt; to link your wallet.'
      );
      return;
    }

    await sendTelegramAwait(chatId,
      `👛 <b>Wallet Connected</b>\n\n` +
      `<code>${wallet}</code>\n\n` +
      `Use /subscribe to pay.`
    );

  } catch (error) {
    console.error('[wallet] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processSubscribe(chatId) {
  const { ensureSubscription, getSubscriptionCost, PAYMENT_ADDRESS, getUserWallet } = require('../services/subscriptionService');

  try {
    // Ensure subscription record (creates trial if new)
    const sub = await ensureSubscription(chatId.toString());
    const cost = await getSubscriptionCost();
    const userWallet = await getUserWallet(chatId.toString());

    const lines = [
      '💳 <b>Subscribe to SFL Watcher Pro</b>',
      '',
      `📅 <b>Status:</b> ${sub.status.toUpperCase()}`
    ];

    if (sub.days_remaining !== undefined) {
      lines.push(`⏰ ${sub.days_remaining} days remaining`);
    }

    if (!userWallet) {
      lines.push('');
      lines.push('⚠️ <b>No wallet connected!</b>');
      lines.push('Use /connectwallet &lt;address&gt; first.');
    } else {
      lines.push('');
      lines.push('<b>💰 Payment:</b>');
      lines.push('Send FLOWER from your wallet to:');
      lines.push(`<code>${PAYMENT_ADDRESS}</code>`);

      if (cost) {
        lines.push('');
        lines.push(`📦 Amount: <b>~${cost.flower_amount} FLOWER</b>`);
        lines.push(`   (≈ $${cost.usd} USD at $${cost.flower_price_usd.toFixed(4)}/FLOWER)`);
      }

      lines.push('');
      lines.push('After sending, use /pay to verify payment.');
    }

    lines.push('');
    lines.push('<b>📋 How it works:</b>');
    lines.push('1. /connectwallet &lt;your_address&gt;');
    lines.push('2. /subscribe to see amount');
    lines.push('3. Send FLOWER from YOUR wallet');
    lines.push('4. /pay to activate');

    await sendTelegramAwait(chatId, lines.join('\n'));

  } catch (error) {
    console.error('[subscribe] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processStatus(chatId) {
  const { getSubscriptionStatus, getUserWallet } = require('../services/subscriptionService');

  try {
    const sub = await getSubscriptionStatus(chatId.toString());
    const wallet = await getUserWallet(chatId.toString());

    let message;
    if (sub.status === 'new' || sub.status === 'trial') {
      message = `✅ <b>Trial Active</b>\n\n⏰ ${sub.days_remaining} days left\n\nUse /subscribe to pay and extend.`;
    } else if (sub.status === 'trial_expired') {
      message = `⏳ <b>Trial Expired</b>\n\nYour free trial ended.\n\nUse /subscribe to pay.`;
    } else if (sub.status === 'active') {
      message = `✅ <b>Subscription Active</b>\n\n📅 ${sub.days_remaining} days remaining\n\nUse /subscribe to extend.`;
    } else if (sub.status === 'expired') {
      message = `⏳ <b>Subscription Expired</b>\n\nUse /subscribe to renew.`;
    } else {
      message = `❓ Use /subscribe to start.`;
    }

    await sendTelegramAwait(chatId, message);

  } catch (error) {
    console.error('[status] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processNtfy(chatId) {
  const { getUserNtfyTopic, getNtfyInstructions } = require('../services/ntfyService');
  const { ensureSubscription, updateNtfySettings, getNtfySettings } = require('../services/subscriptionService');
  
  // Ensure subscription exists and enable NTFY
  await ensureSubscription(chatId.toString());
  await updateNtfySettings(chatId.toString(), { ntfyEnabled: true });
  
  const topic = getUserNtfyTopic(chatId.toString());
  const settings = await getNtfySettings(chatId.toString());
  
  const instructions = [
    '📱 <b>NTFY Setup - Complete!</b>',
    '',
    `Your topic: <code>${topic}</code>`,
    '',
    '1. Open NTFY app',
    `2. Tap "Subscribe" and enter: <code>${topic}</code>`,
    '3. Done! Alerts will arrive as phone notifications.',
    '',
    '📊 Graph images in NTFY: <b>' + (settings.ntfyGraphEnabled ? 'ON' : 'OFF') + '</b>',
    'Change with: /ntfygraph on/off',
    '',
    '🔔 Commands:',
    '/ntfytest - Send test notification',
    '/ntfygraph on/off - Toggle graph images',
    '/ntfystatus - Check settings'
  ].join('\n');
  
  await sendTelegramAwait(chatId, instructions);
}

async function processNtfyTest(chatId) {
  const { getUserNtfyTopic, sendNtfyNotification } = require('../services/ntfyService');
  
  const topic = getUserNtfyTopic(chatId.toString());
  
  const message = [
    'NTFY TEST',
    '',
    'This is a test notification from SFL Watcher.',
    'If you see this, your NTFY app is configured correctly!',
    '',
    'Time: ' + new Date().toISOString()
  ].join('\n');
  
  const sent = await sendNtfyNotification(topic, message, {
    title: 'SFL Watcher Test',
    tags: 'test,bell'
  });
  
  if (sent) {
    await sendTelegramAwait(chatId, '✅ Test notification sent!\n\nCheck your NTFY app. If you don\'t see it within a few seconds, check your subscription to the topic.');
  } else {
    await sendTelegramAwait(chatId, '❌ Failed to send notification. Check that you\'re subscribed to your topic in NTFY app.');
  }
}

async function processNtfyTestImg(chatId) {
  const { getUserNtfyTopic, sendNtfyNotificationWithImage } = require('../services/ntfyService');
  const { getResourceStats } = require('../services/alertEngine');
  
  const topic = getUserNtfyTopic(chatId.toString());
  
  // Get a resource with data for testing
  const resource = 'cabbage';
  const stats = await getResourceStats(resource);
  
  if (!stats) {
    await sendTelegramAwait(chatId, '❌ Could not get price stats for testing.');
    return;
  }
  
  const currentPct = parseFloat(stats.percent_vs_avg.toFixed(2));
  
  // Get history for chart
  const { data: history } = await supabase
    .from('price_snapshots')
    .select('price, created_at')
    .eq('resource', resource)
    .order('created_at', { ascending: false })
    .limit(30);
  
  if (!history || history.length < 2) {
    await sendTelegramAwait(chatId, '❌ Not enough history for chart.');
    return;
  }
  
  // Generate chart
  const { generateChartDataUrl, generateChartBuffer } = require('../services/chartService');
  const { chartConfig } = generateChartDataUrl(resource, history.reverse());
  const arrayBuffer = await generateChartBuffer(chartConfig);
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString('base64');
  const chartDataUrl = `data:image/png;base64,${base64}`;
  
  const message = [
    'NTFY IMAGE TEST',
    '',
    `Resource: ${resource}`,
    `Change: ${currentPct > 0 ? '+' : ''}${currentPct}%`,
    '',
    'Time: ' + new Date().toISOString()
  ].join('\n');
  
  console.log(`[NTFY-TEST-IMG] Sending to topic: ${topic}`);
  console.log(`[NTFY-TEST-IMG] Chart size: ${chartDataUrl.length} chars`);
  
  const sent = await sendNtfyNotificationWithImage(topic, message, chartDataUrl, {
    title: 'NTFY Image Test',
    tags: 'test,camera'
  });
  
  if (sent) {
    await sendTelegramAwait(chatId, '✅ Image notification sent!\n\nCheck your NTFY app for the notification with chart image.');
  } else {
    await sendTelegramAwait(chatId, '❌ Failed to send image notification. Check logs.');
  }
}

async function processNtfyGraph(chatId, parts) {
  const { getNtfySettings, updateNtfySettings } = require('../services/subscriptionService');
  
  // First ensure subscription exists
  await require('../services/subscriptionService').ensureSubscription(chatId.toString());
  
  const current = await getNtfySettings(chatId.toString());
  
  // If no argument, show current status
  if (parts.length < 2) {
    await sendTelegramAwait(chatId, 
      '📊 <b>NTFY Graph Setting</b>\n\n' +
      `Current: <b>${current.ntfyGraphEnabled ? 'ON' : 'OFF'}</b>\n\n` +
      'Usage: /ntfygraph on - Enable graph images in notifications\n' +
      'Usage: /ntfygraph off - Disable graph images (text only)'
    );
    return;
  }
  
  const arg = parts[1].toLowerCase();
  let newValue;
  
  if (arg === 'on' || arg === 'true' || arg === '1') {
    newValue = true;
  } else if (arg === 'off' || arg === 'false' || arg === '0') {
    newValue = false;
  } else {
    await sendTelegramAwait(chatId, '❌ Invalid value. Use: /ntfygraph on or /ntfygraph off');
    return;
  }
  
  await updateNtfySettings(chatId.toString(), { ntfyGraphEnabled: newValue });
  
  await sendTelegramAwait(chatId, 
    `✅ NTFY graph notifications: <b>${newValue ? 'ENABLED' : 'DISABLED'}</b>\n\n` +
    (newValue ? '📊 Graphs will be attached to NTFY notifications.' : '📝 Only text notifications will be sent.')
  );
}

async function processNtfyStatus(chatId) {
  const { getNtfySettings } = require('../services/subscriptionService');
  const { getUserNtfyTopic, getNtfyInstructions } = require('../services/ntfyService');
  
  // First ensure subscription exists
  await require('../services/subscriptionService').ensureSubscription(chatId.toString());
  
  const settings = await getNtfySettings(chatId.toString());
  const topic = getUserNtfyTopic(chatId.toString());
  
  await sendTelegramAwait(chatId,
    '📱 <b>NTFY Status</b>\n\n' +
    `Topic: <code>${topic}</code>\n` +
    `NTFY enabled: <b>${settings.ntfyEnabled ? 'YES' : 'NO'}</b>\n` +
    `Graph images: <b>${settings.ntfyGraphEnabled ? 'ON' : 'OFF'}</b>\n\n` +
    'Commands:\n' +
    '/ntfy - Setup instructions\n' +
    '/ntfytest - Send test notification\n' +
    '/ntfygraph on/off - Toggle graph images\n' +
    '/ntfystatus - This message'
  );
}

async function processPay(chatId) {
  const { verifyWalletPayment, getSubscriptionCost, addSubscriptionDays, recordPayment, isTxHashUsed, getUserWallet, PAYMENT_ADDRESS } = require('../services/subscriptionService');

  try {
    const userWallet = await getUserWallet(chatId.toString());

    if (!userWallet) {
      await sendTelegramAwait(chatId,
        '⚠️ <b>Wallet not connected</b>\n\n' +
        'Use /connectwallet &lt;address&gt; first.'
      );
      return;
    }

    // Get current FLOWER cost
    const cost = await getSubscriptionCost();
    if (!cost) {
      await sendTelegramAwait(chatId, '❌ Could not get FLOWER price. Try again later.');
      return;
    }

    const searchMsg = [
      '🔍 <b>Searching for payment...</b>\n\n',
      'From: ' + userWallet + '\n',
      'To: ' + PAYMENT_ADDRESS + '\n',
      'Amount: ~' + cost.flower_amount + ' FLOWER\n\n',
      'This may take a few seconds...'
    ].join('');
    await sendTelegramAwait(chatId, searchMsg);

    // Search for payment from user's wallet to payment address
    const result = await verifyWalletPayment(userWallet, cost.flower_amount);

    if (!result.success) {
      if (result.partialPayment) {
        const sent = result.partialPayment.amount.toFixed(4);
        const needed = cost.flower_amount.toFixed(4);
        await sendTelegramAwait(chatId,
          `❌ <b>Insufficient Payment</b>\n\n` +
          `You sent: <b>${sent} FLOWER</b>\n` +
          `Required: <b>~${needed} FLOWER</b>\n\n` +
          `Please send at least <b>${needed} FLOWER</b> and try again.`
        );
      } else {
        await sendTelegramAwait(chatId,
          `❌ <b>Payment Not Found</b>\n\n` +
          `No transfer found from your wallet to the payment address.\n\n` +
          `Make sure you:\n` +
          `1. Sent FLOWER from YOUR wallet (${userWallet})\n` +
          `2. Sent to: ${PAYMENT_ADDRESS}\n` +
          `3. Amount: ~${cost.flower_amount} FLOWER\n` +
          `4. Wait a few seconds after sending`
        );
      }
      return;
    }

    // Check if this tx_hash was already used
    const used = await isTxHashUsed(result.txHash);
    if (used) {
      await sendTelegramAwait(chatId,
        '⚠️ <b>Payment Already Verified</b>\n\n' +
        `Tx: ${result.txHash.slice(0, 10)}...\n` +
        `This payment was already credited.`
      );
      return;
    }

    // Payment found and not used! Add subscription
    const added = await addSubscriptionDays(chatId.toString(), 30);
    await recordPayment(chatId.toString(), result.txHash, result.network, result.amount, cost.usd);

    if (added) {
      await sendTelegramAwait(chatId,
        `✅ <b>Payment Verified!</b>\n\n` +
        `💐 Amount: ${result.amount.toFixed(4)} FLOWER\n` +
        `🔗 Network: ${result.network.toUpperCase()}\n` +
        `🔗 Tx: ${result.txHash.slice(0, 16)}...\n` +
        `📅 +30 days added to your subscription!\n\n` +
        `Use /status to check your subscription.`
      );
    } else {
      await sendTelegramAwait(chatId, '❌ Error adding subscription. Contact support.');
    }

  } catch (error) {
    console.error('[pay] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

// ============================================
// TEST & SETUP ENDPOINTS
// ============================================

router.get('/test', async (req, res) => {
  const ok = await sendTelegramAwait('1166287745', '🐣 Test from SFL Watcher API!');
  res.json({ ok });
});

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
