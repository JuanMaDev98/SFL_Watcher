const express = require('express');
const router = express.Router();
const { fetchPrices } = require('../services/priceFetcher');
const { checkAlerts } = require('../services/alertEngine');
const { clearChartCache } = require('../services/chartService');
const { pick } = require('../services/formatters');
const {
  MONITOR_MAX_AGE_MINUTES,
  DAILY_LOOKBACK_HOURS,
  analyzeSnapshotWindows,
  formatMonitorAlert,
  formatDailySummary,
} = require('../services/cronMonitor');

const logger = require('../utils/logger');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const OWNER_TELEGRAM_ID = String(process.env.OWNER_TELEGRAM_ID || '1166287745');
const EXPIRY_WARNING_HOURS = 24; // Notify user when subscription expires in <= 24 hours

/**
 * Send Telegram message helper
 */
async function sendTelegram(chatId, text) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    logger.error('Telegram send error: ' + e.message);
  }
}

async function getSupabaseClient() {
  return require('../lib/supabase');
}

async function fetchRecentSnapshotRows(hours = DAILY_LOOKBACK_HOURS) {
  const supabase = await getSupabaseClient();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('price_snapshots')
      .select('created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function buildSnapshotHealthSummary(hours = DAILY_LOOKBACK_HOURS) {
  const rows = await fetchRecentSnapshotRows(hours);
  return analyzeSnapshotWindows(rows, { lookbackHours: hours, maxAgeMinutes: MONITOR_MAX_AGE_MINUTES });
}

/**
 * Check and notify users with expiring subscriptions
 * Runs every cron cycle
 */
async function checkExpiringSubscriptions() {
  try {
    let supabase;
    try {
      supabase = require('../lib/supabase');
    } catch (e) {
      // Supabase not configured yet, skip expiry check
      return;
    }
    
    // Get all users with active subscriptions
    const { data: users, error } = await supabase
      .from('user_subscriptions')
      .select('user_id, subscription_ends_at, status, preferred_language, notify_expiry')
      .eq('status', 'active');
    
    if (error) {
      logger.error('Error fetching subscriptions: ' + error.message);
      return;
    }
    
    const now = new Date();
    
    for (const sub of users || []) {
      if (!sub.subscription_ends_at) continue;
      
      const expiryDate = new Date(sub.subscription_ends_at);
      const hoursUntilExpiry = (expiryDate - now) / (1000 * 60 * 60);
      
      // Skip if already expired or more than 24 hours left
      if (hoursUntilExpiry <= 0 || hoursUntilExpiry > EXPIRY_WARNING_HOURS) continue;
      
      const chatId = sub.user_id;
      if (!chatId) continue;
      
      // Check if already notified today (within last 23 hours to avoid spam)
      const lastNotified = sub.notify_expiry ? new Date(sub.notify_expiry) : null;
      if (lastNotified && (now - lastNotified) < 23 * 60 * 60 * 1000) continue;
      
      // Calculate days/hours remaining
      const daysLeft = Math.floor(hoursUntilExpiry / 24);
      const hoursLeft = Math.floor(hoursUntilExpiry % 24);
      const locale = sub.preferred_language || 'es';
      const timeLeftStr = locale === 'en'
        ? (daysLeft > 0 ? `${daysLeft} day${daysLeft > 1 ? 's' : ''} and ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}` : `${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}`)
        : (daysLeft > 0 ? `${daysLeft} día${daysLeft > 1 ? 's' : ''} y ${hoursLeft} hora${hoursLeft !== 1 ? 's' : ''}` : `${hoursLeft} hora${hoursLeft !== 1 ? 's' : ''}`);
      
      const message = [
        pick(locale, '⏰ <b>⚠️ Tu suscripción expira pronto</b>', '⏰ <b>⚠️ Your subscription expires soon</b>'),
        '',
        pick(locale, `Tu suscripción vence en <b>${timeLeftStr}</b>.`, `Your subscription expires in <b>${timeLeftStr}</b>.`),
        '',
        pick(locale, 'Para seguir usando SFL Watcher, envía <code>/pay</code> para renovar.', 'To keep using SFL Watcher, send <code>/pay</code> to renew.'),
        'Cost: <b>$1 USD</b> (~30 days)'
      ].join('\n');
      
      await sendTelegram(chatId, message);
      
      // Update notify_expiry timestamp
      await supabase
        .from('user_subscriptions')
        .update({ notify_expiry: now.toISOString() })
        .eq('user_id', sub.user_id);
      
      logger.info('Notified user ' + sub.user_id + ' about expiring subscription');
    }
  } catch (e) {
    logger.error('Expiry check error: ' + e.message);
  }
}

/**
 * GET /api/cron/fetch-prices
 * Vercel Cron: runs every 15 minutes
 * Fetches latest prices from SFL API and checks alerts
 */
router.get('/fetch-prices', async (req, res) => {
  logger.info('Cron: Fetching prices...');

  try {
    // Fetch new prices
    const result = await fetchPrices();
    logger.info('Fetched ' + result.length + ' resources');

    // Invalidate any in-memory charts on this warm instance.
    // The chart cache key also includes the newest snapshot timestamp,
    // so cross-instance freshness is preserved automatically.
    if (result.length > 0) {
      clearChartCache();
      try {
        await checkAlerts();
      } catch (e) {
        logger.error('[AlertEngine] Error: ' + e.message);
      }
    }

    // Check for expiring subscriptions and notify users
    await checkExpiringSubscriptions();

    logger.info('Cron completed successfully');

    res.json({
      success: true,
      message: 'Prices fetched and alerts checked',
      resources_updated: result.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cron fetch-prices error: ' + error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/monitor', async (req, res) => {
  try {
    const summary = await buildSnapshotHealthSummary(DAILY_LOOKBACK_HOURS);
    const shouldNotify = !summary.healthy;

    if (shouldNotify) {
      await sendTelegram(OWNER_TELEGRAM_ID, formatMonitorAlert(summary, 'es'));
    }

    res.json({
      success: true,
      owner: OWNER_TELEGRAM_ID,
      notified: shouldNotify,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Cron monitor error: ' + error.message);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

router.get('/daily-report', async (req, res) => {
  try {
    const summary = await buildSnapshotHealthSummary(DAILY_LOOKBACK_HOURS);
    if (summary.missingCount > 0 || !summary.healthy) {
      await sendTelegram(OWNER_TELEGRAM_ID, formatDailySummary(summary, 'es'));
    }

    res.json({
      success: true,
      owner: OWNER_TELEGRAM_ID,
      notified: summary.missingCount > 0 || !summary.healthy,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Cron daily-report error: ' + error.message);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
