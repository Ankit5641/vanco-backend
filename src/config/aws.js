const { S3Client } = require('@aws-sdk/client-s3');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { TextractClient } = require('@aws-sdk/client-textract');
const { SSMClient } = require('@aws-sdk/client-ssm');
const { SNSClient } = require('@aws-sdk/client-sns');
const config = require('./env');

// Shared credentials object — all clients use this
const awsClientConfig = {
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
};

// Each client is a singleton — created once, reused everywhere
const s3Client = new S3Client(awsClientConfig);
const sqsClient = new SQSClient(awsClientConfig);
const textractClient = new TextractClient(awsClientConfig);
const ssmClient = new SSMClient(awsClientConfig);
const snsClient = new SNSClient(awsClientConfig);

module.exports = {
  s3Client,
  sqsClient,
  textractClient,
  ssmClient,
  snsClient,
};