/**
 * routes/demo-request.js — Self-serve demo request flow.
 *
 * Owns: public demo request form submission, rate limiting, code generation,
 *       email delivery, resend endpoint, and admin list view of demo requests.
 * Does NOT own: demo code CRUD admin UI (routes/demo.js), auth sessions (routes/api.js).
 *
 * Public routes:
 *   POST /api/demo-request/submit    — submit demo request form, generate code, send email
 *   POST /api/demo-request/resend    — resend demo code email by request ID + email
 *
 * Admin routes:
 *   GET  /api/demo-request/admin/list — list all demo requests with redemption status
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  createDemoRequest,
  markEmailSent,
  recordResend,
  getLatestRequestByEmail,
  countRecentByIp,
  countRecentByDomain,
  listDemoRequests,
  countDemoRequests,
} = require('../db/demo-requests');
const { createDemoCode } = require('../db/demo-codes');

// Free email domains blocked for B2B intent filtering
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'protonmail.com', 'mail.com', 'zoho.com', 'yandex.com',
  'live.com', 'msn.com', 'me.com', 'googlemail.com', 'inbox.com',
  'fastmail.com', 'tutanota.com', 'guerrillamail.com', 'mailinator.com',
  'tempmail.com', 'throwaway.email', 'sharklasers.com', 'trashmail.com',
]);

const MAX_REQUESTS_PER_DOMAIN_PER_DAY = 3;
const MAX_REQUESTS_PER_IP_PER_DAY = 5;

/**
 * Generate a random demo code with format DEMO-XXXXXX
 */
function generateDemoCodeString() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `DEMO-${suffix}`;
}

/**
 * Send demo code email via Polsia email proxy.
 */
async function sendDemoEmail({ name, email, demoCode, waterway }) {
  const loginUrl = `https://canalclear.org/login`;

  const waterwayNames = {
    panama: 'Panama Canal (VUMPA/PCSOPEP)',
    suez: 'Suez Canal (SCA/SCNT/ISPS)',
    bosporus: 'Bosporus / Turkish Straits (SP-1)',
    malacca: 'Strait of Malacca (STRAITREP)',
    cape: 'Cape of Good Hope (ISPS Pre-Arrival)',
  };
  const primaryWaterway = waterwayNames[waterway] || waterway;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f6f9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px;">
    <tr>
      <td>
        <table width="600" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;margin:0 auto;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a2d4a 0%,#243350 100%);padding:32px 40px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">⚓ CanalClear</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:6px;">Maritime Compliance Intelligence</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="font-size:16px;color:#1a2d4a;margin:0 0 16px;font-weight:600;">Hello ${name},</p>
              <p style="font-size:15px;color:#4a5568;margin:0 0 24px;line-height:1.6;">
                Your CanalClear demo access is ready. Use the code below to unlock full platform access for 14 days — all five waterways included.
              </p>

              <!-- Code box -->
              <div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:12px;padding:24px;text-align:center;margin:0 0 32px;">
                <div style="font-size:13px;color:#6b7c93;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;font-weight:600;">Your Demo Access Code</div>
                <div style="font-family:'Courier New',monospace;font-size:30px;font-weight:700;color:#E85A00;letter-spacing:4px;">${demoCode}</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:8px;">Valid for 14 days · All 5 waterways</div>
              </div>

              <!-- CTA button -->
              <div style="text-align:center;margin:0 0 32px;">
                <a href="${loginUrl}" style="display:inline-block;background:#E85A00;color:#ffffff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
                  Access CanalClear →
                </a>
                <p style="font-size:12px;color:#94a3b8;margin:12px 0 0;">Click the button, then enter your demo code on the login page</p>
              </div>

              <!-- What to try first -->
              <div style="background:#f0f9ff;border-left:4px solid #E85A00;border-radius:0 8px 8px 0;padding:20px 24px;margin:0 0 32px;">
                <div style="font-size:14px;font-weight:700;color:#1a2d4a;margin-bottom:12px;">✓ What to try first — based on your interest in ${primaryWaterway}</div>
                <ul style="margin:0;padding:0 0 0 20px;color:#4a5568;font-size:14px;line-height:2;">
                  <li>Run a sample <strong>VUMPA filing</strong> for the Panama Canal</li>
                  <li>Test the <strong>PCSOPEP validator</strong> with a real vessel IMO</li>
                  <li>Generate a <strong>Suez ISPS pre-arrival notification</strong></li>
                  <li>Check compliance scoring on the <strong>Bosporus SP-1 form</strong></li>
                  <li>Run the <strong>Voyage Planner</strong> — enter any route crossing a strait</li>
                </ul>
              </div>

              <p style="font-size:14px;color:#4a5568;margin:0;line-height:1.6;">
                Questions? Reply to this email — we read every one.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
              <p style="font-size:12px;color:#94a3b8;margin:0;">
                CanalClear · Automated maritime compliance filings<br>
                Panama · Suez · Bosporus · Malacca · Cape of Good Hope
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const plainText = `Hello ${name},

Your CanalClear demo access code is: ${demoCode}

This code unlocks full platform access for 14 days across all 5 waterways.

To get started:
1. Go to https://canalclear.org/login
2. Enter your demo code: ${demoCode}

What to try first:
- Run a sample VUMPA filing for the Panama Canal
- Test the PCSOPEP validator with a real vessel IMO
- Generate a Suez ISPS pre-arrival notification
- Check compliance scoring on the Bosporus SP-1 form
- Run the Voyage Planner with any route crossing a strait

Questions? Reply to this email.

— CanalClear`;

  const resp = await fetch('https://polsia.com/api/proxy/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
    },
    body: JSON.stringify({
      to: email,
      subject: `Your CanalClear demo code: ${demoCode}`,
      body: plainText,
      html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Email send failed: ${resp.status} ${body}`);
  }

  return true;
}

// ── POST /api/demo-request/submit ─────────────────────────────────────────────

router.post('/submit', async (req, res) => {
  const pool = req.app.locals.pool;
  const { name, email, company, role, fleet_size, waterway } = req.body || {};

  // Basic validation
  if (!name || !email || !company || !role || !fleet_size || !waterway) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const emailLower = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return res.status(400).json({ success: false, message: 'Invalid email address.' });
  }

  const domain = emailLower.split('@')[1];

  // Block free email providers
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return res.status(400).json({
      success: false,
      message: 'Please use your work email address. Free email providers (Gmail, Yahoo, etc.) are not accepted.',
    });
  }

  const ipAddress = req.ip || req.connection?.remoteAddress || null;

  try {
    // Rate limit by IP
    if (ipAddress) {
      const ipCount = await countRecentByIp(pool, ipAddress);
      if (ipCount >= MAX_REQUESTS_PER_IP_PER_DAY) {
        return res.status(429).json({
          success: false,
          message: 'Too many demo requests from your network. Please try again tomorrow or contact us directly.',
        });
      }
    }

    // Rate limit by domain
    const domainCount = await countRecentByDomain(pool, domain);
    if (domainCount >= MAX_REQUESTS_PER_DOMAIN_PER_DAY) {
      return res.status(429).json({
        success: false,
        message: 'Your organization has reached the maximum demo requests for today. Contact us directly for enterprise access.',
      });
    }

    // Generate a unique demo code (retry up to 5 times on collision)
    let demoCodeRecord;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateDemoCodeString();
      try {
        // 14-day expiry, max 1 use (personal code per request)
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        demoCodeRecord = await createDemoCode(pool, {
          code,
          expiresAt,
          maxUses: 3, // allow up to 3 redemptions per code (different devices)
          createdBy: emailLower,
          notes: `Self-serve request: ${company} / ${role}`,
        });
        break;
      } catch (err) {
        if (err.code === '23505') continue; // unique collision, retry
        throw err;
      }
    }

    if (!demoCodeRecord) {
      return res.status(500).json({ success: false, message: 'Failed to generate demo code. Please try again.' });
    }

    // Save the request record
    const requestRecord = await createDemoRequest(pool, {
      name: name.trim(),
      email: emailLower,
      company: company.trim(),
      role: role.trim(),
      fleetSize: fleet_size,
      waterway,
      demoCode: demoCodeRecord.code,
      ipAddress,
      domain,
    });

    // Register contact with email proxy so subsequent emails aren't rate-limited
    fetch('https://polsia.com/api/proxy/email/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
      },
      body: JSON.stringify({ email: emailLower, name: name.trim(), source: 'contact_form' }),
    }).catch(() => {}); // fire-and-forget

    // Send the demo code email
    await sendDemoEmail({
      name: name.trim(),
      email: emailLower,
      demoCode: demoCodeRecord.code,
      waterway,
    });

    await markEmailSent(pool, requestRecord.id);

    return res.json({
      success: true,
      request_id: requestRecord.id,
      email: emailLower,
      message: 'Demo code sent! Check your inbox.',
    });
  } catch (err) {
    console.error('[demo-request] submit error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── POST /api/demo-request/resend ─────────────────────────────────────────────

router.post('/resend', async (req, res) => {
  const pool = req.app.locals.pool;
  const { request_id, email } = req.body || {};

  if (!request_id || !email) {
    return res.status(400).json({ success: false, message: 'request_id and email are required.' });
  }

  const emailLower = email.toLowerCase().trim();

  try {
    // Find the latest request by email as a security check
    const record = await getLatestRequestByEmail(pool, emailLower);

    if (!record || record.id !== parseInt(request_id)) {
      return res.status(404).json({ success: false, message: 'Demo request not found.' });
    }

    // Limit resends to 3
    if (record.resend_count >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Maximum resends reached. Check your spam folder or contact support.',
      });
    }

    // Rate-limit resends: only allow once every 60 seconds
    if (record.last_resend_at || record.email_sent_at) {
      const lastSent = new Date(record.last_resend_at || record.email_sent_at).getTime();
      if (Date.now() - lastSent < 60 * 1000) {
        return res.status(429).json({
          success: false,
          message: 'Please wait at least 60 seconds before resending.',
        });
      }
    }

    await sendDemoEmail({
      name: record.name,
      email: emailLower,
      demoCode: record.demo_code,
      waterway: record.waterway,
    });

    await recordResend(pool, record.id);

    return res.json({ success: true, message: 'Email resent!' });
  } catch (err) {
    console.error('[demo-request] resend error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── Admin: list all demo requests ─────────────────────────────────────────────

router.get('/admin/list', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const [requests, total] = await Promise.all([
      listDemoRequests(pool, { limit, offset }),
      countDemoRequests(pool),
    ]);
    return res.json({ success: true, requests, total });
  } catch (err) {
    console.error('[demo-request] admin list error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
