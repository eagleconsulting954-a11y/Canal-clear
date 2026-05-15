/**
 * db/document-uploads.js — SQL query functions for document_uploads table.
 *
 * Owns: OCR document upload recording, status updates, and history listing.
 * Does NOT own: file parsing, AI extraction, or route handling.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function createDocumentUpload(pool, { userId, filingId, originalFilename, fileType }) {
  const result = await pool.query(
    `INSERT INTO document_uploads (user_id, filing_id, original_filename, file_type, extraction_status)
     VALUES ($1, $2, $3, $4, 'processing') RETURNING id`,
    [userId, filingId || null, originalFilename, fileType]
  );
  return result.rows[0] || null;
}

async function markDocumentUploadCompleted(pool, uploadId, extractedData, docCategory) {
  return pool.query(
    `UPDATE document_uploads SET extracted_data = $1, extraction_status = 'completed', doc_category = $2 WHERE id = $3`,
    [JSON.stringify(extractedData), docCategory || 'unknown', uploadId]
  );
}

async function markDocumentUploadError(pool, uploadId, errorMessage) {
  return pool.query(
    `UPDATE document_uploads SET extraction_status = 'error', extraction_error = $1 WHERE id = $2`,
    [errorMessage, uploadId]
  );
}

async function listDocumentUploads(pool, userId, { limit = 20 } = {}) {
  const result = await pool.query(
    `SELECT id, original_filename, file_type, doc_category, extraction_status, created_at
     FROM document_uploads WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

module.exports = {
  createDocumentUpload,
  markDocumentUploadCompleted,
  markDocumentUploadError,
  listDocumentUploads,
};
