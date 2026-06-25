const dotenv = require('dotenv');
dotenv.config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL,
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },

  s3: {
    bucketName: process.env.S3_BUCKET_NAME,
  },

  sqs: {
    queueUrl: process.env.SQS_QUEUE_URL,
  },

  sns: {
    topicArn: process.env.SNS_TOPIC_ARN,
  },
};

// Validate critical config on startup
const requiredKeys = [
  'DATABASE_URL',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET_NAME',
  'SQS_QUEUE_URL',
];

requiredKeys.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});

module.exports = config;