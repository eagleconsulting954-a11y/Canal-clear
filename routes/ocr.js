/**
 * routes/ocr.js — Document OCR / auto-fill endpoint
 *
 * Owns: POST /api/ocr/extract — accepts a PDF/image upload, runs AI extraction,
 *       returns structured fields mapped to filing wizard form IDs.
 * Does NOT own: field validation (per-waterway validators), storage (R2), auth.
 */

const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const { extractFilingFields } = require('../services/ocr-extractor');

// Memory storage — we pass the buffer directly to GPT-4 Vision; no disk write.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type. Upload PDF, JPG, PNG, or WEBP.'));
  },
});

/**
 * POST /api/ocr/extract
 * Body: multipart/form-data — field "document" (file) + optional "waterway" (string)
 * Returns: { success, documentType, fields: { fieldId: { value, confidence } }, warnings }
 */
router.post('/extract', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No document uploaded.' });
  }

  const waterway = (req.body.waterway || 'generic').toLowerCase();

  try {
    const result = await extractFilingFields(req.file, waterway);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[OCR] Extraction error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Document extraction failed. Please enter fields manually.',
    });
  }
});

module.exports = router;
