const {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { s3Client } = require('../config/aws');
const config = require('../config/env');
const logger = require('../utils/logger');

// Build a unique S3 key for each uploaded file
// Format: uploads/2024/01/15/{uuid}-{original-filename}
// Why: avoids collisions, groups by date, human-readable
const buildS3Key = (originalFilename) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const uniqueId = uuidv4();

  // Sanitize filename — remove spaces and special chars
  const sanitized = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

  return `uploads/${year}/${month}/${day}/${uniqueId}-${sanitized}`;
};

// Upload a file buffer to S3
const uploadFile = async ({ buffer, mimetype, originalname }) => {
  const bucket = config.s3.bucketName;
  const key = buildS3Key(originalname);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
    // Metadata stored on the S3 object itself — useful for debugging
    Metadata: {
      originalFilename: originalname,
      uploadedAt: new Date().toISOString(),
    },
  });

  await s3Client.send(command);

  logger.info('File uploaded to S3', { bucket, key, mimetype });

  return { key, bucket };
};

// Delete a file from S3 — used by DELETE /jobs/:jobId
const deleteFile = async (bucket, key) => {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await s3Client.send(command);

  logger.info('File deleted from S3', { bucket, key });
};

// Generate a presigned URL — optional but useful for debugging
// Lets you view the file in a browser without making the bucket public
const getPresignedUrl = async (bucket, key, expiresInSeconds = 3600) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });

  return url;
};

module.exports = {
  uploadFile,
  deleteFile,
  getPresignedUrl,
};