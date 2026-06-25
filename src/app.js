const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./routes');
const logger = require('./utils/logger');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// All API routes under /api
app.use('/api', routes);

// 404 handler — catches any route not matched above
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler — last middleware, 4 params required by Express
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;

  logger.error('Unhandled error in request', {
    method: req.method,
    url: req.originalUrl,
    status,
    error: err.message,
    stack: err.stack,
  });

  res.status(status).json({
    success: false,
    message:
      status === 500
        ? 'Internal server error'
        : err.message,
  });
});

module.exports = app;