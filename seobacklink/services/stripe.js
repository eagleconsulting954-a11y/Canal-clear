const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter: {
    name: 'Starter',
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    price: 49,
    articlesPerMonth: 10,
    features: ['10 AI articles/month', 'Keyword clustering', 'Basic backlink tracker', 'Email support'],
  },
  growth: {
    name: 'Growth',
    priceId: process.env.STRIPE_GROWTH_PRICE_ID,
    price: 99,
    articlesPerMonth: 30,
    features: ['30 AI articles/month', 'Advanced keyword clusters', 'Backlink outreach tracker', 'AI visibility scores', 'Priority support'],
  },
  agency: {
    name: 'Agency',
    priceId: process.env.STRIPE_AGENCY_PRICE_ID,
    price: 249,
    articlesPerMonth: 100,
    features: ['100 AI articles/month', 'Unlimited keyword clusters', 'Full backlink suite', 'AI visibility monitoring', 'White-label exports', 'Dedicated support'],
  },
};

async function createCheckoutSession({ priceId, customerId, email, successUrl, cancelUrl, userId }) {
  const params = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
  };
  if (customerId) {
    params.customer = customerId;
  } else {
    params.customer_email = email;
  }
  return stripe.checkout.sessions.create(params);
}

async function createPortalSession(customerId, returnUrl) {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

function constructWebhookEvent(rawBody, sig) {
  return stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { stripe, PLANS, createCheckoutSession, createPortalSession, constructWebhookEvent };
