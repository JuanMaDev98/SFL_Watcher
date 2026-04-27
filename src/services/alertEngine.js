const supabase = require('../lib/supabase');
const { sendTelegramMessage, formatPriceAlert } = require('./telegramService');

/**
 * Check all active alerts and send notifications if thresholds are breached
 * Called after every price fetch
 */
async function checkAlerts() {
  console.log('🔔 Checking alerts...');

  try {
    // Get all active alerts with user info
    const { data: alerts, error } = await supabase
      .from('user_alerts')
      .select('*, users:telegram_chat_id')
      .eq('enabled', true);

    if (error) throw error;

    if (!alerts || alerts.length === 0) {
      console.log('No active alerts to check');
      return;
    }

    console.log(`Checking ${alerts.length} alerts...`);

    for (const alert of alerts) {
      try {
        await checkSingleAlert(alert);
      } catch (err) {
        console.error(`Error checking alert ${alert.id}:`, err.message);
      }
    }

  } catch (error) {
    console.error('checkAlerts error:', error.message);
  }
}

/**
 * Check a single alert
 */
async function checkSingleAlert(alert) {
  // Get current price stats for this resource
  const { data: stats, error } = await supabase
    .rpc('get_price_stats', { resource_name: alert.resource });

  if (error || !stats || stats.length === 0) {
    console.log(`No stats for ${alert.resource}`);
    return;
  }

  const priceData = stats[0];
  const percentVsAvg = priceData.percent_vs_avg || 0;

  let shouldNotify = false;
  let reason = '';

  switch (alert.alert_type) {
    case 'spike':
      // Alert if price moved more than threshold % from previous snapshot
      // For now, use threshold_percent as absolute change threshold
      shouldNotify = Math.abs(percentVsAvg) >= (alert.threshold_percent || 10);
      reason = `spike: ${percentVsAvg}% vs avg`;
      break;

    case 'threshold_above':
      // Alert if price is X% above average
      shouldNotify = percentVsAvg >= (alert.threshold_percent || 20);
      reason = `above threshold: ${percentVsAvg}% >= ${alert.threshold_percent}%`;
      break;

    case 'threshold_below':
      // Alert if price is X% below average
      shouldNotify = percentVsAvg <= -(alert.threshold_percent || 20);
      reason = `below threshold: ${percentVsAvg}% <= -${alert.threshold_percent}%`;
      break;

    case 'seasonal':
      // TODO: Implement seasonal pattern detection
      console.log(`Seasonal alerts not yet implemented for ${alert.resource}`);
      return;

    default:
      return;
  }

  if (shouldNotify && alert.user_id) {
    const message = formatPriceAlert({
      resource: alert.resource,
      percent_change: percentVsAvg
    }, priceData);

    await sendTelegramMessage(alert.user_id, message);
    console.log(`✅ Alert sent for ${alert.resource} (${reason})`);
  }
}

/**
 * Get user's telegram chat ID from user_alerts
 * Note: In production, users table would have telegram_chat_id
 */
async function getUserTelegramChatId(userId) {
  // For now, assume user_id IS the telegram chat_id
  // In production, you'd look up in a users table
  return userId;
}

module.exports = {
  checkAlerts,
  checkSingleAlert
};