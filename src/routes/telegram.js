const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const supabase = require('../lib/supabase');
const { generateChartBuffer, generateChartDataUrl } = require('../services/chartService');
const { getResourceHistory, getResourceStats, getAllPrices, getAvailableResources } = require('../services/priceFetcher');
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
  getBroadcastUsers,
  getCriticalAlertsEnabled,
  setCriticalAlertsEnabled,
  getNtfySettings,
  updateNtfySettings,
  connectWallet,
  getSubscriptionCost,
  addSubscriptionDays,
  recordPayment,
  isTxHashUsed,
  verifyWalletPayment,
  PAYMENT_ADDRESS,
  BETA_FREE_MODE,
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
const {
  canSendPromo,
  markPromoSent,
  recordError,
  getRuntimeHealthSnapshot,
} = require('../services/runtimeStatsService');
const {
  joinResourceTokens,
  parsePercentAlertInput,
  parseTargetAlertArgs,
} = require('../services/commandParser');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const OWNER_TELEGRAM_ID = String(process.env.OWNER_TELEGRAM_ID || '1166287745');

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
async function sendTelegramAwait(chatId, text, extra = {}) {
  try {
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra })
    });
    return resp.ok;
  } catch (e) {
    logger.error('Telegram error: ' + e.message);
    return false;
  }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    const resp = await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false })
    });
    return resp.ok;
  } catch (e) {
    logger.error('Telegram callback answer error: ' + e.message);
    return false;
  }
}

async function editTelegramMessage(chatId, messageId, text, extra = {}) {
  try {
    const resp = await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...extra,
      })
    });
    return resp.ok;
  } catch (e) {
    logger.error('Telegram editMessageText error: ' + e.message);
    return false;
  }
}

function buildLanguageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🇪🇸 Español', callback_data: 'lang:es' },
        { text: '🇺🇸 English', callback_data: 'lang:en' },
      ]
    ]
  };
}

function buildQuickAlertKeyboard(resource) {
  return {
    inline_keyboard: [
      [
        { text: '🔔 +10 / -10', callback_data: `alertquick:${resource}:10:10` },
        { text: '🔔 +20 / -15', callback_data: `alertquick:${resource}:20:15` },
      ]
    ]
  };
}

function buildDeleteAlertKeyboard(alerts = []) {
  const rows = alerts.slice(0, 20).map(alert => ([
    { text: `🗑️ ${String(alert.resource).toUpperCase()}`, callback_data: `alertdelete:${alert.resource}` }
  ]));
  return rows.length ? { inline_keyboard: rows } : null;
}

function formatDurationMinutes(ms) {
  const minutes = Math.ceil(ms / 60000);
  return `${minutes} min`;
}

async function getKnownResources(forceRefresh = false) {
  return getAvailableResources(7, forceRefresh);
}

async function assertKnownResource(resource, locale) {
  const normalized = String(resource || '').trim().toLowerCase();
  const resources = await getKnownResources();
  if (resources.includes(normalized)) {
    return { ok: true, resource: normalized, resources };
  }
  return {
    ok: false,
    resource: normalized,
    resources,
    message: pick(
      locale,
      `❌ El recurso <b>${escapeHtml(normalized || '?')}</b> no existe aún en snapshots recientes. Usa /list para ver los disponibles.`,
      `❌ Resource <b>${escapeHtml(normalized || '?')}</b> does not exist in recent snapshots yet. Use /list to see available ones.`
    )
  };
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
  return String(chatId) === OWNER_TELEGRAM_ID;
}

function promoMessageForLanguage(language, esText, enText) {
  return normalizeLanguage(language) === 'en' ? enText : esText;
}

async function checkSubscription(chatId) {
  await ensureSubscription(chatId.toString());
  if (BETA_FREE_MODE) return null;
  const locale = await getLocale(chatId);
  const sub = await getSubscriptionStatus(chatId.toString());

  if (sub.status === 'trial') return null;

  if (sub.status === 'trial_expired') {
    return pick(
      locale,
      'Wallet Required\n\nTu prueba de 7 días terminó.\nConecta tu wallet para suscribirte:\n/connectwallet <tu_address>\n\nEjemplo: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687',
      'Wallet Required\n\nYour 7-day trial has ended.\nConnect your wallet to subscribe:\n/connectwallet <your_address>\n\nExample: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687'
    );
  }

  if (sub.status === 'expired') {
    return pick(locale, 'Suscripción expirada\n\nTu suscripción terminó.\nRenueva con /subscribe', 'Subscription Expired\n\nYour subscription has ended.\nExtend with /subscribe');
  }

  const wallet = await getUserWallet(chatId.toString());
  if (!wallet) {
    return pick(
      locale,
      'Wallet Required\n\nConecta tu wallet para usar el bot:\n/connectwallet <tu_address>\n\nEjemplo: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687',
      'Wallet Required\n\nConnect your wallet to use the bot:\n/connectwallet <your_address>\n\nExample: /connectwallet 0x742d35Cc6634C0532925a3b844Bc9e7595f1d687'
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
    await sendTelegramAwait(chatId, pick(locale, '✅ Promo en español guardada.\n\nAhora manda la promo en inglés.', '✅ Spanish promo saved.\n\nNow send the English promo.'));
    return true;
  }

  if (prefs.pendingAction === 'sendpromo_en') {
    const payload = { ...(prefs.pendingPayload || {}), promo_en: text.trim() };
    const promoGuard = canSendPromo(chatId);
    if (!promoGuard.allowed) {
      await clearPendingAction(String(chatId));
      await sendTelegramAwait(chatId, pick(locale, `⏳ Espera ${formatDurationMinutes(promoGuard.remainingMs)} antes de enviar otra promo.`, `⏳ Wait ${formatDurationMinutes(promoGuard.remainingMs)} before sending another promo.`));
      return true;
    }

    const recipients = await getBroadcastUsers();

    let sentTelegram = 0;
    let sentNtfy = 0;
    const ntfyRecipients = recipients.filter(user => user.ntfyEnabled);

    for (const user of recipients) {
      const outgoing = promoMessageForLanguage(user.language, payload.promo_es || text.trim(), payload.promo_en || text.trim());
      const tgTitle = promoMessageForLanguage(user.language, '📣 <b>Novedad de SFL Watcher</b>', '📣 <b>SFL Watcher Update</b>');
      const tgMessage = `${tgTitle}\n\n${escapeHtml(outgoing)}`;
      const okTelegram = await sendTelegramMessage(user.userId, tgMessage);
      if (okTelegram) sentTelegram += 1;

      if (user.ntfyEnabled) {
        const ntfyBody = `${promoMessageForLanguage(user.language, 'Novedad de SFL Watcher', 'SFL Watcher Update')}\n\n${outgoing}`;
        const okNtfy = await sendNtfyNotification(getUserNtfyTopic(user.userId), ntfyBody, {
          title: 'SFL Watcher Update',
          tags: 'loudspeaker',
          priority: 4,
        });
        if (okNtfy) sentNtfy += 1;
      }
    }

    markPromoSent(chatId, {
      telegramRecipients: recipients.length,
      telegramSent: sentTelegram,
      ntfyRecipients: ntfyRecipients.length,
      ntfySent: sentNtfy,
    });

    await clearPendingAction(String(chatId));
    await sendTelegramAwait(chatId, pick(locale, `✅ Promo enviada por Telegram a ${sentTelegram}/${recipients.length} usuarios.\n✅ Promo enviada por NTFY a ${sentNtfy}/${ntfyRecipients.length} usuarios con NTFY activo.`, `✅ Promo sent by Telegram to ${sentTelegram}/${recipients.length} users.\n✅ Promo sent by NTFY to ${sentNtfy}/${ntfyRecipients.length} users with NTFY enabled.`));
    return true;
  }

  return false;
}

async function processCallbackQuery(callbackQuery) {
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = String(callbackQuery.data || '');

  if (!chatId || !data) {
    await answerCallbackQuery(callbackId, 'Invalid action');
    return;
  }

  const locale = await getLocale(chatId);

  if (data.startsWith('lang:')) {
    const language = data.split(':')[1] || 'es';
    await setUserLanguage(String(chatId), language);
    await answerCallbackQuery(callbackId, pick(language, 'Idioma actualizado', 'Language updated'));
    await editTelegramMessage(chatId, messageId, pick(language, '🌐 <b>Idioma actualizado</b>\n\nTu idioma ahora es <b>Español</b>.', '🌐 <b>Language updated</b>\n\nYour language is now <b>English</b>.'));
    return;
  }

  if (data.startsWith('alertquick:')) {
    const [, resource, riseRaw, fallRaw] = data.split(':');
    await processAlertConfig(chatId, `${resource} ${riseRaw} ${fallRaw}`, false);
    await answerCallbackQuery(callbackId, pick(locale, 'Alerta rápida creada', 'Quick alert created'));
    return;
  }

  if (data.startsWith('alertdelete:')) {
    const [, resource] = data.split(':');
    await processRemoveAlert(chatId, resource);
    await answerCallbackQuery(callbackId, pick(locale, 'Alerta eliminada', 'Alert deleted'));
    return;
  }

  await answerCallbackQuery(callbackId, pick(locale, 'Acción no reconocida', 'Unknown action'));
}



// WEBHOOK HANDLER
// ============================================
router.post('/webhook', async (req, res) => {
  try {
    const { callback_query: callbackQuery } = req.body || {};
    if (callbackQuery) {
      await processCallbackQuery(callbackQuery);
      res.json({ ok: true });
      return;
    }

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
        '🦉 <b>SFL Watcher</b>\n\n📊 <b>Precios y gráficas</b>\n/price &lt;resource&gt; • /priceall • /graph &lt;resource&gt; • /list\n\n🔔 <b>Alertas</b>\n/alerts • /alert &lt;res&gt; &lt;sube%&gt; &lt;baja%&gt; • /pricealert &lt;res&gt; &lt;above|below&gt; &lt;precio&gt;\n\n🌐 <b>Idioma</b>\n/language es • /language en\n\nUsa /help para ver todo.',
        '🦉 <b>SFL Watcher</b>\n\n📊 <b>Prices and charts</b>\n/price &lt;resource&gt; • /priceall • /graph &lt;resource&gt; • /list\n\n🔔 <b>Alerts</b>\n/alerts • /alert &lt;res&gt; &lt;rise%&gt; &lt;fall%&gt; • /pricealert &lt;res&gt; &lt;above|below&gt; &lt;price&gt;\n\n🌐 <b>Language</b>\n/language es • /language en\n\nUse /help to see everything.'
      )
    );
  }
  else if (command === '/help') {
    await sendTelegramAwait(chatId,
      pick(locale,
        '📊 <b>SFL Watcher - Ayuda</b>\n\n' +
        '📈 <b>COMANDOS DE PRECIO</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/price &lt;resource&gt; - Precio de un recurso (ej. /price wood)\n' +
        '/priceall - Precios de todos los recursos disponibles\n' +
        '/graph &lt;resource&gt; - Gráfica del recurso (ej. /graph stone)\n' +
        '/list - Lista dinámica de recursos detectados\n\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '🔔 <b>COMANDOS DE ALERTAS</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/alerts - Ver todas tus alertas activas\n' +
        '/alert &lt;res&gt; &lt;high%&gt; &lt;low%&gt; - Crea alerta porcentual para un recurso\n' +
        '/alertall &lt;high%&gt; &lt;low%&gt; - Crea alertas para todos los recursos\n' +
        '/alertall &lt;high%&gt; &lt;low%&gt; keep - Igual, pero conserva las existentes\n' +
        '/pricealert &lt;res&gt; &lt;above|below&gt; &lt;price&gt; - Alerta por precio objetivo\n' +
        '/criticalalerts on|off - Activa o desactiva alertas críticas automáticas\n' +
        '/removealert &lt;resource&gt; - Elimina la alerta de un recurso\n' +
        '/removeallalerts - Elimina todas las alertas\n\n' +
        '<b>Ejemplos:</b>\n' +
        '/alert yam 10 15 → yam a +10% o -15% vs promedio\n' +
        '/alertall 20 15 → todos los recursos a +20% o -15%\n' +
        '/alertall 20 15 keep → igual, manteniendo alertas existentes\n' +
        '/pricealert milk below 0.01 → alerta si milk baja de 0.01\n' +
        '/criticalalerts off → desactiva alertas críticas automáticas\n\n' +
        '🌐 <b>IDIOMA</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/language es - Cambiar a español\n' +
        '/language en - Cambiar a inglés\n\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '📱 <b>NOTIFICACIONES NTFY</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/ntfy - Configurar NTFY para el teléfono\n' +
        '/ntfytest - Enviar notificación de prueba\n' +
        '/ntfygraph on/off - Activar o desactivar gráficas en NTFY\n' +
        '/ntfystatus - Ver estado de tu configuración NTFY\n\n' +
        '📋 <b>Nota:</b> las notificaciones NTFY son públicas. NO compartas tu topic.',
        '📊 <b>SFL Watcher - Help</b>\n\n' +
        '📈 <b>PRICE COMMANDS</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/price &lt;resource&gt; - Price info (e.g. /price wood)\n' +
        '/priceall - Prices for all available resources\n' +
        '/graph &lt;resource&gt; - Chart image (e.g. /graph stone)\n' +
        '/list - Dynamic list of detected resources\n\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '🔔 <b>ALERT COMMANDS</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/alerts - View all your active alerts\n' +
        '/alert &lt;res&gt; &lt;high%&gt; &lt;low%&gt; - Set percentage alert for one resource\n' +
        '/alertall &lt;high%&gt; &lt;low%&gt; - Set alerts for all resources\n' +
        '/alertall &lt;high%&gt; &lt;low%&gt; keep - Same, but keeps existing alerts\n' +
        '/pricealert &lt;res&gt; &lt;above|below&gt; &lt;price&gt; - Target price alert\n' +
        '/criticalalerts on|off - Enable or disable automatic critical alerts\n' +
        '/removealert &lt;resource&gt; - Remove one resource alert\n' +
        '/removeallalerts - Remove all alerts\n\n' +
        '<b>Examples:</b>\n' +
        '/alert yam 10 15 → yam at +10% or -15% vs average\n' +
        '/alertall 20 15 → all resources at +20% or -15%\n' +
        '/alertall 20 15 keep → same, keeping existing alerts\n' +
        '/pricealert milk below 0.01 → alert if milk drops below 0.01\n' +
        '/criticalalerts off → disable automatic critical alerts\n\n' +
        '🌐 <b>LANGUAGE</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/language es - Switch to Spanish\n' +
        '/language en - Switch to English\n\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '📱 <b>NTFY PHONE NOTIFICATIONS</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        '/ntfy - Setup NTFY app for phone notifications\n' +
        '/ntfytest - Send test notification to phone\n' +
        '/ntfygraph on/off - Enable/disable graph images in NTFY\n' +
        '/ntfystatus - Check your NTFY settings\n\n' +
        '📋 <b>Note:</b> NTFY notifications are public. DO NOT share your topic.'
      )
    );
  }
  else if (command === '/list') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const resources = await getKnownResources(true);
    await sendTelegramAwait(chatId, `${pick(locale, `📋 <b>${resources.length} recursos detectados</b>`, `📋 <b>${resources.length} detected resources</b>`)}\n${resources.join(', ')}`);
  }
  else if (command === '/price') {
    const blocked = await checkSubscription(chatId);
    if (blocked) { await sendTelegramAwait(chatId, blocked); res.json({ ok: true }); return; }
    const resource = parts.length > 1 ? joinResourceTokens(parts.slice(1)) : null;
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
    const resource = parts.length > 1 ? joinResourceTokens(parts.slice(1)) : null;
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
  else if (command === '/criticalalerts' || command === '/critical') {
    await processCriticalAlertsCommand(chatId, parts[1]);
  }
  else if (command === '/sendpromo') {
    await processSendPromo(chatId);
  }
  else if (command === '/healthpanel' || command === '/panel') {
    await processHealthPanel(chatId);
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
    const resource = parts.length > 1 ? joinResourceTokens(parts.slice(1)) : null;
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
  // Beta gratis: comandos de suscripción ocultos temporalmente.
  else if (command === '/connectwallet' || command === '/wallet' || command === '/subscribe') {
    await sendTelegramAwait(chatId, pick(locale, '🧪 La beta es gratis por ahora. Este comando está oculto temporalmente.', '🧪 The beta is free for now. This command is temporarily hidden.'));
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
  // Beta gratis: status/pay desactivados temporalmente.
  else if (command === '/status' || command === '/pay') {
    await sendTelegramAwait(chatId, pick(locale, '🧪 La beta es gratis por ahora. Este comando está desactivado temporalmente.', '🧪 The beta is free for now. This command is temporarily disabled.'));
  }
  else {
    await sendTelegramAwait(chatId, '❌ Unknown command.\nUse /help to see commands.');
  }

    res.json({ ok: true });
  } catch (error) {
    logger.error('[webhook] fatal error: ' + error.message, { stack: error.stack });
    recordError('telegram.webhook', error.message);
    try {
      const chatId = req?.body?.message?.chat?.id;
      if (chatId) {
        await sendTelegramAwait(chatId, '⚠️ Temporary bot error. I am recovering. Try again in a moment.');
      }
    } catch (notifyError) {
      logger.error('[webhook] fallback notify failed: ' + notifyError.message);
    }
    res.json({ ok: true });
  }
});

// ============================================
// COMMAND PROCESSORS
// ============================================

async function processPriceSimple(chatId, resource) {
  try {
    const locale = await getLocale(chatId);
    const resourceCheck = await assertKnownResource(resource, locale);
    if (!resourceCheck.ok) {
      await sendTelegramAwait(chatId, resourceCheck.message);
      return;
    }

    const normalizedResource = resourceCheck.resource;
    const stats = await getResourceStats(normalizedResource);

    if (!stats) {
      await sendTelegramAwait(chatId, pick(locale, `❌ No hay datos para ${normalizedResource}.\nEspera a que el cron recoja más información.`, `❌ No data for ${normalizedResource}.\nWait for cron to collect more data.`));
      return;
    }

    await sendTelegramAwait(chatId, formatGraphCaption(normalizedResource, stats, locale), {
      reply_markup: buildQuickAlertKeyboard(normalizedResource),
    });
  } catch (error) {
    logger.error('[price] error: ' + error.message);
    recordError('telegram.processPriceSimple', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processAllPrices(chatId) {
  try {
    const locale = await getLocale(chatId);
    const rows = await getAllPrices();
    if (!rows || rows.length === 0) {
      await sendTelegramAwait(chatId, pick(locale, '❌ No hay snapshots recientes para mostrar precios.', '❌ No recent snapshots available to show prices.'));
      return;
    }

    const lines = rows
      .sort((a, b) => a.resource.localeCompare(b.resource))
      .map(row => `• <b>${escapeHtml(row.resource)}</b>: ${formatTrimmed(row.current_price, 9)} (${formatSignedPercent(row.percent_vs_avg)})`);

    await sendTelegramAwait(chatId, `${pick(locale, `📊 <b>${rows.length} recursos con precio reciente</b>`, `📊 <b>${rows.length} resources with recent prices</b>`)}\n\n${lines.join('\n')}`);
  } catch (error) {
    logger.error('[priceall] error: ' + error.message);
    recordError('telegram.processAllPrices', error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processGraph(chatId, resource) {
  try {
    const crypto = require('crypto');
    const locale = await getLocale(chatId);
    const resourceCheck = await assertKnownResource(resource, locale);
    if (!resourceCheck.ok) {
      await sendTelegramAwait(chatId, resourceCheck.message);
      return;
    }
    resource = resourceCheck.resource;

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
    const { getResourceHistory, getAvailableResources } = require('../services/priceFetcher');
    const { generateChartUrl } = require('../services/chartService');
    const resources = await getAvailableResources(7, true);
    const sample = resources.includes('salt') ? 'salt' : (resources[0] || 'yam');
    const history = await getResourceHistory(sample, 90);
    const chartUrl = generateChartUrl(sample, history);
    await sendTelegramAwait(chatId, `🔧 Debug:\nResource: ${sample}\nHistory: ${history.length} points\nURL: ${chartUrl.length} chars`);
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

    const parsedAlert = parsePercentAlertInput(input);
    if (!parsedAlert.ok) {
      await sendTelegramAwait(chatId, pick(locale, '❌ Uso: /alert &lt;resource&gt; &lt;sube%&gt; &lt;baja%&gt;\nEjemplo: /alert yam 10 15', '❌ Usage: /alert &lt;resource&gt; &lt;rise%&gt; &lt;fall%&gt;\nExample: /alert yam 10 15'));
      return;
    }

    const { resource, thresholdHigh, thresholdLow } = parsedAlert;
    const resourceCheck = await assertKnownResource(resource, locale);
    if (!resourceCheck.ok) {
      await sendTelegramAwait(chatId, resourceCheck.message);
      return;
    }
    const normalizedResource = resourceCheck.resource;
    const { data: existing } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', chatId)
      .eq('resource', normalizedResource)
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
          last_notified_rise_step: 0,
          last_notified_fall_at: null,
          last_notified_fall_step: 0,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('user_alerts')
        .insert({ user_id: chatId, resource: normalizedResource, alert_type: 'dual', threshold_high: thresholdHigh, threshold_low: thresholdLow, enabled: true });
      if (error) throw error;
    }

    await sendTelegramAwait(chatId, pick(locale, `✅ Alerta guardada para <b>${normalizedResource}</b>\n▲ Sube: +${thresholdHigh}% | ▼ Baja: ${thresholdLow}%`, `✅ Alert saved for <b>${normalizedResource}</b>\n▲ Rise: +${thresholdHigh}% | ▼ Fall: ${thresholdLow}%`));
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

    const normalizedResource = joinResourceTokens(String(resource).split(/\s+/));
    const { error } = await supabase
      .from('user_alerts')
      .delete()
      .eq('user_id', chatId)
      .eq('resource', normalizedResource);

    if (error) throw error;
    await sendTelegramAwait(chatId, `🗑️ Alert for <b>${normalizedResource}</b> permanently deleted.`);

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
        '→ Set alerts for all detected resources at +20% (rise) OR -15% (fall)\n\n' +
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

    const allResources = await getKnownResources(true);
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
            last_notified_rise_step: 0,
            last_notified_fall_at: null,
            last_notified_fall_step: 0
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
    const parsedTarget = parseTargetAlertArgs(args);
    if (!parsedTarget.ok) {
      await sendTelegramAwait(chatId, pick(locale, '❌ Uso: /pricealert &lt;resource&gt; &lt;above|below&gt; &lt;precio&gt;\nEjemplo: /pricealert milk below 0.01', '❌ Usage: /pricealert &lt;resource&gt; &lt;above|below&gt; &lt;price&gt;\nExample: /pricealert milk below 0.01'));
      return;
    }

    const { resource, direction, targetPrice } = parsedTarget;

    const resourceCheck = await assertKnownResource(resource, locale);
    if (!resourceCheck.ok) {
      await sendTelegramAwait(chatId, resourceCheck.message);
      return;
    }
    const normalizedResource = resourceCheck.resource;

    const alertType = direction === 'above' ? 'price_above' : 'price_below';
    const { data: existing } = await supabase
      .from('user_alerts')
      .select('id')
      .eq('user_id', chatId)
      .eq('resource', normalizedResource)
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
          last_notified_target_step: 0,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('user_alerts')
        .insert({
          user_id: chatId,
          resource: normalizedResource,
          alert_type: alertType,
          target_price: targetPrice,
          target_direction: direction,
          enabled: true,
        });
      if (error) throw error;
    }

    await sendTelegramAwait(chatId, pick(locale, `✅ Alerta objetivo guardada para <b>${normalizedResource}</b>\n🎯 ${direction} ${formatTrimmed(targetPrice, 9)}`, `✅ Target alert saved for <b>${normalizedResource}</b>\n🎯 ${direction} ${formatTrimmed(targetPrice, 9)}`));
  } catch (error) {
    logger.error('[pricealert] error: ' + error.message);
    const locale = await getLocale(chatId);
    const message = String(error?.message || '');

    if (message.includes('user_alerts_alert_type_check')) {
      await sendTelegramAwait(chatId, pick(
        locale,
        '❌ La base de datos todavía tiene una regla vieja y no está permitiendo alertas de tipo <code>above/below</code>.\n\nArreglo rápido en Supabase SQL Editor:\n<code>ALTER TABLE user_alerts DROP CONSTRAINT IF EXISTS user_alerts_alert_type_check;</code>',
        '❌ The database still has an old rule and is not allowing <code>above/below</code> alert types yet.\n\nQuick fix in Supabase SQL Editor:\n<code>ALTER TABLE user_alerts DROP CONSTRAINT IF EXISTS user_alerts_alert_type_check;</code>'
      ));
      return;
    }

    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processLanguage(chatId, languageInput) {
  try {
    const current = await getLocale(chatId);
    if (!languageInput) {
      await sendTelegramAwait(chatId, pick(current, `🌐 Idioma actual: <b>${current.toUpperCase()}</b>\nElige abajo el idioma que quieres usar.`, `🌐 Current language: <b>${current.toUpperCase()}</b>\nChoose below the language you want to use.`), {
        reply_markup: buildLanguageKeyboard(),
      });
      return;
    }
    const language = await setUserLanguage(String(chatId), languageInput);
    await sendTelegramAwait(chatId, pick(language, '✅ Idioma cambiado a <b>Español</b>.', '✅ Language changed to <b>English</b>.'));
  } catch (error) {
    logger.error('[language] error: ' + error.message);
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processCriticalAlertsCommand(chatId, value) {
  try {
    const locale = await getLocale(chatId);
    if (!value) {
      const enabled = await getCriticalAlertsEnabled(String(chatId));
      await sendTelegramAwait(chatId, pick(locale,
        `🚨 Alertas críticas: <b>${enabled ? 'ON' : 'OFF'}</b>\n\nUsa /criticalalerts on o /criticalalerts off`,
        `🚨 Critical alerts: <b>${enabled ? 'ON' : 'OFF'}</b>\n\nUse /criticalalerts on or /criticalalerts off`
      ));
      return;
    }

    const normalized = String(value).toLowerCase();
    if (!['on', 'off'].includes(normalized)) {
      await sendTelegramAwait(chatId, pick(locale,
        '❌ Uso: /criticalalerts on|off',
        '❌ Usage: /criticalalerts on|off'
      ));
      return;
    }

    const enabled = await setCriticalAlertsEnabled(String(chatId), normalized === 'on');
    await sendTelegramAwait(chatId, pick(locale,
      `✅ Alertas críticas ${enabled ? 'activadas' : 'desactivadas'}.`,
      `✅ Critical alerts ${enabled ? 'enabled' : 'disabled'}.`
    ));
  } catch (error) {
    logger.error('[criticalalerts] error: ' + error.message);
    recordError('telegram.processCriticalAlertsCommand', error.message);
    const locale = await getLocale(chatId);
    if (String(error.message || '').includes('Database migration required for critical alerts')) {
      await sendTelegramAwait(chatId, pick(locale,
        '❌ Falta la migración de base de datos para alertas críticas.\n\nSQL:\n<code>ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS critical_alerts_enabled BOOLEAN NOT NULL DEFAULT true;</code>',
        '❌ The database migration for critical alerts is still missing.\n\nSQL:\n<code>ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS critical_alerts_enabled BOOLEAN NOT NULL DEFAULT true;</code>'
      ));
      return;
    }
    await sendTelegramAwait(chatId, `Error: ${error.message}`);
  }
}

async function processSendPromo(chatId) {
  const locale = await getLocale(chatId);
  if (!isAdmin(chatId)) {
    await sendTelegramAwait(chatId, pick(locale, '❌ Este comando es solo para admin.', '❌ This command is admin only.'));
    return;
  }

  const promoGuard = canSendPromo(chatId);
  if (!promoGuard.allowed) {
    await sendTelegramAwait(chatId, pick(locale, `⏳ Espera ${formatDurationMinutes(promoGuard.remainingMs)} antes de enviar otra promo.`, `⏳ Wait ${formatDurationMinutes(promoGuard.remainingMs)} before sending another promo.`));
    return;
  }

  await setPendingAction(String(chatId), 'sendpromo_es', {});
  await sendTelegramAwait(chatId, pick(locale, '📣 Manda la promo en español.', '📣 Send the promo in Spanish.'));
}

async function processHealthPanel(chatId) {
  const locale = await getLocale(chatId);
  if (!isAdmin(chatId)) {
    await sendTelegramAwait(chatId, pick(locale, '❌ Este comando es solo para admin.', '❌ This command is admin only.'));
    return;
  }

  try {
    const [usersResult, alertsResult] = await Promise.all([
      supabase.from('user_subscriptions').select('user_id', { count: 'exact', head: true }),
      supabase.from('user_alerts').select('id', { count: 'exact', head: true }).eq('enabled', true),
    ]);

    const usersActive = usersResult.count || 0;
    const alertsActive = alertsResult.count || 0;
    const snapshot = getRuntimeHealthSnapshot({ adminId: String(chatId) });
    const cooldownText = snapshot.promoCooldownRemainingMs > 0
      ? formatDurationMinutes(snapshot.promoCooldownRemainingMs)
      : pick(locale, 'lista', 'ready');

    const message = pick(locale,
      `🩺 <b>Panel de salud</b>\n\n👥 Usuarios activos: <b>${usersActive}</b>\n🔔 Alertas activas: <b>${alertsActive}</b>\n📣 Promos enviadas (24h): <b>${snapshot.promosSent24h}</b>\n❌ Errores últimas 24h: <b>${snapshot.errors24h}</b>\n⏳ Cooldown promo: <b>${cooldownText}</b>`,
      `🩺 <b>Health panel</b>\n\n👥 Active users: <b>${usersActive}</b>\n🔔 Active alerts: <b>${alertsActive}</b>\n📣 Promos sent (24h): <b>${snapshot.promosSent24h}</b>\n❌ Errors last 24h: <b>${snapshot.errors24h}</b>\n⏳ Promo cooldown: <b>${cooldownText}</b>`
    );

    await sendTelegramAwait(chatId, message);
  } catch (error) {
    logger.error('[healthpanel] error: ' + error.message);
    recordError('telegram.processHealthPanel', error.message);
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
  const ok = await sendTelegramAwait(OWNER_TELEGRAM_ID, '🐣 Test from SFL Watcher API!');
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
