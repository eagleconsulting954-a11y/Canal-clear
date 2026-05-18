/**
 * routes/stripe-webhooks.js
 * Owner: Stripe webhook endpoint — receives events directly from Stripe and syncs
 *        subscription state to the users table.
 * NOT responsible for: checkout session creation, payment link generation,
 *                       post-payment registration, or business logic beyond subscription sync.
 *
 * Mount with raw body parsing (before express.json) so Stripe signature can be verified:
 *   app.use('/api/webhooks/stripe', require('./routes/stripe-webhooks'));
 *
 * Webhook endpoint to configure in your Stripe dashboard:
 *   https://canalclear.org/api/webhooks/stripe
 *
 * Events handled:
 *   checkout.session.completed      — first payment; provision subscription
 *   customer.subscription.updated   — plan change, renewal
 *   customer.subscription.deleted   — cancellation
 *   invoice.payment_succeeded       — renewal confirmation
 *   invoice.payment_failed          — payment failure → past_due
 */

'use strict';

const express = require('express');
const router = express.Router();
const { constructWebhookEvent, getSubscription } = require('../services/stripe');
const usersDb = require('../db/users');

// Stripe sends the raw body; we need it unparsed for signature verification.
// This route must be mounted BEFORE express.json() globally, or use express.raw here.
router.use(express.raw({ type: 'application/json' }));

// ── Plan resolution helpers (mirrors api.js — kept local to avoid circular deps) ──

const VESSEL_LIMITS_BY_PLAN = {
  agent_pro_panama:        null,
  agent_pro_suez:          null,
  agent_pro_bosporus:      null,
  agent_pro_malacca:       null,
  agent_pro_bundle:        null,
  ops_manager_panama:      null, // actual limit = subscription quantity
  ops_manager_suez:        null,
  ops_manager_bosporus:    null,
  ops_manager_malacca:     null,
  ops_manager_bundle:      null,
  agency_starter:          50,
  agency_pro:              200,
  agency_enterprise:       null,
};

/** Map Stripe product/price metadata or product name to internal plan key */
function resolvePlanKey(productName, priceMetadata, productMetadata) {
  // Prefer explicit metadata set on the Price or Product in Stripe dashboard
  const metaKey = priceMetadata?.plan_key || productMetadata?.plan_key;
  if (metaKey) return metaKey;

  // Fall back to parsing the product name
  if (!productName) return null;
  const name = productName.toLowerCase();

  if (name.includes('agency')) {
    const tier = name.includes('agency enterprise') ? 'agency_enterprise'
               : name.includes('agency pro')        ? 'agency_pro'
               : name.includes('agency starter')    ? 'agency_starter'
               : null;
    if (tier) {
      const ww = name.includes('panama') ? '_panama' : name.includes('suez') ? '_suez'
               : name.includes('bosporus') ? '_bosporus' : name.includes('malacca') ? '_malacca'
               : name.includes('cape') ? '_cape' : '';
      return `${tier}${ww}`;
    }
  }
  if (name.includes('agent pro')) {
    const ww = name.includes('panama') ? '_panama' : name.includes('suez') ? '_suez'
             : name.includes('bosporus') ? '_bosporus' : name.includes('malacca') ? '_malacca'
             : name.includes('cape') ? '_cape' : name.includes('bundle') ? '_bundle' : null;
    return ww ? `agent_pro${ww}` : null;
  }
  if (name.includes('ops manager')) {
    const ww = name.includes('panama') ? '_panama' : name.includes('suez') ? '_suez'
             : name.includes('bosporus') ? '_bosporus' : name.includes('malacca') ? '_malacca'
             : name.includes('cape') ? '_cape' : name.includes('bundle') ? '_bundle' : null;
    return ww ? `ops_manager${ww}` : null;
  }
  return null;
}

/** Derive vessel limit for a plan key + subscription quantity */
function deriveVesselLimit(planKey, quantity) {
  if (!planKey) return null;
  if (planKey.startsWith('agency_starter'))    return 50;
  if (planKey.startsWith('agency_pro'))        return 200;
  if (planKey.startsWith('agency_enterprise')) return null;
  if (planKey.startsWith('ops_manager')) {
    const qty = parseInt(quantity, 10);
    return (Number.isFinite(qty) && qty > 0) ? qty : 1;
  }
  return null; // agent_pro = unlimited
}

/** Derive plan_type string for fast UI queries */
function derivePlanType(planKey) {
  if (!planKey) return 'free';
  if (planKey.startsWith('agency_')) return 'agency';
  if (planKey.startsWith('agent_pro')) return 'agent_pro';
  if (planKey.startsWith('ops_manager')) return 'ops_manager';
  return 'free';
}

/** Derive allowed canals from plan key */
function deriveAllowedCanals(planKey) {
  const ALL = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
  if (!planKey) return [];
  if (planKey.includes('bundle') || planKey.startsWith('agency_')) return ALL;
  for (const c of ALL) {
    if (planKey.includes(c)) return [c];
  }
  return [];
}

// ── Event processing ──────────────────────────────────────────────────────────

/**
 * Sync a Stripe subscription to the users table.
 * Called for checkout.session.completed, subscription.updated, and invoice events.
 */
async function syncSubscription(pool, opts) {
  const {
    email,
    subscriptionId,
    planKey,
    vesselLimit,
    planType,
    allowedCanals,
    status,     // 'active' | 'canceled' | 'past_due' | etc.
    expiresAt,  // ISO string
  } = opts;

  if (!email) {
    console.error('[stripe-webhook] syncSubscription called with no email');
    return;
  }

  const normalized = email.toLowerCase().trim();
  const existing = await usersDb.getUserIdByEmail(pool, normalized);

  if (existing.rows.length > 0) {
    const userId = existing.rows[0].id;
    await usersDb.syncUserSubscription(pool, {
      mappedStatus: status,
      internalPlanKey: planKey,
      expiresAt,
      subscriptionId,
      vesselLimit,
      planType,
      userId,
      syncedCanals: allowedCanals,
    });
    console.log(`[stripe-webhook] Updated user ${normalized} (plan: ${planKey}, status: ${status}, vessels: ${vesselLimit ?? 'unlimited'})`);
  } else {
    // Stub user — will complete registration on /login?payment=success
    await usersDb.insertStubUser(pool, {
      email: normalized,
      mappedStatus: status,
      internalPlanKey: planKey,
      expiresAt,
      subscriptionId,
      vesselLimit,
      planType,
      syncedCanals: allowedCanals || [],
    });
    console.log(`[stripe-webhook] Created stub user ${normalized} (plan: ${planKey}, status: ${status})`);
  }
}

// ── Webhook route ─────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // req.body is a Buffer here because of express.raw above
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  const pool = req.app.locals.pool;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        if (!email) break;

        let planKey = null;
        let quantity = 1;
        let productName = null;

        // Expand subscription to get price + product details
        if (session.subscription) {
          try {
            const sub = await getSubscription(session.subscription);
            const item = sub.items?.data?.[0];
            if (item) {
              quantity = item.quantity || 1;
              const price = item.price;
              const product = price?.product;
              productName = typeof product === 'object' ? product.name : null;
              planKey = resolvePlanKey(
                productName,
                price?.metadata,
                typeof product === 'object' ? product.metadata : null
              );
            }
          } catch (subErr) {
            console.error('[stripe-webhook] Could not expand subscription:', subErr.message);
          }
        }

        // Also try metadata on the session itself (set in our checkout.session params)
        if (!planKey && session.metadata?.plan_key) {
          planKey = session.metadata.plan_key;
        }

        const vesselLimit = deriveVesselLimit(planKey, quantity);
        const planType = derivePlanType(planKey);
        const allowedCanals = deriveAllowedCanals(planKey);
        const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

        await syncSubscription(pool, {
          email,
          subscriptionId: session.subscription,
          planKey,
          vesselLimit,
          planType,
          allowedCanals,
          status: 'active',
          expiresAt,
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const email = sub.customer_email || null;
        // customer_email isn't always on the subscription object; we need to look up by customer if missing
        // For now, process what we have — the subscription ID is the key
        const item = sub.items?.data?.[0];
        const price = item?.price;
        const product = price?.product;
        const productName = typeof product === 'object' ? product.name : null;
        const planKey = resolvePlanKey(
          productName,
          price?.metadata,
          typeof product === 'object' ? product.metadata : null
        );
        const quantity = item?.quantity || 1;
        const vesselLimit = deriveVesselLimit(planKey, quantity);
        const planType = derivePlanType(planKey);
        const allowedCanals = deriveAllowedCanals(planKey);
        const expiresAt = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

        const statusMap = { active: 'active', trialing: 'trialing', past_due: 'past_due', canceled: 'canceled', unpaid: 'unpaid' };
        const status = statusMap[sub.status] || sub.status;

        // If email is missing, we can't sync — log for investigation
        if (!email) {
          console.warn(`[stripe-webhook] customer.subscription.updated: no email on sub ${sub.id} — cannot sync. Check Stripe customer.`);
          break;
        }

        await syncSubscription(pool, { email, subscriptionId: sub.id, planKey, vesselLimit, planType, allowedCanals, status, expiresAt });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const email = sub.customer_email || null;
        if (!email) {
          console.warn(`[stripe-webhook] subscription.deleted: no email on sub ${sub.id}`);
          break;
        }
        const normalized = email.toLowerCase().trim();
        const existing = await usersDb.getUserIdByEmail(pool, normalized);
        if (existing.rows.length > 0) {
          await usersDb.syncUserSubscription(pool, {
            mappedStatus: 'canceled',
            internalPlanKey: null,
            expiresAt: new Date().toISOString(),
            subscriptionId: sub.id,
            vesselLimit: null,
            planType: 'free',
            userId: existing.rows[0].id,
            syncedCanals: null,
          });
          console.log(`[stripe-webhook] Subscription canceled for ${normalized}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const email = invoice.customer_email;
        if (!email) break;

        const expiresAt = invoice.lines?.data?.[0]?.period?.end
          ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
          : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

        // Just update subscription status to active + extend expiry
        const normalized = email.toLowerCase().trim();
        const existing = await usersDb.getUserIdByEmail(pool, normalized);
        if (existing.rows.length > 0) {
          await usersDb.syncUserSubscription(pool, {
            mappedStatus: 'active',
            internalPlanKey: null, // don't change plan on renewal
            expiresAt,
            subscriptionId: invoice.subscription,
            vesselLimit: null,    // don't change vessel limit on renewal
            planType: null,
            userId: existing.rows[0].id,
            syncedCanals: null,
          });
          console.log(`[stripe-webhook] Invoice paid — renewed ${normalized} to ${expiresAt}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const email = invoice.customer_email;
        if (!email) break;

        const normalized = email.toLowerCase().trim();
        const existing = await usersDb.getUserIdByEmail(pool, normalized);
        if (existing.rows.length > 0) {
          await usersDb.syncUserSubscription(pool, {
            mappedStatus: 'past_due',
            internalPlanKey: null,
            expiresAt: null,
            subscriptionId: invoice.subscription,
            vesselLimit: null,
            planType: null,
            userId: existing.rows[0].id,
            syncedCanals: null,
          });
          console.log(`[stripe-webhook] Invoice payment failed — ${normalized} set to past_due`);
        }
        break;
      }

      default:
        // Unhandled event type — ignore silently (Stripe dashboard shows these as received)
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`[stripe-webhook] Error processing ${event.type}:`, err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
