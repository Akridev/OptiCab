// api/stripe-webhook.js
// Handles Stripe webhook — writes premium status to DynamoDB
import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = 'opticab-users';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const email = paymentIntent.metadata?.email;

    if (email && paymentIntent.metadata?.type === 'opticab_premium') {
      try {
        await docClient.send(new PutCommand({
          TableName: TABLE,
          Item: {
            email: email.toLowerCase().trim(),
            isPremium: true,
            subscribedAt: new Date().toISOString(),
            stripeCustomerId: paymentIntent.customer,
          },
        }));
      } catch (err) {
        console.error('Failed to write premium status:', err);
      }
    }
  }

  return res.status(200).json({ received: true });
}
