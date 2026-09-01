const crypto = require('crypto');
const pdfParse = require('pdf-parse');

function normalizeText(text) {
  return String(text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function parseDateLoose(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extractFields(text) {
  const fields = {};
  const confidence = {};

  const imo = firstMatch(text, [/(?:IMO(?:\s+NUMBER|\s+NO\.?|\s*#)?)[\s:\-]*([0-9]{7})/i, /\bIMO[\s:\-]*([0-9]{7})\b/i]);
  if (imo) { fields['identity.imo'] = imo; confidence['identity.imo'] = 0.98; }

  const vesselName = firstMatch(text, [/(?:NAME OF (?:THE )?SHIP|VESSEL NAME|SHIP NAME)[\s:\-]*([^\n]{2,80})/i]);
  if (vesselName) { fields['identity.name'] = vesselName; confidence['identity.name'] = 0.86; }

  const flag = firstMatch(text, [/(?:FLAG|FLAG STATE)[\s:\-]*([^\n]{2,60})/i]);
  if (flag) { fields['identity.flag'] = flag; confidence['identity.flag'] = 0.82; }

  const callSign = firstMatch(text, [/(?:CALL SIGN|CALLSIGN)[\s:\-]*([A-Z0-9\-]{3,12})/i]);
  if (callSign) { fields['identity.call_sign'] = callSign; confidence['identity.call_sign'] = 0.9; }

  const gt = firstMatch(text, [/(?:GROSS TONNAGE|GROSS TONS|GT)[\s:\-]*([0-9][0-9,\. ]{2,20})/i]);
  if (gt) { fields['particulars.gt'] = Number(gt.replace(/[, ]/g, '')) || gt; confidence['particulars.gt'] = 0.78; }

  const nt = firstMatch(text, [/(?:NET TONNAGE|NET TONS|NT)[\s:\-]*([0-9][0-9,\. ]{2,20})/i]);
  if (nt) { fields['particulars.nt'] = Number(nt.replace(/[, ]/g, '')) || nt; confidence['particulars.nt'] = 0.78; }

  const loa = firstMatch(text, [/(?:LENGTH OVERALL|LOA)[\s:\-]*([0-9]+(?:\.[0-9]+)?)/i]);
  if (loa) { fields['particulars.loa'] = Number(loa); confidence['particulars.loa'] = 0.8; }

  const beam = firstMatch(text, [/(?:BEAM|BREADTH)[\s:\-]*([0-9]+(?:\.[0-9]+)?)/i]);
  if (beam) { fields['particulars.beam'] = Number(beam); confidence['particulars.beam'] = 0.76; }

  const issuer = firstMatch(text, [/(?:ISSUED BY|ISSUING AUTHORITY|AUTHORITY)[\s:\-]*([^\n]{2,120})/i]);
  if (issuer) { fields['document.issuer'] = issuer; confidence['document.issuer'] = 0.72; }

  const expiry = firstMatch(text, [/(?:EXPIRY DATE|EXPIRATION DATE|VALID UNTIL|DATE OF EXPIRY)[\s:\-]*([^\n]{4,40})/i]);
  const expiryIso = parseDateLoose(expiry);
  if (expiry) { fields['document.expires_at'] = expiryIso || expiry; confidence['document.expires_at'] = expiryIso ? 0.84 : 0.55; }

  const issueDate = firstMatch(text, [/(?:DATE OF ISSUE|ISSUED ON|ISSUE DATE)[\s:\-]*([^\n]{4,40})/i]);
  const issueIso = parseDateLoose(issueDate);
  if (issueDate) { fields['document.issued_at'] = issueIso || issueDate; confidence['document.issued_at'] = issueIso ? 0.82 : 0.55; }

  return { fields, confidence };
}

function classifyDocument(text, filename = '') {
  const hay = `${filename}\n${text}`.toLowerCase();
  const candidates = [
    ['international_oil_pollution_prevention_certificate', ['oil pollution prevention', 'iopp certificate']],
    ['safety_management_certificate', ['safety management certificate']],
    ['international_ship_security_certificate', ['international ship security certificate', 'issc']],
    ['cargo_ship_safety_construction_certificate', ['cargo ship safety construction certificate']],
    ['cargo_ship_safety_equipment_certificate', ['cargo ship safety equipment certificate']],
    ['cargo_ship_safety_radio_certificate', ['cargo ship safety radio certificate']],
    ['certificate_of_registry', ['certificate of registry', 'ship registry']],
    ['international_tonnage_certificate', ['international tonnage certificate', 'tonnage certificate']],
    ['crew_list', ['crew list', 'crew manifest']],
    ['cargo_manifest', ['cargo manifest']],
    ['dangerous_goods_manifest', ['dangerous goods manifest', 'imdg manifest']],
    ['pcsopep', ['pcsopep']],
  ];
  for (const [type, needles] of candidates) if (needles.some(n => hay.includes(n))) return type;
  return 'unclassified_maritime_document';
}

async function extractFromBuffer(buffer, { filename = '', mimetype = '' } = {}) {
  let text = '';
  if (mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    const parsed = await pdfParse(buffer);
    text = parsed.text || '';
  } else {
    text = buffer.toString('utf8');
  }
  text = normalizeText(text);
  const { fields, confidence } = extractFields(text);
  const documentType = classifyDocument(text, filename);
  return {
    document_type: documentType,
    extracted_fields: fields,
    field_confidence: confidence,
    extraction_confidence: Object.values(confidence).length ? Object.values(confidence).reduce((a,b) => a+b,0) / Object.values(confidence).length : 0,
    text_excerpt: text.slice(0, 5000),
    source_hash: crypto.createHash('sha256').update(buffer).digest('hex'),
    text_length: text.length,
    guardrail: 'Deterministic extraction only. Extracted values require verification before they are treated as authoritative vessel data.'
  };
}

module.exports = { extractFromBuffer, extractFields, classifyDocument };
