// api/stripe-webhook.js
// Handles Stripe webhook events for subscription lifecycle
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      // If this is an OptiCab premium payment, create the subscription
      if (paymentIntent.metadata?.type === 'opticab_premium_subscription' && paymentIntent.customer) {
        try {
          // Check if customer already has an active subscription
          const existingSubs = await stripe.subscriptions.list({
            customer: paymentIntent.customer,
            status: 'active',
            limit: 1,
          });
          if (existingSubs.data.length === 0) {
            // Create the subscription (first payment already collected)
            await stripe.subscriptions.create({
              customer: paymentIntent.customer,
              items: [{ price: process.env.STRIPE_PRICE_ID }],
            });
          }
        } catch (err) {
          console.error('Failed to create subscription after payment:', err);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      // Subscription cancelled — nothing to do server-side for now
      // The subscription-status endpoint checks live status from Stripe
      break;
    }
  }

  return res.status(200).json({ received: true });
}
