/**
 * services/stripe.js
 * Owner: Stripe integration layer — checkout session creation, payment verification,
 *        and webhook signature validation.
 * NOT responsible for: user provisioning, subscription plan mapping, waterway access.
 *
 * Uses owner's own Stripe account credentials via environment variables.
 * No Polsia payment proxy — all revenue goes directly to the owner's Stripe.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY      — owner's Stripe secret key (sk_live_* or sk_test_*)
 *   STRIPE_WEBHOOK_SECRET  — webhook signing secret (whsec_*) from Stripe dashboard
 *   BASE_URL               — deployment base URL (e.g. https://canalclear.org)
 *
 * Optional price ID env vars (one per product/tier):
 *   STRIPE_PRICE_OPS_PANAMA_1..10     — pre-created price IDs for 1-10 vessel Panama plans
 *   (and similarly for other canals/tiers — see STRIPE_SETUP.md for the full list)
 *
 * Payment link env vars (alternative to dynamic checkout):
 *   STRIPE_LINK_AGENT_PRO_PANAMA, STRIPE_LINK_AGENT_PRO_SUEZ, etc.
 *   STRIPE_LINK_OPS_PANAMA_1..10, STRIPE_LINK_OPS_SUEZ_1..10, etc.
 *   STRIPE_LINK_AGENCY_STARTER, STRIPE_LINK_AGENCY_PRO, STRIPE_LINK_AGENCY_ENTERPRISE
 */

'use strict';

const Stripe = require('stripe');

/** Lazily-initialized Stripe client — fails loudly if key is not set */
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        '[stripe] STRIPE_SECRET_KEY is not set. ' +
        'Set this env var to your Stripe secret key (sk_live_* or sk_test_*).'
      );
    }
    _stripe = new Stripe(key, { apiVersion: '2023-10-16' });
  }
  return _stripe;
}

/**
 * Create a Stripe Checkout Session for a subscription.
 *
 * @param {object} opts
 * @param {string} opts.priceId      — Stripe Price ID (price_*)
 * @param {number} opts.quantity     — number of units (vessels for Ops Manager)
 * @param {string} opts.successUrl   — URL after successful payment (may include {CHECKOUT_SESSION_ID})
 * @param {string} opts.cancelUrl    — URL if customer cancels
 * @param {string} [opts.couponId]   — Stripe coupon ID for promo (e.g. SEAS 20% off)
 * @param {string} [opts.customerEmail] — pre-fill customer email
 * @returns {Promise<{url: string, sessionId: string}>}
 */
async function createCheckoutSession(opts) {
  const { priceId, quantity = 1, successUrl, cancelUrl, couponId, customerEmail } = opts;
  const stripe = getStripe();

  const params = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  if (couponId) {
    params.discounts = [{ coupon: couponId }];
  }
  if (customerEmail) {
    params.customer_email = customerEmail;
  }

  const session = await stripe.checkout.sessions.create(params);
  return { url: session.url, sessionId: session.id };
}

/**
 * Retrieve and verify a completed checkout session.
 * Returns { verified, email, subscriptionId, productName, quantity }.
 *
 * @param {string} sessionId — Stripe checkout session ID (cs_*)
 * @returns {Promise<object>}
 */
async function verifyCheckoutSession(sessionId) {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'subscription'],
  });

  if (session.payment_status !== 'paid' && session.status !== 'complete') {
    return { verified: false };
  }

  const email = session.customer_details?.email || session.customer_email || null;
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id || null;

  // Extract product name from line items
  const lineItems = session.line_items?.data || [];
  const firstItem = lineItems[0];
  const productName = firstItem?.description || null;
  const quantity = firstItem?.quantity || 1;

  return {
    verified: true,
    email,
    subscriptionId,
    productName,
    quantity,
    sessionId: session.id,
  };
}

/**
 * Construct and verify a Stripe webhook event from the raw request body and signature header.
 * Throws if the signature is invalid — caller must catch and return 400.
 *
 * @param {Buffer} rawBody   — raw request body (NOT parsed JSON)
 * @param {string} signature — value of stripe-signature header
 * @returns {object} Stripe event object
 */
function constructWebhookEvent(rawBody, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error(
      '[stripe] STRIPE_WEBHOOK_SECRET is not set. ' +
      'Set this to the webhook signing secret from your Stripe dashboard.'
    );
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Retrieve a Stripe subscription by ID.
 * Used by the webhook handler to get latest subscription state.
 *
 * @param {string} subscriptionId — sub_*
 * @returns {Promise<object>} Stripe subscription object
 */
async function getSubscription(subscriptionId) {
  const stripe = getStripe();
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });
}

/**
 * Returns the Stripe Payment Link URL for a given key, driven by env vars.
 * Falls back to the legacy hardcoded URL if the env var is not set.
 *
 * Env var naming convention: STRIPE_LINK_<KEY> where KEY is uppercase with underscores.
 * Example: STRIPE_LINK_AGENT_PRO_PANAMA, STRIPE_LINK_OPS_PANAMA_1, STRIPE_LINK_AGENCY_STARTER
 *
 * @param {string} envKey  — e.g. 'AGENT_PRO_PANAMA', 'OPS_PANAMA_1', 'AGENCY_STARTER'
 * @param {string} fallback — legacy hardcoded URL (used until owner sets env vars)
 * @returns {string|null}
 */
function getPaymentLink(envKey, fallback) {
  return process.env[`STRIPE_LINK_${envKey}`] || fallback || null;
}

module.exports = {
  getStripe,
  createCheckoutSession,
  verifyCheckoutSession,
  constructWebhookEvent,
  getSubscription,
  getPaymentLink,
};
