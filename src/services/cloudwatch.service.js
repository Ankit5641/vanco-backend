const {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  DescribeLogStreamsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const { cloudwatchClient } = require('../config/aws');
const logger = require('../utils/logger');

const LOG_GROUP = '/vanco/backend';
const LOG_STREAM = `worker-${new Date().toISOString().split('T')[0]}`;

let sequenceToken = null;
let initialized = false;

// Create log group and stream if they don't exist
const initialize = async () => {
  if (initialized) return;

  try {
    // Create log group — fails silently if already exists
    try {
      await cloudwatchClient.send(
        new CreateLogGroupCommand({ logGroupName: LOG_GROUP })
      );
    } catch (err) {
      if (err.name !== 'ResourceAlreadyExistsException') throw err;
    }

    // Create log stream for today
    try {
      await cloudwatchClient.send(
        new CreateLogStreamCommand({
          logGroupName: LOG_GROUP,
          logStreamName: LOG_STREAM,
        })
      );
    } catch (err) {
      if (err.name !== 'ResourceAlreadyExistsException') throw err;
    }

    // Get sequence token for existing stream
    // Required for PutLogEvents on existing streams
    const streams = await cloudwatchClient.send(
      new DescribeLogStreamsCommand({
        logGroupName: LOG_GROUP,
        logStreamNamePrefix: LOG_STREAM,
      })
    );

    const stream = streams.logStreams?.find(
      (s) => s.logStreamName === LOG_STREAM
    );

    sequenceToken = stream?.uploadSequenceToken || null;
    initialized = true;

    logger.info('CloudWatch logging initialized', {
      logGroup: LOG_GROUP,
      logStream: LOG_STREAM,
    });
  } catch (error) {
    logger.warn('CloudWatch initialization failed — using local logs only', {
      error: error.message,
    });
  }
};

// Send a structured log event to CloudWatch
const logToCloudWatch = async (level, message, meta = {}) => {
  if (!initialized) return;

  const logEvent = {
    timestamp: Date.now(),
    message: JSON.stringify({
      level,
      message,
      ...meta,
      service: 'vanco-worker',
      logStream: LOG_STREAM,
    }),
  };

  try {
    const command = new PutLogEventsCommand({
      logGroupName: LOG_GROUP,
      logStreamName: LOG_STREAM,
      logEvents: [logEvent],
      sequenceToken,
    });

    const response = await cloudwatchClient.send(command);

    // Update sequence token for next call
    sequenceToken = response.nextSequenceToken;
  } catch (error) {
    // Don't throw — logging failure shouldn't crash the worker
    logger.warn('Failed to send log to CloudWatch', {
      error: error.message,
    });
  }
};

module.exports = { initialize, logToCloudWatch };