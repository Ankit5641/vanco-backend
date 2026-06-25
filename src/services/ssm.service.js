const { GetParameterCommand, GetParametersCommand } = require('@aws-sdk/client-ssm');
const { ssmClient } = require('../config/aws');
const logger = require('../utils/logger');

// Cache fetched parameters — avoid SSM API call on every request
const parameterCache = new Map();

// Fetch a single parameter from SSM
// WithDecryption: true handles SecureString parameters (passwords, keys)
const getParameter = async (name, useCache = true) => {
  if (useCache && parameterCache.has(name)) {
    return parameterCache.get(name);
  }

  try {
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: true,
    });

    const response = await ssmClient.send(command);
    const value = response.Parameter.Value;

    // Cache for 5 minutes — SSM has rate limits
    parameterCache.set(name, value);
    setTimeout(() => parameterCache.delete(name), 5 * 60 * 1000);

    logger.debug('SSM parameter fetched', { name });
    return value;
  } catch (error) {
    logger.error('Failed to fetch SSM parameter', {
      name,
      error: error.message,
    });
    throw error;
  }
};

// Fetch multiple parameters in one API call — more efficient
const getParameters = async (names) => {
  const command = new GetParametersCommand({
    Names: names,
    WithDecryption: true,
  });

  const response = await ssmClient.send(command);

  // Build a key-value map for easy access
  const result = {};
  response.Parameters.forEach((param) => {
    result[param.Name] = param.Value;
    parameterCache.set(param.Name, param.Value);
  });

  // Warn about any parameters that weren't found
  if (response.InvalidParameters?.length > 0) {
    logger.warn('Some SSM parameters not found', {
      invalidParameters: response.InvalidParameters,
    });
  }

  return result;
};

// Load all app config from SSM at startup
// Falls back to env vars if SSM is unavailable (local dev)
const loadConfigFromSSM = async () => {
  const paramNames = [
    '/vanco/s3-bucket-name',
    '/vanco/sqs-queue-url',
    '/vanco/sns-topic-arn',
  ];

  try {
    const params = await getParameters(paramNames);

    return {
      s3BucketName: params['/vanco/s3-bucket-name'],
      sqsQueueUrl: params['/vanco/sqs-queue-url'],
      snsTopicArn: params['/vanco/sns-topic-arn'],
    };
  } catch (error) {
    logger.warn('SSM unavailable — falling back to environment variables', {
      error: error.message,
    });

    // Graceful fallback for local development
    return {
      s3BucketName: process.env.S3_BUCKET_NAME,
      sqsQueueUrl: process.env.SQS_QUEUE_URL,
      snsTopicArn: process.env.SNS_TOPIC_ARN,
    };
  }
};

module.exports = { getParameter, getParameters, loadConfigFromSSM };