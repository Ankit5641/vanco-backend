const { getJobById, getAllJobs, deleteJob } = require('../models/job.model');
const { deleteFile } = require('../services/s3.service');
const { formatJobResponse, formatJobWithResult } = require('../utils/helpers');
const logger = require('../utils/logger');

// GET /result/:jobId
// Returns job status and extracted text if completed
const getJobResult = async (req, res, next) => {
  const { jobId } = req.params;

  try {
    const job = await getJobById(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Job not found: ${jobId}`,
      });
    }

    logger.debug('Job result fetched', { jobId, status: job.status });

    // Include extractedText only when completed
    // For pending/processing/failed, no text to return
    return res.status(200).json({
      success: true,
      data: formatJobWithResult(job),
    });
  } catch (error) {
    logger.error('Failed to fetch job result', { jobId, error: error.message });
    next(error);
  }
};

// GET /jobs
// Returns all jobs without extracted text (performance)
const listJobs = async (req, res, next) => {
  try {
    const jobs = await getAllJobs();

    return res.status(200).json({
      success: true,
      count: jobs.length,
      data: jobs.map(formatJobResponse),
    });
  } catch (error) {
    logger.error('Failed to list jobs', { error: error.message });
    next(error);
  }
};

// DELETE /jobs/:jobId
// Deletes job record from DB and file from S3
const removeJob = async (req, res, next) => {
  const { jobId } = req.params;

  try {
    const job = await getJobById(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Job not found: ${jobId}`,
      });
    }

    // Delete from S3 first
    // If this fails, we still have the DB record — nothing is lost
    try {
      await deleteFile(job.s3Bucket, job.s3Key);
      logger.info('S3 file deleted', { jobId, s3Key: job.s3Key });
    } catch (s3Error) {
      // Log but don't block DB deletion
      // S3 object may already be gone — not a fatal error
      logger.warn('S3 deletion failed during job removal', {
        jobId,
        s3Key: job.s3Key,
        error: s3Error.message,
      });
    }

    // Delete DB record
    await deleteJob(jobId);

    logger.info('Job deleted', { jobId });

    return res.status(200).json({
      success: true,
      message: `Job ${jobId} deleted successfully.`,
    });
  } catch (error) {
    logger.error('Failed to delete job', { jobId, error: error.message });
    next(error);
  }
};

module.exports = { getJobResult, listJobs, removeJob };