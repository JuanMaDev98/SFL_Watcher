const ALERT_ESCALATION_STEP_PCT = 20;
const CRITICAL_THRESHOLD_PCT = 50;
const CRITICAL_STEP_PCT = 20;
const CRITICAL_RESET_PCT = 0;
const STEP_EPSILON = 1e-9;

function getPercentResetThreshold() {
  return 0;
}

function getPercentStep(currentPct, threshold, direction) {
  const current = Number(currentPct || 0);
  const base = Math.abs(Number(threshold || 0));
  if (!base) return 0;
  if (direction === 'rise') {
    if (current < base) return 0;
    return 1 + Math.floor(((current - base) + STEP_EPSILON) / ALERT_ESCALATION_STEP_PCT);
  }
  if (current > -base) return 0;
  return 1 + Math.floor(((Math.abs(current) - base) + STEP_EPSILON) / ALERT_ESCALATION_STEP_PCT);
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
    return 1 + Math.floor((progressPct + STEP_EPSILON) / 20);
  }

  if (current > target) return 0;
  const progressPct = ((target - current) / target) * 100;
  return 1 + Math.floor((progressPct + STEP_EPSILON) / 20);
}

function getCriticalStep(currentPct) {
  const magnitude = Math.abs(Number(currentPct || 0));
  if (magnitude < CRITICAL_THRESHOLD_PCT) return 0;
  return 1 + Math.floor(((magnitude - CRITICAL_THRESHOLD_PCT) + STEP_EPSILON) / CRITICAL_STEP_PCT);
}

module.exports = {
  ALERT_ESCALATION_STEP_PCT,
  CRITICAL_THRESHOLD_PCT,
  CRITICAL_STEP_PCT,
  CRITICAL_RESET_PCT,
  getPercentResetThreshold,
  getPercentStep,
  getTargetResetPrice,
  getTargetStep,
  getCriticalStep,
};
