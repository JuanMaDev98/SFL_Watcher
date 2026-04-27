require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN not set, Telegram notifications disabled');
}

/**
 * Send notification via Telegram bot
 * @param {string} chatId - Telegram chat ID
 * @param {string} message - Message text (HTML supported)
 * @returns {Promise<boolean>}
 */
async function sendTelegramMessage(chatId, message) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('Telegram: Bot token not configured, skipping message');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
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
      console.error('Telegram API error:', data.description);
      return false;
    }

    console.log(`✅ Telegram message sent to ${chatId}`);
    return true;

  } catch (error) {
    console.error('Telegram send error:', error.message);
    return false;
  }
}

/**
 * Format price alert as Telegram message
 * @param {Object} alert - Alert data
 * @param {Object} priceData - Current price data
 * @returns {string}
 */
function formatPriceAlert(alert, priceData) {
  const emoji = alert.percent_change > 0 ? '📈' : '📉';
  const direction = alert.percent_change > 0 ? 'SUBIÓ' : 'BAJÓ';
  
  return `
${emoji} <b>SFL Watcher Alert</b>

<b>${alert.resource.toUpperCase()}</b> ${direction}!

💰 Precio actual: <code>${priceData.current_price}</code>
📊 vs promedio (90d): <code>${priceData.percent_vs_avg > 0 ? '+' : ''}${priceData.percent_vs_avg}%</code>
📉 Promedio: <code>${priceData.avg_price}</code>
📍 Mín/Máx (90d): <code>${priceData.min_price}</code> / <code>${priceData.max_price}</code>

🕐 ${new Date().toISOString()}
  `.trim();
}

module.exports = {
  sendTelegramMessage,
  formatPriceAlert
};