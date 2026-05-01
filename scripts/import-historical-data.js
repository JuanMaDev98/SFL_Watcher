/**
 * SFL Historical Data Importer
 * Downloads CSV files from sfl.world and imports into Supabase price_snapshots
 * 
 * Usage: node import-historical-data.js
 * 
 * After running: SQL setup script will be pushed to the repo for DB configuration
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = 'C:\\Users\\WorkMonitor\\.openclaw\\workspace\\users\\juanma\\sfl-historical-data';

// Supabase connection (using service role key for inserts)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mtnuwkemkaxslmtbycyd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseClient;

async function initSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        file.close();
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function insertToSupabase(resource, csvContent) {
  const lines = csvContent.trim().split('\n');
  const snapshots = [];
  
  for (const line of lines) {
    const [timestamp, price] = line.split(',');
    if (timestamp && price) {
      snapshots.push({
        resource: resource.toLowerCase(),
        price: parseFloat(price),
        created_at: timestamp
      });
    }
  }
  
  if (snapshots.length === 0) return 0;
  
  const { data, error } = await supabaseClient
    .from('price_snapshots')
    .insert(snapshots)
    .select('id');
  
  if (error) {
    console.error(`Error inserting ${resource}:`, error.message);
    throw error;
  }
  
  return data ? data.length : 0;
}

async function main() {
  console.log('=== SFL Historical Data Importer ===\n');
  
  // Clean up old data directory
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  // Initialize Supabase
  await initSupabase();
  console.log('Connected to Supabase\n');
  
  // Get structure
  console.log('Fetching resource structure...');
  const structure = await fetchJson('https://sfl.world/api/v1/trade/structure.json');
  
  const allResources = {};
  for (const category of Object.values(structure)) {
    Object.assign(allResources, category);
  }
  console.log(`Found ${Object.keys(allResources).length} resources\n`);
  
  // Download all CSVs
  console.log('=== Downloading CSV files ===');
  let downloaded = 0;
  
  for (const [name, info] of Object.entries(allResources)) {
    const url = `https://sfl.world${info.url}`;
    const filename = `${name.replace(/[^a-zA-Z0-9]/g, '_')}_${info.id}.csv`;
    const dest = path.join(OUTPUT_DIR, filename);
    
    try {
      console.log(`[${downloaded + 1}/${Object.keys(allResources).length}] Downloading ${name}...`);
      await downloadFile(url, dest);
      downloaded++;
      await new Promise(r => setTimeout(r, 50));
    } catch (e) {
      console.error(`Error downloading ${name}: ${e.message}`);
    }
  }
  
  console.log(`\nDownloaded ${downloaded} files\n`);
  
  // Import to Supabase
  console.log('=== Importing to Supabase ===');
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.csv'));
  
  let totalInserted = 0;
  let totalErrors = 0;
  const BATCH_SIZE = 500; // Insert in batches for efficiency
  
  for (const file of files) {
    const resourceName = file.replace(/_\d+\.csv$/, '').replace(/_/g, ' ');
    const filePath = path.join(OUTPUT_DIR, file);
    const csvContent = fs.readFileSync(filePath, 'utf8');
    
    try {
      const count = await insertToSupabase(resourceName, csvContent);
      totalInserted += count;
      console.log(`✅ ${resourceName}: ${count} rows inserted`);
    } catch (e) {
      totalErrors++;
      console.error(`❌ ${resourceName}: ${e.message}`);
    }
    
    // Small delay to be nice to Supabase
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log('\n=== Import Complete ===');
  console.log(`Total rows inserted: ${totalInserted}`);
  console.log(`Resources with errors: ${totalErrors}`);
  console.log(`\nData saved to: ${OUTPUT_DIR}`);
  
  // Clean up downloaded files after successful import
  fs.rmSync(OUTPUT_DIR, { recursive: true });
  console.log('Downloaded CSV files cleaned up.');
  
  // Verify data
  console.log('\n=== Verifying data ===');
  const { count } = await supabaseClient
    .from('price_snapshots')
    .select('*', { count: 'exact', head: true });
  console.log(`Total rows in price_snapshots: ${count}`);
}

main().catch(console.error);