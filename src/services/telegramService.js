const supabase = require('../lib/supabase');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

/**
 * Send notification via Telegram bot (awaited, Vercel-safe)
 */
async function sendTelegramMessage(chatId, message) {
  if (!TELEGRAM_API) {
    console.log('[Telegram] Bot token not configured, skipping');
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
      console.error('[Telegram] Error:', data.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[Telegram] Send error:', error.message);
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
        console.error(`[Telegram] sendPhoto failed: ${JSON.stringify(data)}`);
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
    console.error('[Telegram] Photo send error:', error.message);
    return false;
  }
}

/**
 * Format price alert as Telegram message
 */
function formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow) {
  const isAbove = currentPct > 0;
  const emoji = isAbove ? '🔺' : '🔻';
  const direction = isAbove ? 'SUBIÓ' : 'BAJÓ';
  const sign = currentPct > 0 ? '+' : '';

  // 90-day min/max indicator
  let minMaxLabel = '';
  if (stats.is90DayMin) {
    minMaxLabel = '\n\n🟢 <b>90-Day MINIMUM - BUY OPPORTUNITY!</b>';
  } else if (stats.is90DayMax) {
    minMaxLabel = '\n\n🔴 <b>90-Day MAXIMUM - SELL TIME!</b>';
  }

  const lines = [
    `${emoji} <b>SFL Watcher Alert</b>`,
    `<b>${resource.toUpperCase()}</b> ${direction} del promedio!`,
    '',
    `💰 Precio actual: <code>${stats.current_price}</code>`,
    `📊 vs promedio: <code>${sign}${currentPct}%</code>`,
    `📈 Promedio (historial): <code>${stats.avg_price}</code>`,
    `📍 Mín/Máx: <code>${stats.min_price}</code> / <code>${stats.max_price}</code>`,
    `📋 Snapshots usados: <code>${stats.snapshot_count}</code>`,
    minMaxLabel,
    '',
    `⚙️ Tus umbrales:`,
    `   ▲ Umbral alto: +${thresholdHigh}%`,
    `   ▼ Umbral bajo: ${thresholdLow}%`,
  ];

  return lines.join('\n');
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
  formatThresholdConfig
};