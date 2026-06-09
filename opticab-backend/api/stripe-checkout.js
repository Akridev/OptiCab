// api/stripe-checkout.js
// Creates a Stripe Checkout session for OptiCab Premium subscription
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
    // Create or retrieve a Stripe customer by device ID
    const customers = await stripe.customers.list({ metadata: { deviceId }, limit: 1 });
    let customer;

    if (customers.data.length > 0) {
      customer = customers.data[0];
    } else {
      customer = await stripe.customers.create({
        metadata: { deviceId },
        description: `OptiCab user (${deviceId.slice(0, 8)}...)`,
      });
    }

    // Create Checkout Session for the subscription
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, // Monthly subscription price ID from Stripe Dashboard
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_URL || 'https://opticab-backend.vercel.app'}/api/stripe-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'https://opticab-backend.vercel.app'}/api/stripe-cancel`,
    });

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session', details: error.message });
  }
}
