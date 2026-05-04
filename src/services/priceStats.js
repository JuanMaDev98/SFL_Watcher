function normalizeSnapshot(snapshot) {
  const resource = String(snapshot?.resource || '').toLowerCase();
  const price = Number(snapshot?.price);
  const createdAt = snapshot?.created_at ? new Date(snapshot.created_at) : null;

  if (!resource || !Number.isFinite(price) || !createdAt || Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    resource,
    price,
    created_at: createdAt.toISOString(),
    ts: createdAt.getTime(),
  };
}

function buildStatsFromSnapshots(rows = []) {
  const grouped = new Map();

  for (const row of rows) {
    const normalized = normalizeSnapshot(row);
    if (!normalized) continue;

    if (!grouped.has(normalized.resource)) {
      grouped.set(normalized.resource, []);
    }

    grouped.get(normalized.resource).push(normalized);
  }

  return [...grouped.entries()]
    .map(([resource, snapshots]) => {
      snapshots.sort((a, b) => b.ts - a.ts);
      const prices = snapshots.map(snapshot => snapshot.price);
      const current = prices[0];
      const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const pct = avg > 0 ? ((current - avg) / avg) * 100 : 0;

      return {
        resource,
        current_price: current,
        avg_price: avg,
        min_price: min,
        max_price: max,
        percent_vs_avg: pct,
        snapshot_count: prices.length,
      };
    })
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

module.exports = {
  buildStatsFromSnapshots,
};
