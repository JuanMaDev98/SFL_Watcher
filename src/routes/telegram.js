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
    // If it's a data URL, convert to Blob for proper upload
    let body;
    if (photoUrl.startsWith('data:')) {
      const mimeMatch = photoUrl.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/svg+xml';
      const base64 = photoUrl.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const blob = new Blob([buffer], { type: mime });

      // Use FormData for file upload
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', blob, 'chart.png');
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');

      const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: 'POST',
        body: form
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[sendPhoto] Telegram error:', data);
      }
      return resp.ok;
    } else {
      // Regular URL
      const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
          caption: caption,
          parse_mode: 'HTML'
        })
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[sendPhoto] Telegram error:', data);
      }
      return resp.ok;
    }
  } catch (e) {
    console.error('[sendPhoto] error:', e.message);
    return false;
  }
}

// ============================================
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
      '/price &lt;resource&gt; - Current price\n' +
      '/priceall - All prices\n' +
      '/graph &lt;resource&gt; - Chart\n' +
      '/list - All resources\n' +
      '/alerts - View your alerts\n' +
      '/alert &lt;resource&gt; &lt;high%&gt; &lt;low%&gt; - Set/update alert\n' +
      '/removealert &lt;resource&gt; - Remove alert'
    );
  }
  else if (command === '/help') {
    await sendTelegramAwait(chatId,
      '📊 <b>Commands:</b>\n\n' +
      '<b>Price Info:</b>\n' +
      '/price &lt;resource&gt; - Price info\n' +
      '/priceall - All prices\n' +
      '/graph &lt;resource&gt; - Chart\n' +
      '/list - 60 resources\n\n' +
      '<b>Alerts (price vs average):</b>\n' +
      '/alerts - View your alerts\n' +
      '/alert &lt;resource&gt; &lt;high%&gt; &lt;low%&gt; - Set/update\n' +
      '/removealert &lt;resource&gt; - Remove alert\n\n' +
      '<b>Alert examples:</b>\n' +
      '/alert yam +10 -15\n' +
      '→ alerts when yam is +10% above avg OR -15% below avg\n\n' +
      '⚠️ /alert replaces any existing alert for that resource.'
    );
  }
  else if (command === '/list') {
    const resources = ['apple','artichoke','banana','barley','beetroot','blueberry','broccoli','bumpkin emblem','cabbage','carrot','cauliflower','celestine','chewed bone','corn','crimstone','dewberry','duskberry','egg','eggplant','feather','frost pebble','goblin emblem','gold','grape','heart leaf','honey','iron','kale','leather','lemon','lunara','merino wool','milk','moonfur','nightshade emblem','obsidian','olive','onion','orange','parsnip','pepper','potato','pumpkin','radish','rhubarb','ribbon','rice','ruffroot','soybean','stone','sunflorian emblem','sunflower','tomato','turnip','wheat','wild grass','wood','wool','yam','zucchini'];
    await sendTelegramAwait(chatId, '📋 <b>60 Resources:</b>\n' + resources.join(', '));
  }
  else if (command === '/price') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /price &lt;resource&gt;\nExample: /price yam');
      res.json({ ok: true });
      return;
    }
    await processPriceSimple(chatId, resource);
  }
  else if (command === '/priceall') {
    await processAllPrices(chatId);
  }
  else if (command === '/graph' || command === '/graph@sflwatcher_bot') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    if (!resource) {
      await sendTelegramAwait(chatId, '❌ Usage: /graph &lt;resource&gt;\nExample: /graph yam');
      res.json({ ok: true });
      return;
    }
    await processGraph(chatId, resource);
  }
  else if (command === '/debug') {
    await processDebug(chatId);
  }
  else if (command === '/alert' || command === '/alerts') {
    const rest = parts.slice(1).join(' ');
    await processAlertConfig(chatId, rest, parts[0] === '/alerts');
  }
  else if (command === '/removealert') {
    const resource = parts.length > 1 ? parts[1].toLowerCase() : null;
    await processRemoveAlert(chatId, resource);
  }
  else if (command === '/subscribe') {
    await processSubscribe(chatId);
  }
  else if (command === '/status') {
    await processStatus(chatId);
  }
  else if (command === '/pay') {
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

    // Use 90 days of data
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
    const { generateChartDataUrl, generateChartBuffer, calculateStats } = require('../services/chartService');

    // Use all available data (up to 90 days)
    const history = await getResourceHistory(resource, 90);

    if (!history || history.length === 0) {
      await sendTelegramAwait(chatId, `❌ No data for ${resource}.\nWait for cron to collect data.`);
      return;
    }

    // Calculate stats
    const stats = calculateStats(history);
    const emoji = stats.pct >= 0 ? '📈' : '📉';
    const sign = stats.pct >= 0 ? '+' : '';

    // Caption with stats
    const caption =
      `<b>${resource.toUpperCase()}</b>\n\n` +
      `💰 Current: <code>${stats.current.toFixed(6)}</code>\n` +
      `📊 Min: ${stats.min.toFixed(6)} | Max: ${stats.max.toFixed(6)}\n` +
      `📐 Avg: ${stats.avg.toFixed(6)}\n` +
      `${emoji} vs Avg: ${sign}${stats.pct}%\n\n` +
      `📈 Data Points: ${history.length}`;

    // Generate chart via QuickChart POST API (no URL length limit)
    const { chartConfig } = generateChartDataUrl(resource, history);
    const arrayBuffer = await generateChartBuffer(chartConfig);
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const chartUrl = `data:image/png;base64,${base64}`;
    const sent = await sendPhoto(chatId, chartUrl, caption);
    if (!sent) {
      console.error('[graph] sendPhoto failed, attempting sendDocument fallback');
      const resp = await fetch(`${TELEGRAM_API}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          document: chartUrl,
          caption: caption,
          parse_mode: 'HTML'
        })
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[graph] sendDocument fallback also failed:', data);
        await sendTelegramAwait(chatId, `❌ Chart failed to generate. Try /price ${resource} for text data.`);
      }
    }
  } catch (error) {
    console.error('[graph] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
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
    // List user's alerts
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

    // Parse: /alert yam +10 -15
    const tokens = input.trim().split(/\s+/);
    if (tokens.length < 3) {
      await sendTelegramAwait(chatId,
        '❌ Usage: /alert &lt;resource&gt; &lt;high%&gt; &lt;low%&gt;\n' +
        'Example: /alert yam +10 -15\n' +
        '(alerts when yam is +10% above avg OR -15% below avg)'
      );
      return;
    }

    const resource = tokens[0].toLowerCase();
    const rawHigh = parseFloat(tokens[1]);
    const rawLow = parseFloat(tokens[2]);

    if (isNaN(rawHigh) || isNaN(rawLow)) {
      await sendTelegramAwait(chatId, '❌ High and low must be numbers.\nExample: /alert yam +10 -15');
      return;
    }

    // High should be positive (price above avg), low should be negative (price below avg)
    const thresholdHigh = Math.abs(rawHigh);  // Always store positive
    const thresholdLow = -Math.abs(rawLow);   // Always store negative

    // Check if alert exists for this user+resource
    const { data: existing } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', chatId)
      .eq('resource', resource)
      .eq('enabled', true)
      .single();

    let updated;
    if (existing) {
      // Update
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
      // Insert
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

    const highSign = thresholdHigh >= 0 ? '+' : '';
    const lowSign = thresholdLow >= 0 ? '+' : '';
    const action = updated ? 'Updated (replaced old alert)' : 'Created';

    await sendTelegramAwait(chatId,
      `✅ ${action} alert for <b>${resource}</b>\n` +
      `▲ High threshold: ${highSign}${thresholdHigh}%\n` +
      `▼ Low threshold: ${lowSign}${thresholdLow}%\n\n` +
      `⚠️ Replaces any existing alert for ${resource}.\n` +
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
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('user_id', chatId)
      .eq('resource', resource.toLowerCase())
      .eq('enabled', true);

    if (error) throw error;

    await sendTelegramAwait(chatId, `🗑️ Alert for <b>${resource}</b> removed.`);

  } catch (error) {
    console.error('[removealert] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processSubscribe(chatId) {
  const { ensureSubscription, getSubscriptionCost, PAYMENT_ADDRESS } = require('../services/subscriptionService');

  try {
    // Ensure subscription record (creates trial if new)
    const sub = await ensureSubscription(chatId.toString());
    const cost = await getSubscriptionCost();

    const lines = [
      '💳 <b>Subscribe to SFL Watcher Pro</b>',
      '',
      `📅 <b>Your Status:</b> ${sub.status.toUpperCase()}`
    ];

    if (sub.days_remaining !== undefined) {
      lines.push(`⏰ ${sub.days_remaining} days remaining`);
    }

    lines.push('');
    lines.push('<b>💰 Subscription:</b>');
    lines.push('• 1 month = $1 USD in FLOWER');
    lines.push('• 7 days FREE trial for new users');

    if (cost) {
      lines.push('');
      lines.push(`💐 Current FLOWER price: $${cost.flower_price_usd.toFixed(4)}`);
      lines.push(`📦 30 days = ~${cost.flower_amount} FLOWER`);
    }

    lines.push('');
    lines.push('<b>How to pay:</b>');
    lines.push('1. Send FLOWER to:');
    lines.push(`<code>${PAYMENT_ADDRESS}</code>`);
    lines.push('2. Use /pay <your_tx_hash> to verify');
    lines.push('');
    lines.push('Networks: <b>Base</b> or <b>Ronin</b>');

    await sendTelegramAwait(chatId, lines.join('\n'));

  } catch (error) {
    console.error('[subscribe] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processStatus(chatId) {
  const { getSubscriptionStatus } = require('../services/subscriptionService');

  try {
    const sub = await getSubscriptionStatus(chatId.toString());

    let message;
    if (sub.status === 'new' || sub.status === 'trial') {
      message = `✅ <b>Trial Active</b>\n\n⏰ ${sub.days_remaining} days left in your free trial\n\nUse /subscribe to see payment options.`;
    } else if (sub.status === 'trial_expired') {
      message = `⏳ <b>Trial Expired</b>\n\nYour free trial ended. Subscribe to continue using the bot.\n\nUse /subscribe to pay.`;
    } else if (sub.status === 'active') {
      message = `✅ <b>Subscription Active</b>\n\n📅 ${sub.days_remaining} days remaining\n\nUse /subscribe to extend.`;
    } else if (sub.status === 'expired') {
      message = `⏳ <b>Subscription Expired</b>\n\nUse /subscribe to renew.`;
    } else {
      message = `❓ Status unknown. Use /subscribe.`;
    }

    await sendTelegramAwait(chatId, message);

  } catch (error) {
    console.error('[status] error:', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processPay(chatId, txHash) {
  const { verifyFlowerPayment } = require('../services/paymentVerifier');
  const { recordPayment, addSubscriptionDays, getSubscriptionCost, isTxHashUsed, PAYMENT_ADDRESS } = require('../services/subscriptionService');

  try {
    if (!txHash) {
      const cost = await getSubscriptionCost();
      await sendTelegramAwait(chatId,
        '💐 <b>Pay with FLOWER</b>\n\n' +
        `Send FLOWER to:\n<code>${PAYMENT_ADDRESS}</code>\n\n` +
        'Then send:\n/pay <your_tx_hash>\n\n' +
        'Example: /pay 0x1234...\n\n' +
        'Supported networks: <b>Base</b>, <b>Ronin</b>'
      );
      return;
    }

    // Validate tx hash format
    if (!txHash.startsWith('0x') || txHash.length !== 66) {
      await sendTelegramAwait(chatId, '❌ Invalid tx hash format. Must be 66 chars starting with 0x.');
      return;
    }

    // Check if already used
    const used = await isTxHashUsed(txHash);
    if (used) {
      await sendTelegramAwait(chatId, '⚠️ This transaction was already used. Each tx can only be used once.');
      return;
    }

    // Verify payment on-chain
    await sendTelegramAwait(chatId, '🔍 Verifying payment on-chain...');
    const result = await verifyFlowerPayment(txHash);

    if (!result.success) {
      await sendTelegramAwait(chatId, `❌ Verification failed: ${result.error}\n\nMake sure you sent FLOWER to the correct address and the transaction is confirmed.`);
      return;
    }

    // Payment verified! Add subscription
    const added = await addSubscriptionDays(chatId.toString(), 30);
    await recordPayment(chatId.toString(), txHash, result.network, result.amount, null);

    if (added) {
      await sendTelegramAwait(chatId,
        `✅ <b>Payment Verified!</b>\n\n` +
        `💐 Sent: ${result.amount.toFixed(4)} FLOWER\n` +
        `🔗 Network: ${result.network.toUpperCase()}\n` +
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
