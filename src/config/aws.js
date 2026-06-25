const { S3Client } = require('@aws-sdk/client-s3');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { TextractClient } = require('@aws-sdk/client-textract');
const { SSMClient } = require('@aws-sdk/client-ssm');
const { SNSClient } = require('@aws-sdk/client-sns');
const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
const config = require('./env');

const awsClientConfig = {
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
};

const s3Client = new S3Client(awsClientConfig);
const sqsClient = new SQSClient(awsClientConfig);
const textractClient = new TextractClient(awsClientConfig);
const ssmClient = new SSMClient(awsClientConfig);
const snsClient = new SNSClient(awsClientConfig);
const cloudwatchClient = new CloudWatchLogsClient(awsClientConfig);

module.exports = {
  s3Client,
  sqsClient,
  textractClient,
  ssmClient,
  snsClient,
  cloudwatchClient,
};