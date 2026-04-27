/**
 * Subscription service - handles trial, payments, and subscription status
 */
const supabase = require('../lib/supabase');

// FLOWER token config
const FLOWER_CONTRACT_BASE = '0x3E12b9d6A4D12cd9b4a6d613872d0Eb32f68b380';
const FLOWER_CONTRACT_RONIN = '0x3e12b9d6a4d12cd9b4a6d613872d0eb32f68b380';
const PAYMENT_ADDRESS = '0xbeA7Aa84316661BBC3963e2c5276d2Cd952D7806';
const PRICE_API = 'https://sfl.world/api/v1.1/exchange';

// Subscription pricing
const USD_PER_MONTH = 1;
const TRIAL_DAYS = 7;

/**
 * Get FLOWER price in USD from SFL API
 */
async function getFlowerPrice() {
  try {
    const resp = await fetch(PRICE_API);
    const data = await resp.json();
    return parseFloat(data.sfl?.usd || 0);
  } catch (error) {
    console.error('[subscription] getFlowerPrice error:', error.message);
    return null;
  }
}

/**
 * Calculate FLOWER amount for $1 USD
 */
async function getFlowerAmountForSubscription() {
  const price = await getFlowerPrice();
  if (!price) return null;
  return USD_PER_MONTH / price;
}

/**
 * Check if user has active subscription (trial or paid)
 */
async function hasActiveSubscription(userId) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) return false;

  const now = new Date();
  
  if (data.status === 'trial' && data.trial_ends_at) {
    return new Date(data.trial_ends_at) > now;
  }
  
  if (data.status === 'active' && data.subscription_ends_at) {
    return new Date(data.subscription_ends_at) > now;
  }
  
  return false;
}

/**
 * Get subscription status for user
 */
async function getSubscriptionStatus(userId) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return {
      status: 'new',
      trial_active: true,
      trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      days_remaining: TRIAL_DAYS
    };
  }

  const now = new Date();
  
  if (data.status === 'trial' && data.trial_ends_at) {
    const trialEnd = new Date(data.trial_ends_at);
    if (trialEnd > now) {
      return {
        status: 'trial',
        trial_active: true,
        trial_ends_at: trialEnd,
        days_remaining: Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000))
      };
    } else {
      return {
        status: 'trial_expired',
        trial_active: false,
        trial_ends_at: trialEnd
      };
    }
  }
  
  if (data.status === 'active' && data.subscription_ends_at) {
    const subEnd = new Date(data.subscription_ends_at);
    if (subEnd > now) {
      return {
        status: 'active',
        trial_active: false,
        subscription_ends_at: subEnd,
        days_remaining: Math.ceil((subEnd - now) / (24 * 60 * 60 * 1000))
      };
    } else {
      return {
        status: 'expired',
        trial_active: false,
        subscription_ends_at: subEnd
      };
    }
  }
  
  return { status: 'unknown' };
}

/**
 * Ensure user has a subscription record (creates trial if new)
 */
async function ensureSubscription(userId) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    // Create new trial subscription
    const trialEnds = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const { error: insertError } = await supabase
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        status: 'trial',
        trial_started_at: new Date().toISOString(),
        trial_ends_at: trialEnds.toISOString()
      });

    if (insertError) {
      console.error('[subscription] ensureSubscription insert error:', insertError.message);
    }
    
    return {
      status: 'trial',
      trial_active: true,
      trial_ends_at: trialEnds,
      days_remaining: TRIAL_DAYS
    };
  }
  
  return await getSubscriptionStatus(userId);
}

/**
 * Add subscription days to user
 */
async function addSubscriptionDays(userId, days) {
  const { data: existing } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  const now = new Date();
  let newEndDate;

  if (existing && existing.status === 'active' && existing.subscription_ends_at) {
    const currentEnd = new Date(existing.subscription_ends_at);
    newEndDate = currentEnd > now 
      ? new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000)
      : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  } else {
    newEndDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      status: 'active',
      subscription_ends_at: newEndDate.toISOString(),
      trial_ends_at: null,
      updated_at: now.toISOString()
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[subscription] addSubscriptionDays error:', error.message);
    return false;
  }

  return true;
}

/**
 * Record a payment in database
 */
async function recordPayment(userId, txHash, network, amountToken, amountUsd) {
  const { error } = await supabase
    .from('user_payments')
    .insert({
      user_id: userId,
      tx_hash: txHash,
      network,
      amount_token: amountToken,
      amount_usd: amountUsd,
      days_added: 30,
      verified: true,
      verified_at: new Date().toISOString()
    });

  if (error) {
    console.error('[subscription] recordPayment error:', error.message);
    return false;
  }
  return true;
}

/**
 * Check if tx hash was already used
 */
async function isTxHashUsed(txHash) {
  const { data } = await supabase
    .from('user_payments')
    .select('id')
    .eq('tx_hash', txHash)
    .single();
  
  return !!data;
}

/**
 * Get FLOWER price and calculate subscription cost
 */
async function getSubscriptionCost() {
  const price = await getFlowerPrice();
  if (!price) return null;
  
  const flowerAmount = USD_PER_MONTH / price;
  return {
    usd: USD_PER_MONTH,
    flower_price_usd: price,
    flower_amount: Math.ceil(flowerAmount)
  };
}

module.exports = {
  getFlowerPrice,
  getFlowerAmountForSubscription,
  hasActiveSubscription,
  getSubscriptionStatus,
  ensureSubscription,
  addSubscriptionDays,
  recordPayment,
  isTxHashUsed,
  getSubscriptionCost,
  FLOWER_CONTRACT_BASE,
  FLOWER_CONTRACT_RONIN,
  PAYMENT_ADDRESS,
  TRIAL_DAYS
};