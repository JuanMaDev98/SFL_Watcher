/**
 * SFL Historical Data Importer
 * Downloads CSV from sfl.world and imports directly to Supabase
 * No intermediate files - download and insert in one pass
 * 
 * Usage: node import-historical-data.js
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fmmorgahertchyzehuwz.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadCsv(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function insertBatch(resource, snapshots) {
  if (snapshots.length === 0) return 0;
  
  const { data, error } = await supabase
    .from('price_snapshots')
    .insert(snapshots)
    .select('id');
  
  if (error) throw error;
  return data ? data.length : 0;
}

async function main() {
  console.log('=== SFL Historical Data Importer ===\n');
  
  // Init Supabase
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
  console.log('Connected to Supabase\n');
  
  // Get structure
  console.log('Fetching resource structure...');
  const structure = await fetchJson('https://sfl.world/api/v1/trade/structure.json');
  
  const allResources = {};
  for (const category of Object.values(structure)) {
    Object.assign(allResources, category);
  }
  console.log(`Found ${Object.keys(allResources).length} resources\n`);
  
  // Process each resource - download and insert immediately
  console.log('=== Downloading & Importing ===');
  let totalInserted = 0;
  let totalErrors = 0;
  const resourceEntries = Object.entries(allResources);
  
  for (let i = 0; i < resourceEntries.length; i++) {
    const [name, info] = resourceEntries[i];
    const url = `https://sfl.world${info.url}`;
    const resourceKey = name.toLowerCase();
    
    try {
      console.log(`[${i + 1}/${resourceEntries.length}] ${name}...`);
      
      // Download CSV
      const csv = await downloadCsv(url);
      
      // Parse and insert immediately
      const lines = csv.trim().split('\n');
      const snapshots = [];
      
      for (const line of lines) {
        const [timestamp, price] = line.split(',');
        if (timestamp && price) {
          snapshots.push({
            resource: resourceKey,
            price: parseFloat(price),
            created_at: timestamp
          });
        }
      }
      
      if (snapshots.length > 0) {
        const count = await insertBatch(resourceKey, snapshots);
        totalInserted += count;
        console.log(`  ✅ ${count} rows`);
      }
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 50));
      
    } catch (e) {
      totalErrors++;
      console.error(`  ❌ Error: ${e.message}`);
    }
  }
  
  console.log('\n=== Import Complete ===');
  console.log(`Total rows inserted: ${totalInserted}`);
  console.log(`Resources with errors: ${totalErrors}`);
  
  // Verify
  const { count } = await supabase
    .from('price_snapshots')
    .select('*', { count: 'exact', head: true });
  console.log(`Total in DB: ${count}`);
}

main().catch(console.error);