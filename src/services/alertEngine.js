const supabase = require('../lib/supabase');
const { sendTelegramMessage, formatAlertMessage, sendTelegramPhoto } = require('./telegramService');
const { generateChartDataUrl, generateChartBuffer, calculateStats } = require('./chartService');

/**
 * Check all active alerts after a price fetch
 * Alert configuration: threshold_high (for price going up) and threshold_low (for price going down)
 * Both stored in user_alerts.threshold_percent (as a string like "10/-15")
 * Or use separate columns: threshold_high and threshold_low
 */
async function checkAlerts() {
  console.log('[AlertEngine] Checking alerts after price fetch...');

  try {
    // Get all active alerts
    const { data: alerts, error } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('enabled', true);

    if (error) throw error;
    if (!alerts || alerts.length === 0) {
      console.log('[AlertEngine] No active alerts');
      return;
    }

    console.log(`[AlertEngine] Checking ${alerts.length} alerts`);

    // Group by resource to batch-get stats
    const alertsByResource = {};
    alerts.forEach(a => {
      if (!alertsByResource[a.resource]) alertsByResource[a.resource] = [];
      alertsByResource[a.resource].push(a);
    });

    // Check each resource's stats once
    for (const [resource, resourceAlerts] of Object.entries(alertsByResource)) {
      await checkResourceAlerts(resource, resourceAlerts);
    }

  } catch (error) {
    console.error('[AlertEngine] Error:', error.message);
  }
}

/**
 * Check alerts for a specific resource
 */
async function checkResourceAlerts(resource, alerts) {
  try {
    // Get stats for this resource using RPC
    const { data: statsArr, error } = await supabase
      .rpc('get_price_stats', { resource_name: resource });

    if (error) {
      console.error(`[AlertEngine] RPC error for ${resource}:`, error.message);
      return;
    }

    if (!statsArr || statsArr.length === 0) {
      console.log(`[AlertEngine] No stats for ${resource}`);
      return;
    }

    const stats = statsArr[0];
    const currentPct = parseFloat(stats.percent_vs_avg.toFixed(2));

    console.log(`[AlertEngine] ${resource}: current=${currentPct}%, avg=${stats.avg_price}, cur=${stats.current_price}`);

    for (const alert of alerts) {
      // Parse thresholds - stored as "high/low" or separate columns
      let thresholdHigh = 10;
      let thresholdLow = -10;

      // Support both formats: "10/-15" string OR numeric columns
      if (typeof alert.threshold_percent === 'string' && alert.threshold_percent.includes('/')) {
        const [th, tl] = alert.threshold_percent.split('/');
        thresholdHigh = parseFloat(th);
        thresholdLow = parseFloat(tl);
      } else if (alert.threshold_high !== undefined && alert.threshold_low !== undefined) {
        thresholdHigh = alert.threshold_high;
        thresholdLow = alert.threshold_low;
      } else {
        // Fallback: threshold_percent is the magnitude, direction determined by alert_type
        // threshold_above = high threshold, threshold_below = low threshold (negative)
        thresholdHigh = alert.alert_type === 'threshold_above' ? alert.threshold_percent : 10;
        thresholdLow = alert.alert_type === 'threshold_below' ? -alert.threshold_percent : -10;
      }

      const triggered = currentPct >= thresholdHigh || currentPct <= thresholdLow;

      if (triggered) {
        // Check cooldown - don't spam the user
        const lastNotified = alert.last_notified_at ? new Date(alert.last_notified_at) : null;
        const now = new Date();
        const cooldownHours = 1; // 1 hour cooldown
        const withinCooldown = lastNotified && (now - lastNotified) < (cooldownHours * 60 * 60 * 1000);

        if (withinCooldown) {
          console.log(`[AlertEngine] ${resource}: alert triggered but within cooldown, skipping`);
          continue;
        }

        console.log(`[AlertEngine] 🚨 TRIGGERED: ${resource} at ${currentPct}% (thresholds: +${thresholdHigh}/${thresholdLow}%)`);

        // Send alert with chart
        await sendAlertWithChart(alert.user_id, resource, currentPct, stats, thresholdHigh, thresholdLow);

        // Update last_notified_at
        await supabase
          .from('user_alerts')
          .update({ last_notified_at: now.toISOString() })
          .eq('id', alert.id);

      } else {
        console.log(`[AlertEngine] ${resource}: ${currentPct}% within thresholds (+${thresholdHigh}/${thresholdLow}%)`);
      }
    }

  } catch (error) {
    console.error(`[AlertEngine] Error checking ${resource}:`, error.message);
  }
}

/**
 * Send alert message with chart image
 */
async function sendAlertWithChart(userId, resource, currentPct, stats, thresholdHigh, thresholdLow) {
  try {
    // Get history for chart (last 30 points)
    const { data: history } = await supabase
      .from('price_snapshots')
      .select('price, created_at')
      .eq('resource', resource)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!history || history.length < 2) {
      // Send text-only alert
      const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow);
      await sendTelegramMessage(userId, msg);
      return;
    }

    // Generate chart PNG
    const { chartConfig } = generateChartDataUrl(resource, history);
    const arrayBuffer = await generateChartBuffer(chartConfig);
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const chartDataUrl = `data:image/png;base64,${base64}`;

    // Build caption
    const sign = currentPct > 0 ? '+' : '';
    const caption = `${currentPct >= thresholdHigh ? '🔺' : '🔻'} <b>${resource.toUpperCase()} Alert!</b>\n` +
      `Current: <code>${sign}${currentPct}%</code> vs avg\n` +
      `Thresholds: ▲ +${thresholdHigh}% | ▼ ${thresholdLow}%`;

    const sent = await sendTelegramPhoto(userId, chartDataUrl, caption);
    if (!sent) {
      // Fallback to text
      const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow);
      await sendTelegramMessage(userId, msg);
    }

  } catch (error) {
    console.error('[AlertEngine] sendAlertWithChart error:', error.message);
    // Fallback to text
    const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow);
    await sendTelegramMessage(userId, msg);
  }
}

/**
 * Test alert system for a specific resource (for debugging)
 */
async function testAlertForResource(resource, userId = '1166287745') {
  const { data: statsArr } = await supabase.rpc('get_price_stats', { resource_name: resource });
  if (!statsArr || statsArr.length === 0) return null;
  const stats = statsArr[0];
  const currentPct = parseFloat(stats.percent_vs_avg.toFixed(2));
  return { resource, currentPct, stats };
}

module.exports = { checkAlerts, testAlertForResource };