const supabase = require('../lib/supabase');
const logger = require('../utils/logger');

const SFL_API_URL = process.env.SFL_API_URL || 'https://sfl.world/api/v1';

/**
 * Fetch prices from SFL API and save to database
 */
async function fetchPrices() {
  logger.info(`Fetching prices from ${SFL_API_URL}/prices...`);

  try {
    const response = await fetch(`${SFL_API_URL}/prices`);
    
    if (!response.ok) {
      throw new Error(`SFL API returned ${response.status}`);
    }

    const data = await response.json();
    
    // SFL API returns { data: { p2p: { resource: price, ... } }, ... }
    const p2pData = data.data?.p2p || data.p2p || data;
    
    const snapshots = [];
    
    for (const [resource, price] of Object.entries(p2pData)) {
      if (typeof price === 'number') {
        snapshots.push({
          resource: resource.toLowerCase(),
          price: price
        });
      }
    }

    if (snapshots.length === 0) {
      logger.info('No prices to insert');
      return [];
    }

    // Insert all snapshots
    const { data: inserted, error } = await supabase
      .from('price_snapshots')
      .insert(snapshots)
      .select();

    if (error) {
      logger.error('❌ Supabase insert error:', error.message);
      throw error;
    }

    logger.info(`✅ Inserted ${inserted.length} price snapshots`);
    return inserted;

  } catch (error) {
    logger.error('❌ fetchPrices error:', error.message);
    throw error;
  }
}

/**
 * Get stats for a specific resource using SQL function
 */
async function getResourceStats(resource) {
  const { data, error } = await supabase
    .rpc('get_price_stats', { resource_name: resource, days_limit: 90 });

  if (error) {
    logger.error('getResourceStats RPC error:', error.message);
    throw error;
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
    snapshot_count: parseInt(stats.snapshot_count)
  };
}

/**
 * Get all resources with latest stats
 * Uses single RPC call for efficiency
 */
async function getAllPrices() {
  // Get distinct resources from last 24h only (efficient query)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data: resources, error } = await supabase
    .from('price_snapshots')
    .select('resource')
    .gte('created_at', since)
    .order('resource');

  if (error || !resources) return [];
  
  const uniqueResources = [...new Set(resources.map(r => r.resource))];
  
  if (uniqueResources.length === 0) return [];
  
  // If only 1-5 resources, use individual calls (original logic)
  if (uniqueResources.length <= 5) {
    const results = [];
    for (const resource of uniqueResources) {
      const stats = await getResourceStats(resource);
      if (stats) results.push({ ...stats, resource });
    }
    return results;
  }
  
  // For many resources, query raw data and compute in JS
  // This is faster than N RPC calls
  const { data: allSnapshots } = await supabase
    .from('price_snapshots')
    .select('resource, price, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  
  if (!allSnapshots) return [];
  
  // Group by resource and compute stats
  const byResource = {};
  for (const s of allSnapshots) {
    if (!byResource[s.resource]) byResource[s.resource] = [];
    byResource[s.resource].push(parseFloat(s.price));
  }
  
  const output = [];
  for (const [resource, prices] of Object.entries(byResource)) {
    if (prices.length === 0) continue;
    const current = prices[0];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pct = avg > 0 ? ((current - avg) / avg * 100) : 0;
    output.push({ resource, current_price: current, avg_price: avg, min_price: min, max_price: max, percent_vs_avg: pct, snapshot_count: prices.length });
  }
  
  return output.sort((a, b) => a.resource.localeCompare(b.resource));
}

/**
 * Get price history for a resource.
 * Supabase responses are paginated, so we fetch in batches.
 */
async function getResourceHistory(resource, days = 30) {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('price_snapshots')
      .select('price, created_at')
      .eq('resource', resource)
      .gte('created_at', cutoffDate)
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

module.exports = {
  fetchPrices,
  getResourceStats,
  getAllPrices,
  getResourceHistory
};
