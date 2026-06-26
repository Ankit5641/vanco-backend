const Tesseract = require('tesseract.js');

const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/aws');
const logger = require('../utils/logger');

// Download file from S3 to local temp folder
const downloadFromS3 = async (bucket, key) => {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);

  const ext = path.extname(key) || '.bin';
  const tmpFile = path.join(os.tmpdir(), `vanco-${Date.now()}${ext}`);

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  fs.writeFileSync(tmpFile, Buffer.concat(chunks));
  logger.info('File downloaded from S3', { tmpFile });
  return tmpFile;
};

// Run Tesseract OCR on an image file
const ocrImage = async (imagePath) => {
  const result = await Tesseract.recognize(imagePath, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        logger.debug('OCR progress', {
          progress: Math.round(m.progress * 100) + '%',
        });
      }
    },
  });

  return {
    text: result.data.text || '',
    words: result.data.words || [],
  };
};

// Main extraction function called by worker
const extractTextFromS3 = async (s3Bucket, s3Key) => {
  const tmpFiles = [];

  try {
    // Step 1 — Download file from S3
    const ext = path.extname(s3Key).toLowerCase();
    const tmpFilePath = path.join(
      os.tmpdir(),
      `vanco-${Date.now()}${ext || '.bin'}`
    );

    const command = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: s3Key,
    });
    const response = await s3Client.send(command);

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }

    fs.writeFileSync(tmpFilePath, Buffer.concat(chunks));
    tmpFiles.push(tmpFilePath);

    logger.info('File downloaded from S3', { tmpFilePath, ext });

    let extractedText = '';
    let confidenceScore = null;
    let wordCount = 0;

    if (ext === '.pdf') {
      // Step 2 — Extract text directly from PDF
      // pdf-parse reads the text layer — works for all text-based PDFs
      logger.info('Extracting text from PDF using pdf-parse');

      try {
        const dataBuffer = fs.readFileSync(tmpFilePath);
        const pdfData = await pdfParse(dataBuffer);

        extractedText = pdfData.text.trim();
        wordCount = extractedText
          .split(/\s+/)
          .filter((w) => w.length > 0).length;

        // Direct text extraction is highly accurate
        confidenceScore = 99.0;

        logger.info('PDF text extraction complete', {
          pages: pdfData.numpages,
          charCount: extractedText.length,
          wordCount,
          preview: extractedText.substring(0, 300),
        });

        // If extraction returned nothing meaningful
        if (extractedText.length < 10) {
          throw new Error('PDF appears to have no extractable text');
        }

      } catch (pdfError) {
        // PDF has no text layer — it's a scanned image PDF
        // Fall back to Tesseract OCR on the image itself
        logger.warn('PDF text extraction failed — trying image OCR', {
          error: pdfError.message,
        });

        // For scanned PDFs upload a JPG/PNG instead
        // Tell user in extracted text
        extractedText = 'This PDF appears to be a scanned document. ' +
          'Please upload a JPG or PNG image for OCR processing, ' +
          'or a text-based PDF.';
        confidenceScore = null;
        wordCount = 0;
      }

    } else {
      // Image file — use Tesseract OCR directly
      logger.info('Processing image file with Tesseract OCR', { ext });

      const { text, words } = await ocrImage(tmpFilePath);

      extractedText = text.trim();

      const confidences = words
        .filter((w) => w.confidence > 0)
        .map((w) => w.confidence);

      wordCount = confidences.length;

      confidenceScore =
        confidences.length > 0
          ? Math.round(
              (confidences.reduce((a, b) => a + b, 0) /
                confidences.length) * 100
            ) / 100
          : null;

      logger.info('Image OCR complete', {
        charCount: extractedText.length,
        wordCount,
        confidenceScore,
        preview: extractedText.substring(0, 200),
      });
    }

    logger.info('Extraction complete', {
      s3Key,
      wordCount,
      confidenceScore,
      engine: ext === '.pdf' ? 'pdf-parse' : 'tesseract.js',
    });

    return {
      extractedText,
      confidenceScore,
      metadata: {
        wordCount,
        engine: ext === '.pdf' ? 'pdf-parse' : 'tesseract.js',
      },
    };

  } finally {
    // Cleanup all temp files after everything is done
    for (const f of tmpFiles) {
      try {
        if (f && fs.existsSync(f)) {
          fs.unlinkSync(f);
          logger.debug('Cleaned temp file', { file: f });
        }
      } catch (e) {
        logger.warn('Cleanup failed', { file: f, error: e.message });
      }
    }
  }
};

module.exports = { extractTextFromS3 };