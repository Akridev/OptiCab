// api/create-payment.js
// Creates a Stripe PaymentIntent and returns client secret
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(200).end(); }
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { email } = body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Find or create Stripe customer by email
    let customer;
    const existing = await stripe.customers.list({ email: normalizedEmail, limit: 1 });

    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({
        email: normalizedEmail,
        metadata: { source: 'opticab' },
      });
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 299, // $2.99 SGD
      currency: 'sgd',
      customer: customer.id,
      metadata: { email: normalizedEmail, type: 'opticab_premium' },
      automatic_payment_methods: { enabled: true },
      receipt_email: normalizedEmail,
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
