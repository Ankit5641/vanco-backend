const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// Singleton pattern — one instance for the entire app lifetime
let prisma;

const getClient = () => {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
    });

    // Log Prisma-level errors through Winston
    prisma.$on('error', (e) => {
      logger.error('Prisma error', { message: e.message, target: e.target });
    });

    prisma.$on('warn', (e) => {
      logger.warn('Prisma warning', { message: e.message });
    });
  }

  return prisma;
};

const disconnect = async () => {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  }
};

module.exports = { getClient, disconnect };