# VANCO AI — Async Document Processing Pipeline

A production-ready backend system built for the VANCO AI Backend Engineering
Intern Assignment. The system accepts document uploads, processes them
asynchronously, extracts text from documents, and makes results queryable
through a REST API.

---

## Important Note on Text Extraction

The assignment specifies using AWS Textract OR free alternatives like
Tesseract OCR, PaddleOCR, or EasyOCR.

This project uses **pdf-parse** and **Tesseract.js** instead of AWS Textract.

**Why we did not use AWS Textract:**

AWS Textract is not available on the AWS Free Tier. It is a paid service
that charges per page processed. For an intern assignment meant to be
"Free Tier compatible — no cost traps" (as stated in the assignment PDF),
using Textract would result in unexpected AWS charges. Additionally,
Textract requires specific IAM permissions and regional availability that
adds unnecessary complexity for a local development setup.

**What we use instead:**

The assignment explicitly allows this:

> "extracts text using AWS Textract OR use free alternatives like local OCR
> (Tesseract OCR, PaddleOCR, EasyOCR)"

We chose:
- **pdf-parse** for text-based PDFs — reads the text layer directly,
  faster and more accurate than OCR, completely free
- **Tesseract.js** for images — industry standard open source OCR engine,
  runs locally, no API costs, no subscription required

The output is identical to what Textract would produce — extracted text
and a confidence score stored in PostgreSQL.

---

## What This Project Does

When you upload a PDF or image to this system, here is exactly
what happens step by step:

1. The file gets stored in AWS S3 for safe persistent storage
2. A job record is created in PostgreSQL with status `pending`
3. A message is pushed to AWS SQS queue
4. The upload API returns a `jobId` immediately — no waiting
5. A separate worker process picks up the message from SQS
6. The worker extracts text from the document
7. The result gets saved to PostgreSQL with status `completed`
8. You poll `GET /result/:jobId` to get the extracted text

The key design decision is that the API and the worker are completely
separate processes. The upload returns in milliseconds regardless of
how long text extraction takes.

---

## Why the Worker is Separate

If text extraction happened inside the upload route, every request
would hang for 10 to 30 seconds while OCR runs. At 100 concurrent
uploads, the server would become unresponsive. The SQS queue acts
as a buffer — jobs pile up in the queue and the worker processes
them one by one at its own pace. If the worker crashes, the message
stays in SQS and gets redelivered automatically. Nothing is lost.

---

## Architecture

```
Client
  ↓
POST /api/upload
  ↓
Multer (validates and buffers file in memory)
  ↓
AWS S3 (stores the file permanently)
  ↓
AWS SQS (queues the job message)
  ↓
API returns { jobId } immediately — HTTP 202 Accepted


--- Separately in the background ---


Worker Process (polls SQS continuously using long polling)
  ↓
Downloads file from S3 to local temp storage
  ↓
pdf-parse (text-based PDFs) or Tesseract.js (images)
  ↓
Saves extracted text and confidence score to PostgreSQL
  ↓
Deletes SQS message (acknowledges job is done)
  ↓
Publishes SNS notification (job completed or failed)


--- Client polls for result ---


GET /api/result/:jobId
  ↓
Returns status and extracted text when ready
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 20 | Fast async I/O, great AWS SDK support |
| Framework | Express.js | Simple flexible REST API framework |
| ORM | Prisma | Type-safe DB access, clean migrations |
| Database | PostgreSQL 15 | Reliable persistent job state storage |
| File Storage | AWS S3 | Durable object storage, Textract reads from it directly |
| Queue | AWS SQS | Async decoupling, at-least-once delivery with retry |
| OCR for PDFs | pdf-parse | Direct text extraction — faster and more accurate than image OCR |
| OCR for Images | Tesseract.js | Free open-source OCR, used instead of paid AWS Textract |
| Image Processing | sharp | Preprocesses images before OCR for better accuracy |
| Config | AWS SSM Parameter Store | Secure config management beyond .env files |
| Notifications | AWS SNS | Event-driven job completion and failure alerts |
| Logging | Winston + CloudWatch | Structured local logs with AWS observability |
| Containerization | Docker + Docker Compose | One command to run everything |

---

## AWS Services Used

| Service | Purpose |
|---|---|
| S3 | Stores uploaded PDF and image files durably |
| SQS | Decouples upload from processing — core async pattern |
| SSM Parameter Store | Stores bucket name and queue URL securely |
| SNS | Publishes job completion and failure events |
| CloudWatch Logs | Receives structured worker logs for observability |
| IAM | Least-privilege permissions — no AdministratorAccess |

Note: AWS Textract is NOT used. Text extraction is handled locally
using pdf-parse and Tesseract.js as permitted by the assignment.

---

## Project Structure

```
vanco-backend/
├── src/
│   ├── config/
│   │   ├── env.js              # Single source of truth for all env vars
│   │   ├── database.js         # Singleton Prisma client
│   │   └── aws.js              # All AWS SDK clients initialized once
│   ├── controllers/
│   │   ├── upload.controller.js  # Handles POST /upload logic
│   │   └── job.controller.js     # Handles GET and DELETE endpoints
│   ├── jobs/
│   │   └── jobQueue.js         # Abstraction over SQS for queuing jobs
│   ├── middleware/
│   │   ├── upload.middleware.js  # Multer config — memory storage, file validation
│   │   └── validate.middleware.js # UUID validation for route params
│   ├── models/
│   │   └── job.model.js        # All database queries live here
│   ├── prisma/
│   │   └── schema.prisma       # Database schema definition
│   ├── routes/
│   │   ├── index.js            # Mounts all route groups
│   │   ├── upload.routes.js    # POST /upload route
│   │   └── job.routes.js       # GET and DELETE routes
│   ├── services/
│   │   ├── s3.service.js       # Upload, delete, presigned URLs
│   │   ├── sqs.service.js      # Send, receive, delete messages
│   │   ├── textract.service.js # PDF parsing and image OCR
│   │   ├── sns.service.js      # Job completion notifications
│   │   ├── ssm.service.js      # Config fetching from Parameter Store
│   │   └── cloudwatch.service.js # Structured logging to CloudWatch
│   ├── utils/
│   │   ├── logger.js           # Winston logger with file and console output
│   │   ├── helpers.js          # UUID generation, response formatting, backoff
│   │   └── circuitBreaker.js   # Prevents hammering failing services
│   ├── worker/
│   │   ├── worker.js           # SQS polling loop — runs as separate process
│   │   └── processor.js        # Job processing logic with retry
│   ├── app.js                  # Express app setup
│   └── server.js               # Server startup and graceful shutdown
├── Dockerfile                  # Container definition
├── docker-compose.yml          # Runs API, worker, and PostgreSQL together
├── README.md                   # This file
├── infrastructure.md           # AWS setup documentation
└── package.json
```

---

## Prerequisites

**For local development:**
- Node.js 20 or higher
- PostgreSQL 15 or higher
- AWS account with Free Tier access

**For Docker:**
- Docker Desktop installed and running

---

## Local Setup Without Docker

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/vanco-backend.git
cd vanco-backend
```

### 2. Install dependencies

```powershell
npm install
```

### 3. Configure environment variables

```powershell
copy .env.example .env
```

Open `.env` and fill in your values:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/vanco_db"

AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here

S3_BUCKET_NAME=your-bucket-name
SQS_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/your-account-id/your-queue-name
SNS_TOPIC_ARN=arn:aws:sns:ap-south-1:your-account-id:your-topic-name
```

### 4. Set up the database

```powershell
npm run db:generate
npm run db:migrate
```

When prompted for migration name type: `init_jobs_table`

### 5. Start the API server

```powershell
npm run dev
```

### 6. Start the worker in a new terminal

```powershell
npm run worker
```

The API runs on `http://localhost:3000`. The worker polls SQS
every 20 seconds using long polling.

---

## Docker Setup Recommended

Docker starts PostgreSQL, runs migrations, and starts both the
API and worker automatically with a single command.

### 1. Make sure Docker Desktop is running

Look for the Docker whale icon in your taskbar.

### 2. Copy and fill environment file

```powershell
copy .env.example .env
```

Fill in your AWS credentials in `.env`.

### 3. Start everything

```powershell
docker-compose up --build
```

You should see:

```
vanco_postgres  | database system is ready to accept connections
vanco_migrate   | All migrations have been successfully applied
vanco_api       | Server running { port: 3000 }
vanco_worker    | Worker started — beginning SQS polling loop
```

### 4. Stop everything

```powershell
docker-compose down
```

---

## AWS Configuration

### Step 1 — Create IAM User

Go to AWS Console → IAM → Users → Create user

Name: `vanco-backend-app`

Attach this exact policy — no more no less:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-south-1:YOUR_ACCOUNT_ID:YOUR_QUEUE_NAME"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:ap-south-1:YOUR_ACCOUNT_ID:parameter/vanco/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "arn:aws:sns:ap-south-1:YOUR_ACCOUNT_ID:YOUR_TOPIC_NAME"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:ap-south-1:YOUR_ACCOUNT_ID:log-group:/vanco/*"
    }
  ]
}
```

After creating the user go to Security Credentials → Create Access Key
→ copy both keys into your `.env` file.

### Step 2 — Create S3 Bucket

Go to AWS Console → S3 → Create bucket

- Bucket name: `your-bucket-name` (must be globally unique)
- Region: `ap-south-1`
- Block all public access: enabled

### Step 3 — Create SQS Queue

Go to AWS Console → SQS → Create queue

- Type: Standard
- Name: `vanco-jobs`
- Visibility timeout: 300 seconds
- Message retention: 86400 seconds
- Receive message wait time: 20 seconds

### Step 4 — Create SNS Topic

Go to AWS Console → SNS → Create topic

- Type: Standard
- Name: `vanco-job-events`

### Step 5 — Create SSM Parameters

Go to AWS Console → Systems Manager → Parameter Store

Create three parameters:

| Name | Value |
|---|---|
| `/vanco/s3-bucket-name` | your actual bucket name |
| `/vanco/sqs-queue-url` | your full SQS queue URL |
| `/vanco/sns-topic-arn` | your full SNS topic ARN |

---

## API Reference

### POST /api/upload

Upload a document for processing.

**Request:** `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| file | File | Yes | PDF, JPEG, PNG, TIFF, WEBP. Max 5MB |

**Response: 202 Accepted**

```json
{
  "success": true,
  "message": "File uploaded successfully. Processing has started.",
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "originalFilename": "invoice.pdf",
    "confidenceScore": null,
    "retryCount": 0,
    "createdAt": "2026-06-26T10:30:00.000Z"
  }
}
```

We return 202 and not 200 because the work is not complete yet.
The file is accepted and queued but text extraction happens
asynchronously. 202 means received and will be processed.

---

### GET /api/result/:jobId

Poll for job status and extracted text.

**Response: 200 OK**

```json
{
  "success": true,
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "originalFilename": "invoice.pdf",
    "extractedText": "INVOICE\nDate: June 26 2026\nTotal: 45,000",
    "confidenceScore": 99,
    "retryCount": 0,
    "errorMessage": null,
    "createdAt": "2026-06-26T10:30:00.000Z",
    "completedAt": "2026-06-26T10:30:05.000Z"
  }
}
```

**Job status lifecycle:**

```
pending → processing → completed
                    → failed (after 3 retries with exponential backoff)
```

---

### GET /api/jobs

List all jobs without extracted text for performance.

**Response: 200 OK**

```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "jobId": "550e8400-...",
      "status": "completed",
      "originalFilename": "invoice.pdf",
      "confidenceScore": 99,
      "createdAt": "2026-06-26T10:30:00.000Z"
    }
  ]
}
```

Extracted text is excluded from this endpoint on purpose.
A single document can contain thousands of words. Returning
extracted text for 100 jobs in one response would send
megabytes of data for no reason.

---

### DELETE /api/jobs/:jobId

Delete a job record and its file from S3.

**Response: 200 OK**

```json
{
  "success": true,
  "message": "Job 550e8400-... deleted successfully."
}
```

The S3 file is deleted first then the database record. This order
ensures you never have an orphaned file in S3 with no way to
track or delete it later.

---

### GET /health

Check if the API is running.

**Response: 200 OK**

```json
{
  "status": "ok",
  "timestamp": "2026-06-26T10:30:00.000Z",
  "uptime": 3600
}
```

---

## How Text Extraction Works

The system uses two different strategies depending on file type:

**Strategy 1 — Direct PDF text extraction (pdf-parse):**

Most modern PDFs contain an actual text layer — the characters
are stored as text data, not as an image. pdf-parse reads this
layer directly, which is:
- Faster than OCR (no image rendering required)
- More accurate (reads actual characters not pixel patterns)
- Free with no API costs or subscriptions
- Confidence score is set to 99 for direct text extraction

**Strategy 2 — Image OCR (Tesseract.js):**

For image files (JPEG, PNG, TIFF, WEBP), Tesseract.js runs
optical character recognition. Before OCR the image is
preprocessed with sharp:
- Upscaled to 2480px width for better character recognition
- Converted to grayscale to reduce noise
- Normalized to improve contrast
- Sharpened to make edges cleaner

Confidence is the average word-level confidence score across
all words recognized in the image.

**Why this is better than AWS Textract for this use case:**

AWS Textract is a paid service. The assignment states the project
should be "Free Tier compatible — no cost traps." pdf-parse and
Tesseract.js are completely free, run locally, require no
subscription, and produce equivalent output. The assignment
explicitly allows this approach.

---

## Retry Logic

The worker retries failed jobs up to 3 times using exponential
backoff with jitter:

```
Attempt 1 fails → wait ~1 second  → Attempt 2
Attempt 2 fails → wait ~2 seconds → Attempt 3
Attempt 3 fails → mark job FAILED → delete SQS message
```

Jitter adds a random 0 to 1000ms delay on top of each wait.
This prevents multiple workers from all retrying at exactly
the same time and hammering a failing service simultaneously.
This is called the thundering herd problem.

---

## What Happens When S3 Succeeds But SQS Fails

This is an important edge case. If the file uploads to S3
successfully but the SQS push fails, the job record in
PostgreSQL gets marked as FAILED immediately. The client
receives a 500 response with the jobId so they can retry.

Without this handling, the job would sit as PENDING forever
with no worker ever picking it up. The client would poll
GET /result/:jobId and never see it complete.

---

## Mandatory Questions

### What would break first under 1,000 concurrent uploads?

The first bottleneck would be the **PostgreSQL connection pool**.
Prisma defaults to 10 connections. At 1,000 concurrent requests
all hitting `createJob()` simultaneously, 990 of them queue up
waiting for a free connection. Response times spike and requests
start timing out.

**How to fix it:**

Fix 1 — Add PgBouncer as a connection pooler between the app
and PostgreSQL. PgBouncer multiplexes thousands of application
connections into a smaller set of real database connections.
This is the highest impact fix.

Fix 2 — Increase the connection limit in the connection string:
```
DATABASE_URL="postgresql://...?connection_limit=50&pool_timeout=10"
```

Fix 3 — Scale workers horizontally. 1,000 uploads means 1,000
jobs in SQS. A single worker processes them sequentially.
Running multiple worker containers pointing at the same queue
drains it faster. SQS handles competing consumers natively —
each message goes to exactly one worker.

Fix 4 — S3 and SQS are not the bottleneck. S3 handles 3,500
PUT requests per second per prefix. Our date-based folder
structure already distributes load. SQS handles virtually
unlimited throughput.

Correct priority: DB connection pool → worker scaling →
API replicas behind a load balancer.

---

### What would you improve with two more days?

**Day 1:**

Dead Letter Queue on SQS — currently jobs that fail after 3
retries are marked FAILED and the SQS message is deleted. A
DLQ would capture these messages automatically. You can inspect
what went wrong, fix the root cause, and replay the messages
without re-uploading files. A CloudWatch alarm on DLQ depth
would alert the team when processing starts failing.

Webhook endpoint for SNS — right now SNS publishes completion
events but nothing receives them. Adding POST /webhook/sns that
verifies the SNS signature and calls back the client's
registered URL would eliminate the need to poll GET /result/:jobId.
True event-driven architecture.

Magic byte validation on uploads — currently the system trusts
the MIME type the client sends. A malicious client could rename
an executable to .pdf. Reading the first bytes of the file and
checking they match the format signature would catch this.

**Day 2:**

Rate limiting — different limits for upload (expensive, involves
S3 and SQS) versus result polling (cheap, just a DB read).
Prevents a single client from overwhelming the system.

API key authentication — the upload endpoint is currently open
to anyone. API key middleware would ensure only authorized
clients submit jobs.

Integration tests — Jest tests that mock AWS services and verify
the full upload to result lifecycle without real AWS calls.
These would catch regressions when code changes.

S3 lifecycle policy — automatically delete files after 30 days
to prevent storage costs growing indefinitely.

---

## Useful Commands

```powershell
# Start everything with Docker
docker-compose up --build

# Stop Docker
docker-compose down

# View logs
docker-compose logs -f api
docker-compose logs -f worker

# Start local development
npm run dev

# Start local worker
npm run worker

# Open database GUI
npm run db:studio

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | API port. Defaults to 3000 |
| `NODE_ENV` | No | development or production |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AWS_REGION` | Yes | AWS region e.g. ap-south-1 |
| `AWS_ACCESS_KEY_ID` | Yes | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | IAM user secret key |
| `S3_BUCKET_NAME` | Yes | Name of your S3 bucket |
| `SQS_QUEUE_URL` | Yes | Full SQS queue URL |
| `SNS_TOPIC_ARN` | Yes | Full SNS topic ARN |