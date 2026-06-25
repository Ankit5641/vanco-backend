const {
  DetectDocumentTextCommand,
} = require('@aws-sdk/client-textract');
const { textractClient } = require('../config/aws');
const logger = require('../utils/logger');

// Extract text from a document already stored in S3
// Textract reads directly from S3 — we never re-download the file
const extractTextFromS3 = async (s3Bucket, s3Key) => {
  const command = new DetectDocumentTextCommand({
    Document: {
      S3Object: {
        Bucket: s3Bucket,
        Name: s3Key,
      },
    },
  });

  const response = await textractClient.send(command);

  // Textract returns blocks — each block is a unit of detected content
  // Block types: PAGE, LINE, WORD
  // We want WORD blocks for confidence scores, LINE blocks for readable text
  const blocks = response.Blocks || [];

  // Extract lines of text in reading order
  const lines = blocks
    .filter((block) => block.BlockType === 'LINE')
    .map((block) => block.Text || '')
    .filter(Boolean);

  // Calculate average confidence across all WORD blocks
  // Textract gives confidence 0-100 per word
  const wordBlocks = blocks.filter(
    (block) => block.BlockType === 'WORD' && block.Confidence !== undefined
  );

  const averageConfidence =
    wordBlocks.length > 0
      ? wordBlocks.reduce((sum, block) => sum + block.Confidence, 0) /
        wordBlocks.length
      : null;

  const extractedText = lines.join('\n');

  logger.info('Textract extraction complete', {
    s3Key,
    totalBlocks: blocks.length,
    wordCount: wordBlocks.length,
    lineCount: lines.length,
    averageConfidence: averageConfidence?.toFixed(2),
  });

  return {
    extractedText,
    // Round to 2 decimal places — 99.87 not 99.8734523...
    confidenceScore: averageConfidence
      ? Math.round(averageConfidence * 100) / 100
      : null,
    metadata: {
      totalBlocks: blocks.length,
      wordCount: wordBlocks.length,
      lineCount: lines.length,
    },
  };
};

module.exports = { extractTextFromS3 };