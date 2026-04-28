const express = require('express');
const router = express.Router();
const { fetchPrices } = require('../services/priceFetcher');
const { checkAlerts } = require('../services/alertEngine');
const { getSubscriptionStatus, getUserByChatId } = require('../services/subscriptionService');

const logger = require('../utils/logger');

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
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
    console.error('Telegram send error:', e.message);
  }
}

/**
 * Check and notify users with expiring subscriptions
 * Runs every cron cycle
 */
async function checkExpiringSubscriptions() {
  try {
    const { supabase } = require('../services/supabase');
    
    // Get all users with active subscriptions
    const { data: users, error } = await supabase
      .from('user_subscriptions')
      .select('user_id, subscription_ends_at, status')
      .eq('status', 'active');
    
    if (error) {
      console.error('Error fetching subscriptions:', error.message);
      return;
    }
    
    const now = new Date();
    
    for (const sub of users || []) {
      if (!sub.subscription_ends_at) continue;
      
      const expiryDate = new Date(sub.subscription_ends_at);
      const hoursUntilExpiry = (expiryDate - now) / (1000 * 60 * 60);
      
      // Skip if already expired or more than 24 hours left
      if (hoursUntilExpiry <= 0 || hoursUntilExpiry > EXPIRY_WARNING_HOURS) continue;
      
      // Get user's Telegram chat_id
      const { data: user } = await supabase
        .from('user_subscriptions')
        .select('chat_id, notify_expiry')
        .eq('user_id', sub.user_id)
        .single();
      
      if (!user?.chat_id) continue;
      
      // Check if already notified today (within last 23 hours to avoid spam)
      const lastNotified = user.notify_expiry ? new Date(user.notify_expiry) : null;
      if (lastNotified && (now - lastNotified) < 23 * 60 * 60 * 1000) continue;
      
      // Calculate days/hours remaining
      const daysLeft = Math.floor(hoursUntilExpiry / 24);
      const hoursLeft = Math.floor(hoursUntilExpiry % 24);
      const timeLeftStr = daysLeft > 0 
        ? `${daysLeft} day${daysLeft > 1 ? 's' : ''} and ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}`
        : `${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}`;
      
      const message = [
        '⏰ <b>⚠️ Subscription Expiring Soon!</b>',
        '',
        `Your subscription expires in <b>${timeLeftStr}</b>.`,
        '',
        'To continue using SFL Watcher, send <code>/pay</code> to renew.',
        'Cost: <b>$1 USD</b> (~30 days)'
      ].join('\n');
      
      await sendTelegram(user.chat_id, message);
      
      // Update notify_expiry timestamp
      await supabase
        .from('user_subscriptions')
        .update({ notify_expiry: now.toISOString() })
        .eq('user_id', sub.user_id);
      
      console.log(`📢 Notified user ${sub.user_id} about expiring subscription`);
    }
  } catch (e) {
    console.error('Expiry check error:', e.message);
  }
}

/**
 * GET /api/cron/fetch-prices
 * Vercel Cron: runs every 15 minutes
 * Fetches latest prices from SFL API and checks alerts
 */
router.get('/fetch-prices', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Cron: Fetching prices...`);

  try {
    // Fetch new prices
    const result = await fetchPrices();
    console.log(`✅ Fetched ${result.length} resources`);

    // Check alerts after fetching
    if (result.length > 0) {
      await checkAlerts();
    }

    // Check for expiring subscriptions and notify users
    await checkExpiringSubscriptions();

    res.json({
      success: true,
      message: 'Prices fetched and alerts checked',
      resources_updated: result.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Cron fetch-prices error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;