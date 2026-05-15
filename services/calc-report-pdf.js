/**
 * Fleet Compliance Cost Calculator — Personalized Report PDF Generator
 *
 * Generates a branded, data-driven PDF for each prospect who unlocks
 * the email-gated calculator report. Data comes from the prospect's
 * actual inputs (vessel count, canals, charter rate, error types).
 *
 * NOT responsible for: R2 upload, email sending, lead capture.
 * Those are handled by the route that calls this service.
 */

'use strict';

const PDFDocument = require('pdfkit');

// Brand palette
const C = {
  navy:        '#1a2332',
  navyLight:   '#243450',
  navyCard:    '#1a2e48',
  orange:      '#d4622b',
  orangeLight: '#e8743e',
  white:       '#ffffff',
  offWhite:    '#f4f6f9',
  grey:        '#8fa3b8',
  greyLight:   '#c8d4e0',
  text:        '#e8eef4',
  textDark:    '#1a2332',
  green:       '#22c55e',
  greenPale:   '#16a34a',
  red:         '#ef4444',
};

/**
 * Determine recommended pricing tier from calculator inputs.
 *
 * Pricing matrix (per task spec):
 *   Single canal:
 *     1–9 vessels  → Agent Pro  ($599 Panama / $899 Suez /mo)
 *     10+ vessels  → Ops Manager ($399 Panama / $599 Suez /vessel/mo)
 *   Both canals:
 *     1–9 vessels  → Bundle Agent Pro ($1,199/mo)
 *     10+ vessels  → Bundle Ops Manager ($900/vessel/mo)
 *
 * @param {number} vessels
 * @param {boolean} hasPanama
 * @param {boolean} hasSuez
 * @returns {{ tier: string, monthly: number, annual: number, label: string, reasoning: string }}
 */
function getRecommendedTier(vessels, hasPanama, hasSuez) {
  const both = hasPanama && hasSuez;
  const singleCanal = hasPanama ? 'Panama' : 'Suez';

  if (both) {
    if (vessels >= 10) {
      const monthly = vessels * 900;
      return {
        tier:      'Bundle Ops Manager',
        monthly,
        annual:    monthly * 12,
        label:     'Bundle Ops Manager',
        reasoning: `Based on your ${vessels}-vessel fleet transiting both canals, Bundle Ops Manager is your best fit at $${(monthly * 12).toLocaleString()}/year`,
      };
    } else {
      return {
        tier:      'Bundle Agent Pro',
        monthly:   1199,
        annual:    1199 * 12,
        label:     'Bundle Agent Pro',
        reasoning: `Based on your ${vessels}-vessel fleet transiting both canals, Bundle Agent Pro is your best fit at $${(1199 * 12).toLocaleString()}/year`,
      };
    }
  } else {
    // Single canal
    if (vessels >= 10) {
      const rate = hasPanama ? 399 : 599;
      const monthly = vessels * rate;
      return {
        tier:      `Ops Manager (${singleCanal})`,
        monthly,
        annual:    monthly * 12,
        label:     `Ops Manager — ${singleCanal}`,
        reasoning: `Based on your ${vessels}-vessel fleet transiting ${singleCanal}, Ops Manager is your best fit at $${(monthly * 12).toLocaleString()}/year`,
      };
    } else {
      const monthly = hasPanama ? 599 : 899;
      return {
        tier:      `Agent Pro (${singleCanal})`,
        monthly,
        annual:    monthly * 12,
        label:     `Agent Pro — ${singleCanal}`,
        reasoning: `Based on your ${vessels}-vessel fleet transiting ${singleCanal}, Agent Pro is your best fit at $${(monthly * 12).toLocaleString()}/year`,
      };
    }
  }
}

/**
 * Generate a personalized compliance risk PDF report.
 *
 * @param {object} data  — Calculator result payload from client
 *   data.email         {string}  prospect email
 *   data.vessels       {number}  fleet size
 *   data.panamaT       {number}  Panama transits/year
 *   data.suezT         {number}  Suez transits/year
 *   data.dailyRate     {number}  charter rate USD/day
 *   data.vesselTypes   {string[]}
 *   data.errorTypes    {string[]}
 *   data.totalRisk     {number}  total annual risk $
 *   data.panamaRisk    {number}
 *   data.suezRisk      {number}
 *
 * @returns {Promise<Buffer>}
 */
function generateCalcReportPDF(data) {
  return new Promise((resolve, reject) => {
    const {
      email       = '',
      vessels     = 1,
      panamaT     = 0,
      suezT       = 0,
      dailyRate   = 32000,
      vesselTypes = [],
      errorTypes  = [],
      totalRisk   = 0,
      panamaRisk  = 0,
      suezRisk    = 0,
    } = data;

    const hasPanama = panamaT > 0;
    const hasSuez   = suezT > 0;
    const tier      = getRecommendedTier(vessels, hasPanama, hasSuez);

    // Derive company name hint from email domain
    const domain = email.includes('@') ? email.split('@')[1] : '';
    const companyHint = domain
      ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
      : 'Your Fleet';

    const perVessel  = vessels > 0 ? Math.round(totalRisk / vessels) : 0;
    const roi        = tier.annual > 0 ? Math.max(1, Math.round(totalRisk / tier.annual)) : 0;
    const savings    = Math.max(0, totalRisk - tier.annual);

    function fmt(n) {
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return '$' + Math.round(n / 1000) + 'K';
      return '$' + n.toLocaleString();
    }
    function fmtFull(n) {
      return '$' + n.toLocaleString('en-US');
    }

    // PDFKit document — Letter-sized, zero margin (we control all layout)
    const buffers = [];
    const doc = new PDFDocument({
      size:   'LETTER', // 612 × 792
      margin: 0,
      info: {
        Title:    `Fleet Compliance Risk Report — ${companyHint}`,
        Author:   'CanalClear',
        Subject:  'Annual Canal Compliance Exposure Analysis',
        Creator:  'CanalClear (canalclear.org)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'compliance, VUMPA, SCA, Panama Canal, Suez Canal, risk',
      },
    });

    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width;  // 612
    const H = doc.page.height; // 792

    // ── Full-page navy background ──────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(C.navy);

    // ── Header band ───────────────────────────────────────────────────────
    const HEADER_H = 80;
    doc.rect(0, 0, W, HEADER_H).fill(C.navyLight);
    // Orange left stripe
    doc.rect(0, 0, 5, HEADER_H).fill(C.orange);

    // Logo
    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.orange);
    doc.text('CanalClear', 22, 18);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey);
    doc.text('Maritime Compliance Automation', 22, 38);

    // Report title
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white);
    doc.text('FLEET COMPLIANCE RISK REPORT', 22, 54);

    // Date badge (right)
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    doc.font('Helvetica').fontSize(8).fillColor(C.grey);
    doc.text(dateStr, W - 120, 58, { width: 100, align: 'right' });

    // Company name & email
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orangeLight);
    doc.text('Prepared for:', W - 200, 22, { width: 178, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(C.greyLight);
    doc.text(email, W - 200, 34, { width: 178, align: 'right' });

    // ── Content area ───────────────────────────────────────────────────────
    const marginX = 24;
    const contentW = W - marginX * 2;
    let y = HEADER_H + 16;

    // ── Section 1: Executive Summary ──────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text('EXECUTIVE SUMMARY', marginX, y);
    y += 14;

    // Risk number block
    doc.roundedRect(marginX, y, contentW, 60, 6).fill(C.navyLight);
    doc.rect(marginX, y, 4, 60).fill(C.red);

    doc.font('Helvetica-Bold').fontSize(22).fillColor(C.red);
    doc.text(fmt(totalRisk), marginX + 18, y + 10, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(C.grey);
    doc.text('estimated annual compliance risk exposure', marginX + 18, y + 38);

    // Stats on the right
    const statsX = marginX + contentW - 200;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white);
    doc.text(`${vessels} vessels`, statsX, y + 8, { width: 190, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(C.grey);
    const canalStr = [hasPanama ? `${panamaT} Panama transits` : '', hasSuez ? `${suezT} Suez transits` : ''].filter(Boolean).join(' + ');
    doc.text(canalStr, statsX, y + 24, { width: 190, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text(`${roi}× higher than CanalClear cost`, statsX, y + 38, { width: 190, align: 'center' });

    y += 72;

    // ── Section 2: Per-Canal Breakdown ────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text('PER-CANAL BREAKDOWN', marginX, y);
    y += 12;

    const cardW = (contentW - 10) / 2;

    // Panama card
    if (hasPanama) {
      doc.roundedRect(marginX, y, cardW, 50, 5).fill(C.navyCard);
      doc.rect(marginX, y, 3, 50).fill(C.orange);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
      doc.text('PANAMA CANAL', marginX + 10, y + 8);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(C.white);
      doc.text(fmt(panamaRisk), marginX + 10, y + 20);
      doc.font('Helvetica').fontSize(8).fillColor(C.grey);
      doc.text(`${panamaT} transits/yr · VUMPA/PCSOPEP risk`, marginX + 10, y + 38);
    }

    // Suez card
    if (hasSuez) {
      const suezX = hasPanama ? marginX + cardW + 10 : marginX;
      const suezW = hasPanama ? cardW : contentW;
      doc.roundedRect(suezX, y, suezW, 50, 5).fill(C.navyCard);
      doc.rect(suezX, y, 3, 50).fill(C.orangeLight);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orangeLight);
      doc.text('SUEZ CANAL', suezX + 10, y + 8);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(C.white);
      doc.text(fmt(suezRisk), suezX + 10, y + 20);
      doc.font('Helvetica').fontSize(8).fillColor(C.grey);
      doc.text(`${suezT} transits/yr · SCA/convoy risk`, suezX + 10, y + 38);
    }

    if (!hasPanama && !hasSuez) {
      doc.roundedRect(marginX, y, contentW, 50, 5).fill(C.navyCard);
      doc.font('Helvetica').fontSize(9).fillColor(C.grey);
      doc.text('No canal transits entered.', marginX + 16, y + 20);
    }

    y += 62;

    // ── Section 3: Failure Cost Matrix ────────────────────────────────────
    const FAILURE_COSTS = [
      { label: 'VUMPA missing/incorrect docs',  cost: Math.round(dailyRate * 0.75 + 12000) },
      { label: 'Booking number / tonnage error', cost: Math.round(dailyRate * 0.5  + 8000)  },
      { label: 'PCSOPEP gaps or expired plan',   cost: Math.round(dailyRate * 0.9  + 15000) },
      { label: 'Draft or dimension mismatch',    cost: Math.round(dailyRate * 0.6  + 10000) },
      { label: 'SCA convoy miss',               cost: Math.round(dailyRate * 1.5  + 22000) },
      { label: 'Crew manifest / STCW error',    cost: Math.round(dailyRate * 0.5  + 7000)  },
    ];

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text('COST PER FAILURE EVENT (your charter rate)', marginX, y);
    y += 12;

    const rowH = 18;
    FAILURE_COSTS.forEach((item, i) => {
      const rowY = y + i * rowH;
      const isOdd = i % 2 === 0;
      doc.rect(marginX, rowY, contentW, rowH).fill(isOdd ? '#1e2e45' : C.navyCard);

      doc.font('Helvetica').fontSize(7.5).fillColor(C.greyLight);
      doc.text(item.label, marginX + 8, rowY + 5);

      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.red);
      doc.text(fmt(item.cost), W - marginX - 60, rowY + 5, { width: 58, align: 'right' });
    });
    y += FAILURE_COSTS.length * rowH + 14;

    // ── Section 4: Per-Vessel Cost Matrix ─────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text('PER-VESSEL EXPOSURE ESTIMATE', marginX, y);
    y += 12;

    const vesselTypeLabels = {
      container: 'Container',
      bulk:      'Bulk Carrier',
      tanker:    'Tanker',
      lng:       'LNG Carrier',
      vehicle:   'Vehicle Carrier',
    };

    const VESSEL_REJECTION = {
      container: { panama: 0.20, suez: 0.18 },
      bulk:      { panama: 0.22, suez: 0.20 },
      tanker:    { panama: 0.19, suez: 0.22 },
      lng:       { panama: 0.15, suez: 0.16 },
      vehicle:   { panama: 0.21, suez: 0.19 },
    };

    const typesToShow = vesselTypes.length > 0 ? vesselTypes : ['container'];

    doc.roundedRect(marginX, y, contentW, typesToShow.length * 22 + 14, 5).fill(C.navyCard);
    // Header row
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.grey);
    doc.text('Vessel Type', marginX + 8, y + 5);
    doc.text('Rejection Rate', marginX + 160, y + 5);
    doc.text('Annual Exposure/Vessel', marginX + 290, y + 5);
    doc.text('Total Exposure', W - marginX - 80, y + 5, { width: 76, align: 'right' });

    y += 18;
    typesToShow.forEach((vt) => {
      const rates = VESSEL_REJECTION[vt] || { panama: 0.20, suez: 0.18 };
      const rejRate = (hasPanama && hasSuez) ? ((rates.panama + rates.suez) / 2) : (hasPanama ? rates.panama : rates.suez);
      const transitsPerVessel = ((hasPanama ? panamaT : 0) + (hasSuez ? suezT : 0)) / vessels;
      const incidentsPerVessel = transitsPerVessel * rejRate;
      const avgDelay = (hasPanama && hasSuez) ? 0.67 : (hasPanama ? 0.75 : 0.58);
      const avgOverhead = (hasPanama && hasSuez) ? 17000 : (hasPanama ? 12000 : 22000);
      const expPerVessel = Math.round(incidentsPerVessel * (dailyRate * avgDelay + avgOverhead));
      const totalExp = expPerVessel * vessels;

      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white);
      doc.text(vesselTypeLabels[vt] || vt, marginX + 8, y + 3);
      doc.font('Helvetica').fontSize(8).fillColor(C.grey);
      doc.text(Math.round(rejRate * 100) + '% avg', marginX + 160, y + 3);
      doc.font('Helvetica').fontSize(8).fillColor(C.greyLight);
      doc.text(fmt(expPerVessel) + '/vessel', marginX + 290, y + 3);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.red);
      doc.text(fmt(totalExp), W - marginX - 80, y + 3, { width: 76, align: 'right' });
      y += 22;
    });

    y += 10;

    // ── Section 5: ROI Multiplier ──────────────────────────────────────────
    doc.roundedRect(marginX, y, contentW, 62, 6).fill(C.navyLight);
    doc.rect(marginX, y, contentW, 62).stroke(C.green).lineWidth(1);
    doc.rect(marginX, y, 4, 62).fill(C.green);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.green);
    doc.text('RETURN ON INVESTMENT', marginX + 14, y + 10);

    // Three numbers
    const roiColW = (contentW - 28) / 3;
    const roiY = y + 26;

    // Your risk
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.red);
    doc.text(fmt(totalRisk), marginX + 14, roiY, { width: roiColW, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor(C.grey);
    doc.text('Annual risk', marginX + 14, roiY + 18, { width: roiColW, align: 'center' });

    // CC cost
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.green);
    doc.text(fmt(tier.annual), marginX + 14 + roiColW + 10, roiY, { width: roiColW, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor(C.grey);
    doc.text('CanalClear/year', marginX + 14 + roiColW + 10, roiY + 18, { width: roiColW, align: 'center' });

    // ROI
    doc.font('Helvetica-Bold').fontSize(18).fillColor(C.orange);
    doc.text(`${roi}×`, marginX + 14 + roiColW * 2 + 20, roiY, { width: roiColW, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor(C.grey);
    doc.text('ROI multiplier', marginX + 14 + roiColW * 2 + 20, roiY + 22, { width: roiColW, align: 'center' });

    y += 74;

    // ── Section 6: Recommended Tier ───────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text('RECOMMENDED PLAN', marginX, y);
    y += 12;

    doc.roundedRect(marginX, y, contentW, 52, 6).fill(C.navyCard);
    doc.rect(marginX, y, 4, 52).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.orange);
    doc.text(tier.label, marginX + 14, y + 10);

    doc.font('Helvetica').fontSize(8).fillColor(C.greyLight);
    doc.text(tier.reasoning, marginX + 14, y + 26, { width: contentW - 28 - 110 });

    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white);
    doc.text(fmtFull(tier.annual) + '/yr', W - marginX - 110, y + 10, { width: 106, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(C.grey);
    doc.text(`$${tier.monthly.toLocaleString()}/month`, W - marginX - 110, y + 30, { width: 106, align: 'right' });

    y += 64;

    // ── Section 7: 12-Month Cost vs Single Rejection ──────────────────────
    const singleRejection = Math.round(dailyRate * 0.75 + 12000);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text('12-MONTH CANALCLEAR COST vs SINGLE REJECTION EVENT', marginX, y);
    y += 12;

    doc.roundedRect(marginX, y, contentW, 32, 5).fill(C.navyCard);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.greyLight);
    doc.text(
      `12 months of CanalClear (${tier.label}): ${fmtFull(tier.annual)}  ·  Single rejection event cost: ~${fmt(singleRejection)}  ·  Breakeven: ${Math.ceil(tier.annual / singleRejection)} rejection${Math.ceil(tier.annual / singleRejection) !== 1 ? 's' : ''} prevented`,
      marginX + 10, y + 11, { width: contentW - 20 }
    );

    y += 44;

    // ── Section 8: CTA Block ───────────────────────────────────────────────
    doc.roundedRect(marginX, y, contentW, 60, 8).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white);
    doc.text('First 25 Clients Lock In Lifetime Rates', marginX + 20, y + 12);

    doc.font('Helvetica').fontSize(9).fillColor('#fff');
    doc.text('20 of 25 founding spots remaining. Lock in your rate before it increases — immediate access, no contracts.', marginX + 20, y + 30, { width: contentW - 180 });

    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white);
    doc.text('canalclear.org/demo/panama →', W - marginX - 170, y + 22, { width: 150, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,0.75)');
    doc.text('Or book 15-min founder call:', W - marginX - 170, y + 38, { width: 150, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(C.white);
    doc.text('wa.me/19543098130', W - marginX - 170, y + 50, { width: 150, align: 'right' });

    y += 72;

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = Math.max(y, H - 36);
    doc.rect(0, footerY, W, H - footerY).fill(C.navyLight);
    doc.rect(0, footerY, W, 1).fill(C.orange);

    doc.font('Helvetica').fontSize(7).fillColor(C.grey);
    doc.text(
      `Generated ${dateStr} by CanalClear · canalclear.org · Based on industry-average rejection rates and vessel delay costs. Actual costs vary.`,
      marginX, footerY + 8, { width: W - marginX * 2 }
    );

    doc.end();
  });
}

/**
 * Upload PDF buffer to R2 via Polsia proxy.
 * Returns the R2 URL or null if upload fails.
 */
async function uploadPDFToR2(pdfBuffer, filename) {
  const apiToken = process.env.POLSIA_API_KEY;
  if (!apiToken) return null;

  try {
    const nodeFetch = require('node-fetch');
    const FormData  = require('form-data');

    const formData = new FormData();
    formData.append('file', pdfBuffer, {
      filename,
      contentType: 'application/pdf',
    });

    const res = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiToken}`, ...formData.getHeaders() },
      body:    formData,
    });

    const data = await res.json();
    if (data.success && data.file && data.file.url) {
      return data.file.url;
    }
    console.error('[CalcReportPDF] R2 upload returned error:', data.error?.message || JSON.stringify(data));
    return null;
  } catch (err) {
    console.error('[CalcReportPDF] R2 upload exception:', err.message);
    return null;
  }
}

/**
 * Build the personalized email HTML body.
 * Used for the immediate post-unlock email delivery.
 */
function buildCalcReportEmail({ email, totalRisk, tier, vessels, panamaT, suezT, roi, savings, pdfUrl }) {
  const unsubUrl = `https://canalclear.org/api/leads/unsubscribe?email=${encodeURIComponent(email)}`;
  const fmtN = n => {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1000) + 'K';
    return '$' + n.toLocaleString();
  };

  const canalDetails = [
    panamaT > 0 ? `${panamaT} Panama transits` : '',
    suezT   > 0 ? `${suezT} Suez transits`     : '',
  ].filter(Boolean).join(' + ');

  const pdfSection = pdfUrl
    ? `<div style="text-align:center;margin:24px 0;">
         <a href="${pdfUrl}" style="display:inline-block;background:#1A2B45;color:#d4622b;border:2px solid #d4622b;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;">
           📄 Download Your Full PDF Report →
         </a>
       </div>`
    : '';

  const html = `
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;color:#C4D0DC;background:#0d1b2e;border-radius:12px;overflow:hidden;">
  <div style="background:#142238;padding:28px 40px;border-radius:12px 12px 0 0;border-left:4px solid #d4622b;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="color:#d4622b;font-size:1.4rem;font-weight:700;letter-spacing:-0.5px;">CanalClear</span>
      <span style="color:#3a5270;font-size:1.2rem;">·</span>
      <span style="color:#8fa3b8;font-size:0.8rem;">Maritime Compliance Automation</span>
    </div>
  </div>

  <div style="padding:40px;">
    <h2 style="color:#ffffff;font-size:1.3rem;margin:0 0 6px;line-height:1.3;">
      Your ${fmtN(totalRisk)} annual canal exposure — here's the report
    </h2>
    <p style="color:#8fa3b8;font-size:0.85rem;margin:0 0 28px;">Fleet: ${vessels} vessel${vessels !== 1 ? 's' : ''} · ${canalDetails}</p>

    <!-- Big number callout -->
    <div style="background:#1a2e48;border:1px solid #243652;border-radius:12px;padding:24px;text-align:center;margin:0 0 28px;">
      <div style="font-size:0.75rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8fa3b8;margin-bottom:8px;">
        Annual Compliance Risk Exposure
      </div>
      <div style="font-size:3rem;font-weight:700;color:#ef4444;letter-spacing:-2px;line-height:1;margin-bottom:8px;">
        ${fmtN(totalRisk)}
      </div>
      <div style="color:#b8c8d8;font-size:0.9rem;">
        ${roi}× higher than CanalClear's annual cost — you'd save ${fmtN(savings)}/year
      </div>
    </div>

    <!-- Recommended tier -->
    <div style="background:#1a2e48;border:1px solid #d4622b;border-radius:10px;padding:20px 24px;margin:0 0 24px;">
      <div style="font-size:0.75rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#d4622b;margin-bottom:8px;">Recommended Plan</div>
      <div style="color:#ffffff;font-size:1.1rem;font-weight:700;margin-bottom:4px;">${tier.label}</div>
      <div style="color:#8fa3b8;font-size:0.9rem;margin-bottom:8px;">${tier.reasoning}</div>
      <div style="color:#e8eef4;font-size:1.4rem;font-weight:700;">$${tier.monthly.toLocaleString()}/month <span style="color:#8fa3b8;font-size:0.85rem;font-weight:400;">· $${tier.annual.toLocaleString()}/year</span></div>
    </div>

    ${pdfSection}

    <!-- CTA -->
    <div style="text-align:center;margin:28px 0;">
      <a href="https://canalclear.org/pricing" style="display:inline-block;background:#d4622b;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:1rem;margin-bottom:12px;">
        First 25 Clients Lock In Lifetime Rates →
      </a>
      <br>
      <a href="https://wa.me/19543098130?text=Hi%2C+I+just+ran+the+fleet+calculator+and+want+to+discuss+my+${vessels}+vessel+fleet" style="color:#d4622b;font-size:0.85rem;">
        Book 15-min call with the founder →
      </a>
    </div>

    <p style="color:#8fa3b8;font-size:0.8rem;line-height:1.6;margin:0;border-top:1px solid #1a2e48;padding-top:20px;">
      CanalClear validates every VUMPA, PCSOPEP, and SCA filing before submission —
      stopping rejections before they become delays. Near-zero preventable rejection rate.
    </p>
  </div>

  <div style="background:#0d1b2e;padding:16px 40px;border-top:1px solid #1a2e48;">
    <p style="color:#3a5270;font-size:0.75rem;margin:0;">
      You're receiving this because you unlocked a report at canalclear.org/get/calculator.
      <a href="${unsubUrl}" style="color:#3a5270;">Unsubscribe</a>
    </p>
  </div>
</div>`;

  return {
    subject: `Your ${fmtN(totalRisk)} annual canal exposure — here's the report`,
    html,
  };
}

module.exports = {
  getRecommendedTier,
  generateCalcReportPDF,
  uploadPDFToR2,
  buildCalcReportEmail,
};
