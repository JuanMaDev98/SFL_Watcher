const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FLOWER_PRICE_API = 'https://sfl.world/api/v1.1/exchange';
const SUBSCRIPTION_USD = 1; // $1 USD = 30 days
const DAYS_PER_SUBSCRIPTION = 30;
const TRIAL_DAYS = 7;

let supabase;

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
    console.error('[subscriptionService] getFlowerPrice error:', e.message);
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

  const { data: newSub, error } = await db
    .from('user_subscriptions')
    .insert({
      user_id: userId,
      status: 'trial',
      trial_started_at: new Date().toISOString(),
      trial_ends_at: trialEndsAt.toISOString()
    })
    .select()
    .single();

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

  if (error) throw error;
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
    subscription_ends_at: sub.subscription_ends_at
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
  const { error } = await db
    .from('user_subscriptions')
    .update({
      ntfy_enabled: settings.ntfyEnabled !== undefined ? settings.ntfyEnabled : false,
      ntfy_graph_enabled: settings.ntfyGraphEnabled !== undefined ? settings.ntfyGraphEnabled : true
    })
    .eq('user_id', userId);
  if (error) throw error;
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
  PAYMENT_ADDRESS,
  DAYS_PER_SUBSCRIPTION,
  SUBSCRIPTION_USD
};
