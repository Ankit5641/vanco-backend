const { PublishCommand } = require('@aws-sdk/client-sns');
const { snsClient } = require('../config/aws');
const config = require('../config/env');
const logger = require('../utils/logger');

// Publish a job completion notification to SNS
// SNS then fans out to all subscribers (webhooks, SQS, email, etc.)
const publishJobComplete = async (job) => {
  if (!config.sns.topicArn) {
    logger.debug('SNS topic ARN not configured — skipping notification');
    return;
  }

  const message = {
    event: 'JOB_COMPLETED',
    jobId: job.id,
    status: job.status,
    originalFilename: job.originalFilename,
    confidenceScore: job.confidenceScore,
    completedAt: job.completedAt,
    timestamp: new Date().toISOString(),
  };

  const command = new PublishCommand({
    TopicArn: config.sns.topicArn,
    Message: JSON.stringify(message),
    Subject: `Document Processing Complete: ${job.id}`,

    // Message attributes for subscription filter policies
    // Subscribers can filter to only receive COMPLETED or FAILED events
    MessageAttributes: {
      eventType: {
        DataType: 'String',
        StringValue: 'JOB_COMPLETED',
      },
      jobId: {
        DataType: 'String',
        StringValue: job.id,
      },
    },
  });

  try {
    const response = await snsClient.send(command);

    logger.info('SNS notification published', {
      jobId: job.id,
      messageId: response.MessageId,
    });

    return response.MessageId;
  } catch (error) {
    // Non-fatal — job completed successfully even if notification fails
    // Log the error but don't throw — don't fail the job over SNS
    logger.error('Failed to publish SNS notification', {
      jobId: job.id,
      error: error.message,
    });
  }
};

// Publish a job failure notification
const publishJobFailed = async (job) => {
  if (!config.sns.topicArn) return;

  const message = {
    event: 'JOB_FAILED',
    jobId: job.id,
    status: job.status,
    originalFilename: job.originalFilename,
    errorMessage: job.errorMessage,
    retryCount: job.retryCount,
    timestamp: new Date().toISOString(),
  };

  const command = new PublishCommand({
    TopicArn: config.sns.topicArn,
    Message: JSON.stringify(message),
    Subject: `Document Processing Failed: ${job.id}`,
    MessageAttributes: {
      eventType: {
        DataType: 'String',
        StringValue: 'JOB_FAILED',
      },
    },
  });

  try {
    await snsClient.send(command);
    logger.info('SNS failure notification published', { jobId: job.id });
  } catch (error) {
    logger.error('Failed to publish SNS failure notification', {
      jobId: job.id,
      error: error.message,
    });
  }
};

module.exports = { publishJobComplete, publishJobFailed };