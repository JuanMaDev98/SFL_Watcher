require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pricesRouter = require('./routes/prices');
const alertsRouter = require('./routes/alerts');
const subscribeRouter = require('./routes/subscribe');
const cronRouter = require('./routes/cron');
const telegramRouter = require('./routes/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/prices', pricesRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/subscribe', subscribeRouter);
app.use('/api/cron', cronRouter);
app.use('/api/telegram', telegramRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server (only in local dev, Vercel uses serverless)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 SFL Watcher API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
  });
}

module.exports = app;