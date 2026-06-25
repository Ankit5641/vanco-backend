const { param } = require('express-validator');
const { validationResult } = require('express-validator');

// Reusable jobId param validator
const validateJobId = [
  param('jobId')
    .isUUID(4)
    .withMessage('jobId must be a valid UUID'),
];

// Run validation and return errors if any
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }

  next();
};

module.exports = { validateJobId, handleValidationErrors };