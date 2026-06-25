const app = require('./app');
const config = require('./config/env');
const logger = require('./utils/logger');
const { disconnect } = require('./config/database');

const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info('Server running', { port: PORT, env: config.nodeEnv });
});

// Graceful shutdown — finish in-flight requests, then close DB
const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});