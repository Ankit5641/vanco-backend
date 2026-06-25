// This file runs as a separate process: node src/worker/worker.js
// It never imports app.js or server.js
// It has its own lifecycle — starts, polls forever, shuts down gracefully

require('dotenv').config();

const { receiveMessages } = require('../services/sqs.service');
const { processMessage } = require('./processor');
const { getClient, disconnect } = require('../config/database');
const CircuitBreaker = require('../utils/circuitBreaker');
const logger = require('../utils/logger');

// Circuit breaker — if SQS keeps failing, stop hammering it
const sqsCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeout: 30000, // 30 seconds
});

// Track whether worker should keep running
// Set to false on SIGTERM to stop after current job finishes
let isRunning = true;

// Ensure DB connection is established before polling starts
const prisma = getClient();

const poll = async () => {
  logger.info('Worker started — beginning SQS polling loop');

  while (isRunning) {
    // Check circuit breaker before attempting SQS call
    if (!sqsCircuitBreaker.canExecute()) {
      logger.warn('Circuit breaker OPEN — pausing polling for 30 seconds');
      await new Promise((resolve) => setTimeout(resolve, 30000));
      continue;
    }

    let messages = [];

    try {
      // Long polling — blocks up to 20 seconds if queue is empty
      messages = await receiveMessages(1);
      sqsCircuitBreaker.onSuccess();
    } catch (sqsError) {
      sqsCircuitBreaker.onFailure();
      logger.error('Failed to receive messages from SQS', {
        error: sqsError.message,
        circuitState: sqsCircuitBreaker.getState(),
      });

      // Short pause before retrying to avoid tight error loop
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    // No messages — long polling already waited 20s
    // Loop immediately to poll again
    if (messages.length === 0) {
      logger.debug('No messages received — polling again');
      continue;
    }

    // Process each message
    // We only request 1 at a time — simpler, easier to reason about
    for (const message of messages) {
      if (!isRunning) break; // Respect shutdown signal mid-batch

      try {
        await processMessage(message);
      } catch (processingError) {
        // processMessage handles its own errors internally
        // This catch is a safety net for truly unexpected failures
        logger.error('Unexpected error in processMessage', {
          messageId: message.MessageId,
          error: processingError.message,
          stack: processingError.stack,
        });
        // Don't delete message — let visibility timeout expire
        // SQS will redeliver it for another attempt
      }
    }
  }

  // Shutdown complete
  logger.info('Worker polling loop ended — shutting down');
  await disconnect();
  process.exit(0);
};

// Graceful shutdown — finish current job then stop
const shutdown = async (signal) => {
  logger.info(`${signal} received — worker will stop after current job`);
  isRunning = false;
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in worker', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in worker', {
    error: error.message,
    stack: error.stack,
  });
  // Exit so process manager (Docker, PM2) can restart
  process.exit(1);
});

// Start polling
poll().catch((error) => {
  logger.error('Worker crashed on startup', { error: error.message });
  process.exit(1);
});