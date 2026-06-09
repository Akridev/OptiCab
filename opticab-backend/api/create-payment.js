// api/create-payment.js
// Creates a Stripe subscription and returns the client secret for in-app payment
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { deviceId } = body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  try {
    // Find or create customer
    let customer;
    const searchResult = await stripe.customers.search({
      query: `metadata["deviceId"]:"${deviceId}"`,
      limit: 1,
    });

    if (searchResult.data.length > 0) {
      customer = searchResult.data[0];
    } else {
      customer = await stripe.customers.create({
        metadata: { deviceId },
        description: `OptiCab user (${deviceId.slice(0, 8)}...)`,
      });
    }

    // Create a subscription with incomplete status (pending payment)
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    const paymentIntent = subscription.latest_invoice.payment_intent;

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      subscriptionId: subscription.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (error) {
    console.error('Create payment error:', error);
    return res.status(500).json({ error: 'Failed to create payment', details: error.message });
  }
}
