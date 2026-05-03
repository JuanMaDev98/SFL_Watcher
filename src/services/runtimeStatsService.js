const PROMO_COOLDOWN_MS = 10 * 60 * 1000;
const ALERT_THROTTLE_MS = 60 * 60 * 1000;

const promoCooldowns = new Map();
const alertThrottle = new Map();
const promoEvents = [];
const errorEvents = [];

function nowMs() {
  return Date.now();
}

function prune(list, maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = nowMs() - maxAgeMs;
  while (list.length && list[0].ts < cutoff) list.shift();
}

function canSendPromo(adminId, cooldownMs = PROMO_COOLDOWN_MS) {
  const lastSent = promoCooldowns.get(String(adminId)) || 0;
  const remainingMs = cooldownMs - (nowMs() - lastSent);
  return {
    allowed: remainingMs <= 0,
    remainingMs: Math.max(0, remainingMs),
    cooldownMs,
  };
}

function markPromoSent(adminId, summary = {}) {
  const ts = nowMs();
  promoCooldowns.set(String(adminId), ts);
  promoEvents.push({ ts, adminId: String(adminId), ...summary });
  prune(promoEvents);
}

function shouldThrottleAlert(key, cooldownMs = ALERT_THROTTLE_MS) {
  const normalizedKey = String(key);
  const lastTs = alertThrottle.get(normalizedKey) || 0;
  if ((nowMs() - lastTs) < cooldownMs) {
    return true;
  }
  alertThrottle.set(normalizedKey, nowMs());
  return false;
}

function recordError(source, message = '') {
  errorEvents.push({ ts: nowMs(), source: String(source || 'unknown'), message: String(message || '') });
  prune(errorEvents);
}

function getRuntimeHealthSnapshot(extra = {}) {
  prune(promoEvents);
  prune(errorEvents);
  return {
    promoCooldownRemainingMs: canSendPromo(extra.adminId || 'owner').remainingMs,
    promosSent24h: promoEvents.length,
    promosSentSinceBoot: promoEvents.length,
    errors24h: errorEvents.length,
    lastPromoAt: promoEvents[promoEvents.length - 1]?.ts || null,
    lastErrorAt: errorEvents[errorEvents.length - 1]?.ts || null,
    ...extra,
  };
}

module.exports = {
  PROMO_COOLDOWN_MS,
  ALERT_THROTTLE_MS,
  canSendPromo,
  markPromoSent,
  shouldThrottleAlert,
  recordError,
  getRuntimeHealthSnapshot,
};
