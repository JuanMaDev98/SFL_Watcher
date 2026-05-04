const supabase = require('../lib/supabase');
const logger = require('../utils/logger');
const { extractUniqueResources } = require('./resourceCatalog');
const { buildStatsFromSnapshots } = require('./priceStats');

const SFL_API_URL = process.env.SFL_API_URL || 'https://sfl.world/api/v1';
const RESOURCE_CACHE_TTL_MS = 5 * 60 * 1000;
let resourceCache = { ts: 0, items: [] };

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

async function getRecentSnapshotsSince(since) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('price_snapshots')
      .select('resource, price, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      logger.error('getRecentSnapshotsSince error:', error.message);
      throw error;
    }

    if (!data || data.length === 0) break;
    rows.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

/**
 * Get all resources with latest stats without N+1 RPC calls.
 */
async function getAllPrices() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const allSnapshots = await getRecentSnapshotsSince(since);
  if (!allSnapshots || allSnapshots.length === 0) return [];

  const uniqueResources = extractUniqueResources(allSnapshots);
  if (uniqueResources.length === 0) return [];

  return buildStatsFromSnapshots(allSnapshots);
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

async function getAvailableResources(days = 7, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && resourceCache.items.length > 0 && (now - resourceCache.ts) < RESOURCE_CACHE_TTL_MS) {
    return resourceCache.items;
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  const resources = new Set();
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('price_snapshots')
      .select('resource, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row?.resource) resources.add(String(row.resource).toLowerCase());
    }

    if (data.length < pageSize) break;
    from += pageSize;

    if (resources.size >= 500) break;
  }

  const items = [...resources].sort((a, b) => a.localeCompare(b));
  resourceCache = { ts: now, items };
  return items;
}

module.exports = {
  fetchPrices,
  getResourceStats,
  getAllPrices,
  getResourceHistory,
  getAvailableResources,
};
