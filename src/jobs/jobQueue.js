const { sendJobMessage } = require('../services/sqs.service');
const logger = require('../utils/logger');

// Enqueue a job after upload succeeds
// Separating this from the SQS service lets you swap queues later
// (e.g., switch from SQS to RabbitMQ) without touching the controller
const enqueueJob = async (jobData) => {
  const { jobId, s3Key, s3Bucket, originalFilename, mimeType } = jobData;

  try {
    const messageId = await sendJobMessage({
      jobId,
      s3Key,
      s3Bucket,
      originalFilename,
      mimeType,
    });

    logger.info('Job enqueued successfully', { jobId, messageId });

    return messageId;
  } catch (error) {
    logger.error('Failed to enqueue job', { jobId, error: error.message });
    throw error;
  }
};

module.exports = { enqueueJob };