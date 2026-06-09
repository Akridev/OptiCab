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

    // Create a PaymentIntent directly (simpler than subscription for initial setup)
    // Once payment succeeds, the webhook will create/activate the subscription
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 299, // $2.99 SGD in cents
      currency: 'sgd',
      customer: customer.id,
      metadata: { deviceId, type: 'opticab_premium_subscription' },
      automatic_payment_methods: { enabled: true },
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (error) {
    console.error('Create payment error:', error);
    return res.status(500).json({ error: 'Failed to create payment', details: error.message });
  }
}
