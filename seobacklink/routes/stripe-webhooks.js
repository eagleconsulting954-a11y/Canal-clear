const router = require('express').Router();
const { constructWebhookEvent } = require('../services/stripe');
const { updateUser, getUserByEmail } = require('../db/users');
const pool = require('../db/index');

router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        if (!userId) break;
        const planMap = {
          [process.env.STRIPE_STARTER_PRICE_ID]: 'starter',
          [process.env.STRIPE_GROWTH_PRICE_ID]: 'growth',
          [process.env.STRIPE_AGENCY_PRICE_ID]: 'agency',
        };
        const lineItems = session.line_items?.data || [];
        const priceId = lineItems[0]?.price?.id || session.metadata?.price_id;
        const planType = planMap[priceId] || 'starter';
        await updateUser(userId, {
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          plan_type: planType,
          subscription_status: 'active',
        });
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { rows } = await pool.query('SELECT id FROM users WHERE stripe_customer_id = $1 LIMIT 1', [sub.customer]);
        if (rows[0]) {
          await updateUser(rows[0].id, {
            subscription_status: sub.status,
            stripe_subscription_id: sub.id,
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const { rows } = await pool.query('SELECT id FROM users WHERE stripe_customer_id = $1 LIMIT 1', [sub.customer]);
        if (rows[0]) {
          await updateUser(rows[0].id, { plan_type: 'free', subscription_status: 'canceled' });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const { rows } = await pool.query('SELECT id FROM users WHERE stripe_customer_id = $1 LIMIT 1', [invoice.customer]);
        if (rows[0]) {
          await updateUser(rows[0].id, { subscription_status: 'past_due' });
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('webhook processing error', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
