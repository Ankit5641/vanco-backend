# Infrastructure Documentation

This document describes every AWS resource created for the VANCO AI
document processing pipeline, explains why each service was chosen,
and provides step by step instructions to replicate the setup.

---

## A Note on AWS Textract

The original assignment mentions AWS Textract for text extraction.
This project does not use Textract.

**Reason:** AWS Textract is not part of the AWS Free Tier. It charges
per page processed ($1.50 per 1,000 pages for DetectDocumentText).
The assignment explicitly states the project should be
"Free Tier compatible — no cost traps." Using Textract would result
in charges for every document processed during testing and evaluation.

**What we use instead:** The assignment allows free alternatives:
> "use free alternatives like local OCR (Tesseract OCR, PaddleOCR, EasyOCR)"

We use `pdf-parse` for text-based PDFs and `Tesseract.js` for images.
Both are completely free, run locally inside the application, require
no AWS account permissions, and produce the same output — extracted
text with a confidence score.

All other AWS services in this project (S3, SQS, SSM, SNS, CloudWatch)
are used as specified and fall within the AWS Free Tier.

---

## Overview of AWS Resources

```
Document Upload
      ↓
S3 — stores the file
      ↓
SQS — queues the processing job
      ↓
Worker downloads from S3, extracts text locally
      ↓
SSM — provides config values to worker at runtime
      ↓
SNS — notifies on job completion or failure
      ↓
CloudWatch — receives structured worker logs
```

---

## Resource 1 — S3 Bucket

**Name:** `vanco-doc-bucket-{yourname}-2026`

**Purpose:** Stores every uploaded PDF and image permanently.
The worker downloads files from S3 for processing. Files are
never stored on the application server itself.

**Why S3 over local disk:**
Local disk disappears when a container restarts or a server
crashes. S3 provides 99.999999999% durability. A file uploaded
to S3 stays there until you explicitly delete it. S3 also
allows multiple worker instances to access the same files
without any file sharing setup.

**Configuration applied:**
- Region: ap-south-1 (Mumbai — closest to Bengaluru)
- Versioning: Disabled (files are write-once, never updated)
- Public access: Completely blocked
- Encryption: SSE-S3 (enabled by default on all new buckets)

**Key naming strategy we use:**
```
uploads/2026/06/26/uuid-filename.pdf
```

Date prefixes serve two purposes. First, easy to find files
from a specific day when debugging. Second, S3 partitions
storage by key prefix for read and write performance. Without
date prefixes, all requests hit the same partition and
performance degrades at high upload rates.

**Steps to create:**
1. Go to AWS Console → S3 → Create bucket
2. Enter a globally unique bucket name
3. Select region ap-south-1
4. Leave Block all public access checked
5. Click Create bucket
6. Copy bucket name into your .env file as S3_BUCKET_NAME

---

## Resource 2 — SQS Queue

**Name:** `vanco-document-processing-queue`

**Purpose:** Acts as a buffer between the upload API and the
worker. When a file is uploaded, a message goes into this queue.
The worker continuously polls the queue and processes jobs.

**Why SQS is the right tool here:**

Without SQS, you would process documents synchronously inside
the upload request. The client waits 10 to 30 seconds for OCR
to finish before getting a response. At 10 concurrent uploads
the server is fully blocked. At 100 concurrent uploads it
falls over completely.

With SQS, the upload returns in under 2 seconds. The client
gets a jobId and can poll for the result. The worker processes
jobs independently. If the worker crashes, the message stays
in SQS and gets redelivered automatically after the visibility
timeout expires. No job is ever lost.

**Why Standard Queue and not FIFO:**

FIFO queues guarantee exactly-once delivery and strict message
ordering but cap at 300 messages per second. Standard queues
handle virtually unlimited throughput. Document processing does
not require strict ordering — it does not matter if job B
finishes before job A. We handle the rare duplicate delivery
case in the worker by checking job status before processing.

**Configuration applied:**

Visibility timeout: 300 seconds
The message stays invisible for 5 minutes while the worker
processes it. If the worker crashes before finishing, the
message reappears after 5 minutes and another worker picks
it up. 5 minutes gives plenty of headroom for large documents.

Message retention: 86,400 seconds (1 day)
If the worker is down for a full day, messages expire. In
production this should be set to 4 days. A CloudWatch alarm
on queue depth would alert the team if messages are backing up.

Receive message wait time: 20 seconds
This enables long polling. Without long polling an idle worker
polls SQS 60 times per minute on an empty queue, wasting API
calls and money. With long polling it waits up to 20 seconds
for a message before returning empty. An idle worker makes
about 3 API calls per minute instead of 60.

**Steps to create:**
1. Go to AWS Console → SQS → Create queue
2. Select Standard type
3. Name: vanco-document-processing-queue
4. Set Visibility timeout to 300
5. Set Message retention period to 86400
6. Set Receive message wait time to 20
7. Click Create queue
8. Copy the queue URL into your .env file as SQS_QUEUE_URL

---

## Resource 3 — SNS Topic

**Name:** `vanco-job-events`

**Purpose:** Publishes notifications when jobs complete or fail.
SNS is a fan-out service — one published message reaches all
subscribers simultaneously.

**Why SNS matters for this architecture:**

Without SNS, the only way to know a job is done is to poll
GET /result/:jobId repeatedly. This wastes server resources
and adds latency.

With SNS, the worker publishes one event when a job finishes.
Any number of systems can subscribe and react:
- A webhook calls the client that uploaded the file
- An SQS queue feeds an analytics pipeline
- An email alerts the team when jobs fail repeatedly

Adding new reactions does not require any code changes in
the worker. This is the event-driven pattern the assignment
refers to as a stretch goal.

**Current state:** Topic is created and worker publishes to it.
No subscribers are configured yet. Adding a webhook subscriber
at POST /webhook/sns would be the immediate next improvement.

**Steps to create:**
1. Go to AWS Console → SNS → Topics → Create topic
2. Select Standard type
3. Name: vanco-job-events
4. Click Create topic
5. Copy the topic ARN into your .env file as SNS_TOPIC_ARN

---

## Resource 4 — SSM Parameter Store

**Purpose:** Stores configuration values centrally and securely.
Instead of hardcoding bucket names and queue URLs in .env files
on every server, they live in one place in AWS.

**Parameters we created:**

| Name | Type | Value stored |
|---|---|---|
| /vanco/s3-bucket-name | String | S3 bucket name |
| /vanco/sqs-queue-url | String | SQS queue URL |
| /vanco/sns-topic-arn | String | SNS topic ARN |

**Why SSM instead of just .env files:**

Environment variables have real problems in production.
You must distribute them manually to every server.
There is no audit trail of who changed what and when.
Secrets in plaintext .env files committed to version control
are a major security vulnerability.

With SSM, config lives in one central place. All servers
read from SSM at startup. Rotating a value means updating
one SSM parameter — all servers pick it up on next restart.
IAM controls who can read or write each parameter.
For secrets like database passwords, SSM SecureString
encrypts values with KMS.

The assignment specifically calls out SSM usage as a signal
that shows you understand config management beyond .env files.

**Steps to create:**
1. Go to AWS Console → Systems Manager → Parameter Store
2. Click Create parameter
3. Name: /vanco/s3-bucket-name
4. Tier: Standard
5. Type: String
6. Value: your actual bucket name
7. Click Create parameter
8. Repeat for /vanco/sqs-queue-url and /vanco/sns-topic-arn

---

## Resource 5 — CloudWatch Log Group

**Name:** `/vanco/backend`

**Purpose:** Receives structured JSON logs from the worker
process. Makes logs searchable and queryable from anywhere.

**Log structure:**
```
Log Group:  /vanco/backend
  Log Stream: worker-2026-06-26
  Log Stream: worker-2026-06-27
```

A new stream is created each day. This makes it easy to
find logs from a specific date.

**Sample log entry:**
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

JSON format lets CloudWatch Insights run queries like:

Find all failed jobs today:
```sql
fields @timestamp, jobId, errorMessage
| filter message = "Job failed after max retries"
| sort @timestamp desc
```

Find average confidence score by hour:
```sql
fields @timestamp, confidenceScore
| filter message = "Job completed"
| stats avg(confidenceScore) by bin(1h)
```

**How it gets created:**
CloudWatch log groups are created automatically when the
worker first pushes logs. No manual setup needed. The IAM
policy must include logs:CreateLogGroup, logs:CreateLogStream,
logs:PutLogEvents, and logs:DescribeLogStreams.

---

## Resource 6 — IAM User and Policy

**User name:** `vanco-backend-app`

**Purpose:** Application credentials with exactly the
permissions needed — nothing more.

**Why least privilege is critical:**

The assignment specifically asks: "Did they use IAM roles
with least privilege or just slap AdministratorAccess
on everything?"

If application credentials are accidentally committed to
GitHub or leaked in logs, an attacker with AdministratorAccess
can delete all your S3 data, spin up EC2 instances to mine
cryptocurrency, or access your entire AWS account.

With least privilege the blast radius is limited to exactly
what this application touches. A leaked key can upload files
to one specific bucket and read from one specific queue.
Nothing else.

**Permissions granted and why each one is needed:**

s3:PutObject — upload files during POST /upload

s3:GetObject — download files in the worker for OCR

s3:DeleteObject — remove files during DELETE /jobs/:jobId

sqs:SendMessage — push job to queue after upload

sqs:ReceiveMessage — worker polls for new jobs

sqs:DeleteMessage — worker acknowledges completed jobs

sqs:ChangeMessageVisibility — extend timeout for slow jobs

sqs:GetQueueAttributes — check queue configuration

ssm:GetParameter, ssm:GetParameters — read config at startup

sns:Publish — notify on job completion and failure

logs:CreateLogGroup, logs:CreateLogStream,
logs:PutLogEvents, logs:DescribeLogStreams — write worker logs

No wildcards on actions. No wildcards on resources except
where AWS requires it (Textract and CloudWatch log groups).

---

## How to Replicate This From Scratch

Total estimated time: 25 minutes

Step 1 — Sign into AWS Console

Step 2 — Create IAM user named vanco-backend-app
with programmatic access and the policy from README.md

Step 3 — Save the access key ID and secret access key

Step 4 — Create S3 bucket with public access blocked

Step 5 — Create SQS standard queue with visibility
timeout 300, retention 86400, wait time 20

Step 6 — Create SNS standard topic named vanco-job-events

Step 7 — Create three SSM parameters for bucket name,
queue URL, and SNS ARN

Step 8 — Fill in .env with access key, secret key,
bucket name, queue URL, and SNS ARN

Step 9 — Run docker-compose up --build

The application will start and be ready to accept uploads.

---

## AWS Free Tier Cost Estimate

| Service | Free Tier Limit | Expected Usage | Cost |
|---|---|---|---|
| S3 Storage | 5 GB | Under 100 MB | $0.00 |
| S3 Requests | 2,000 PUT | Under 100 | $0.00 |
| SQS | 1 million requests | Under 1,000 | $0.00 |
| SNS | 1 million publishes | Under 1,000 | $0.00 |
| SSM Parameter Store | 10,000 API calls | Under 100 | $0.00 |
| CloudWatch Logs | 5 GB ingestion | Under 1 MB | $0.00 |

**Total estimated cost for this assignment: $0.00**

This is why we chose not to use AWS Textract. Textract
is not in the Free Tier and would add real charges for
every document processed.

---

## What I Would Add With More Time

**Dead Letter Queue:**
Attach a DLQ to the SQS queue with maxReceiveCount set to 3.
Messages that fail 3 deliveries move to the DLQ automatically.
This lets you inspect failed jobs, fix the root cause, and
replay without re-uploading files. A CloudWatch alarm on
DLQ message count would alert on processing failures.

**VPC:**
In production the database and application containers would
live in private VPC subnets with no public internet access.
The current setup uses public endpoints which is fine for
a development assignment but not for production customer data.

**S3 Lifecycle Policy:**
Auto-delete files after 30 days. Prevents storage costs
growing indefinitely as more documents are uploaded during
testing and production use.

**RDS instead of containerized PostgreSQL:**
The current setup runs PostgreSQL in a Docker container.
Amazon RDS provides automated backups, point-in-time recovery,
multi-AZ failover, and managed patching. The application
code would not change — only the DATABASE_URL connection string.

**Secrets Manager instead of SSM for sensitive values:**
AWS Secrets Manager supports automatic rotation of database
credentials and API keys. SSM Parameter Store with SecureString
is good enough for this assignment but Secrets Manager is
the production-grade solution.