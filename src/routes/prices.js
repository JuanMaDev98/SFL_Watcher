const express = require('express');
const router = express.Router();
const { getAllPrices, getResourceStats, getResourceHistory } = require('../services/priceFetcher');

// GET /api/prices - Get all resources with stats
router.get('/', async (req, res) => {
  try {
    const prices = await getAllPrices();
    res.json({
      success: true,
      data: prices,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('GET /api/prices error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/prices/:resource - Get stats for specific resource
router.get('/:resource', async (req, res) => {
  try {
    const { resource } = req.params;
    const stats = await getResourceStats(resource.toLowerCase());
    
    if (!stats) {
      return res.status(404).json({ success: false, error: 'Resource not found' });
    }

    res.json({
      success: true,
      data: {
        resource,
        ...stats
      }
    });
  } catch (error) {
    console.error(`GET /api/prices/${req.params.resource} error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/prices/:resource/history - Get price history
router.get('/:resource/history', async (req, res) => {
  try {
    const { resource } = req.params;
    const { days = 30 } = req.query;
    
    const history = await getResourceHistory(resource.toLowerCase(), parseInt(days));

    res.json({
      success: true,
      data: {
        resource,
        history,
        days: parseInt(days)
      }
    });
  } catch (error) {
    console.error(`GET /api/prices/${req.params.resource}/history error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;