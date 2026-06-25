const { extractTextFromS3 } = require('../services/textract.service');
const { deleteMessage } = require('../services/sqs.service');
const { publishJobComplete, publishJobFailed } = require('../services/sns.service');
const { logToCloudWatch } = require('../services/cloudwatch.service');
const {
  getJobById,
  updateJobStatus,
  incrementRetryCount,
} = require('../models/job.model');
const { sleep, getBackoffDelay } = require('../utils/helpers');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;

const processMessage = async (message) => {
  let jobData;

  try {
    jobData = JSON.parse(message.Body);
  } catch (parseError) {
    logger.error('Failed to parse SQS message — deleting poison message', {
      messageId: message.MessageId,
      error: parseError.message,
    });
    await deleteMessage(message.ReceiptHandle);
    return;
  }

  const { jobId, s3Key, s3Bucket } = jobData;

  logger.info('Processing job', { jobId, s3Key });
  await logToCloudWatch('info', 'Processing job', { jobId, s3Key });

  const existingJob = await getJobById(jobId);

  if (!existingJob) {
    logger.warn('Job not found in DB — deleting orphaned message', { jobId });
    await deleteMessage(message.ReceiptHandle);
    return;
  }

  if (existingJob.status === 'COMPLETED') {
    logger.info('Job already completed — skipping duplicate', { jobId });
    await deleteMessage(message.ReceiptHandle);
    return;
  }

  if (existingJob.status === 'PROCESSING') {
    logger.warn('Job already processing — possible duplicate delivery', { jobId });
    return;
  }

  if (existingJob.status === 'FAILED' && existingJob.retryCount >= MAX_RETRIES) {
    logger.info('Job exhausted retries — deleting message', { jobId });
    await deleteMessage(message.ReceiptHandle);
    return;
  }

  await updateJobStatus(jobId, 'PROCESSING');
  await attemptExtraction(jobId, s3Bucket, s3Key, message);
};

const attemptExtraction = async (jobId, s3Bucket, s3Key, message) => {
  const job = await getJobById(jobId);
  let attempt = job.retryCount + 1;

  while (attempt <= MAX_RETRIES) {
    try {
      logger.info('Textract attempt', { jobId, attempt });
      await logToCloudWatch('info', 'Textract attempt', { jobId, attempt });

      const { extractedText, confidenceScore } = await extractTextFromS3(
        s3Bucket,
        s3Key
      );

      const updatedJob = await updateJobStatus(jobId, 'COMPLETED', {
        extractedText,
        confidenceScore,
        errorMessage: null,
      });

      await deleteMessage(message.ReceiptHandle);

      // Fire SNS notification — non-blocking
      // We don't await this — don't let SNS delay job completion
      publishJobComplete(updatedJob).catch((err) => {
        logger.error('SNS notification failed', { jobId, error: err.message });
      });

      await logToCloudWatch('info', 'Job completed', {
        jobId,
        confidenceScore,
        attempt,
      });

      logger.info('Job completed', { jobId, confidenceScore, attempt });
      return;
    } catch (error) {
      logger.warn('Textract attempt failed', {
        jobId,
        attempt,
        error: error.message,
      });

      await incrementRetryCount(jobId);

      if (attempt >= MAX_RETRIES) {
        const failedJob = await updateJobStatus(jobId, 'FAILED', {
          errorMessage: `Failed after ${MAX_RETRIES} attempts. Last error: ${error.message}`,
        });

        await deleteMessage(message.ReceiptHandle);

        // SNS failure notification
        publishJobFailed(failedJob).catch((err) => {
          logger.error('SNS failure notification error', {
            jobId,
            error: err.message,
          });
        });

        await logToCloudWatch('error', 'Job failed after max retries', {
          jobId,
          totalAttempts: attempt,
          error: error.message,
        });

        logger.error('Job failed after max retries', { jobId });
        return;
      }

      const delay = getBackoffDelay(attempt);
      await sleep(delay);
      attempt++;
    }
  }
};

module.exports = { processMessage };