const { getClient } = require('../config/database');

const prisma = getClient();

// Create a new job record when a file is uploaded
const createJob = async ({ id, originalFilename, mimeType, s3Key, s3Bucket }) => {
  return prisma.job.create({
    data: {
      id,
      originalFilename,
      mimeType,
      s3Key,
      s3Bucket,
      status: 'PENDING',
    },
  });
};

// Get a single job by ID
const getJobById = async (id) => {
  return prisma.job.findUnique({
    where: { id },
  });
};

// Get all jobs, newest first
const getAllJobs = async () => {
  return prisma.job.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      originalFilename: true,
      confidenceScore: true,
      retryCount: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      errorMessage: true,
      // Exclude extractedText from list view — can be large
    },
  });
};

// Update job status — used by worker at each stage
const updateJobStatus = async (id, status, extra = {}) => {
  return prisma.job.update({
    where: { id },
    data: {
      status,
      ...extra,
      // Auto-set completedAt when job finishes
      ...(status === 'COMPLETED' || status === 'FAILED'
        ? { completedAt: new Date() }
        : {}),
    },
  });
};

// Increment retry count — called before each retry attempt
const incrementRetryCount = async (id) => {
  return prisma.job.update({
    where: { id },
    data: {
      retryCount: { increment: 1 },
    },
  });
};

// Delete a job record
const deleteJob = async (id) => {
  return prisma.job.delete({
    where: { id },
  });
};

module.exports = {
  createJob,
  getJobById,
  getAllJobs,
  updateJobStatus,
  incrementRetryCount,
  deleteJob,
};