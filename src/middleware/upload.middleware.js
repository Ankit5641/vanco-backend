const multer = require('multer');

// Allowed MIME types — matches what Textract supports
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/tiff',
  'image/webp',
];

// Max file size: 5MB — Textract limit for synchronous operations
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Memory storage — file lives as Buffer in req.file.buffer
// Never touches disk — clean for containerized environments
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    // null = no error, true = accept file
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Allowed: PDF, JPEG, PNG, TIFF, WEBP`
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only one file per request
  },
});

// Wrap multer errors into a cleaner middleware
// By default multer throws its own error format — we normalize it
const handleUpload = (req, res, next) => {
  const uploadSingle = upload.single('file');

  uploadSingle(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 5MB.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Field name must be "file".',
      });
    }

    next();
  });
};

module.exports = { handleUpload };