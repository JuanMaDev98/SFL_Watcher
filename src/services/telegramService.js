const supabase = require('../lib/supabase');
const logger = require('../utils/logger');
const {
  formatPercentAlertMessage,
  formatPriceAlertMessage,
} = require('./formatters');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

/**
 * Send notification via Telegram bot (awaited, Vercel-safe)
 */
async function sendTelegramMessage(chatId, message) {
  if (!TELEGRAM_API) {
    logger.info('[Telegram] Bot token not configured, skipping');
    return false;
  }

  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_preview: true
      })
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error('[Telegram] Error:', data.description);
      return false;
    }
    return true;
  } catch (error) {
    logger.error('[Telegram] Send error:', error.message);
    return false;
  }
}

/**
 * Send photo/caption to Telegram
 */
async function sendTelegramPhoto(chatId, photoDataUrl, caption) {
  if (!TELEGRAM_API) return false;

  try {
    // Detect if data URL and convert to blob for upload
    let body;
    if (photoDataUrl.startsWith('data:')) {
      const mimeMatch = photoDataUrl.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/png';
      const base64 = photoDataUrl.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const blob = new Blob([buffer], { type: mime });

      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', blob, 'alert_chart.png');
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');

      const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: 'POST', body: form });
      const data = await resp.json();
      if (!resp.ok) {
        logger.error(`[Telegram] sendPhoto failed: ${JSON.stringify(data)}`);
      }
      return resp.ok;
    } else {
      const resp = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo: photoDataUrl, caption, parse_mode: 'HTML' })
      });
      return resp.ok;
    }
  } catch (error) {
    logger.error('[Telegram] Photo send error:', error.message);
    return false;
  }
}

/**
 * Format price alert as Telegram message
 */
function formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow, language = 'es') {
  return formatPercentAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow, language);
}

function formatTargetAlertMessage(resource, direction, targetPrice, stats, language = 'es') {
  return formatPriceAlertMessage(resource, direction, targetPrice, stats, language);
}

/**
 * Format threshold config message
 */
function formatThresholdConfig(resource, currentPct, thresholdHigh, thresholdLow, isBreached, breachType) {
  const emoji = breachType === 'high' ? '🔺' : (breachType === 'low' ? '🔻' : '✅');
  const sign = currentPct > 0 ? '+' : '';

  const lines = [
    `${emoji} <b>${resource.toUpperCase()} - Status</b>`,
    `📊 Precio actual vs promedio: <code>${sign}${currentPct}%</code>`,
    '',
    `⚙️ <b>Configuración de alertas:</b>`,
    `   ▲ Umbral alto: +${thresholdHigh}% → ${currentPct >= thresholdHigh ? '✅ ACTIVO' : '⏳ inactivo'}`,
    `   ▼ Umbral bajo: ${thresholdLow}% → ${currentPct <= thresholdLow ? '✅ ACTIVO' : '⏳ inactivo'}`,
  ];

  if (isBreached) {
    lines.push('');
    lines.push(`🚨 <b>⚠️ ALERTA: Precio ${breachType === 'high' ? 'ARRIBA' : 'ABAJO'} del umbral!</b>`);
  }

  return lines.join('\n');
}

module.exports = {
  sendTelegramMessage,
  sendTelegramPhoto,
  formatAlertMessage,
  formatTargetAlertMessage,
  formatThresholdConfig
};
