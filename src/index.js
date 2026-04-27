require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const pricesRouter = require('./routes/prices');
const alertsRouter = require('./routes/alerts');
const subscribeRouter = require('./routes/subscribe');
const { fetchPrices } = require('./services/priceFetcher');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/prices', pricesRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/subscribe', subscribeRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cron job: fetch prices every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log(`[${new Date().toISOString()}] Running price fetch cron...`);
  try {
    const result = await fetchPrices();
    console.log(`✅ Fetched ${result.length} resources`);
  } catch (error) {
    console.error('❌ Price fetch failed:', error.message);
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SFL Watcher API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;