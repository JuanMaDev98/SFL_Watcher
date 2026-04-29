const supabase = require('../lib/supabase');
const { sendTelegramMessage, formatAlertMessage, sendTelegramPhoto } = require('./telegramService');
const { generateChartDataUrl, generateChartBuffer } = require('./chartService');
const { sendNtfyNotification, formatNtfyAlert, getUserNtfyTopic } = require('./ntfyService');

/**
 * Get stats for a resource using direct query
 * Also checks if current price is min/max in last 90 days
 */
async function getResourceStats(resource, check90Day = true) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: snapshots, error } = await supabase
    .from('price_snapshots')
    .select('price, created_at')
    .eq('resource', resource)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!snapshots || snapshots.length === 0) return null;

  const prices = snapshots.map(s => parseFloat(s.price));
  const current_price = prices[0];
  const avg_price = prices.reduce((a, b) => a + b, 0) / prices.length;
  const min_price = Math.min(...prices);
  const max_price = Math.max(...prices);
  const snapshot_count = prices.length;
  const percent_vs_avg = avg_price > 0 ? ((current_price - avg_price) / avg_price * 100) : 0;

  // Check 90-day min/max
  let is90DayMin = false;
  let is90DayMax = false;

  if (check90Day) {
    const recentSnapshots = snapshots.filter(s => new Date(s.created_at) >= ninetyDaysAgo);
    if (recentSnapshots.length > 0) {
      const recentPrices = recentSnapshots.map(s => parseFloat(s.price));
      const min90 = Math.min(...recentPrices);
      const max90 = Math.max(...recentPrices);
      is90DayMin = current_price <= min90;
      is90DayMax = current_price >= max90;
    }
  }

  return { 
    resource, 
    current_price, 
    avg_price, 
    min_price, 
    max_price, 
    percent_vs_avg, 
    snapshot_count,
    is90DayMin,
    is90DayMax
  };
}

/**
 * Get NTFY settings for a user
 */
async function getUserNtfyEnabled(userId) {
  console.log(`[AlertEngine] getUserNtfyEnabled() called for userId: ${userId}`);
  
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('ntfy_enabled, ntfy_graph_enabled')
    .eq('user_id', userId)
    .single();
  
  if (error) {
    console.error(`[AlertEngine] ❌ Error fetching NTFY settings: ${error.message}`);
    console.error(`[AlertEngine] Error details:`, JSON.stringify(error));
    return { enabled: false, graphEnabled: true };
  }
  
  if (!data) {
    console.log(`[AlertEngine] ⚠️ No subscription record found for userId: ${userId}`);
    return { enabled: false, graphEnabled: true };
  }
  
  console.log(`[AlertEngine] ✅ NTFY settings found:`);
  console.log(`[AlertEngine]   - ntfy_enabled: ${data.ntfy_enabled}`);
  console.log(`[AlertEngine]   - ntfy_graph_enabled: ${data.ntfy_graph_enabled}`);
  
  return {
    enabled: data?.ntfy_enabled || false,
    graphEnabled: data?.ntfy_graph_enabled !== undefined ? data.ntfy_graph_enabled : true
  };
}

/**
 * Check all active alerts after a price fetch
 */
async function checkAlerts() {
  console.log('[AlertEngine] Checking alerts after price fetch...');

  try {
    // Get all active alerts (simple query, no joins)
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

    // Group by resource to get stats once per resource
    const alertsByResource = {};
    alerts.forEach(a => {
      if (!alertsByResource[a.resource]) alertsByResource[a.resource] = [];
      alertsByResource[a.resource].push(a);
    });

    // Check each resource
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
    // Get stats using direct query
    const stats = await getResourceStats(resource);

    if (!stats) {
      console.log(`[AlertEngine] No stats for ${resource}`);
      return;
    }

    const currentPct = parseFloat(stats.percent_vs_avg.toFixed(2));

    console.log(`[AlertEngine] ${resource}: current=${currentPct}%, avg=${stats.avg_price?.toFixed(4)}, cur=${stats.current_price?.toFixed(4)}`);

    for (const alert of alerts) {
      const thresholdHigh = alert.threshold_high || 10;
      const thresholdLow = alert.threshold_low || -10;

      const triggered = currentPct >= thresholdHigh || currentPct <= thresholdLow;

      if (triggered) {
        const now = new Date();
        const cooldownHours = 12;
        
        // Determine if this is a RISE or FALL alert
        const isRiseAlert = currentPct >= thresholdHigh;
        const isFallAlert = currentPct <= thresholdLow;
        
        // Check cooldown based on direction
        let withinCooldown = false;
        if (isRiseAlert && alert.last_notified_rise_at) {
          const lastNotified = new Date(alert.last_notified_rise_at);
          withinCooldown = (now - lastNotified) < (cooldownHours * 60 * 60 * 1000);
        } else if (isFallAlert && alert.last_notified_fall_at) {
          const lastNotified = new Date(alert.last_notified_fall_at);
          withinCooldown = (now - lastNotified) < (cooldownHours * 60 * 60 * 1000);
        }

        if (withinCooldown) {
          console.log(`[AlertEngine] ${resource}: alert triggered (${isRiseAlert ? 'RISE' : 'FALL'}) but within 12h cooldown, skipping`);
          continue;
        }

        console.log(`[AlertEngine] 🚨 TRIGGERED: ${resource} at ${currentPct}% (${isRiseAlert ? 'RISE' : 'FALL'}, thresholds: +${thresholdHigh}/${thresholdLow}%)`);

        // Send Telegram alert with chart
        await sendTelegramAlert(alert.user_id, resource, currentPct, stats, thresholdHigh, thresholdLow);

        // Send NTFY notification if enabled
        const ntfySettings = await getUserNtfyEnabled(alert.user_id);
        console.log(`[AlertEngine] NTFY check for user ${alert.user_id}: enabled=${ntfySettings.enabled}, graphEnabled=${ntfySettings.graphEnabled}`);
        if (ntfySettings.enabled) {
          try {
            await sendNtfyAlertNotification(alert.user_id, resource, currentPct, stats, thresholdHigh, thresholdLow, ntfySettings.graphEnabled);
            console.log(`[AlertEngine] NTFY notification sent for ${resource}`);
          } catch (ntfyErr) {
            console.error(`[AlertEngine] NTFY error for ${resource}:`, ntfyErr.message);
          }
        } else {
          console.log(`[AlertEngine] NTFY skipped for ${resource} - not enabled`);
        }

        // Update last_notified based on direction
        // Reset opposite cooldown so price can cross both ways within 12h window
        const updateField = isRiseAlert ? 'last_notified_rise_at' : 'last_notified_fall_at';
        const updates = { [updateField]: now.toISOString() };
        
        if (isFallAlert) {
          // Reset rise cooldown so next rise can notify
          updates.last_notified_rise_at = null;
        } else if (isRiseAlert) {
          // Reset fall cooldown so next fall can notify
          updates.last_notified_fall_at = null;
        }
        
        await supabase
          .from('user_alerts')
          .update(updates)
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
 * Send Telegram alert with chart image
 */
async function sendTelegramAlert(userId, resource, currentPct, stats, thresholdHigh, thresholdLow) {
  const sign = currentPct > 0 ? '+' : '';
  const emoji = currentPct >= thresholdHigh ? '🔺' : '🔻';

  try {
    // Get history for chart
    const { data: history } = await supabase
      .from('price_snapshots')
      .select('price, created_at')
      .eq('resource', resource)
      .order('created_at', { ascending: false })
      .limit(30);

    if (history && history.length >= 2) {
      // Generate and send chart
      const { chartConfig } = generateChartDataUrl(resource, history.reverse());
      const arrayBuffer = await generateChartBuffer(chartConfig);
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');
      const chartDataUrl = `data:image/png;base64,${base64}`;

      const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow);

      const caption = msg;

      const sent = await sendTelegramPhoto(userId, chartDataUrl, caption);
      if (!sent) {
        console.error(`[AlertEngine] sendTelegramPhoto failed for ${userId}, falling back to text`);
        const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow);
        await sendTelegramMessage(userId, msg);
      }
    } else {
      // Not enough history, send text only
      const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow);
      await sendTelegramMessage(userId, msg);
    }

  } catch (error) {
    console.error('[AlertEngine] sendTelegramAlert error:', error.message);
    const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow);
    await sendTelegramMessage(userId, msg);
  }
}

/**
 * Send NTFY notification (with optional chart)
 */
async function sendNtfyAlertNotification(userId, resource, currentPct, stats, thresholdHigh, thresholdLow, includeGraph) {
  console.log(`[AlertEngine] sendNtfyAlertNotification() ===`);
  console.log(`[AlertEngine]   userId: ${userId}`);
  console.log(`[AlertEngine]   resource: ${resource}`);
  console.log(`[AlertEngine]   currentPct: ${currentPct}%`);
  console.log(`[AlertEngine]   thresholdHigh: ${thresholdHigh}%`);
  console.log(`[AlertEngine]   thresholdLow: ${thresholdLow}%`);
  console.log(`[AlertEngine]   includeGraph: ${includeGraph}`);
  
  try {
    const topic = getUserNtfyTopic(userId);
    console.log(`[AlertEngine] Generated topic: ${topic}`);
    
    const message = formatNtfyAlert(resource, currentPct, stats, thresholdHigh, thresholdLow);
    console.log(`[AlertEngine] Formatted message:\n${message}`);

    // Always send text-only notification (no images)
    console.log(`[AlertEngine] Sending text-only notification...`);
    const result = await sendNtfyNotification(topic, message, {
      title: `${resource.toUpperCase()} Alert`,
      tags: 'warning'
    });
    console.log(`[AlertEngine] sendNtfyNotification result: ${result}`);
    return result;

  } catch (error) {
    console.error(`[AlertEngine] ❌ sendNtfyAlertNotification error: ${error.message}`);
    console.error(`[AlertEngine] Error stack:`, error.stack);
  }
}

/**
 * Test alert system for debugging
 */
async function testAlertForResource(resource) {
  const stats = await getResourceStats(resource);
  if (!stats) return null;
  const currentPct = parseFloat(stats.percent_vs_avg.toFixed(2));
  return { resource, currentPct, stats };
}

module.exports = { checkAlerts, testAlertForResource };
