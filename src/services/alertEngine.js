const supabase = require('../lib/supabase');
const { sendTelegramMessage, formatAlertMessage, formatTargetAlertMessage, sendTelegramPhoto } = require('./telegramService');
const { generateChartDataUrl, generateChartBuffer } = require('./chartService');
const { sendNtfyNotification, formatNtfyAlert, formatNtfyTargetAlert, getUserNtfyTopic } = require('./ntfyService');
const { getUserLanguage, getBroadcastUsers } = require('./subscriptionService');
const { getResourceHistory } = require('./priceFetcher');
const { shouldThrottleAlert, clearAlertThrottle, recordError } = require('./runtimeStatsService');
const logger = require('../utils/logger');

const percentAlertState = new Map();
const targetAlertState = new Map();
const criticalAlertState = new Map();
const ALERT_ESCALATION_STEP_PCT = 20;
const CRITICAL_THRESHOLD_PCT = 50;
const CRITICAL_STEP_PCT = 20;
const CRITICAL_RESET_PCT = 0;

function getPercentResetThreshold() {
  return 0;
}

function getPercentStep(currentPct, threshold, direction) {
  const current = Number(currentPct || 0);
  const base = Math.abs(Number(threshold || 0));
  if (!base) return 0;
  if (direction === 'rise') {
    if (current < base) return 0;
    return 1 + Math.floor((current - base) / ALERT_ESCALATION_STEP_PCT);
  }
  if (current > -base) return 0;
  return 1 + Math.floor((Math.abs(current) - base) / ALERT_ESCALATION_STEP_PCT);
}

function getTargetResetPrice(targetPrice) {
  const target = Number(targetPrice || 0);
  if (!target) return 0;
  return target;
}

function getTargetStep(currentPrice, targetPrice, direction) {
  const current = Number(currentPrice || 0);
  const target = Number(targetPrice || 0);
  if (!target) return 0;

  if (direction === 'above') {
    if (current < target) return 0;
    const progressPct = ((current - target) / target) * 100;
    return 1 + Math.floor(progressPct / 20);
  }

  if (current > target) return 0;
  const progressPct = ((target - current) / target) * 100;
  return 1 + Math.floor(progressPct / 20);
}

function getOrInitPercentState(alertId, alert, currentPct) {
  if (!percentAlertState.has(alertId)) {
    const fallbackRiseStep = alert?.last_notified_rise_at
      ? Math.max(getPercentStep(currentPct, alert?.threshold_high || 10, 'rise'), 1)
      : 0;
    const fallbackFallStep = alert?.last_notified_fall_at
      ? Math.max(getPercentStep(currentPct, alert?.threshold_low || -10, 'fall'), 1)
      : 0;

    percentAlertState.set(alertId, {
      riseStep: Number(alert?.last_notified_rise_step) || fallbackRiseStep,
      fallStep: Number(alert?.last_notified_fall_step) || fallbackFallStep,
    });
  }
  return percentAlertState.get(alertId);
}

function getOrInitTargetState(alertId, alert, stats) {
  if (!targetAlertState.has(alertId)) {
    const direction = alert?.target_direction || (alert?.alert_type === 'price_above' ? 'above' : 'below');
    const fallbackStep = alert?.last_notified_target_at
      ? Math.max(getTargetStep(stats?.current_price, alert?.target_price, direction), 1)
      : 0;
    const initialStep = Number(alert?.last_notified_target_step) || fallbackStep;
    targetAlertState.set(alertId, { step: initialStep });
  }
  return targetAlertState.get(alertId);
}

function getCriticalState(userId, resource, direction, initialStep = 0) {
  const key = `${userId}:${resource}:${direction}`;
  if (!criticalAlertState.has(key)) {
    criticalAlertState.set(key, { step: Number(initialStep) || 0 });
  }
  return criticalAlertState.get(key);
}

async function loadCriticalStates(resource, userIds = []) {
  if (!resource || !Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const normalizedUserIds = [...new Set(userIds.map(id => String(id)).filter(Boolean))];
  if (!normalizedUserIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('critical_alert_states')
    .select('user_id, resource, direction, current_step')
    .eq('resource', resource)
    .in('user_id', normalizedUserIds);

  if (error) {
    throw error;
  }

  const stateMap = new Map();
  for (const row of data || []) {
    stateMap.set(`${row.user_id}:${row.direction}`, Number(row.current_step) || 0);
  }
  return stateMap;
}

async function persistCriticalState(userId, resource, direction, step, currentPct) {
  const payload = {
    user_id: String(userId),
    resource,
    direction,
    current_step: Number(step) || 0,
    last_percent: Number(currentPct),
    last_notified_at: step > 0 ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('critical_alert_states')
    .upsert(payload, { onConflict: 'user_id,resource,direction' });

  if (error) {
    throw error;
  }
}

/**
 * Get stats for a resource using optimized SQL function
 * This replaces loading all rows into memory
 */
async function getResourceStats(resource, check90Day = true) {
  try {
    // Use the efficient SQL function
    const { data, error } = await supabase
      .rpc('get_price_stats', { 
        resource_name: resource,
        days_limit: 90 
      });

    if (error) {
      // Fallback to direct query if RPC fails
      logger.warn(`[AlertEngine] RPC failed, using fallback query: ${error.message}`);
      return getResourceStatsFallback(resource, check90Day);
    }

    if (!data || data.length === 0) return null;

    const stats = data[0];
    return {
      resource: stats.p_resource || resource,
      current_price: parseFloat(stats.current_price),
      avg_price: parseFloat(stats.avg_price),
      min_price: parseFloat(stats.min_price),
      max_price: parseFloat(stats.max_price),
      percent_vs_avg: parseFloat(stats.percent_vs_avg),
      snapshot_count: parseInt(stats.snapshot_count),
      is90DayMin: stats.is_90day_min,
      is90DayMax: stats.is_90day_max
    };
  } catch (e) {
    logger.error(`[AlertEngine] getResourceStats error: ${e.message}`);
    return getResourceStatsFallback(resource, check90Day);
  }
}

/**
 * Fallback: direct query for stats (less efficient but works without RPC)
 */
async function getResourceStatsFallback(resource, check90Day = true) {
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
  logger.info(`[AlertEngine] getUserNtfyEnabled() called for userId: ${userId}`);
  
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('ntfy_enabled, ntfy_graph_enabled')
    .eq('user_id', userId)
    .single();
  
  if (error) {
    logger.error(`[AlertEngine] ❌ Error fetching NTFY settings: ${error.message}`);
    logger.error(`[AlertEngine] Error details:`, JSON.stringify(error));
    return { enabled: false, graphEnabled: true };
  }
  
  if (!data) {
    logger.info(`[AlertEngine] ⚠️ No subscription record found for userId: ${userId}`);
    return { enabled: false, graphEnabled: true };
  }
  
  logger.info(`[AlertEngine] ✅ NTFY settings found:`);
  logger.info(`[AlertEngine]   - ntfy_enabled: ${data.ntfy_enabled}`);
  logger.info(`[AlertEngine]   - ntfy_graph_enabled: ${data.ntfy_graph_enabled}`);
  
  return {
    enabled: data?.ntfy_enabled || false,
    graphEnabled: data?.ntfy_graph_enabled !== undefined ? data.ntfy_graph_enabled : true
  };
}

/**
 * Check all active alerts after a price fetch
 */
async function checkAlerts() {
  logger.info('[AlertEngine] Checking alerts after price fetch...');

  try {
    const broadcastUsers = await getBroadcastUsers();
    const latestResources = await getAllResourcesForCriticals();

    // Get all active alerts (simple query, no joins)
    const { data: alerts, error } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('enabled', true);

    if (error) throw error;
    logger.info(`[AlertEngine] Checking ${(alerts || []).length} alerts`);

    // Group by resource to get stats once per resource
    const alertsByResource = {};
    (alerts || []).forEach(a => {
      if (!alertsByResource[a.resource]) alertsByResource[a.resource] = [];
      alertsByResource[a.resource].push(a);
    });

    const resourcesToCheck = new Set([...Object.keys(alertsByResource), ...latestResources]);
    
    // Check each resource
    for (const resource of resourcesToCheck) {
      await checkResourceAlerts(resource, alertsByResource[resource] || [], broadcastUsers);
    }

  } catch (error) {
    logger.error('[AlertEngine] Error:', error.message);
    recordError('alertEngine.checkAlerts', error.message);
  }
}

async function getAllResourcesForCriticals() {
  const { data, error } = await supabase
    .from('price_snapshots')
    .select('resource')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('resource');
  if (error) throw error;
  return [...new Set((data || []).map(row => row.resource).filter(Boolean))];
}

/**
 * Check alerts for a specific resource
 */
async function checkResourceAlerts(resource, alerts, broadcastUsers = []) {
  try {
    // Get stats using direct query
    const stats = await getResourceStats(resource);

    if (!stats) {
      logger.info(`[AlertEngine] No stats for ${resource}`);
      return;
    }

    const currentPct = parseFloat(stats.percent_vs_avg.toFixed(2));

    logger.info(`[AlertEngine] ${resource}: current=${currentPct}%, avg=${stats.avg_price?.toFixed(4)}, cur=${stats.current_price?.toFixed(4)}`);

    for (const alert of alerts) {
      const alertType = alert.alert_type || 'dual';
      const thresholdHigh = Number(alert.threshold_high || 10);
      const thresholdLow = Number(alert.threshold_low || -10);
      const targetPrice = alert.target_price != null ? Number(alert.target_price) : null;
      const targetDirection = alert.target_direction || null;
      const now = new Date();
      let updates = {};

      if (alertType === 'price_above' || alertType === 'price_below') {
        const isAboveTarget = alertType === 'price_above';
        const resolvedDirection = targetDirection || (isAboveTarget ? 'above' : 'below');
        const targetState = getOrInitTargetState(alert.id, alert, stats);
        const resetPrice = getTargetResetPrice(targetPrice, resolvedDirection);

        if (resolvedDirection === 'above' && Number(stats.current_price) <= resetPrice) {
          targetState.step = 0;
          updates.last_notified_target_at = null;
          updates.last_notified_target_step = 0;
          clearAlertThrottle(`${alert.user_id}:${resource}:${alertType}:${targetPrice}:step:`);
        }
        if (resolvedDirection === 'below' && Number(stats.current_price) >= resetPrice) {
          targetState.step = 0;
          updates.last_notified_target_at = null;
          updates.last_notified_target_step = 0;
          clearAlertThrottle(`${alert.user_id}:${resource}:${alertType}:${targetPrice}:step:`);
        }

        const step = getTargetStep(stats.current_price, targetPrice, resolvedDirection);
        if (step > targetState.step) {
          const runtimeThrottleKey = `${alert.user_id}:${resource}:${alertType}:${targetPrice}:step:${step}`;
          if (!shouldThrottleAlert(runtimeThrottleKey)) {
            const language = await getUserLanguage(String(alert.user_id));
            await sendTelegramTargetAlert(alert.user_id, resource, resolvedDirection, targetPrice, stats, language);

            const ntfySettings = await getUserNtfyEnabled(alert.user_id);
            if (ntfySettings.enabled) {
              await sendNtfyTargetAlertNotification(alert.user_id, resource, resolvedDirection, targetPrice, stats, language);
            }

            targetState.step = step;
            updates.last_notified_target_at = now.toISOString();
            updates.last_notified_target_step = step;
          }
        }
      } else {
        const state = getOrInitPercentState(alert.id, alert, currentPct);
        const riseReset = getPercentResetThreshold(thresholdHigh, 'rise');
        const fallReset = getPercentResetThreshold(thresholdLow, 'fall');

        if (currentPct <= riseReset && state.riseStep !== 0) {
          state.riseStep = 0;
          updates.last_notified_rise_at = null;
          updates.last_notified_rise_step = 0;
          clearAlertThrottle(`${alert.user_id}:${resource}:rise:${thresholdHigh}:step:`);
        }
        if (currentPct >= fallReset && state.fallStep !== 0) {
          state.fallStep = 0;
          updates.last_notified_fall_at = null;
          updates.last_notified_fall_step = 0;
          clearAlertThrottle(`${alert.user_id}:${resource}:fall:${thresholdLow}:step:`);
        }

        const riseStep = getPercentStep(currentPct, thresholdHigh, 'rise');
        const fallStep = getPercentStep(currentPct, thresholdLow, 'fall');

        if (riseStep > state.riseStep) {
          const runtimeThrottleKey = `${alert.user_id}:${resource}:rise:${thresholdHigh}:step:${riseStep}`;
          if (!shouldThrottleAlert(runtimeThrottleKey)) {
            const language = await getUserLanguage(String(alert.user_id));
            await sendTelegramAlert(alert.user_id, resource, currentPct, stats, thresholdHigh, thresholdLow, language);
            const ntfySettings = await getUserNtfyEnabled(alert.user_id);
            if (ntfySettings.enabled) {
              await sendNtfyAlertNotification(alert.user_id, resource, currentPct, stats, thresholdHigh, thresholdLow, language, ntfySettings.graphEnabled);
            }
            state.riseStep = riseStep;
            state.fallStep = 0;
            updates.last_notified_rise_at = now.toISOString();
            updates.last_notified_rise_step = riseStep;
            updates.last_notified_fall_at = null;
            updates.last_notified_fall_step = 0;
          }
        } else if (fallStep > state.fallStep) {
          const runtimeThrottleKey = `${alert.user_id}:${resource}:fall:${thresholdLow}:step:${fallStep}`;
          if (!shouldThrottleAlert(runtimeThrottleKey)) {
            const language = await getUserLanguage(String(alert.user_id));
            await sendTelegramAlert(alert.user_id, resource, currentPct, stats, thresholdHigh, thresholdLow, language);
            const ntfySettings = await getUserNtfyEnabled(alert.user_id);
            if (ntfySettings.enabled) {
              await sendNtfyAlertNotification(alert.user_id, resource, currentPct, stats, thresholdHigh, thresholdLow, language, ntfySettings.graphEnabled);
            }
            state.fallStep = fallStep;
            state.riseStep = 0;
            updates.last_notified_fall_at = now.toISOString();
            updates.last_notified_fall_step = fallStep;
            updates.last_notified_rise_at = null;
            updates.last_notified_rise_step = 0;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('user_alerts')
          .update(updates)
          .eq('id', alert.id);
      }
    }

    await processCriticalAlerts(resource, stats, currentPct, broadcastUsers);

  } catch (error) {
    logger.error(`[AlertEngine] Error checking ${resource}:`, error.message);
    recordError('alertEngine.checkResourceAlerts', error.message);
  }
}

/**
 * Send Telegram alert with chart image
 */
async function sendTelegramAlert(userId, resource, currentPct, stats, thresholdHigh, thresholdLow, language = 'es') {
  try {
    const history = await getResourceHistory(resource, 90);
    const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow, language);

    if (history && history.length >= 2) {
      const { chartConfig } = generateChartDataUrl(resource, history, { locale: language, statsOverride: stats });
      const arrayBuffer = await generateChartBuffer(chartConfig);
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');
      const chartDataUrl = `data:image/png;base64,${base64}`;

      const sent = await sendTelegramPhoto(userId, chartDataUrl, msg);
      if (!sent) {
        logger.error(`[AlertEngine] sendTelegramPhoto failed for ${userId}, falling back to text`);
        await sendTelegramMessage(userId, msg);
      }
    } else {
      await sendTelegramMessage(userId, msg);
    }
  } catch (error) {
    logger.error('[AlertEngine] sendTelegramAlert error:', error.message);
    recordError('alertEngine.sendTelegramAlert', error.message);
    const msg = formatAlertMessage(resource, currentPct, stats, thresholdHigh, thresholdLow, language);
    await sendTelegramMessage(userId, msg);
  }
}

async function sendTelegramTargetAlert(userId, resource, direction, targetPrice, stats, language = 'es') {
  try {
    const history = await getResourceHistory(resource, 90);
    const msg = formatTargetAlertMessage(resource, direction, targetPrice, stats, language);

    if (history && history.length >= 2) {
      const { chartConfig } = generateChartDataUrl(resource, history, { locale: language, statsOverride: stats });
      const arrayBuffer = await generateChartBuffer(chartConfig);
      const buffer = Buffer.from(arrayBuffer);
      const chartDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      const sent = await sendTelegramPhoto(userId, chartDataUrl, msg);
      if (!sent) await sendTelegramMessage(userId, msg);
    } else {
      await sendTelegramMessage(userId, msg);
    }
  } catch (error) {
    logger.error('[AlertEngine] sendTelegramTargetAlert error:', error.message);
    recordError('alertEngine.sendTelegramTargetAlert', error.message);
    await sendTelegramMessage(userId, formatTargetAlertMessage(resource, direction, targetPrice, stats, language));
  }
}

/**
 * Send NTFY notification (with optional chart)
 */
async function sendNtfyAlertNotification(userId, resource, currentPct, stats, thresholdHigh, thresholdLow, language = 'es', includeGraph) {
  logger.info(`[AlertEngine] sendNtfyAlertNotification() ===`);
  logger.info(`[AlertEngine]   userId: ${userId}`);
  logger.info(`[AlertEngine]   resource: ${resource}`);
  logger.info(`[AlertEngine]   currentPct: ${currentPct}%`);
  logger.info(`[AlertEngine]   thresholdHigh: ${thresholdHigh}%`);
  logger.info(`[AlertEngine]   thresholdLow: ${thresholdLow}%`);
  logger.info(`[AlertEngine]   includeGraph: ${includeGraph}`);
  
  try {
    const topic = getUserNtfyTopic(userId);
    logger.info(`[AlertEngine] Generated topic: ${topic}`);
    
    const message = formatNtfyAlert(resource, currentPct, stats, thresholdHigh, thresholdLow, language);
    logger.info(`[AlertEngine] Formatted message:\n${message}`);

    // Always send text-only notification (no images)
    logger.info(`[AlertEngine] Sending text-only notification...`);
    const result = await sendNtfyNotification(topic, message, {
      title: `${resource.toUpperCase()} Alert`,
      tags: 'warning'
    });
    logger.info(`[AlertEngine] sendNtfyNotification result: ${result}`);
    return result;

  } catch (error) {
    logger.error(`[AlertEngine] ❌ sendNtfyAlertNotification error: ${error.message}`);
    logger.error(`[AlertEngine] Error stack:`, error.stack);
    recordError('alertEngine.sendNtfyAlertNotification', error.message);
  }
}

async function sendNtfyTargetAlertNotification(userId, resource, direction, targetPrice, stats, language = 'es') {
  try {
    const topic = getUserNtfyTopic(userId);
    const message = formatNtfyTargetAlert(resource, direction, targetPrice, stats, language);
    return sendNtfyNotification(topic, message, {
      title: `${resource.toUpperCase()} Alert`,
      tags: 'warning'
    });
  } catch (error) {
    logger.error(`[AlertEngine] sendNtfyTargetAlertNotification error: ${error.message}`);
    recordError('alertEngine.sendNtfyTargetAlertNotification', error.message);
    return false;
  }
}

async function processCriticalAlerts(resource, stats, currentPct, broadcastUsers = []) {
  const eligibleUsers = (broadcastUsers || []).filter(user => user.criticalAlertsEnabled !== false);
  if (!eligibleUsers.length) return;

  const directions = [];
  if (currentPct >= CRITICAL_THRESHOLD_PCT) directions.push('up');
  if (currentPct <= -CRITICAL_THRESHOLD_PCT) directions.push('down');

  let persistedStates = new Map();
  try {
    persistedStates = await loadCriticalStates(resource, eligibleUsers.map(user => user.userId));
  } catch (error) {
    logger.error(`[AlertEngine] Failed loading persisted critical states for ${resource}: ${error.message}`);
    recordError('alertEngine.loadCriticalStates', error.message);
    if (String(error.message || '').includes('critical_alert_states')) {
      throw new Error('Database migration required for critical alert state persistence');
    }
  }

  for (const user of eligibleUsers) {
    for (const direction of ['up', 'down']) {
      const persistedStep = persistedStates.get(`${user.userId}:${direction}`) || 0;
      const state = getCriticalState(user.userId, resource, direction, persistedStep);
      if (persistedStep > state.step) {
        state.step = persistedStep;
      }

      const shouldReset = (direction === 'up' && currentPct <= CRITICAL_RESET_PCT)
        || (direction === 'down' && currentPct >= -CRITICAL_RESET_PCT);

      if (shouldReset && state.step !== 0) {
        state.step = 0;
        clearAlertThrottle(`${user.userId}:${resource}:critical:${direction}:step:`);
        await persistCriticalState(user.userId, resource, direction, 0, currentPct);
      }
    }

    for (const direction of directions) {
      const persistedStep = persistedStates.get(`${user.userId}:${direction}`) || 0;
      const state = getCriticalState(user.userId, resource, direction, persistedStep);
      const magnitude = Math.abs(currentPct);
      const step = 1 + Math.floor((magnitude - CRITICAL_THRESHOLD_PCT) / CRITICAL_STEP_PCT);
      if (step <= state.step) continue;

      const throttleKey = `${user.userId}:${resource}:critical:${direction}:step:${step}`;
      if (shouldThrottleAlert(throttleKey)) continue;

      await sendTelegramCriticalAlert(user.userId, resource, currentPct, step, user.language || 'es');
      if (user.ntfyEnabled) {
        await sendNtfyCriticalAlert(user.userId, resource, currentPct, step, user.language || 'es');
      }
      state.step = step;
      await persistCriticalState(user.userId, resource, direction, step, currentPct);
    }
  }
}

async function sendTelegramCriticalAlert(userId, resource, currentPct, step, language = 'es') {
  const isUp = Number(currentPct) >= 0;
  const message = language === 'en'
    ? `🚨 <b>Critical market alert</b>\n\n<b>${resource.toUpperCase()}</b> is now at <code>${currentPct.toFixed(2)}%</code> vs average.\nThis is a critical ${isUp ? 'upside' : 'downside'} move${step > 1 ? ` (step ${step})` : ''}.`
    : `🚨 <b>Alerta crítica de mercado</b>\n\n<b>${resource.toUpperCase()}</b> está ahora en <code>${currentPct.toFixed(2)}%</code> vs promedio.\nEste es un movimiento crítico ${isUp ? 'al alza' : 'a la baja'}${step > 1 ? ` (escalón ${step})` : ''}.`;
  await sendTelegramMessage(userId, message);
}

async function sendNtfyCriticalAlert(userId, resource, currentPct, step, language = 'es') {
  const isUp = Number(currentPct) >= 0;
  const topic = getUserNtfyTopic(userId);
  const message = language === 'en'
    ? `${resource.toUpperCase()} critical move\n\n${currentPct.toFixed(2)}% vs average. ${isUp ? 'Strong upside move' : 'Strong downside move'}${step > 1 ? ` (step ${step})` : ''}.`
    : `${resource.toUpperCase()} movimiento crítico\n\n${currentPct.toFixed(2)}% vs promedio. ${isUp ? 'Fuerte movimiento al alza' : 'Fuerte movimiento a la baja'}${step > 1 ? ` (escalón ${step})` : ''}.`;
  return sendNtfyNotification(topic, message, {
    title: 'Critical Alert',
    tags: 'rotating_light',
    priority: 5,
  });
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
