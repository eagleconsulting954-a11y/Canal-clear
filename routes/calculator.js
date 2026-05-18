/**
 * routes/calculator.js — Rejection Exposure Calculator API.
 *
 * Owns: lead capture for the public calculator, email-gated PDF report delivery,
 *       admin listing of calculator leads.
 * Does NOT own: calculation logic (client-side), PDF layout (services/calc-report-pdf.js),
 *               auth sessions (routes/api.js).
 *
 * Public routes:
 *   POST /api/calculator/capture   — capture lead + send PDF report
 *   GET  /api/calculator/leads     — admin: list all calculator leads
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  insertCalculatorLead,
  markPdfSent,
  listCalculatorLeads,
  countCalculatorLeads,
} = require('../db/calculator-leads');

// ── Calculation constants (mirrored from client for server-side PDF data) ───
const REJECTION_RATES = {
  manual:      0.034,   // 3.4% industry average for manual filing
  in_house:    0.022,   // 2.2% for in-house teams
  third_party: 0.018,   // 1.8% for third-party agents
  automated:   0.004,   // 0.4% with automated validation (CanalClear)
};

// Cost-per-event multiplier by cargo type (relative to $65K baseline)
const CARGO_MULTIPLIERS = {
  containers:      1.0,
  bulk:            0.85,
  tanker:          1.3,
  lng:             1.8,
  vehicle_carrier: 1.1,
  other:           1.0,
};

// Failure category split (must sum to 1)
const FAILURE_SPLITS = {
  vumpa_errors:           0.32,
  pcsopep_gaps:           0.24,
  customs_mismatches:     0.28,
  schedule_slip_cascades: 0.16,
};

const BASE_COST_PER_EVENT = 65000;

/**
 * Run the standard calculation from raw inputs.
 * Returns the same numbers the client produces, so the PDF is self-consistent.
 */
function calculate({ fleet_size, monthly_transits, cargo_type, primary_waterway, filing_method }) {
  const annualTransitsPerVessel = (monthly_transits || 1) * 12;
  const totalAnnualTransits = fleet_size * annualTransitsPerVessel;

  const rejectionRate   = REJECTION_RATES[filing_method]  ?? REJECTION_RATES.manual;
  const ccRejectionRate = REJECTION_RATES.automated;

  const costPerEvent = BASE_COST_PER_EVENT * (CARGO_MULTIPLIERS[cargo_type] ?? 1.0);

  // Rejection events
  const annualRejections   = totalAnnualTransits * rejectionRate;
  const ccRejections       = totalAnnualTransits * ccRejectionRate;

  const annualExposure = annualRejections   * costPerEvent;
  const withCanalClear = ccRejections       * costPerEvent;
  const savings        = annualExposure - withCanalClear;

  // Lo-hi confidence band (±25%)
  const low  = annualExposure * 0.75;
  const high = annualExposure * 1.25;

  // Category breakdown
  const breakdown = Object.entries(FAILURE_SPLITS).map(([key, share]) => ({
    key,
    label: FAILURE_LABELS[key],
    exposure:     Math.round(annualExposure * share),
    withCanalClear: Math.round(withCanalClear * share),
  }));

  return {
    annualTransits:         Math.round(totalAnnualTransits),
    annualRejections:       parseFloat(annualRejections.toFixed(1)),
    ccRejections:           parseFloat(ccRejections.toFixed(1)),
    annualExposure:         Math.round(annualExposure),
    withCanalClear:         Math.round(withCanalClear),
    savings:                Math.round(savings),
    savingsPct:             Math.round((savings / (annualExposure || 1)) * 100),
    low:                    Math.round(low),
    high:                   Math.round(high),
    breakdown,
    rejectionRatePct:       parseFloat((rejectionRate * 100).toFixed(1)),
    ccRejectionRatePct:     parseFloat((ccRejectionRate * 100).toFixed(1)),
  };
}

const FAILURE_LABELS = {
  vumpa_errors:           'VUMPA Errors',
  pcsopep_gaps:           'PCSOPEP Gaps',
  customs_mismatches:     'Customs Mismatches',
  schedule_slip_cascades: 'Schedule Slip Cascades',
};

// ── Email builder ─────────────────────────────────────────────────────────────

function buildPdfReportEmail({ email, fleet_size, monthly_transits, cargo_type,
  primary_waterway, filing_method, calc }) {

  const fmt = n => {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1000) + 'K';
    return '$' + n.toLocaleString();
  };

  const methodLabels = {
    manual: 'Manual Filing',
    in_house: 'In-House Team',
    third_party: 'Third-Party Agent',
    automated: 'Automated System',
  };

  const cargoLabels = {
    containers: 'Containers', bulk: 'Bulk Cargo', tanker: 'Tanker',
    lng: 'LNG', vehicle_carrier: 'Vehicle Carrier', other: 'Other',
  };

  const waterwayLabels = {
    panama: 'Panama Canal', suez: 'Suez Canal',
    kiel: 'Kiel Canal', singapore: 'Singapore Strait', cape: 'Cape of Good Hope',
  };

  const breakdownRows = calc.breakdown.map(b => `
    <tr>
      <td style="padding:8px 12px;color:#94a3b8;font-size:13px;border-bottom:1px solid #1e3352;">${b.label}</td>
      <td style="padding:8px 12px;text-align:right;color:#ef4444;font-weight:700;font-size:13px;border-bottom:1px solid #1e3352;">${fmt(b.exposure)}</td>
      <td style="padding:8px 12px;text-align:right;color:#22c55e;font-weight:700;font-size:13px;border-bottom:1px solid #1e3352;">${fmt(b.withCanalClear)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a1628;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;padding:32px 16px;">
<tr><td>
<table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#0f1f38;border-radius:12px;overflow:hidden;border:1px solid #1e3352;">

  <!-- Header -->
  <tr>
    <td style="background:#0d1b30;padding:28px 36px;border-bottom:3px solid #E85A00;">
      <div style="font-size:20px;font-weight:800;color:#E85A00;letter-spacing:-0.5px;">⚓ CanalClear</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;">Maritime Compliance Intelligence</div>
    </td>
  </tr>

  <!-- Body -->
  <tr><td style="padding:36px;">

    <h2 style="color:#f1f5f9;font-size:20px;margin:0 0 8px;line-height:1.3;">Your Fleet's Annual Rejection Exposure</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 28px;">
      ${fleet_size} vessel${fleet_size > 1 ? 's' : ''} ·
      ${monthly_transits} transit${monthly_transits > 1 ? 's' : ''}/vessel/month ·
      ${cargoLabels[cargo_type] || cargo_type} ·
      ${waterwayLabels[primary_waterway] || primary_waterway} ·
      ${methodLabels[filing_method] || filing_method}
    </p>

    <!-- Big number -->
    <div style="background:#1a2e48;border:1px solid #1e3352;border-radius:10px;padding:28px;text-align:center;margin:0 0 24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Estimated Annual Exposure</div>
      <div style="font-size:48px;font-weight:800;color:#ef4444;letter-spacing:-2px;line-height:1;">${fmt(calc.annualExposure)}</div>
      <div style="color:#94a3b8;font-size:13px;margin-top:10px;">${calc.rejectionRatePct}% rejection rate · ${calc.annualRejections} rejection events/year</div>
      <div style="color:#64748b;font-size:11px;margin-top:6px;">Confidence range: ${fmt(calc.low)} – ${fmt(calc.high)}</div>
    </div>

    <!-- Comparison row -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td width="48%" style="background:#1a0f0f;border:1px solid #3f1212;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;margin-bottom:8px;">Current Method</div>
          <div style="font-size:26px;font-weight:800;color:#ef4444;">${fmt(calc.annualExposure)}</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">${calc.rejectionRatePct}% rejection rate</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:#0f1f0f;border:1px solid #12310f;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;margin-bottom:8px;">With CanalClear</div>
          <div style="font-size:26px;font-weight:800;color:#22c55e;">${fmt(calc.withCanalClear)}</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">${calc.ccRejectionRatePct}% rejection rate</div>
        </td>
      </tr>
    </table>

    <!-- Savings callout -->
    <div style="background:#0f2a0f;border:1px solid #166534;border-radius:10px;padding:18px 24px;margin:0 0 28px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#86efac;margin-bottom:6px;">Estimated Annual Savings</div>
      <div style="font-size:36px;font-weight:800;color:#22c55e;letter-spacing:-1px;">${fmt(calc.savings)}</div>
      <div style="font-size:12px;color:#86efac;margin-top:4px;">${calc.savingsPct}% reduction in exposure</div>
    </div>

    <!-- Breakdown table -->
    <h3 style="color:#94a3b8;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px;">BREAKDOWN BY FAILURE CATEGORY</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1b30;border-radius:8px;overflow:hidden;margin:0 0 32px;">
      <tr style="background:#1e3352;">
        <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Category</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Current</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">With CanalClear</th>
      </tr>
      ${breakdownRows}
    </table>

    <!-- CTA -->
    <div style="text-align:center;margin:32px 0 0;">
      <a href="https://canalclear.org/pricing" style="display:inline-block;background:#E85A00;color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
        Eliminate Your Exposure →
      </a>
      <p style="font-size:12px;color:#475569;margin:16px 0 0;">Full platform demo — no commitment required</p>
    </div>

  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0a1120;border-top:1px solid #1e3352;padding:20px 36px;text-align:center;">
      <p style="font-size:11px;color:#334155;margin:0;">
        CanalClear · Automated maritime compliance filings<br>
        Panama · Suez · Bosporus · Malacca · Cape of Good Hope
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return {
    subject: `Your fleet's ${fmt(calc.annualExposure)}/year rejection exposure — full breakdown`,
    html,
    body: `Your CanalClear Rejection Exposure Report

Fleet: ${fleet_size} vessel(s), ${monthly_transits} transit(s)/month per vessel
Cargo: ${cargoLabels[cargo_type] || cargo_type}  |  Waterway: ${waterwayLabels[primary_waterway] || primary_waterway}
Filing method: ${methodLabels[filing_method] || filing_method}

Estimated annual rejection exposure: ${fmt(calc.annualExposure)}
With CanalClear: ${fmt(calc.withCanalClear)}
Estimated savings: ${fmt(calc.savings)} (${calc.savingsPct}% reduction)

Visit https://canalclear.org/pricing to eliminate your exposure.`,
  };
}

// ── POST /api/calculator/capture ──────────────────────────────────────────────
// Accepts the form inputs + calculation result, captures lead, sends report email.

router.post('/capture', async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    email, company,
    fleet_size, monthly_transits, cargo_type, primary_waterway, filing_method,
    // Optional: pre-computed values from client (we recompute anyway for integrity)
  } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Valid work email required.' });
  }
  if (!fleet_size || fleet_size < 1) {
    return res.status(400).json({ success: false, message: 'Fleet size must be at least 1.' });
  }
  if (!monthly_transits || monthly_transits < 1) {
    return res.status(400).json({ success: false, message: 'Monthly transits must be at least 1.' });
  }
  if (!cargo_type || !filing_method || !primary_waterway) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const emailLower = email.toLowerCase().trim();
  const ipAddress  = req.ip || req.connection?.remoteAddress || null;

  // Recompute calculation server-side — don't trust client values for storage
  const calc = calculate({
    fleet_size:      parseInt(fleet_size, 10),
    monthly_transits: parseInt(monthly_transits, 10),
    cargo_type,
    primary_waterway,
    filing_method,
  });

  try {
    const lead = await insertCalculatorLead(pool, {
      email:           emailLower,
      company:         company ? String(company).trim().slice(0, 200) : null,
      fleet_size:      parseInt(fleet_size, 10),
      monthly_transits: parseInt(monthly_transits, 10),
      cargo_type,
      primary_waterway,
      filing_method,
      annual_exposure: calc.annualExposure,
      with_canalclear: calc.withCanalClear,
      savings:         calc.savings,
      ip_address:      ipAddress,
    });

    // Register contact (fire-and-forget)
    fetch('https://polsia.com/api/proxy/email/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
      },
      body: JSON.stringify({
        email: emailLower,
        name:  company ? company.trim() : undefined,
        source: 'contact_form',
      }),
    }).catch(() => {});

    // Build and send the report email
    const { subject, html, body } = buildPdfReportEmail({
      email: emailLower, company, fleet_size: parseInt(fleet_size, 10),
      monthly_transits: parseInt(monthly_transits, 10), cargo_type,
      primary_waterway, filing_method, calc,
    });

    fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
      },
      body: JSON.stringify({ to: emailLower, subject, html, body }),
    }).then(async r => {
      if (r.ok) {
        await markPdfSent(pool, lead.id);
      } else {
        const t = await r.text();
        console.error('[calculator] email send failed:', r.status, t.slice(0, 200));
      }
    }).catch(err => console.error('[calculator] email exception:', err.message));

    return res.json({
      success: true,
      lead_id: lead.id,
      calc,
      message: 'Your detailed report is on its way — check your inbox.',
    });
  } catch (err) {
    console.error('[calculator] capture error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── GET /api/calculator/leads — Admin listing ─────────────────────────────────

router.get('/leads', requireAuth, requireAdmin, async (req, res) => {
  const pool   = req.app.locals.pool;
  const limit  = Math.min(parseInt(req.query.limit)  || 100, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const [leads, total] = await Promise.all([
      listCalculatorLeads(pool, { limit, offset }),
      countCalculatorLeads(pool),
    ]);
    return res.json({ success: true, leads, total });
  } catch (err) {
    console.error('[calculator] admin list error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
