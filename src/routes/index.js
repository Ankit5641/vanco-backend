const express = require('express');
const uploadRoutes = require('./upload.routes');
const jobRoutes = require('./job.routes');

const router = express.Router();

router.use('/upload', uploadRoutes);
router.use('/jobs', jobRoutes);

// Alias for GET /result/:jobId at top level
// Matches the assignment spec: GET /result/{job_id}
router.use('/', jobRoutes);

module.exports = router;