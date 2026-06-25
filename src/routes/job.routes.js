const express = require('express');
const { getJobResult, listJobs, removeJob } = require('../controllers/job.controller');
const { validateJobId, handleValidationErrors } = require('../middleware/validate.middleware');

const router = express.Router();

// GET /jobs — list all jobs
router.get('/', listJobs);

// GET /result/:jobId — get single job result
router.get(
  '/result/:jobId',
  validateJobId,
  handleValidationErrors,
  getJobResult
);

// DELETE /jobs/:jobId — delete job and S3 file
router.delete(
  '/:jobId',
  validateJobId,
  handleValidationErrors,
  removeJob
);

module.exports = router;