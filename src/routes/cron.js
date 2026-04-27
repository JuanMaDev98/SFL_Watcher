const express = require('express');
const router = express.Router();
const { fetchPrices } = require('../services/priceFetcher');
const { checkAlerts } = require('../services/alertEngine');

/**
 * GET /api/cron/fetch-prices
 * Vercel Cron: runs every 15 minutes
 * Fetches latest prices from SFL API and checks alerts
 */
router.get('/fetch-prices', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Cron: Fetching prices...`);

  try {
    // Fetch new prices
    const result = await fetchPrices();
    console.log(`✅ Fetched ${result.length} resources`);

    // Check alerts after fetching
    if (result.length > 0) {
      await checkAlerts();
    }

    res.json({
      success: true,
      message: 'Prices fetched and alerts checked',
      resources_updated: result.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Cron error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;