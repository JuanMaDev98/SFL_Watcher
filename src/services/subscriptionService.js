const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FLOWER_PRICE_API = 'https://sfl.world/api/v1.1/exchange';
const SUBSCRIPTION_USD = 1; // $1 USD = 90 days
const DAYS_PER_SUBSCRIPTION = 90;
const TRIAL_DAYS = 7;
const DEFAULT_LANGUAGE = 'en';
const BETA_FREE_MODE = true;
const DEFAULT_CRITICAL_ALERTS_ENABLED = true;

let supabase;

function isMissingColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('column') && (message.includes('does not exist') || message.includes('schema cache'));
}

/**
 * Get or create supabase client with service role
 */
function getSupabase() {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

/**
 * Get current FLOWER price in USD
 */
async function getFlowerPrice() {
  try {
    const resp = await fetch(FLOWER_PRICE_API);
    const data = await resp.json();
    const price = parseFloat(data.sfl?.usd || data.sfl_usd || 0);
    if (price <= 0) throw new Error('Invalid price');
    return price;
  } catch (e) {
    logger.error('[subscriptionService] getFlowerPrice error:', e.message);
    return null;
  }
}

/**
 * Get subscription cost in FLOWER
 */
async function getSubscriptionCost() {
  const price = await getFlowerPrice();
  if (!price) return null;

  const flowerAmount = SUBSCRIPTION_USD / price;
  return {
    usd: SUBSCRIPTION_USD,
    flower_price_usd: price,
    flower_amount: Math.ceil(flowerAmount * 10000) / 10000 // Round up to 4 decimals
  };
}

/**
 * Ensure user has a subscription record (create trial if new)
 */
async function ensureSubscription(userId) {
  const db = getSupabase();

  const { data: existing } = await db
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing) return formatSubscription(existing);

  // Create trial subscription for new user
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  let insertPayload = {
    user_id: userId,
    status: 'trial',
    preferred_language: DEFAULT_LANGUAGE,
    critical_alerts_enabled: DEFAULT_CRITICAL_ALERTS_ENABLED,
    pending_action: null,
    pending_payload: {},
    trial_started_at: new Date().toISOString(),
    trial_ends_at: trialEndsAt.toISOString()
  };

  let { data: newSub, error } = await db
    .from('user_subscriptions')
    .insert(insertPayload)
    .select()
    .single();

  if (error && isMissingColumnError(error)) {
    ({ data: newSub, error } = await db
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        status: 'trial',
        trial_started_at: insertPayload.trial_started_at,
        trial_ends_at: insertPayload.trial_ends_at
      })
      .select()
      .single());
  }

  if (error) throw error;
  return formatSubscription(newSub);
}

/**
 * Get user's wallet address
 */
async function getUserWallet(userId) {
  const db = getSupabase();
  const { data } = await db
    .from('user_wallets')
    .select('wallet_address')
    .eq('user_id', userId)
    .single();
  return data?.wallet_address || null;
}

/**
 * Connect or update user's wallet address
 */
async function connectWallet(userId, walletAddress) {
  const db = getSupabase();

  // Validate Ethereum address
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new Error('Invalid Ethereum address format');
  }

  const { error } = await db
    .from('user_wallets')
    .upsert({
      user_id: userId,
      wallet_address: walletAddress.toLowerCase(),
      connected_at: new Date().toISOString()
    });

  if (error) {
    // Unique violation on wallet_address - already linked to another user
    if (error.code === '23505') {
      throw new Error('Wallet already linked to another user');
    }
    throw error;
  }
  return true;
}

/**
 * Get subscription status
 */
async function getSubscriptionStatus(userId) {
  const db = getSupabase();

  const { data: sub } = await db
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    return { status: 'new', days_remaining: 0 };
  }

  return formatSubscription(sub);
}

/**
 * Format subscription for Telegram response
 */
function formatSubscription(sub) {
  if (BETA_FREE_MODE) {
    return {
      status: 'trial',
      days_remaining: 99999,
      trial_started_at: sub.trial_started_at,
      trial_ends_at: null,
      subscription_ends_at: null,
      beta_free_mode: true,
    };
  }

  const now = new Date();
  let status = sub.status;
  let daysRemaining = 0;

  if (status === 'trial') {
    const ends = new Date(sub.trial_ends_at);
    const diff = Math.ceil((ends - now) / (1000 * 60 * 60 * 24));
    daysRemaining = Math.max(0, diff);

    if (daysRemaining <= 0) {
      status = 'trial_expired';
      daysRemaining = 0;
    }
  } else if (status === 'active') {
    const ends = new Date(sub.subscription_ends_at);
    const diff = Math.ceil((ends - now) / (1000 * 60 * 60 * 24));
    daysRemaining = Math.max(0, diff);

    if (daysRemaining <= 0) {
      status = 'expired';
      daysRemaining = 0;
    }
  }

  return {
    status,
    days_remaining: daysRemaining,
    trial_started_at: sub.trial_started_at,
    trial_ends_at: sub.trial_ends_at,
    subscription_ends_at: sub.subscription_ends_at,
    ads_enabled: sub.ads_enabled !== false,
    user_id: sub.user_id,
  };
}

/**
 * Add days to subscription
 */
async function addSubscriptionDays(userId, days) {
  const db = getSupabase();

  const { data: sub } = await db
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    // Create new active subscription
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + days);

    await db.from('user_subscriptions').insert({
      user_id: userId,
      status: 'active',
      subscription_ends_at: endsAt.toISOString()
    });
    return true;
  }

  let newEndsAt;
  const now = new Date();
  if (sub.status === 'active' && sub.subscription_ends_at) {
    const currentEnds = new Date(sub.subscription_ends_at);
    if (currentEnds > now) {
      // Add to existing active subscription
      currentEnds.setDate(currentEnds.getDate() + days);
      newEndsAt = currentEnds;
    } else {
      // Start fresh from now
      newEndsAt = new Date();
      newEndsAt.setDate(newEndsAt.getDate() + days);
    }
  } else {
    // Start from now
    newEndsAt = new Date();
    newEndsAt.setDate(newEndsAt.getDate() + days);
  }

  const { error } = await db
    .from('user_subscriptions')
    .update({
      status: 'active',
      subscription_ends_at: newEndsAt.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (error) throw error;
  return true;
}

/**
 * Record a payment
 */
async function recordPayment(userId, txHash, network, amountToken, amountUsd, daysToAdd = 30) {
  const db = getSupabase();

  const { error } = await db
    .from('user_payments')
    .insert({
      user_id: userId,
      tx_hash: txHash,
      network: network,
      amount_token: amountToken,
      amount_usd: amountUsd,
      days_added: daysToAdd,
      verified: true,
      verified_at: new Date().toISOString()
    });

  if (error) {
    // Duplicate tx_hash - already used
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

/**
 * Check if tx hash was already used
 */
async function isTxHashUsed(txHash) {
  const db = getSupabase();
  const { data } = await db
    .from('user_payments')
    .select('id')
    .eq('tx_hash', txHash)
    .single();
  return !!data;
}

const PAYMENT_ADDRESS = process.env.FLOWER_PAYMENT_ADDRESS || '0xbeA7Aa84316661BBC3963e2c5276d2Cd952D7806';

const { verifyWalletPayment } = require('./paymentVerifier');

/**
 * Get NTFY settings for a user
 */
async function getNtfySettings(userId) {
  const db = getSupabase();
  const { data } = await db
    .from('user_subscriptions')
    .select('ntfy_enabled, ntfy_graph_enabled')
    .eq('user_id', userId)
    .single();
  return {
    ntfyEnabled: data?.ntfy_enabled || false,
    ntfyGraphEnabled: data?.ntfy_graph_enabled !== undefined ? data.ntfy_graph_enabled : true
  };
}

/**
 * Update NTFY settings
 */
async function updateNtfySettings(userId, settings) {
  const db = getSupabase();
  const updates = {};
  if (settings.ntfyEnabled !== undefined) updates.ntfy_enabled = settings.ntfyEnabled;
  if (settings.ntfyGraphEnabled !== undefined) updates.ntfy_graph_enabled = settings.ntfyGraphEnabled;
  const { error } = await db
    .from('user_subscriptions')
    .update(updates)
    .eq('user_id', userId);
  if (error) throw error;
}

async function getUserPreferences(userId) {
  await ensureSubscription(userId);
  const db = getSupabase();
  let { data, error } = await db
    .from('user_subscriptions')
    .select('preferred_language, critical_alerts_enabled, pending_action, pending_payload, status, ntfy_enabled, ntfy_graph_enabled, notify_expiry, ads_enabled')
    .eq('user_id', userId)
    .single();

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await db
      .from('user_subscriptions')
      .select('status, ntfy_enabled, ntfy_graph_enabled')
      .eq('user_id', userId)
      .single());
  }

  if (error) throw error;

  return {
    preferredLanguage: data?.preferred_language || DEFAULT_LANGUAGE,
    criticalAlertsEnabled: data?.critical_alerts_enabled !== undefined ? data.critical_alerts_enabled : DEFAULT_CRITICAL_ALERTS_ENABLED,
    pendingAction: data?.pending_action || null,
    pendingPayload: data?.pending_payload || {},
    status: data?.status || 'trial',
    ntfyEnabled: data?.ntfy_enabled || false,
    ntfyGraphEnabled: data?.ntfy_graph_enabled !== undefined ? data.ntfy_graph_enabled : true,
    notifyExpiry: data?.notify_expiry || null,
    adsEnabled: data?.ads_enabled !== false,
  };
}

async function getUserLanguage(userId) {
  const prefs = await getUserPreferences(userId);
  return prefs.preferredLanguage || DEFAULT_LANGUAGE;
}

async function setUserLanguage(userId, language) {
  const db = getSupabase();
  const normalized = String(language || DEFAULT_LANGUAGE).toLowerCase().startsWith('en') ? 'en' : 'es';
  await ensureSubscription(userId);
  const { error } = await db
    .from('user_subscriptions')
    .update({ preferred_language: normalized, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error && isMissingColumnError(error)) {
    throw new Error('Database migration required for /language');
  }
  if (error) throw error;
  return normalized;
}

async function setPendingAction(userId, action, payload = {}) {
  const db = getSupabase();
  await ensureSubscription(userId);
  const { error } = await db
    .from('user_subscriptions')
    .update({ pending_action: action, pending_payload: payload, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error && isMissingColumnError(error)) {
    throw new Error('Database migration required for promo flow');
  }
  if (error) throw error;
}

async function setCriticalAlertsEnabled(userId, enabled) {
  const db = getSupabase();
  await ensureSubscription(userId);
  const { error } = await db
    .from('user_subscriptions')
    .update({ critical_alerts_enabled: !!enabled, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error && isMissingColumnError(error)) {
    throw new Error('Database migration required for critical alerts');
  }
  if (error) throw error;
  return !!enabled;
}

async function getCriticalAlertsEnabled(userId) {
  const prefs = await getUserPreferences(userId);
  return prefs.criticalAlertsEnabled !== false;
}

async function clearPendingAction(userId) {
  const db = getSupabase();
  const { error } = await db
    .from('user_subscriptions')
    .update({ pending_action: null, pending_payload: {}, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error && isMissingColumnError(error)) {
    throw new Error('Database migration required for promo flow');
  }
  if (error) throw error;
}

async function getFreeTierUsers() {
  const db = getSupabase();
  let { data, error } = await db
    .from('user_subscriptions')
    .select('user_id, preferred_language, status')
    .in('status', ['trial', 'trial_expired']);
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await db
      .from('user_subscriptions')
      .select('user_id, status')
      .in('status', ['trial', 'trial_expired']));
  }
  if (error) throw error;
  return (data || []).map(row => ({
    userId: row.user_id,
    language: row.preferred_language || DEFAULT_LANGUAGE,
    status: row.status,
  }));
}

async function getBroadcastUsers() {
  const db = getSupabase();
  let { data, error } = await db
    .from('user_subscriptions')
    .select('user_id, preferred_language, status, ntfy_enabled, critical_alerts_enabled, ads_enabled');

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await db
      .from('user_subscriptions')
      .select('user_id, status'));
  }

  if (error) throw error;

  const filtered = (data || [])
    .filter(row => row?.user_id)
    // Exclude premium users who have opted out of ads
    .filter(row => !(row.status === 'active' && row.ads_enabled === false));

  return filtered
    .map(row => ({
      userId: row.user_id,
      language: row.preferred_language || DEFAULT_LANGUAGE,
      status: row.status || 'trial',
      ntfyEnabled: row.ntfy_enabled || false,
      criticalAlertsEnabled: row.critical_alerts_enabled !== undefined ? row.critical_alerts_enabled : DEFAULT_CRITICAL_ALERTS_ENABLED,
    }));
}

async function getBroadcastUsersWithSkipped() {
  const db = getSupabase();
  let { data, error } = await db
    .from('user_subscriptions')
    .select('user_id, preferred_language, status, ntfy_enabled, critical_alerts_enabled, ads_enabled');

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await db
      .from('user_subscriptions')
      .select('user_id, status'));
  }

  if (error) throw error;

  const total = (data || []).filter(row => row?.user_id).length;
  const skipped = (data || []).filter(row => row?.user_id && row.status === 'active' && row.ads_enabled === false).length;

  const recipients = (data || [])
    .filter(row => row?.user_id)
    .filter(row => !(row.status === 'active' && row.ads_enabled === false))
    .map(row => ({
      userId: row.user_id,
      language: row.preferred_language || DEFAULT_LANGUAGE,
      status: row.status || 'trial',
      ntfyEnabled: row.ntfy_enabled || false,
      criticalAlertsEnabled: row.critical_alerts_enabled !== undefined ? row.critical_alerts_enabled : DEFAULT_CRITICAL_ALERTS_ENABLED,
    }));

  return { recipients, total, skipped };
}

/**
 * Enable or disable ads for a premium user
 */
async function setAdsEnabled(userId, enabled) {
  const db = getSupabase();
  const { error } = await db
    .from('user_subscriptions')
    .update({ ads_enabled: !!enabled, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error && isMissingColumnError(error)) {
    throw new Error('Database migration required for ads toggle');
  }
  if (error) throw error;
  return !!enabled;
}

/**
 * Check if user has a real active paid subscription (ignores BETA_FREE_MODE)
 */
async function isPremiumUser(userId) {
  const db = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('user_subscriptions')
    .select('status, subscription_ends_at, ads_enabled')
    .eq('user_id', userId)
    .single();
  if (error || !data) return false;
  if (data.status !== 'active') return false;
  if (!data.subscription_ends_at) return false;
  return new Date(data.subscription_ends_at) > new Date();
}

/**
 * Get count of premium users (status = active with valid subscription)
 */
async function getPremiumUsersCount() {
  const db = getSupabase();
  const now = new Date().toISOString();
  const { count, error } = await db
    .from('user_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .gt('subscription_ends_at', now);
  if (error) throw error;
  return count || 0;
}

module.exports = {
  ensureSubscription,
  getSubscriptionStatus,
  getSubscriptionCost,
  getFlowerPrice,
  addSubscriptionDays,
  recordPayment,
  isTxHashUsed,
  connectWallet,
  getUserWallet,
  verifyWalletPayment,
  getNtfySettings,
  updateNtfySettings,
  getUserPreferences,
  getUserLanguage,
  setUserLanguage,
  setPendingAction,
  clearPendingAction,
  setCriticalAlertsEnabled,
  getCriticalAlertsEnabled,
  getFreeTierUsers,
  getBroadcastUsers,
  getBroadcastUsersWithSkipped,
  setAdsEnabled,
  isPremiumUser,
  getPremiumUsersCount,
  PAYMENT_ADDRESS,
  DAYS_PER_SUBSCRIPTION,
  SUBSCRIPTION_USD,
  BETA_FREE_MODE,
};
