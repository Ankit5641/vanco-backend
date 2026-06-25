const { v4: uuidv4 } = require('uuid');
const { uploadFile } = require('../services/s3.service');
const { enqueueJob } = require('../jobs/jobQueue');
const { createJob, updateJobStatus } = require('../models/job.model');
const { formatJobResponse } = require('../utils/helpers');
const logger = require('../utils/logger');

const uploadDocument = async (req, res, next) => {
  const { originalname, mimetype, buffer, size } = req.file;
  const jobId = uuidv4();

  logger.info('Upload request received', {
    jobId,
    originalname,
    mimetype,
    size,
  });

  let s3Key = null;
  let s3Bucket = null;

  try {
    // Step 1 — Upload file to S3
    // If this fails, nothing has been written yet — safe to return error
    const uploadResult = await uploadFile({
      buffer,
      mimetype,
      originalname,
    });

    s3Key = uploadResult.key;
    s3Bucket = uploadResult.bucket;

    logger.info('S3 upload successful', { jobId, s3Key, s3Bucket });

    // Step 2 — Create job record in DB
    // Status starts as PENDING
    const job = await createJob({
      id: jobId,
      originalFilename: originalname,
      mimeType: mimetype,
      s3Key,
      s3Bucket,
    });

    logger.info('Job record created in DB', { jobId });

    // Step 3 — Send message to SQS
    // If this fails AFTER DB record is created, we must mark job as FAILED
    // Otherwise it sits as PENDING forever with no worker to pick it up
    try {
      await enqueueJob({
        jobId,
        s3Key,
        s3Bucket,
        originalFilename: originalname,
        mimeType: mimetype,
      });

      logger.info('Job enqueued to SQS', { jobId });
    } catch (sqsError) {
      // Partial failure — S3 upload succeeded, DB record exists, SQS failed
      // Mark job as FAILED so client isn't left polling a stuck PENDING job
      logger.error('SQS enqueue failed after S3 upload', {
        jobId,
        error: sqsError.message,
      });

      await updateJobStatus(jobId, 'FAILED', {
        errorMessage: 'Failed to queue job for processing. Please retry.',
      });

      return res.status(500).json({
        success: false,
        message: 'File uploaded but failed to queue for processing.',
        jobId,
      });
    }

    // Step 4 — Return job details to client
    // Client will use jobId to poll GET /result/:jobId
    return res.status(202).json({
      success: true,
      message: 'File uploaded successfully. Processing has started.',
      data: formatJobResponse(job),
    });
  } catch (error) {
    // Top-level catch — S3 upload failed or DB write failed
    logger.error('Upload failed', { jobId, error: error.message });

    // If DB record was created before crash, mark it failed
    if (s3Key) {
      try {
        await updateJobStatus(jobId, 'FAILED', {
          errorMessage: error.message,
        });
      } catch (dbError) {
        logger.error('Failed to update job status after error', {
          jobId,
          error: dbError.message,
        });
      }
    }

    next(error);
  }
};

module.exports = { uploadDocument };