'use strict';

const {
  insertDripEmail,
  unsubscribePendingEmails,
  getDueDripEmails,
  markDripEmailSent,
  markDripEmailFailed,
  markDripEmailNotImplemented,
} = require('../db/drip-emails');

/**
 * CanalClear Drip Email Service
 *
 * Handles:
 *   1. Scheduling drip emails when a new lead is created
 *   2. Sending due drip emails on the hourly tick
 *   3. Unsubscribe support (marks all pending emails as unsubscribed)
 *
 * Sequence:
 *   Email 2 — Day 2:  "Your Panama Canal Compliance Checklist"
 *   Email 3 — Day 4:  "How CanalClear Saves 40+ Hours Per Transit"
 *   Email 4 — Day 7:  (stub — implement in follow-up task)
 *   Email 5 — Day 14: (stub — implement in follow-up task)
 *
 * Email proxy: https://polsia.com/api/proxy/email/send
 * Auth: POLSIA_API_KEY env var
 */

const APP_URL = 'https://canalclear.org';

// Days after lead creation each email fires (email 1 = welcome, handled separately)
const DRIP_SCHEDULE = {
  2: 2,   // Day 2
  3: 4,   // Day 4
  4: 7,   // Day 7
  5: 14,  // Day 14
};

// ─── Email header + footer HTML helpers ──────────────────────────────────────

function emailHeader() {
  return `
<div style="background:#0A1628;padding:28px 40px;border-radius:12px 12px 0 0;text-align:center;">
  <h1 style="color:#00D4AA;font-size:1.4rem;margin:0;letter-spacing:-0.5px;">CanalClear</h1>
  <p style="color:#8899AA;font-size:0.8rem;margin:4px 0 0;">Panama Canal Compliance Automation</p>
</div>`;
}

function emailFooter(unsubscribeUrl) {
  return `
<div style="background:#07111F;padding:20px 40px;border-radius:0 0 12px 12px;border-top:1px solid rgba(255,255,255,0.06);">
  <p style="color:#556677;font-size:0.75rem;margin:0 0 6px;">
    You're receiving this because you requested a free compliance assessment from CanalClear.
  </p>
  <p style="color:#556677;font-size:0.75rem;margin:0;">
    Reply <strong>STOP</strong> to unsubscribe, or <a href="${unsubscribeUrl}" style="color:#00D4AA;">click here to unsubscribe</a>.
  </p>
</div>`;
}

function emailWrapper(content, unsubscribeUrl) {
  return `
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#C4D0DC;background:#0F1D32;border-radius:12px;overflow:hidden;">
  ${emailHeader()}
  <div style="padding:40px 40px 32px;">
    ${content}
  </div>
  ${emailFooter(unsubscribeUrl)}
</div>`;
}

// ─── Email templates ──────────────────────────────────────────────────────────

/**
 * Email 2 (Day 2): Panama Canal Compliance Checklist
 * Top 5 compliance requirements + CTA to compliance-score tool
 */
function buildEmail2(lead) {
  const firstName = lead.company_name ? lead.company_name.split(' ')[0] : 'there';
  const unsubUrl = `${APP_URL}/api/leads/unsubscribe?email=${encodeURIComponent(lead.email)}`;

  const content = `
<h2 style="color:#F0F4F8;font-size:1.25rem;margin:0 0 8px;line-height:1.3;">
  Your Panama Canal Compliance Checklist
</h2>
<p style="color:#8899AA;font-size:0.85rem;margin:0 0 24px;">5 Requirements Every Vessel Must Meet Before Transit</p>

<p style="color:#C4D0DC;line-height:1.7;margin:0 0 24px;">Hi ${firstName},</p>
<p style="color:#C4D0DC;line-height:1.7;margin:0 0 28px;">
  Panama Canal transit compliance isn't just paperwork — a single missing document can delay your vessel by 24–72 hours
  and cost <strong style="color:#F0F4F8;">$20,000–$50,000 per day</strong> in demurrage. Here are the five requirements
  that catch operators off-guard most often:
</p>

<div style="background:#1A2B45;border-radius:10px;padding:24px;margin:0 0 28px;">
  <p style="color:#00D4AA;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 16px;">
    Top 5 ACP Compliance Requirements
  </p>

  <div style="display:flex;align-items:flex-start;margin:0 0 14px;">
    <span style="background:#00D4AA;color:#0A1628;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;margin-right:12px;margin-top:2px;">1</span>
    <div>
      <strong style="color:#F0F4F8;">VUMPA (Vessel Underwater Marine Pollution Assessment)</strong>
      <p style="color:#8899AA;font-size:0.85rem;margin:3px 0 0;line-height:1.5;">Required for all vessels transiting the Canal. Must be submitted 96+ hours before arrival. Incomplete fields = automatic rejection.</p>
    </div>
  </div>

  <div style="display:flex;align-items:flex-start;margin:0 0 14px;">
    <span style="background:#00D4AA;color:#0A1628;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;margin-right:12px;margin-top:2px;">2</span>
    <div>
      <strong style="color:#F0F4F8;">PCSOPEP (Panama Canal Spill Contingency Plan)</strong>
      <p style="color:#8899AA;font-size:0.85rem;margin:3px 0 0;line-height:1.5;">Must be ACP-approved and current. Expired plans are one of the top reasons for last-minute transit denials.</p>
    </div>
  </div>

  <div style="display:flex;align-items:flex-start;margin:0 0 14px;">
    <span style="background:#00D4AA;color:#0A1628;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;margin-right:12px;margin-top:2px;">3</span>
    <div>
      <strong style="color:#F0F4F8;">Crew Manifest &amp; Certifications</strong>
      <p style="color:#8899AA;font-size:0.85rem;margin:3px 0 0;line-height:1.5;">All crew certifications must be valid and listed accurately. A single mismatch triggers a manual ACP review — adding 12–24 hours to clearance.</p>
    </div>
  </div>

  <div style="display:flex;align-items:flex-start;margin:0 0 14px;">
    <span style="background:#00D4AA;color:#0A1628;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;margin-right:12px;margin-top:2px;">4</span>
    <div>
      <strong style="color:#F0F4F8;">Cargo Declaration &amp; Hazmat Documentation</strong>
      <p style="color:#8899AA;font-size:0.85rem;margin:3px 0 0;line-height:1.5;">Hazardous materials require ACP-specific declarations. Omissions discovered at inspection result in delayed boarding and possible fines.</p>
    </div>
  </div>

  <div style="display:flex;align-items:flex-start;">
    <span style="background:#00D4AA;color:#0A1628;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;margin-right:12px;margin-top:2px;">5</span>
    <div>
      <strong style="color:#F0F4F8;">Certificate of Registry + Class Certificate</strong>
      <p style="color:#8899AA;font-size:0.85rem;margin:3px 0 0;line-height:1.5;">Both must be valid and match the information on file with ACP. Discrepancies in vessel name, IMO number, or flag state cause immediate holds.</p>
    </div>
  </div>
</div>

<p style="color:#C4D0DC;line-height:1.7;margin:0 0 24px;">
  Not sure where your vessel stands? CanalClear's compliance score tool checks all five areas
  in under 2 minutes — free, no account required.
</p>

<a href="${APP_URL}/compliance-score"
   style="display:inline-block;background:#00D4AA;color:#0A1628;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;">
  Check Your Vessel's Score →
</a>`;

  return {
    subject: 'Your Panama Canal Compliance Checklist (5 Requirements Every Vessel Needs)',
    html: emailWrapper(content, unsubUrl),
  };
}

/**
 * Email 3 (Day 4): How CanalClear Saves 40+ Hours Per Transit
 * ROI breakdown: manual vs automated compliance. CTA to /pricing.
 */
function buildEmail3(lead) {
  const firstName = lead.company_name ? lead.company_name.split(' ')[0] : 'there';
  const unsubUrl = `${APP_URL}/api/leads/unsubscribe?email=${encodeURIComponent(lead.email)}`;

  const content = `
<h2 style="color:#F0F4F8;font-size:1.25rem;margin:0 0 8px;line-height:1.3;">
  How CanalClear Saves 40+ Hours Per Transit
</h2>
<p style="color:#8899AA;font-size:0.85rem;margin:0 0 24px;">The real cost of manual compliance — and what automation changes</p>

<p style="color:#C4D0DC;line-height:1.7;margin:0 0 24px;">Hi ${firstName},</p>
<p style="color:#C4D0DC;line-height:1.7;margin:0 0 28px;">
  Most operators don't realize how much time their team actually spends on Panama Canal compliance
  until they add it up. Here's what the numbers look like:
</p>

<!-- Comparison Table -->
<div style="background:#1A2B45;border-radius:10px;padding:24px;margin:0 0 28px;overflow:hidden;">
  <p style="color:#00D4AA;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 16px;">
    Manual vs. Automated Compliance
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px 10px;color:#8899AA;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.08);">Task</th>
        <th style="text-align:center;padding:8px 10px;color:#FF6B6B;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.08);">Manual</th>
        <th style="text-align:center;padding:8px 10px;color:#00D4AA;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.08);">CanalClear</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:9px 10px;color:#C4D0DC;border-bottom:1px solid rgba(255,255,255,0.04);">Compile VUMPA form data</td>
        <td style="text-align:center;padding:9px 10px;color:#FF9999;border-bottom:1px solid rgba(255,255,255,0.04);">6–10 hrs</td>
        <td style="text-align:center;padding:9px 10px;color:#00D4AA;border-bottom:1px solid rgba(255,255,255,0.04);">~15 min</td>
      </tr>
      <tr>
        <td style="padding:9px 10px;color:#C4D0DC;border-bottom:1px solid rgba(255,255,255,0.04);">Validate crew certifications</td>
        <td style="text-align:center;padding:9px 10px;color:#FF9999;border-bottom:1px solid rgba(255,255,255,0.04);">4–8 hrs</td>
        <td style="text-align:center;padding:9px 10px;color:#00D4AA;border-bottom:1px solid rgba(255,255,255,0.04);">Automated</td>
      </tr>
      <tr>
        <td style="padding:9px 10px;color:#C4D0DC;border-bottom:1px solid rgba(255,255,255,0.04);">Cross-check PCSOPEP status</td>
        <td style="text-align:center;padding:9px 10px;color:#FF9999;border-bottom:1px solid rgba(255,255,255,0.04);">2–4 hrs</td>
        <td style="text-align:center;padding:9px 10px;color:#00D4AA;border-bottom:1px solid rgba(255,255,255,0.04);">Automated</td>
      </tr>
      <tr>
        <td style="padding:9px 10px;color:#C4D0DC;border-bottom:1px solid rgba(255,255,255,0.04);">Review hazmat declarations</td>
        <td style="text-align:center;padding:9px 10px;color:#FF9999;border-bottom:1px solid rgba(255,255,255,0.04);">3–6 hrs</td>
        <td style="text-align:center;padding:9px 10px;color:#00D4AA;border-bottom:1px solid rgba(255,255,255,0.04);">~10 min</td>
      </tr>
      <tr>
        <td style="padding:9px 10px;color:#C4D0DC;border-bottom:1px solid rgba(255,255,255,0.04);">Fix errors &amp; resubmit</td>
        <td style="text-align:center;padding:9px 10px;color:#FF9999;border-bottom:1px solid rgba(255,255,255,0.04);">8–20 hrs</td>
        <td style="text-align:center;padding:9px 10px;color:#00D4AA;border-bottom:1px solid rgba(255,255,255,0.04);">Near zero</td>
      </tr>
      <tr style="background:rgba(0,212,170,0.05);">
        <td style="padding:10px 10px;color:#F0F4F8;font-weight:700;">Total per transit</td>
        <td style="text-align:center;padding:10px 10px;color:#FF6B6B;font-weight:700;">40–60 hrs</td>
        <td style="text-align:center;padding:10px 10px;color:#00D4AA;font-weight:700;">&lt; 2 hrs</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- Cost impact callout -->
<div style="background:rgba(0,212,170,0.08);border:1px solid rgba(0,212,170,0.2);border-radius:10px;padding:20px 24px;margin:0 0 28px;">
  <p style="color:#00D4AA;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px;">What delay actually costs</p>
  <p style="color:#C4D0DC;line-height:1.7;margin:0;">
    A single ACP rejection that delays transit by 24 hours costs <strong style="color:#F0F4F8;">$20,000–$50,000</strong>
    in vessel demurrage alone — not counting cargo penalties and contract breaches.
    CanalClear's validation engine catches errors <em>before submission</em>, eliminating
    the most expensive rework loop in transit operations.
  </p>
</div>

<p style="color:#C4D0DC;line-height:1.7;margin:0 0 24px;">
  Plans start at $299/month per vessel — less than 2 hours of an agent's time,
  and a fraction of what a single rejected filing costs.
</p>

<a href="${APP_URL}/pricing"
   style="display:inline-block;background:#00D4AA;color:#0A1628;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;">
  See Pricing →
</a>`;

  return {
    subject: 'How CanalClear Saves 40+ Hours Per Panama Canal Transit',
    html: emailWrapper(content, unsubUrl),
  };
}

/**
 * Email 4 (Day 7): stub — to be built in follow-up task
 */
function buildEmail4(lead) {
  return null; // not yet implemented
}

/**
 * Email 5 (Day 14): stub — to be built in follow-up task
 */
function buildEmail5(lead) {
  return null; // not yet implemented
}

const EMAIL_BUILDERS = { 2: buildEmail2, 3: buildEmail3, 4: buildEmail4, 5: buildEmail5 };

// ─── Email proxy sender ───────────────────────────────────────────────────────

async function sendViaProxy({ to, subject, html }) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.log('[Drip] POLSIA_API_KEY not set — skipping email to', to);
    return false;
  }

  const response = await fetch('https://polsia.com/api/proxy/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      to,
      subject,
      body: subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Email proxy ${response.status}: ${text.slice(0, 200)}`);
  }

  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedule drip emails 2–5 for a newly-created lead.
 * Called fire-and-forget from the lead capture endpoint.
 *
 * @param {Pool}   pool
 * @param {number} leadId
 * @param {Date}   leadCreatedAt
 * @param {string} email
 */
async function scheduleDripEmails(pool, leadId, leadCreatedAt, email) {
  const base = new Date(leadCreatedAt);

  const rows = Object.entries(DRIP_SCHEDULE).map(([emailNumber, days]) => ({
    emailNumber: parseInt(emailNumber),
    scheduledFor: new Date(base.getTime() + days * 24 * 60 * 60 * 1000),
  }));

  for (const { emailNumber, scheduledFor } of rows) {
    await insertDripEmail(pool, {
      lead_id: leadId,
      email_number: emailNumber,
      email,
      scheduled_for: scheduledFor,
    });
  }

  console.log(`[Drip] Scheduled ${rows.length} emails for lead #${leadId} (${email})`);
}

/**
 * Mark all pending drip emails for a given email address as unsubscribed.
 * Returns the number of rows updated.
 *
 * @param {Pool}   pool
 * @param {string} email
 */
async function unsubscribeLead(pool, email) {
  const result = await unsubscribePendingEmails(pool, email);
  console.log(`[Drip] Unsubscribed ${result.rowCount} pending emails for ${email}`);
  return result.rowCount;
}

/**
 * Hourly scheduler tick.
 * Finds all drip emails where scheduled_for <= NOW() and status = 'pending',
 * builds + sends each one, then marks it sent or failed.
 *
 * @param {Pool} pool
 */
async function processDripEmails(pool) {
  // Fetch due emails with their lead data (name, company) for personalisation
  const rows = await getDueDripEmails(pool, { limit: 50 });

  if (rows.length === 0) {
    return; // nothing to do
  }

  console.log(`[Drip] Processing ${rows.length} due email(s)`);

  for (const row of rows) {
    const builder = EMAIL_BUILDERS[row.email_number];

    // Stub emails (4 & 5) — skip gracefully until content is built
    if (!builder) {
      await markDripEmailFailed(pool, row.id, `No builder for email #${row.email_number}`);
      continue;
    }

    const emailContent = builder(row);

    if (!emailContent) {
      // Builder returned null (stub not yet implemented)
      await markDripEmailNotImplemented(pool, row.id);
      console.log(`[Drip] Skipped email #${row.email_number} for lead #${row.lead_id} — content not yet implemented`);
      continue;
    }

    try {
      await sendViaProxy({ to: row.email, ...emailContent });

      await markDripEmailSent(pool, row.id);

      console.log(`[Drip] ✓ Sent email #${row.email_number} to ${row.email} (lead #${row.lead_id})`);
    } catch (err) {
      await markDripEmailFailed(pool, row.id, err.message.slice(0, 500));
      console.error(`[Drip] ✗ Failed email #${row.email_number} for lead #${row.lead_id}:`, err.message);
    }
  }
}

module.exports = { scheduleDripEmails, unsubscribeLead, processDripEmails };
