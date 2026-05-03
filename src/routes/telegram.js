const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const supabase = require('../lib/supabase');
const { generateChartBuffer, generateChartDataUrl } = require('../services/chartService');
const { getResourceHistory, getResourceStats, getAllPrices } = require('../services/priceFetcher');
const { getUserNtfyTopic, sendNtfyNotification } = require('../services/ntfyService');
const { sendTelegramMessage } = require('../services/telegramService');
const {
  getSubscriptionStatus,
  getUserWallet,
  ensureSubscription,
  getUserLanguage,
  setUserLanguage,
  getUserPreferences,
  setPendingAction,
  clearPendingAction,
  getFreeTierUsers,
  getNtfySettings,
  updateNtfySettings,
  connectWallet,
  getSubscriptionCost,
  addSubscriptionDays,
  recordPayment,
  isTxHashUsed,
  verifyWalletPayment,
  PAYMENT_ADDRESS,
} = require('../services/subscriptionService');
const {
  pick,
  normalizeLanguage,
  escapeHtml,
  formatGraphCaption,
  formatFixed,
  formatTrimmed,
  formatSignedPercent,
} = require('../services/formatters');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const ADMIN_TELEGRAM_IDS = new Set(String(process.env.ADMIN_TELEGRAM_IDS || '1166287745').split(',').map(v => v.trim()).filter(Boolean));
const ALL_RESOURCES = ['apple','artichoke','banana','barley','beetroot','blueberry','broccoli','bumpkin emblem','cabbage','carrot','cauliflower','celestine','chewed bone','corn','crimstone','dewberry','duskberry','egg','eggplant','feather','frost pebble','goblin emblem','gold','grape','heart leaf','honey','iron','kale','leather','lemon','lunara','merino wool','milk','moonfur','nightshade emblem','obsidian','olive','onion','orange','parsnip','pepper','potato','pumpkin','radish','rhubarb','ribbon','rice','ruffroot','soybean','stone','sunflorian emblem','sunflower','tomato','turnip','wheat','wild grass','wood','wool','yam','zucchini'];

/**
 * Fire-and-forget Telegram sender (for simple responses)
 */
function sendTelegram(chatId, text) {
  setImmediate(() => {
    fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    }).catch(e => logger.error('Telegram error: ' + e.message));
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
    logger.error('Telegram error: ' + e.message);
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
      if (!resp.ok) logger.error('[sendPhoto] Telegram error: ' + data);
      return resp.ok;
    } else {
      const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' })
      });
      const data = await resp.json();
      if (!resp.ok) logger.error('[sendPhoto] Telegram error: ' + data);
      return resp.ok;
    }
  } catch (e) {
    logger.error('[sendPhoto] error: ' + e.message);
    return false;
  }
}

/**
 * Send photo using a raw Buffer payload.
 */
async function sendPhotoBuffer(chatId, buffer, caption, filename = 'chart.png', mime = 'image/png') {
  try {
    logger.info('[sendPhotoBuffer] start', { chatId, filename, mime, bytes: buffer.length, captionLength: caption.length });
    const blob = new Blob([buffer], { type: mime });
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', blob, filename);
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');

    const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: 'POST', body: form });
    const data = await resp.json();
    logger.info('[sendPhotoBuffer] response', { ok: resp.ok, status: resp.status, telegramOk: data?.ok, resultType: data?.result?.document ? 'document' : data?.result?.photo ? 'photo' : 'unknown' });
    if (!resp.ok) logger.error('[sendPhotoBuffer] Telegram error: ' + JSON.stringify(data));
    return resp.ok;
  } catch (e) {
    logger.error('[sendPhotoBuffer] error: ' + e.message);
    return false;
  }
}

/**
 * Send document fallback for binary chart payloads.
 */
async function sendDocument(chatId, documentUrl, caption, filename = 'chart.png') {
  try {
    if (documentUrl.startsWith('data:')) {
      const mimeMatch = documentUrl.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const base64 = documentUrl.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const blob = new Blob([buffer], { type: mime });

      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', blob, filename);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');

      const resp = await fetch(`${TELEGRAM_API}/sendDocument`, { method: 'POST', body: form });
      const data = await resp.json();
      if (!resp.ok) logger.error('[sendDocument] Telegram error: ' + JSON.stringify(data));
      return resp.ok;
    }

    const resp = await fetch(`${TELEGRAM_API}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, document: documentUrl, caption, parse_mode: 'HTML' })
    });
    const data = await resp.json();
    if (!resp.ok) logger.error('[sendDocument] Telegram error: ' + JSON.stringify(data));
    return resp.ok;
  } catch (e) {
    logger.error('[sendDocument] error: ' + e.message);
    return false;
  }
}

/**
 * Send document using a raw Buffer payload.
 */
async function sendDocumentBuffer(chatId, buffer, caption, filename = 'chart.png', mime = 'image/png') {
  try {
    logger.info('[sendDocumentBuffer] start', { chatId, filename, mime, bytes: buffer.length, captionLength: caption.length });
    const blob = new Blob([buffer], { type: mime });
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', blob, filename);
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');

    const resp = await fetch(`${TELEGRAM_API}/sendDocument`, { method: 'POST', body: form });
    const data = await resp.json();
    logger.info('[sendDocumentBuffer] response', { ok: resp.ok, status: resp.status, telegramOk: data?.ok, fileName: data?.result?.document?.file_name, mimeType: data?.result?.document?.mime_type, fileId: data?.result?.document?.file_id || null });
    if (!resp.ok) logger.error('[sendDocumentBuffer] Telegram error: ' + JSON.stringify(data));
    return resp.ok;
  } catch (e) {
    logger.error('[sendDocumentBuffer] error: ' + e.message);
    return false;
  }
}

// ============================================


// ============================================
// SUBSCRIPTION GATING
// ============================================
async function getLocale(chatId) {
  return normalizeLanguage(await getUserLanguage(String(chatId)));
}

function isAdmin(chatId) {
  return ADMIN_TELEGRAM_IDS.has(String(chatId));
}

function promoMessageForLanguage(language, esText, enText) {
  return normalizeLanguage(language) === 'en' ? enText : esText;
}

async function checkSubscription(chatId) {
  await ensureSubscription(chatId.toString());
  const locale = await getLocale(chatId);
  const sub = await getSubscriptionStatus(chatId.toString());

  if (sub.status === 'trial') return null;

  if (sub.status === 'trial_expired') {
    return pick(
      locale,
      'Wallet Required\\n\\nTu prueba de 7 días terminó.\\nConecta tu wallet para suscribirte:\\n/connectwallet <tu_address>\\n\\nEjemplo: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687',
      'Wallet Required\\n\\nYour 7-day trial has ended.\\nConnect your wallet to subscribe:\\n/connectwallet <your_address>\\n\\nExample: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687'
    );
  }

  if (sub.status === 'expired') {
    return pick(locale, 'Suscripción expirada\\n\\nTu suscripción terminó.\\nRenueva con /subscribe', 'Subscription Expired\\n\\nYour subscription has ended.\\nExtend with /subscribe');
  }

  const wallet = await getUserWallet(chatId.toString());
  if (!wallet) {
    return pick(
      locale,
      'Wallet Required\\n\\nConecta tu wallet para usar el bot:\\n/connectwallet <tu_address>\\n\\nEjemplo: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687',
      'Wallet Required\\n\\nConnect your wallet to use the bot:\\n/connectwallet <your_address>\\n\\nExample: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687'
    );
  }

  return null;
}

async function handlePendingFlow(chatId, text) {
  const locale = await getLocale(chatId);
  const prefs = await getUserPreferences(String(chatId));

  if (!prefs.pendingAction) return false;

  if (prefs.pendingAction === 'sendpromo_es') {
    await setPendingAction(String(chatId), 'sendpromo_en', { promo_es: text.trim() });
    await sendTelegramAwait(chatId, pick(locale, '✅ Promo en español guardada.\\n\\nAhora manda la promo en inglés.', '✅ Spanish promo saved.\\n\\nNow send the English promo.'));
    return true;
  }

  if (prefs.pendingAction === 'sendpromo_en') {
    const payload = { ...(prefs.pendingPayload || {}), promo_en: text.trim() };
    const recipients = (await getFreeTierUsers()).filter(user => String(user.userId) !== String(chatId));

    let sent = 0;
    for (const user of recipients) {
      const outgoing = promoMessageForLanguage(user.language, payload.promo_es || text.trim(), payload.promo_en || text.trim());
      const wrapped = `${promoMessageForLanguage(user.language, '📣 <b>Novedad de SFL Watcher</b>', '📣 <b>SFL Watcher Update</b>')}\\n\\n${escapeHtml(outgoing)}`;
      const ok = await sendTelegramMessage(user.userId, wrapped);
      if (ok) sent += 1;
    }

    await clearPendingAction(String(chatId));
    await sendTelegramAwait(chatId, pick(locale, `✅ Promo enviada a ${sent}/${recipients.length} usuarios free.`, `✅ Promo sent to ${sent}/${recipients.length} free users.`));
    return true;
  }

  return false;
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
  await ensureSubscription(String(chatId));

  if (!text.startsWith('/')) {
    const handled = await handlePendingFlow(chatId, text);
    if (!handled) {
      const locale = await getLocale(chatId);
      await sendTelegramAwait(chatId, pick(locale, '❌ No entendí ese mensaje. Usa /help para ver los comandos.', '❌ I did not understand that message. Use /help to see commands.'));
    }
    res.json({ ok: true });
    return;
  }

  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  const locale = await getLocale(chatId);

  logger.info(`[webhook] ${command} from ${chatId}`);

  if (command === '/start') {
    await sendTelegramAwait(chatId,
      pick(locale,
        '🦉 <b>SFL Watcher</b>\n\n📊 <b>Precios y gráficas</b>\n/price &lt;resource&gt; • /priceall • /graph &lt;resource&gt; • /list\n\n🔔 <b>Alertas</b>\n/alerts • /alert &lt;res&gt; &lt;sube%&gt; &lt;baja%&gt; • /pricealert &lt;res&gt; &lt;above|below&gt; &lt;precio&gt;\n\n🌐 <b>Idioma</b>\n/language es • /language en\n\n💳 <b>Suscripción</b>\n/connectwallet • /subscribe • /status • /pay\n\nUsa /help para ver todo.',
        '🦉 <b>SFL Watcher</b>\n\n📊 <b>Prices and charts</b>\n/price &lt;resource&gt; • /priceall • /graph &lt;resource&gt; • /list\n\n🔔 <b>Alerts</b>\n/alerts • /alert &lt;res&gt; &lt;rise%&gt; &lt;fall%&gt; • /pricealert &lt;res&gt; &lt;above|below&gt; &lt;price&gt;\n\n🌐 <b>Language</b>\n/language es • /language en\n\n💳 <b>Subscription</b>\n/connectwallet • /subscribe • /status • /pay\n\nUse /help to see everything.'
      )
    );
  }
  else if (command === '/help') {
    const adminLine = isAdmin(chatId)
      ? pick(locale, '\n/sendpromo - Mandar promo a usuarios free', '\n/sendpromo - Send promo to free users')
      : '';
    await sendTelegramAwait(chatId,
      pick(locale,
        '📊 <b>SFL Watcher - Ayuda</b>\n\n<b>Precios</b>\n/price &lt;resource&gt;\n/priceall\n/graph &lt;resource&gt;\n/list\n\n<b>Alertas por porcentaje</b>\n/alerts\n/alert &lt;resource&gt; &lt;sube%&gt; &lt;baja%&gt;\n/alertall &lt;sube%&gt; &lt;baja%&gt; [keep]\n/removealert &lt;resource&gt;\n/removeallalerts\n\n<b>Alertas por precio</b>\n/pricealert &lt;resource&gt; &lt;above|below&gt; &lt;precio&gt;\nEjemplo: /pricealert milk below 0.01\n\n<b>Idioma</b>\n/language es\n/language en\n\n<b>Wallet y pago</b>\n/connectwallet &lt;address&gt;\n/wallet\n/status\n/subscribe\n/pay\n\n<b>NTFY</b>\n/ntfy\n/ntfytest\n/ntfygraph on|off\n/ntfystatus' + adminLine,
        '📊 <b>SFL Watcher - Help</b>\n\n<b>Prices</b>\n/price &lt;resource&gt;\n/priceall\n/graph &lt;resource&gt;\n/list\n\n<b>Percentage alerts</b>\n/alerts\n/alert &lt;resource&gt; &lt;rise%&gt; &lt;fall%&gt;\n/alertall &lt;rise%&gt; &lt;fall%&gt; [keep]\n/removealert &lt;resource&gt;\n/removeallalerts\n\n<b>Price target alerts</b>\n/pricealert &lt;resource&gt; &lt;above|below&gt; &lt;price&gt;\nExample: /pricealert milk below 0.01\n\n<b>Language</b>\n/language es\n/language en\n\n<b>Wallet and payment</b>\n/connectwallet &lt;address&gt;\n/wallet\n/status\n/subscribe\n/pay\n\n<b>NTFY</b>\n/ntfy\n/ntfytest\n/ntfygraph on|off\n/ntfystatus' + adminLine
      )
    );
  }
  else if (command === '/list') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await sendTelegramAwait(chatId, `${pick(locale, '📋 <b>60 recursos</b>', '📋 <b>60 resources</b>')}\n${ALL_RESOURCES.join(', ')}`);
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
      await sendTelegramAwait(chatId, pick(locale, '❌ Uso: /graph &lt;resource&gt;\nEjemplo: /graph yam', '❌ Usage: /graph &lt;resource&gt;\nExample: /graph yam'));
      res.json({ ok: true });
      return;
    }
    await processGraph(chatId, resource);
  }
  else if (command === '/pricealert' || command === '/targetalert') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    await processPriceTargetAlert(chatId, parts.slice(1));
  }
  else if (command === '/language' || command === '/lang') {
    await processLanguage(chatId, parts[1]);
  }
  else if (command === '/sendpromo') {
    await processSendPromo(chatId);
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
    const locale = await getLocale(chatId);
    const stats = await getResourceStats(resource);

    if (!stats) {
      await sendTelegramAwait(chatId, pick(locale, `❌ No hay datos para ${resource}.\nEspera a que el cron recoja más información.`, `❌ No data for ${resource}.\nWait for cron to collect more data.`));
      return;
    }

    await sendTelegramAwait(chatId, formatGraphCaption(resource, stats, locale));
  } catch (error) {
    logger.error('[price] error: ' + error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processGraph(chatId, resource) {
  try {
    const crypto = require('crypto');
    const locale = await getLocale(chatId);

    logger.info('[graph] start', { chatId, resource });
    const stats = await getResourceStats(resource);
    const history = await getResourceHistory(resource, 90);
    logger.info('[graph] data loaded', {
      chatId,
      resource,
      historyPoints: history?.length || 0,
      statsFound: !!stats,
      current: stats?.current_price || null,
      avg: stats?.avg_price || null,
      min: stats?.min_price || null,
      max: stats?.max_price || null,
      firstTs: history?.[0]?.created_at || null,
      lastTs: history?.[history.length - 1]?.created_at || null,
    });

    if (!history || history.length < 2) {
      await sendTelegramAwait(chatId, `Not enough data for ${resource} (${history?.length || 0} points). Wait for cron to collect more data.`);
      return;
    }

    const chartPayload = generateChartDataUrl(resource, history, { locale, statsOverride: stats });
    if (!chartPayload || !chartPayload.chartConfig) {
      throw new Error('Failed to build chart config');
    }

    const { chartConfig, pointsUsed, rawPoints, aggregated } = chartPayload;
    logger.info('[graph] chart payload ready', {
      resource,
      chatId,
      pointsUsed,
      rawPoints,
      aggregated,
      svgBytes: Buffer.byteLength(chartConfig.svg, 'utf8'),
      svgSha256: crypto.createHash('sha256').update(chartConfig.svg).digest('hex'),
    });
    const caption = formatGraphCaption(resource, stats, locale);

    const arrayBuffer = await generateChartBuffer(chartConfig);
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('Local renderer returned empty buffer');
    }

    const buffer = Buffer.from(arrayBuffer);
    logger.info('[graph] png buffer ready', {
      resource,
      chatId,
      pngBytes: buffer.length,
      pngSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      pngSignature: buffer.subarray(0, 8).toString('hex'),
    });

    if (buffer.byteLength > 20 * 1024 * 1024) {
      throw new Error('Chart image too large to send');
    }

    const sent = await sendPhotoBuffer(chatId, buffer, caption, `${resource}-chart.png`, 'image/png');
    logger.info('[graph] send result', { resource, chatId, sent, mode: 'photo' });
    if (!sent) {
      logger.error('[graph] sendPhoto failed, attempting document fallback');
      const docSent = await sendDocumentBuffer(chatId, buffer, caption, `${resource}-chart.png`, 'image/png');
      logger.info('[graph] fallback send result', { resource, chatId, sent: docSent, mode: 'document' });
      if (!docSent) {
        logger.error('[graph] sendDocument failed');
        await sendTelegramAwait(chatId, `Chart failed to send. Try /price ${resource} for text data.`);
      }
    }
  } catch (error) {
    logger.error('[graph] error: ' + error.message, { stack: error.stack, resource, chatId });
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
    logger.error('[debug] error: ' + error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processAlertConfig(chatId, input, isListMode) {
  try {
    const locale = await getLocale(chatId);
    if (isListMode || !input.trim()) {
      const { data: alerts, error } = await supabase
        .from('user_alerts')
        .select('*')
        .eq('user_id', chatId)
        .eq('enabled', true)
        .order('resource');

      if (error) throw error;

      if (!alerts || alerts.length === 0) {
        await sendTelegramAwait(chatId, pick(locale, '🔔 <b>Tus alertas</b>\n\nNo tienes alertas configuradas.\nUsa /alert o /pricealert para crear una.', '🔔 <b>Your alerts</b>\n\nYou have no alerts configured.\nUse /alert or /pricealert to create one.'));
        return;
      }

      const lines = alerts.map(a => {
        if (a.alert_type === 'price_above' || a.alert_type === 'price_below') {
          return `• <b>${a.resource}</b>: 🎯 ${a.alert_type === 'price_above' ? 'above' : 'below'} ${formatTrimmed(a.target_price, 9)}`;
        }
        return `• <b>${a.resource}</b>: ▲+${Number(a.threshold_high)}% | ▼${Number(a.threshold_low)}%`;
      });

      await sendTelegramAwait(chatId, `${pick(locale, '🔔 <b>Tus alertas</b>', '🔔 <b>Your alerts</b>')}\n\n${lines.join('\n')}\n\n${pick(locale, 'Agregar porcentaje: /alert &lt;resource&gt; &lt;sube%&gt; &lt;baja%&gt;\nAgregar objetivo: /pricealert &lt;resource&gt; &lt;above|below&gt; &lt;precio&gt;\nEliminar: /removealert &lt;resource&gt;', 'Add percentage: /alert &lt;resource&gt; &lt;rise%&gt; &lt;fall%&gt;\nAdd target: /pricealert &lt;resource&gt; &lt;above|below&gt; &lt;price&gt;\nRemove: /removealert &lt;resource&gt;' )}`);
      return;
    }

    const tokens = input.trim().split(/\s+/);
    if (tokens.length < 3) {
      await sendTelegramAwait(chatId, pick(locale, '❌ Uso: /alert &lt;resource&gt; &lt;sube%&gt; &lt;baja%&gt;\nEjemplo: /alert yam 10 15', '❌ Usage: /alert &lt;resource&gt; &lt;rise%&gt; &lt;fall%&gt;\nExample: /alert yam 10 15'));
      return;
    }

    const resource = tokens[0].toLowerCase();
    const rawHigh = parseFloat(tokens[1]);
    const rawLow = parseFloat(tokens[2]);
    if (isNaN(rawHigh) || isNaN(rawLow)) {
      await sendTelegramAwait(chatId, pick(locale, '❌ Los porcentajes deben ser números.', '❌ Percentages must be numbers.'));
      return;
    }

    const thresholdHigh = Math.abs(rawHigh);
    const thresholdLow = -Math.abs(rawLow);
    const { data: existing } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', chatId)
      .eq('resource', resource)
      .eq('alert_type', 'dual')
      .eq('enabled', true)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('user_alerts')
        .update({
          alert_type: 'dual',
          threshold_high: thresholdHigh,
          threshold_low: thresholdLow,
          updated_at: new Date().toISOString(),
          last_notified_rise_at: null,
          last_notified_fall_at: null,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('user_alerts')
        .insert({ user_id: chatId, resource, alert_type: 'dual', threshold_high: thresholdHigh, threshold_low: thresholdLow, enabled: true });
      if (error) throw error;
    }

    await sendTelegramAwait(chatId, pick(locale, `✅ Alerta guardada para <b>${resource}</b>\n▲ Sube: +${thresholdHigh}% | ▼ Baja: ${thresholdLow}%`, `✅ Alert saved for <b>${resource}</b>\n▲ Rise: +${thresholdHigh}% | ▼ Fall: ${thresholdLow}%`));
  } catch (error) {
    logger.error('[alert] error: ' + error.message);
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
    logger.error('[removealert] error: ' + error.message);
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
    logger.error('[alertall] error: ' + error.message);
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
    logger.error('[removeallalerts] error: ' + error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processPriceTargetAlert(chatId, args) {
  try {
    const locale = await getLocale(chatId);
    const [resourceRaw, directionRaw, priceRaw] = args;
    const resource = String(resourceRaw || '').toLowerCase();
    const direction = String(directionRaw || '').toLowerCase();
    const targetPrice = Number(String(priceRaw || '').replace(',', '.'));

    if (!resource || !['above', 'below'].includes(direction) || !Number.isFinite(targetPrice) || targetPrice <= 0) {
      await sendTelegramAwait(chatId, pick(locale, '❌ Uso: /pricealert &lt;resource&gt; &lt;above|below&gt; &lt;precio&gt;\nEjemplo: /pricealert milk below 0.01', '❌ Usage: /pricealert &lt;resource&gt; &lt;above|below&gt; &lt;price&gt;\nExample: /pricealert milk below 0.01'));
      return;
    }

    const alertType = direction === 'above' ? 'price_above' : 'price_below';
    const { data: existing } = await supabase
      .from('user_alerts')
      .select('id')
      .eq('user_id', chatId)
      .eq('resource', resource)
      .eq('alert_type', alertType)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('user_alerts')
        .update({
          target_price: targetPrice,
          target_direction: direction,
          enabled: true,
          updated_at: new Date().toISOString(),
          last_notified_target_at: null,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('user_alerts')
        .insert({
          user_id: chatId,
          resource,
          alert_type: alertType,
          target_price: targetPrice,
          target_direction: direction,
          enabled: true,
        });
      if (error) throw error;
    }

    await sendTelegramAwait(chatId, pick(locale, `✅ Alerta objetivo guardada para <b>${resource}</b>\n🎯 ${direction} ${formatTrimmed(targetPrice, 9)}`, `✅ Target alert saved for <b>${resource}</b>\n🎯 ${direction} ${formatTrimmed(targetPrice, 9)}`));
  } catch (error) {
    logger.error('[pricealert] error: ' + error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processLanguage(chatId, languageInput) {
  try {
    const current = await getLocale(chatId);
    if (!languageInput) {
      await sendTelegramAwait(chatId, pick(current, `🌐 Idioma actual: <b>${current.toUpperCase()}</b>\nUsa /language es o /language en`, `🌐 Current language: <b>${current.toUpperCase()}</b>\nUse /language es or /language en`));
      return;
    }
    const language = await setUserLanguage(String(chatId), languageInput);
    await sendTelegramAwait(chatId, pick(language, '✅ Idioma cambiado a <b>Español</b>.', '✅ Language changed to <b>English</b>.'));
  } catch (error) {
    logger.error('[language] error: ' + error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processSendPromo(chatId) {
  const locale = await getLocale(chatId);
  if (!isAdmin(chatId)) {
    await sendTelegramAwait(chatId, pick(locale, '❌ Este comando es solo para admin.', '❌ This command is admin only.'));
    return;
  }

  await setPendingAction(String(chatId), 'sendpromo_es', {});
  await sendTelegramAwait(chatId, pick(locale, '📣 Manda la promo en español.', '📣 Send the promo in Spanish.'));
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
    logger.error('[connectwallet] error: ' + error.message);
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
    logger.error('[wallet] error: ' + error.message);
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
    logger.error('[subscribe] error: ' + error.message);
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
    logger.error('[status] error: ' + error.message);
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
    logger.error('[pay] error: ' + error.message);
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
