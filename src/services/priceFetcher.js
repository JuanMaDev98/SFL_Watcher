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
    resource,
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
 */
async function getAllPrices() {
  // Get all distinct resources
  const { data: resources } = await supabase
    .from('price_snapshots')
    .select('resource')
    .order('resource');

  const uniqueResources = [...new Set(resources.map(r => r.resource))];
  
  const results = [];
  
  for (const resource of uniqueResources) {
    const stats = await getResourceStats(resource);
    if (stats) {
      results.push({
        resource,
        current_price: stats.current_price,
        avg_price: stats.avg_price,
        min_price: stats.min_price,
        max_price: stats.max_price,
        percent_vs_avg: stats.percent_vs_avg,
        snapshot_count: stats.snapshot_count
      });
    }
  }

  return results;
}

/**
 * Get price history for a resource (last 30 days)
 */
async function getResourceHistory(resource, days = 30) {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('price_snapshots')
    .select('price, created_at')
    .eq('resource', resource)
    .gte('created_at', cutoffDate)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

module.exports = {
  fetchPrices,
  getResourceStats,
  getAllPrices,
  getResourceHistory
};
