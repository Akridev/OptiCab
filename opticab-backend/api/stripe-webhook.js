// api/stripe-webhook.js
// Handles Stripe webhook events for subscription lifecycle
// Configure this endpoint in Stripe Dashboard: https://dashboard.stripe.com/webhooks
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// In-memory store for demo (replace with a database in production)
// For production: use Vercel KV, Upstash Redis, or a DB
const activeSubscriptions = global._activeSubscriptions || (global._activeSubscriptions = new Map());

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Get raw body for signature verification
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription') {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const deviceId = subscription.metadata.deviceId;
        if (deviceId) {
          activeSubscriptions.set(deviceId, {
            subscriptionId: subscription.id,
            status: 'active',
            currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
          });
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const deviceId = subscription.metadata.deviceId;
      if (deviceId) {
        activeSubscriptions.set(deviceId, {
          subscriptionId: subscription.id,
          status: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const deviceId = subscription.metadata.deviceId;
      if (deviceId) {
        activeSubscriptions.delete(deviceId);
      }
      break;
    }
  }

  return res.status(200).json({ received: true });
}

// Export for subscription-status endpoint to access
export { activeSubscriptions };
