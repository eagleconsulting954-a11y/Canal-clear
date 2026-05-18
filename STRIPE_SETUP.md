# CanalClear — Stripe Setup Guide

All payment revenue goes directly to **your** Stripe account. No intermediary.

---

## Step 1: Create your Stripe account

Sign up at [stripe.com](https://stripe.com) if you don't have one. Complete identity verification before going live.

---

## Step 2: Set required environment variables

In your Render dashboard → CanalClear service → **Environment**:

| Variable | Description | Where to find it |
|---|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe secret key | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | Stripe Dashboard → Developers → Webhooks (after Step 5) |

**Use `sk_test_*` keys in test mode, `sk_live_*` in production.**

---

## Step 3: Configure your webhook endpoint

In Stripe Dashboard → Developers → Webhooks → **Add endpoint**:

- **Endpoint URL:** `https://canalclear.org/api/webhooks/stripe`
- **Events to listen for:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`

After creating, copy the **Signing secret** (`whsec_*`) and set it as `STRIPE_WEBHOOK_SECRET`.

---

## Step 4: Create the SEAS promo coupon (20% off)

In Stripe Dashboard → Coupons → **Create coupon**:

- **Name:** SEAS
- **Discount:** 20% off
- **Duration:** Forever (applies to each billing period)
- **Redemption limit:** Leave blank (unlimited)

Copy the coupon ID (e.g. `seas_20_off`) and set:

```
STRIPE_COUPON_SEAS=seas_20_off
```

---

## Step 5: Create products and payment links

You need to create Stripe products for each plan. The app works in **two modes**:

### Mode A: Payment Links (simplest — no per-session pricing needed)

For vessel counts 1–10, create a Stripe Payment Link for each combination. Then set:

```
# Agent Pro plans (unlimited filings, flat monthly fee)
STRIPE_LINK_AGENT_PRO_PANAMA=https://buy.stripe.com/YOUR_LINK
STRIPE_LINK_AGENT_PRO_SUEZ=https://buy.stripe.com/YOUR_LINK
STRIPE_LINK_AGENT_PRO_BOSPORUS=https://buy.stripe.com/YOUR_LINK
STRIPE_LINK_AGENT_PRO_MALACCA=https://buy.stripe.com/YOUR_LINK
STRIPE_LINK_AGENT_PRO_BUNDLE=https://buy.stripe.com/YOUR_LINK

# Ops Manager — Panama (per-vessel, 1–10 vessel counts)
STRIPE_LINK_OPS_PANAMA_1=https://buy.stripe.com/YOUR_LINK
STRIPE_LINK_OPS_PANAMA_2=https://buy.stripe.com/YOUR_LINK
# ... through STRIPE_LINK_OPS_PANAMA_10

# Ops Manager — Suez (per-vessel, 1–10 vessel counts)
STRIPE_LINK_OPS_SUEZ_1=https://buy.stripe.com/YOUR_LINK
# ... through STRIPE_LINK_OPS_SUEZ_10

# Ops Manager — Bosporus (per-vessel, 1–10 vessel counts)
STRIPE_LINK_OPS_BOSPORUS_1=https://buy.stripe.com/YOUR_LINK
# ... through STRIPE_LINK_OPS_BOSPORUS_10

# Ops Manager — Malacca (per-vessel, 1–10 vessel counts)
STRIPE_LINK_OPS_MALACCA_1=https://buy.stripe.com/YOUR_LINK
# ... through STRIPE_LINK_OPS_MALACCA_10

# Ops Manager — Bundle / All Waterways (per-vessel, 1–10 vessel counts)
STRIPE_LINK_OPS_BUNDLE_1=https://buy.stripe.com/YOUR_LINK
# ... through STRIPE_LINK_OPS_BUNDLE_10

# SEAS 20% discounted links (same structure, separate links with discounted prices)
STRIPE_LINK_OPS_SEAS_PANAMA_1=https://buy.stripe.com/YOUR_LINK
# ... etc.

# Agency plans (flat monthly per tier)
STRIPE_LINK_AGENCY_STARTER=https://buy.stripe.com/YOUR_LINK
STRIPE_LINK_AGENCY_PRO=https://buy.stripe.com/YOUR_LINK
STRIPE_LINK_AGENCY_ENTERPRISE=https://buy.stripe.com/YOUR_LINK

# Agency plans — per-waterway variants (optional, falls back to bundle links)
STRIPE_LINK_AGENCY_STARTER_PANAMA=https://buy.stripe.com/YOUR_LINK
# ... etc.
```

**If you don't set these, the app falls back to the existing Polsia-created links (payments still work, but revenue goes to Polsia).** Set them as you create your own products.

### Mode B: Dynamic Checkout (for 11+ vessels and Cape of Good Hope)

For orders above 10 vessels, the app creates a dynamic Stripe Checkout Session. This requires a Price ID per canal (recurring monthly subscription):

```
# Price IDs for dynamic checkout (11+ vessels)
STRIPE_PRICE_OPS_PANAMA=price_xxxxx    # $399/vessel/mo recurring
STRIPE_PRICE_OPS_SUEZ=price_xxxxx     # $599/vessel/mo recurring
STRIPE_PRICE_OPS_BOSPORUS=price_xxxxx # $499/vessel/mo recurring
STRIPE_PRICE_OPS_MALACCA=price_xxxxx  # $449/vessel/mo recurring
STRIPE_PRICE_OPS_CAPE=price_xxxxx     # $349/vessel/mo recurring
STRIPE_PRICE_OPS_BUNDLE=price_xxxxx   # $1,299/vessel/mo recurring
```

To create a Price ID in Stripe: Dashboard → Products → Create product → Add price (Recurring, Monthly, per the amounts above). The Price ID starts with `price_`.

---

## Pricing reference

| Plan | Type | Monthly |
|---|---|---|
| Agent Pro — Panama | Flat | $599/mo |
| Agent Pro — Suez | Flat | $899/mo |
| Agent Pro — Bosporus | Flat | (set your price) |
| Agent Pro — Malacca | Flat | (set your price) |
| Agent Pro — Bundle | Flat | $1,500/mo |
| Ops Manager — Panama | Per-vessel | $399/vessel/mo |
| Ops Manager — Suez | Per-vessel | $599/vessel/mo |
| Ops Manager — Bosporus | Per-vessel | $499/vessel/mo |
| Ops Manager — Malacca | Per-vessel | $449/vessel/mo |
| Ops Manager — Cape | Per-vessel | $349/vessel/mo |
| Ops Manager — Bundle | Per-vessel | $1,299/vessel/mo |
| Agency Starter | Flat | $999/mo |
| Agency Pro | Flat | $1,999/mo |
| Agency Enterprise | Flat | $2,999/mo |
| SEAS promo | -20% off Ops Manager | Coupon applied at checkout |

---

## Step 6: Minimal env vars to get started

You can go live with just these 3 env vars. The app falls back to existing payment links for all checkouts, but routes all webhook events through your account:

```
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_COUPON_SEAS=your_coupon_id
```

**Then set `STRIPE_LINK_*` env vars as you create your own Stripe products** — the app auto-uses your links as soon as the env vars are set, no code deploy needed.

---

## Step 7: Test the integration

1. Use test mode: `STRIPE_SECRET_KEY=sk_test_*`, test webhook endpoint
2. Complete a test checkout using Stripe test card `4242 4242 4242 4242`
3. Verify the user account is created/updated in your database
4. Check the webhook log in Stripe Dashboard → Developers → Webhooks → your endpoint

---

## Troubleshooting

**"Webhook signature verification failed"** — `STRIPE_WEBHOOK_SECRET` is wrong or not set. Get it from Stripe Dashboard → Webhooks → your endpoint → Signing secret.

**"STRIPE_SECRET_KEY is not set"** — You've set the env var but the app hasn't restarted yet. Trigger a redeploy.

**Payment went to Polsia, not me** — You haven't set the `STRIPE_LINK_*` env vars for that plan yet. The fallback links point to the old Polsia account. Set your own links.

**Subscription not synced after payment** — Check the Stripe webhook dashboard to see if the event was delivered. If yes but user is still `free`, check the app logs for `[stripe-webhook]` lines.
