/**
 * services/ocr-extractor.js — AI-powered document field extraction for filing wizards
 *
 * Owns: sending uploaded file to GPT-4 Vision, parsing the AI response,
 *       mapping extracted fields to wizard form element IDs per waterway.
 * Does NOT own: file storage, form validation, route handling.
 */

'use strict';

const OpenAI = require('openai');
const pdf    = require('pdf-parse');

const openai = new OpenAI(); // Uses OPENAI_BASE_URL + OPENAI_API_KEY from env

// ── Field mapping: extracted key → form element IDs per waterway ──────────────
// Each key is a canonical field name the AI returns.
// Each value is a list of [waterwayPattern, formId] pairs.
// waterwayPattern = regex string matched against the waterway param.

const FIELD_MAP = [
  // Vessel identity
  { key: 'vessel_name',      formId: ['f-vessel-name'],  waterwayPattern: '.*' },
  { key: 'imo_number',       formId: ['f-imo'],           waterwayPattern: '.*' },
  { key: 'flag_state',       formId: ['f-flag'],          waterwayPattern: '.*' },
  { key: 'call_sign',        formId: ['f-callsign', 'f-call-sign'], waterwayPattern: '.*' },
  { key: 'mmsi',             formId: ['f-mmsi'],          waterwayPattern: '.*' },
  { key: 'vessel_type',      formId: ['f-vessel-type'],   waterwayPattern: '.*' },
  // Dimensions / tonnage
  { key: 'gross_tonnage',    formId: ['f-gt'],            waterwayPattern: '.*' },
  { key: 'net_tonnage',      formId: ['f-nt'],            waterwayPattern: '.*' },
  { key: 'loa',              formId: ['f-loa'],           waterwayPattern: '.*' },
  { key: 'beam',             formId: ['f-beam'],          waterwayPattern: '.*' },
  { key: 'draft',            formId: ['f-draft'],         waterwayPattern: '.*' },
  // Crew / master
  { key: 'crew_count',       formId: ['f-crew'],          waterwayPattern: '.*' },
  { key: 'master_name',      formId: ['f-master'],        waterwayPattern: '.*' },
  // Cargo
  { key: 'cargo_description',formId: ['f-cargo-desc', 'f-cargo-desc'],waterwayPattern: '.*' },
  { key: 'cargo_quantity_mt',formId: ['f-cargo-qty', 'f-cargo-weight'], waterwayPattern: '.*' },
  // Dangerous goods
  { key: 'un_number',        formId: ['f-un', 'f-un2', 'f-un-number'], waterwayPattern: '.*' },
  { key: 'imdg_class',       formId: ['f-imdg', 'f-dg-class', 'f-class'], waterwayPattern: '.*' },
  { key: 'proper_shipping_name', formId: ['f-psn'],       waterwayPattern: '.*' },
  // Voyage
  { key: 'port_of_origin',   formId: ['f-origin', 'f-port-origin', 'f-pol'], waterwayPattern: '.*' },
  { key: 'port_of_destination', formId: ['f-dest', 'f-next-port', 'f-pod'], waterwayPattern: '.*' },
  // Certificates
  { key: 'pcsopep_cert_number', formId: ['f-pcsopep-cert'], waterwayPattern: 'panama' },
  { key: 'pcsopep_issue_date',  formId: ['f-pcsopep-issue'], waterwayPattern: 'panama' },
  { key: 'pcsopep_expiry_date', formId: ['f-pcsopep-expiry'], waterwayPattern: 'panama' },
  { key: 'isps_level',          formId: ['f-isps-level'],    waterwayPattern: 'cape|malacca' },
  { key: 'classification_society', formId: ['f-class-society'], waterwayPattern: '.*' },
  // Insurance / P&I
  { key: 'pi_club',             formId: ['f-pi-club'],       waterwayPattern: '.*' },
  { key: 'pi_policy_number',    formId: ['f-pi-policy'],     waterwayPattern: '.*' },
  { key: 'pi_coverage_expiry',  formId: ['f-pi-expiry'],     waterwayPattern: '.*' },
];

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildPrompt(waterway) {
  return `You are a maritime compliance expert extracting data from a ship's document.

Analyze this document and extract the following fields if present. Return ONLY valid JSON — no markdown, no prose.

Document context: this is for a ${waterway} canal/strait filing.

Return JSON with this exact shape:
{
  "document_type": "<one of: pi_certificate|crew_manifest|cofr|ship_particulars|dg_manifest|other>",
  "fields": {
    "vessel_name": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "imo_number": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "flag_state": { "value": "<ISO 2-letter country code or full name or null>", "confidence": <0.0–1.0> },
    "call_sign": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "mmsi": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "vessel_type": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "gross_tonnage": { "value": "<number as string or null>", "confidence": <0.0–1.0> },
    "net_tonnage": { "value": "<number as string or null>", "confidence": <0.0–1.0> },
    "loa": { "value": "<number in meters as string or null>", "confidence": <0.0–1.0> },
    "beam": { "value": "<number in meters as string or null>", "confidence": <0.0–1.0> },
    "draft": { "value": "<number in meters as string or null>", "confidence": <0.0–1.0> },
    "crew_count": { "value": "<number as string or null>", "confidence": <0.0–1.0> },
    "master_name": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "cargo_description": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "cargo_quantity_mt": { "value": "<number as string or null>", "confidence": <0.0–1.0> },
    "un_number": { "value": "<UN#### string or null>", "confidence": <0.0–1.0> },
    "imdg_class": { "value": "<class like 3 or 6.1 or null>", "confidence": <0.0–1.0> },
    "proper_shipping_name": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "port_of_origin": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "port_of_destination": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "pcsopep_cert_number": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "pcsopep_issue_date": { "value": "<YYYY-MM-DD or null>", "confidence": <0.0–1.0> },
    "pcsopep_expiry_date": { "value": "<YYYY-MM-DD or null>", "confidence": <0.0–1.0> },
    "isps_level": { "value": "<1, 2, or 3 as string, or null>", "confidence": <0.0–1.0> },
    "classification_society": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "pi_club": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "pi_policy_number": { "value": "<string or null>", "confidence": <0.0–1.0> },
    "pi_coverage_expiry": { "value": "<YYYY-MM-DD or null>", "confidence": <0.0–1.0> }
  }
}

Rules:
- Set value to null and confidence to 0 for any field not found in the document.
- confidence 0.9–1.0 = clearly stated in the document
- confidence 0.6–0.89 = inferred or partially legible
- confidence < 0.6 = uncertain — we will warn the user
- Return ONLY the JSON object, no other text.`;
}

// ── PDF → image (base64 of first page as text extraction) ─────────────────────

async function extractTextFromPDF(buffer) {
  try {
    const data = await pdf(buffer);
    return data.text || '';
  } catch {
    return '';
  }
}

// ── Main extraction function ───────────────────────────────────────────────────

async function extractFilingFields(file, waterway) {
  const { buffer, mimetype } = file;
  const CONFIDENCE_THRESHOLD = 0.6;

  let messages;

  if (mimetype === 'application/pdf') {
    // For PDFs: extract text first, send as text content
    const text = await extractTextFromPDF(buffer);
    if (!text || text.trim().length < 20) {
      // Scanned PDF — send as base64 image (convert first page isn't feasible without
      // heavy deps; send the raw text and let GPT do its best)
      throw new Error('Scanned PDF — text extraction insufficient. Please upload a JPG/PNG image of the document instead.');
    }
    messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(waterway) },
          { type: 'text', text: `\n\nDOCUMENT TEXT:\n${text.slice(0, 8000)}` },
        ],
      },
    ];
  } else {
    // Image: send as base64 vision
    const b64 = buffer.toString('base64');
    const dataUrl = `data:${mimetype};base64,${b64}`;
    messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(waterway) },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ];
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    task: 'ocr',
    messages,
    max_tokens: 1500,
    temperature: 0,
  });

  const raw = response.choices[0].message.content.trim();

  // Strip markdown fences if present
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('AI returned malformed JSON — cannot parse extraction result.');
  }

  const { document_type, fields = {} } = parsed;

  // Build field map: formId[] → { value, confidence }
  // Only include fields above the confidence threshold
  const mappedFields = {};
  const warnings     = [];

  for (const mapping of FIELD_MAP) {
    const extracted = fields[mapping.key];
    if (!extracted || extracted.value === null || extracted.value === '') continue;

    const { value, confidence } = extracted;

    if (confidence < CONFIDENCE_THRESHOLD) {
      warnings.push(`Could not confidently extract "${mapping.key.replace(/_/g, ' ')}" — please enter manually.`);
      continue; // Don't auto-fill low-confidence fields
    }

    // Apply to all matching formIds
    for (const formId of mapping.formId) {
      mappedFields[formId] = { value, confidence };
    }
  }

  return {
    documentType: document_type || 'other',
    fields: mappedFields,
    warnings,
    fieldCount: Object.keys(mappedFields).length,
  };
}

module.exports = { extractFilingFields };
