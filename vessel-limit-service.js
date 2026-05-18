/**
 * services/vessel-limit-service.js — Business logic for agency vessel tier enforcement.
 *
 * Owns: tier limit lookup, grace period calculation, over-limit state management,
 *       email notification scheduling (day 1/5/7).
 * Does NOT own: SQL queries (db/vessel-limits.js), route handling, Stripe integration.
 *
 * Soft cap model:
 *   - At limit: warning banner, allow filing
 *   - Over limit: allow but start 7-day grace countdown + send emails
 *   - After grace expires: block new filings for vessels beyond tier limit
 *   - Upgrade clears block immediately
 */

const {
  countAgencyVessels,
  getUserLimitState,
  markVesselLimitExceeded,
  clearVesselLimitExceeded,
  setNotifiedDay,
  getOverLimitAgencies,
} = require('../db/vessel-limits');

const GRACE_PERIOD_DAYS = 7;

/** Plan keys that are agency tiers with vessel caps */
const AGENCY_TIER_LIMITS = {
  agency_starter:          50,
  agency_pro:              200,
  agency_enterprise:       Infinity,
  // Per-waterway variants share same caps
  agency_starter_panama:   50,  agency_pro_panama:   200, agency_enterprise_panama:   Infinity,
  agency_starter_suez:     50,  agency_pro_suez:     200, agency_enterprise_suez:     Infinity,
  agency_starter_bosporus: 50,  agency_pro_bosporus: 200, agency_enterprise_bosporus: Infinity,
  agency_starter_malacca:  50,  agency_pro_malacca:  200, agency_enterprise_malacca:  Infinity,
  agency_starter_cape:     50,  agency_pro_cape:     200, agency_enterprise_cape:     Infinity,
};

/**
 * Get the vessel cap for an agency plan key.
 * Returns Infinity for enterprise / non-agency plans.
 */
function getAgencyVesselLimit(planKey) {
  if (!planKey) return Infinity;
  return AGENCY_TIER_LIMITS[planKey] ?? Infinity;
}

/**
 * Friendly tier names for UI / email copy.
 */
function getTierDisplayName(planKey) {
  if (!planKey) return 'your plan';
  if (planKey.startsWith('agency_enterprise')) return 'Enterprise';
  if (planKey.startsWith('agency_pro'))        return 'Professional';
  if (planKey.startsWith('agency_starter'))    return 'Starter';
  return 'your plan';
}

function getUpgradeTierName(planKey) {
  if (planKey && planKey.startsWith('agency_starter')) return 'Professional ($1,999/mo)';
  if (planKey && planKey.startsWith('agency_pro'))     return 'Enterprise ($2,999/mo)';
  return 'a higher tier';
}

/**
 * Calculate grace period status given when a user first exceeded the limit.
 * Returns { inGrace, daysRemaining, graceExpired }.
 */
function calcGraceStatus(exceededAt) {
  if (!exceededAt) return { inGrace: false, daysRemaining: 0, graceExpired: false };
  const graceEnd = new Date(new Date(exceededAt).getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  if (now < graceEnd) {
    const daysRemaining = Math.ceil((graceEnd - now) / (24 * 60 * 60 * 1000));
    return { inGrace: true, daysRemaining, graceExpired: false };
  }
  return { inGrace: false, daysRemaining: 0, graceExpired: true };
}

/**
 * Get the full vessel limit status for an agency user.
 * Called by API endpoints to build banner state and filing gate decisions.
 *
 * Returns:
 *   {
 *     isAgency: bool,
 *     vesselCount: number,
 *     vesselLimit: number | null,   // null = unlimited
 *     atLimit: bool,
 *     overLimit: bool,
 *     inGrace: bool,
 *     daysRemaining: number,
 *     graceExpired: bool,
 *     filingBlocked: bool,          // true only after grace expires AND still over limit
 *     planKey: string,
 *     tierName: string,
 *   }
 */
async function getAgencyLimitStatus(pool, userId) {
  const user = await getUserLimitState(pool, userId);
  if (!user) {
    return { isAgency: false, vesselCount: 0, vesselLimit: null, atLimit: false,
             overLimit: false, inGrace: false, daysRemaining: 0, graceExpired: false,
             filingBlocked: false, planKey: null, tierName: 'your plan' };
  }

  const planKey = user.subscription_plan;
  const isAgency = planKey && planKey.startsWith('agency_');

  if (!isAgency) {
    return { isAgency: false, vesselCount: 0, vesselLimit: null, atLimit: false,
             overLimit: false, inGrace: false, daysRemaining: 0, graceExpired: false,
             filingBlocked: false, planKey, tierName: 'your plan' };
  }

  const limit = getAgencyVesselLimit(planKey);
  const vesselCount = await countAgencyVessels(pool, userId);
  const limitNum = limit === Infinity ? null : limit;
  const atLimit   = limit !== Infinity && vesselCount >= limit;
  const overLimit = limit !== Infinity && vesselCount > limit;

  // Grace period calc (only relevant when over limit)
  const grace = calcGraceStatus(user.vessel_limit_exceeded_at);

  // Filing is blocked only after grace expires AND still over limit
  const filingBlocked = overLimit && grace.graceExpired;

  return {
    isAgency:       true,
    vesselCount,
    vesselLimit:    limitNum,
    atLimit,
    overLimit,
    inGrace:        overLimit && grace.inGrace,
    daysRemaining:  grace.daysRemaining,
    graceExpired:   grace.graceExpired,
    filingBlocked,
    planKey,
    tierName:       getTierDisplayName(planKey),
    upgradeTierName: getUpgradeTierName(planKey),
  };
}

/**
 * Called after a vessel is added to agent_client_vessels.
 * Handles grace period start + notification logic.
 * Does NOT block — adding vessel is always allowed (soft cap).
 */
async function handleVesselAdded(pool, userId) {
  const status = await getAgencyLimitStatus(pool, userId);
  if (!status.isAgency) return status;

  if (status.overLimit) {
    // Start grace period if not already started
    await markVesselLimitExceeded(pool, userId);

    // Reload to get the new timestamp
    const updatedStatus = await getAgencyLimitStatus(pool, userId);

    // Send day-1 email if not yet sent
    const userState = await getUserLimitState(pool, userId);
    if (!userState.vessel_limit_notified_day) {
      await sendLimitEmail(userState, updatedStatus, 1);
      await setNotifiedDay(pool, userId, 1);
    }

    return updatedStatus;
  } else if (status.atLimit) {
    // At limit (not over) — no email, just return status for banner
    return status;
  }

  return status;
}

/**
 * Called when a vessel is removed or user upgrades.
 * If now at or under limit, clear the exceeded state.
 */
async function handleVesselRemoved(pool, userId) {
  const status = await getAgencyLimitStatus(pool, userId);
  if (!status.isAgency) return;

  if (!status.overLimit && status.isAgency) {
    // Back under limit — clear grace period
    await clearVesselLimitExceeded(pool, userId);
  }
}

/**
 * Run by the notification scheduler (startup.js cron) to send day-5 and day-7 emails.
 * Called once per hour — idempotent via vessel_limit_notified_day.
 */
async function runLimitNotificationJob(pool) {
  const overLimitUsers = await getOverLimitAgencies(pool);
  const now = new Date();

  for (const user of overLimitUsers) {
    try {
      const exceededAt = new Date(user.vessel_limit_exceeded_at);
      const daysSinceExceeded = Math.floor((now - exceededAt) / (24 * 60 * 60 * 1000));
      const notifiedDay = user.vessel_limit_notified_day || 0;

      // Day 5 warning (2 days before block) — send if haven't yet
      if (daysSinceExceeded >= 5 && notifiedDay < 5) {
        const status = await getAgencyLimitStatus(pool, user.id);
        if (status.overLimit) {
          await sendLimitEmail(user, status, 5);
          await setNotifiedDay(pool, user.id, 5);
        }
      }

      // Day 7 block notification
      if (daysSinceExceeded >= 7 && notifiedDay < 7) {
        const status = await getAgencyLimitStatus(pool, user.id);
        if (status.overLimit) {
          await sendLimitEmail(user, status, 7);
          await setNotifiedDay(pool, user.id, 7);
        }
      }
    } catch (err) {
      console.error(`[vessel-limit] Notification job error for user ${user.id}:`, err.message);
    }
  }
}

/**
 * Send a vessel limit notification email.
 * Day 1: "You're over your limit — 7 days to upgrade"
 * Day 5: "2 days left before filing is blocked"
 * Day 7: "Filing is now blocked — upgrade to resume"
 */
async function sendLimitEmail(user, status, day) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) return; // Email proxy not configured (dev/test)

  const tierName = getTierDisplayName(user.subscription_plan);
  const limit = getAgencyVesselLimit(user.subscription_plan);
  const upgradeName = getUpgradeTierName(user.subscription_plan);

  let subject, body, html;

  if (day === 1) {
    subject = `Action required: You've exceeded your ${tierName} vessel limit`;
    body = `You have ${status.vesselCount} vessels on your ${tierName} plan (limit: ${limit}). You have 7 days to upgrade to ${upgradeName} before new filings are blocked. Upgrade at https://canalclear.org/pricing`;
    html = `
<p>Hi there,</p>
<p>Your CanalClear <strong>${tierName}</strong> plan includes up to <strong>${limit} vessels</strong>. You currently have <strong>${status.vesselCount} vessels</strong> — that's ${status.vesselCount - limit} over your limit.</p>
<p><strong>What happens next:</strong></p>
<ul>
  <li>You can continue filing for all existing vessels for <strong>7 days</strong></li>
  <li>After 7 days, new filings for vessels beyond your limit will be blocked</li>
  <li>All vessel data and filing history stays fully accessible</li>
</ul>
<p><a href="https://canalclear.org/pricing" style="background:#E87722;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Upgrade to ${upgradeName}</a></p>
<p>Questions? Reply to this email.</p>`;
  } else if (day === 5) {
    subject = `2 days left: Upgrade your ${tierName} plan to avoid filing disruption`;
    body = `Reminder: You have 2 days to upgrade before new filings for vessels over your ${tierName} limit (${limit} vessels) are blocked. You currently have ${status.vesselCount} vessels. Upgrade at https://canalclear.org/pricing`;
    html = `
<p>Hi there,</p>
<p>This is a reminder that you have <strong>2 days left</strong> before new filings are blocked on your <strong>${tierName}</strong> plan.</p>
<p>You have <strong>${status.vesselCount} vessels</strong> on a plan that covers <strong>${limit}</strong>. Upgrade to ${upgradeName} to keep everything running smoothly.</p>
<p><a href="https://canalclear.org/pricing" style="background:#E87722;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Upgrade Now</a></p>`;
  } else if (day === 7) {
    subject = `Filing paused: Upgrade your ${tierName} plan to resume`;
    body = `New filings are now blocked for vessels beyond your ${tierName} limit (${limit} vessels). You have ${status.vesselCount} vessels. Upgrade to resume filing. Existing vessel data and history is fully accessible. Upgrade at https://canalclear.org/pricing`;
    html = `
<p>Hi there,</p>
<p>New filings are now <strong>paused</strong> for vessels beyond your <strong>${tierName}</strong> plan limit of <strong>${limit} vessels</strong>.</p>
<p>You have <strong>${status.vesselCount} vessels</strong>. Your vessel data and all existing filing history remains fully accessible — you just can't submit new filings until you upgrade.</p>
<p><a href="https://canalclear.org/pricing" style="background:#E87722;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Upgrade to ${upgradeName}</a></p>
<p>Once you upgrade, filing resumes immediately — no waiting period.</p>`;
  }

  try {
    await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to: user.email, subject, body, html }),
    });
  } catch (err) {
    console.error(`[vessel-limit] Email send failed (day ${day}) for ${user.email}:`, err.message);
  }
}

/**
 * Express middleware: block filing submission when agency is over limit and grace expired.
 * Attach after requireAuth on filing creation routes.
 *
 * Only blocks agency accounts (plan_type = agent_pro) after the 7-day grace period.
 * Non-agency plans pass through unchanged.
 *
 * On block: 403 JSON with vessel_limit_exceeded: true for frontend detection.
 */
async function requireAgencyVesselCapacity(req, res, next) {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user && req.user.id;
    if (!userId) return next(); // no user = let auth middleware handle it

    const status = await getAgencyLimitStatus(pool, userId);
    if (!status.isAgency) return next(); // ops_manager / non-agency → skip

    // Attach status to request so route handlers can include banner data in response
    req.agencyVesselStatus = status;

    if (status.filingBlocked) {
      return res.status(403).json({
        success: false,
        error: 'vessel_limit_exceeded',
        message: `Upgrade your plan to file for more than ${status.vesselLimit} vessels`,
        vessel_limit_exceeded: true,
        vessels_used:  status.vesselCount,
        vessel_limit:  status.vesselLimit,
        tier_name:     status.tierName,
        upgrade_url:   '/pricing?tab=agency',
      });
    }

    return next();
  } catch (err) {
    console.error('[vessel-limit] middleware error:', err.message);
    return next(); // fail-open — don't block on internal error
  }
}

module.exports = {
  getAgencyVesselLimit,
  getAgencyLimitStatus,
  handleVesselAdded,
  handleVesselRemoved,
  runLimitNotificationJob,
  requireAgencyVesselCapacity,
  GRACE_PERIOD_DAYS,
};
