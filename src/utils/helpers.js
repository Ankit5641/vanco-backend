const { v4: uuidv4 } = require('uuid');

// Generate a job ID — this becomes the public-facing identifier
const generateJobId = () => uuidv4();

// Format job for API response — consistent shape across all endpoints
const formatJobResponse = (job) => ({
  jobId: job.id,
  status: job.status.toLowerCase(), // PENDING → pending (friendlier for clients)
  originalFilename: job.originalFilename,
  confidenceScore: job.confidenceScore,
  retryCount: job.retryCount,
  errorMessage: job.errorMessage || null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt || null,
});

// Format job with extracted text — for GET /result/:jobId only
const formatJobWithResult = (job) => ({
  ...formatJobResponse(job),
  extractedText: job.extractedText || null,
});

// Sleep utility — used in retry logic with exponential backoff
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calculate exponential backoff delay
// Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s
// Jitter added so multiple workers don't all retry at the same time
const getBackoffDelay = (attempt, baseDelayMs = 1000) => {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 1000; // 0–1000ms random jitter
  return exponential + jitter;
};

module.exports = {
  generateJobId,
  formatJobResponse,
  formatJobWithResult,
  sleep,
  getBackoffDelay,
};