const {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} = require('@aws-sdk/client-sqs');
const { sqsClient } = require('../config/aws');
const config = require('../config/env');
const logger = require('../utils/logger');

// Send a job message to SQS after successful S3 upload
// This is called by the upload controller
const sendJobMessage = async ({ jobId, s3Key, s3Bucket, originalFilename, mimeType }) => {
  const message = {
    jobId,
    s3Key,
    s3Bucket,
    originalFilename,
    mimeType,
    enqueuedAt: new Date().toISOString(),
  };

  const command = new SendMessageCommand({
    QueueUrl: config.sqs.queueUrl,
    MessageBody: JSON.stringify(message),
    // MessageGroupId is required for FIFO queues — skip if standard queue
    // MessageDeduplicationId prevents duplicate messages in FIFO queues

    // Delay delivery by 0 seconds — process immediately
    DelaySeconds: 0,

    // Message attributes — metadata about the message itself
    // Useful for filtering without parsing the body
    MessageAttributes: {
      jobId: {
        DataType: 'String',
        StringValue: jobId,
      },
      fileType: {
        DataType: 'String',
        StringValue: mimeType,
      },
    },
  });

  const result = await sqsClient.send(command);

  logger.info('Job message sent to SQS', {
    jobId,
    messageId: result.MessageId,
    queueUrl: config.sqs.queueUrl,
  });

  return result.MessageId;
};

// Poll SQS for messages — called in a loop by the worker
// Returns up to maxMessages at once (max 10 — SQS hard limit)
const receiveMessages = async (maxMessages = 1) => {
  const command = new ReceiveMessageCommand({
    QueueUrl: config.sqs.queueUrl,
    MaxNumberOfMessages: maxMessages,

    // Long polling — wait up to 20 seconds for a message
    // Without this, empty polls cost money and waste CPU
    // With this, SQS holds the connection open until a message arrives
    WaitTimeSeconds: 20,

    // How long the message stays invisible while being processed
    // Set longer than your expected processing time
    // Textract can take 10-30 seconds — give 5 minutes of buffer
    VisibilityTimeout: 300,

    // What to include in the response
    MessageAttributeNames: ['All'],
    AttributeNames: ['All'],
  });

  const result = await sqsClient.send(command);

  // Returns empty array if no messages — worker handles this gracefully
  return result.Messages || [];
};

// Delete message after successful processing
// This is the "acknowledge" step — tells SQS the job is done
const deleteMessage = async (receiptHandle) => {
  const command = new DeleteMessageCommand({
    QueueUrl: config.sqs.queueUrl,
    ReceiptHandle: receiptHandle,
  });

  await sqsClient.send(command);

  logger.debug('Message deleted from SQS', { receiptHandle });
};

// Extend visibility timeout during long processing
// Call this if processing takes longer than expected
// Prevents the message from becoming visible again mid-processing
const extendVisibility = async (receiptHandle, additionalSeconds = 300) => {
  const command = new ChangeMessageVisibilityCommand({
    QueueUrl: config.sqs.queueUrl,
    ReceiptHandle: receiptHandle,
    VisibilityTimeout: additionalSeconds,
  });

  await sqsClient.send(command);

  logger.debug('Extended SQS message visibility', {
    receiptHandle,
    additionalSeconds,
  });
};

module.exports = {
  sendJobMessage,
  receiveMessages,
  deleteMessage,
  extendVisibility,
};