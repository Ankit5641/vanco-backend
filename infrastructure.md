# Infrastructure Documentation

This document describes every AWS resource created for the VANCO AI document processing pipeline, explains why each service was chosen, and provides step-by-step instructions for replicating the setup from scratch.

---

## Overview

The system uses five AWS services working together:

```
User uploads file
      ↓
S3 — stores the file permanently
      ↓
SQS — queues the processing job
      ↓
Worker reads from SQS, processes file
      ↓
SSM — provides config to the worker
      ↓
SNS — notifies on job completion
      ↓
CloudWatch — receives worker logs
```

---

## Resources Created

### 1. S3 Bucket

**Name:** `vanco-doc-bucket-{your-name}-2026`

**Purpose:** Stores every uploaded PDF and image file. The worker downloads files from S3 for OCR processing. Files are never stored on the application server itself.

**Why S3 over local disk?**
Local disk disappears when a container restarts or crashes. S3 stores objects with 99.999999999% durability — if a file is uploaded, it stays there until you delete it. S3 also allows Textract and other AWS services to read files directly without downloading them through your server first.

**Configuration:**
- Region: `ap-south-1` (Mumbai — closest to Bengaluru, lowest latency)
- Versioning: Disabled (files are write-once, never updated)
- Public access: Completely blocked (files are only accessed via IAM credentials)
- Encryption: SSE-S3 enabled by default

**Key naming strategy:**
```
uploads/{year}/{month}/{day}/{uuid}-{sanitized-filename}

Example:
uploads/2026/06/26/550e8400-invoice.pdf
```

The date-based prefix structure serves two purposes. First, it makes it easy to find files from a specific day when debugging. Second, S3 partitions storage by key prefix for performance — without date prefixes, all keys would start with `uploads/` and land on the same partition, creating a hotspot at high upload rates.

**How to create:**

Go to AWS Console → S3 → Create bucket
- Enter a globally unique bucket name
- Select region `ap-south-1`
- Leave all other settings as default (public access blocked)
- Click Create bucket

---

### 2. SQS Queue

**Name:** `vanco-document-processing-queue`

**Purpose:** Acts as a buffer between the upload API and the worker. When a file is uploaded, a message is pushed to this queue. The worker continuously polls the queue and processes one job at a time.

**Why SQS instead of processing in the API request?**
If the worker logic ran inside the upload route handler, every HTTP request would block for 10-30 seconds while OCR runs. At 10 concurrent uploads, the server would be fully occupied. SQS decouples the two — the upload returns in under 2 seconds and the worker processes jobs independently.

**Why Standard Queue instead of FIFO?**
FIFO queues guarantee strict ordering and exactly-once delivery but cap at 300 messages per second. Standard queues handle virtually unlimited throughput. Document processing does not require strict ordering — it does not matter if job B finishes before job A. We handle the rare case of duplicate delivery in the worker by checking job status before processing.

**Configuration:**
- Type: Standard Queue
- Visibility timeout: 300 seconds — the message stays invisible for 5 minutes while the worker processes it. If the worker crashes before finishing, the message reappears after 5 minutes and another worker picks it up.
- Message retention: 86,400 seconds (1 day) — if the worker is down for over a day, messages expire. In production this should be 4 days.
- Receive message wait time: 20 seconds — enables long polling. Without this, an idle worker polls SQS 60 times per minute on an empty queue. With long polling, it makes 3 calls per minute, waiting up to 20 seconds for a message each time. This reduces cost significantly.

**How to create:**

Go to AWS Console → SQS → Create queue
- Type: Standard
- Name: `vanco-document-processing-queue`
- Visibility timeout: 300
- Message retention period: 86400
- Receive message wait time: 20
- Click Create queue
- Copy the queue URL into your `.env` file

---

### 3. SNS Topic

**Name:** `vanco-job-events`

**Purpose:** Publishes notifications when jobs complete or fail. SNS is a fan-out service — one published message can reach multiple subscribers simultaneously.

**Why SNS?**
Once a job completes, multiple systems might need to know. A webhook could notify the client that uploaded the file. An SQS queue could feed an analytics pipeline. An email could alert the team on repeated failures. With SNS, the worker publishes one message and SNS delivers it to all subscribers. Adding a new subscriber does not require changing any application code.

**Current state:** The topic is created and the worker publishes to it on job completion and failure. No subscribers are configured yet. Adding a webhook subscriber would be the immediate next step.

**Configuration:**
- Type: Standard
- Name: `vanco-job-events`

**How to create:**

Go to AWS Console → SNS → Topics → Create topic
- Type: Standard
- Name: `vanco-job-events`
- Click Create topic
- Copy the topic ARN into your `.env` file

---

### 4. SSM Parameter Store

**Purpose:** Stores configuration values securely. Instead of hardcoding the S3 bucket name and SQS URL in `.env` files distributed to every server, they live in one central place.

**Parameters created:**

| Parameter Name | Type | Purpose |
|---|---|---|
| `/vanco/s3-bucket-name` | String | S3 bucket name |
| `/vanco/sqs-queue-url` | String | SQS queue URL |
| `/vanco/sns-topic-arn` | String | SNS topic ARN |

**Why SSM instead of environment variables?**

Environment variables have three problems in production. First, they must be distributed manually to every server or container — if you have 10 API instances, you update 10 `.env` files. Second, there is no audit trail — you cannot see who changed a value or when. Third, secrets in plaintext `.env` files are a security risk.

With SSM, config lives in one place. All instances read from SSM at startup. Rotating a value means updating one SSM parameter — all instances pick it up on their next restart. IAM controls who can read or write each parameter. For sensitive values like database passwords, SSM SecureString encrypts them with KMS.

**How to create:**

Go to AWS Console → Systems Manager → Parameter Store → Create parameter

For each parameter:
- Name: `/vanco/s3-bucket-name`
- Tier: Standard
- Type: String
- Value: your actual bucket name
- Click Create parameter

Repeat for the other two parameters.

---

### 5. CloudWatch Log Group

**Name:** `/vanco/backend`

**Purpose:** Receives structured logs from the worker process. CloudWatch makes logs searchable, filterable, and alertable.

**Log structure:**
```
Log Group:  /vanco/backend
  Log Stream: worker-2026-06-26   (new stream per day)
  Log Stream: worker-2026-06-27
```

**Log format (JSON):**
```json
{
  "level": "info",
  "message": "Job completed",
  "jobId": "550e8400-...",
  "confidenceScore": 99,
  "wordCount": 720,
  "timestamp": "2026-06-26T11:19:42.000Z"
}
```

JSON format allows CloudWatch Insights to query across fields. For example, to find all jobs with low confidence:
```sql
fields @timestamp, jobId, confidenceScore
| filter confidenceScore < 80
| sort @timestamp desc
```

**How to create:**

CloudWatch log groups are created automatically when the worker first pushes logs. No manual setup required. The IAM policy must include `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents`.

---

### 6. IAM User and Policy

**User name:** `vanco-backend-app`

**Purpose:** Provides the application with credentials to access AWS services. The policy grants exactly the permissions needed — nothing more.

**Why least privilege matters:**

If these credentials are accidentally committed to GitHub, hardcoded in a build artifact, or stolen from a container, an attacker with `AdministratorAccess` can delete all your S3 data, spin up EC2 instances to mine cryptocurrency, or exfiltrate your entire AWS account. With least privilege, the blast radius is limited to this application's specific resources.

The policy grants:
- `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the specific bucket only
- `sqs:SendMessage`, `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` on the specific queue only
- `ssm:GetParameter`, `ssm:GetParameters` on `/vanco/*` parameters only
- `sns:Publish` on the specific topic only
- CloudWatch log permissions on `/vanco/*` log groups only

No `*` resources. No `*` actions. Every permission is scoped to exactly what the application touches.

---

## How to Replicate This Setup From Scratch

Total time: approximately 25 minutes

1. Sign into AWS Console
2. Create IAM user `vanco-backend-app` with programmatic access
3. Attach the inline policy from `README.md`
4. Save the access key and secret key
5. Create S3 bucket with public access blocked
6. Create SQS standard queue with the configuration above
7. Create SNS standard topic
8. Create three SSM parameters for bucket name, queue URL, and SNS ARN
9. Copy access key and secret key into your `.env` file
10. Fill in bucket name, queue URL, and SNS ARN in your `.env` file
11. Run `docker-compose up --build`

The application will start and be ready to accept uploads.

---

## Cost Estimate for This Assignment

All services used fall within the AWS Free Tier:

| Service | Free Tier | Expected Usage |
|---|---|---|
| S3 | 5GB storage, 20,000 GET, 2,000 PUT | Well under limit |
| SQS | 1 million requests/month | Well under limit |
| SNS | 1 million publishes/month | Well under limit |
| SSM Parameter Store | 10,000 API calls/month | Well under limit |
| CloudWatch Logs | 5GB ingestion/month | Well under limit |

Estimated cost for this assignment: **$0.00**

---

## What I Would Add With More Time

**Dead Letter Queue:** Attach a DLQ to the SQS queue with `maxReceiveCount: 3`. Any message that fails 3 delivery attempts automatically moves to the DLQ instead of being deleted. This lets you inspect failed jobs and replay them after fixing the root cause. A CloudWatch alarm on DLQ message count would alert the team when processing starts failing.

**VPC:** In a real production environment, the RDS database and ECS tasks would live in a private VPC subnet with no public internet access. The current setup uses public endpoints which is acceptable for a development assignment but not for production customer data.

**S3 Lifecycle Policy:** Automatically transition files to S3 Glacier after 30 days and delete them after 90 days. This prevents storage costs from growing indefinitely as more documents are uploaded.

**RDS instead of containerized PostgreSQL:** The current setup runs PostgreSQL inside a Docker container. In production, Amazon RDS would provide automated backups, multi-AZ failover, and managed patching. The application code would not change — only the `DATABASE_URL` connection string.

**Parameter Store Rotation:** A Lambda function that rotates database credentials in SSM on a schedule, then triggers a rolling restart of the application containers to pick up the new values without downtime.