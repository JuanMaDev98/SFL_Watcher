function joinResourceTokens(tokens = []) {
  return tokens.map(token => String(token || '').trim()).filter(Boolean).join(' ').trim().toLowerCase();
}

function parsePercentAlertInput(input) {
  const tokens = String(input || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) {
    return { ok: false, error: 'missing_arguments' };
  }

  const resource = joinResourceTokens(tokens.slice(0, -2));
  const rawHigh = parseFloat(tokens[tokens.length - 2]);
  const rawLow = parseFloat(tokens[tokens.length - 1]);

  if (!resource || Number.isNaN(rawHigh) || Number.isNaN(rawLow)) {
    return { ok: false, error: 'invalid_percentages' };
  }

  return {
    ok: true,
    resource,
    thresholdHigh: Math.abs(rawHigh),
    thresholdLow: -Math.abs(rawLow),
  };
}

function parseTargetAlertArgs(args = []) {
  const tokens = Array.isArray(args) ? args.filter(Boolean) : [];
  if (tokens.length < 3) {
    return { ok: false, error: 'missing_arguments' };
  }

  const priceRaw = tokens[tokens.length - 1];
  const direction = String(tokens[tokens.length - 2] || '').toLowerCase();
  const resource = joinResourceTokens(tokens.slice(0, -2));
  const targetPrice = Number(String(priceRaw || '').replace(',', '.'));

  if (!resource || !['above', 'below'].includes(direction) || !Number.isFinite(targetPrice) || targetPrice <= 0) {
    return { ok: false, error: 'invalid_target_alert' };
  }

  return { ok: true, resource, direction, targetPrice };
}

module.exports = {
  joinResourceTokens,
  parsePercentAlertInput,
  parseTargetAlertArgs,
};
