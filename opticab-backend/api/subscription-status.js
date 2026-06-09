// api/subscription-status.js
// Checks if a device has an active premium subscription
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { deviceId } = body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required', isPremium: false });
  }

  try {
    // Search for customer by device ID metadata
    const searchResult = await stripe.customers.search({
      query: `metadata["deviceId"]:"${deviceId}"`,
      limit: 1,
    });

    if (searchResult.data.length === 0) {
      return res.status(200).json({ isPremium: false });
    }

    const customerId = searchResult.data[0].id;

    // Check for active subscriptions on this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length > 0) {
      const sub = subscriptions.data[0];
      return res.status(200).json({
        isPremium: true,
        plan: sub.items.data[0]?.price?.nickname || 'OptiCab Premium',
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      });
    }

    // Also check trialing status
    const trialSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'trialing',
      limit: 1,
    });

    if (trialSubs.data.length > 0) {
      return res.status(200).json({
        isPremium: true,
        plan: 'OptiCab Premium (Trial)',
        currentPeriodEnd: new Date(trialSubs.data[0].current_period_end * 1000).toISOString(),
      });
    }

    return res.status(200).json({ isPremium: false });
  } catch (error) {
    console.error('Subscription status check error:', error);
    return res.status(200).json({ isPremium: false, error: 'Check failed' });
  }
}
