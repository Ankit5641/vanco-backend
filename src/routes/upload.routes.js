const express = require('express');
const { uploadDocument } = require('../controllers/upload.controller');
const { handleUpload } = require('../middleware/upload.middleware');

const router = express.Router();

// POST /upload
// handleUpload runs first — validates file, puts it in req.file
// uploadDocument runs second — handles business logic
router.post('/', handleUpload, uploadDocument);

module.exports = router;