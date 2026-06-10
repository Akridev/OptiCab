// api/subscription-status.js
// Checks premium status from DynamoDB by email
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = 'opticab-users';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(200).end(); }
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { email } = body;

  if (!email) {
    return res.status(200).json({ isPremium: false });
  }

  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE,
      Key: { email: email.toLowerCase().trim() },
    }));

    if (result.Item && result.Item.isPremium) {
      return res.status(200).json({
        isPremium: true,
        subscribedAt: result.Item.subscribedAt || null,
      });
    }

    return res.status(200).json({ isPremium: false });
  } catch (error) {
    console.error('Subscription status error:', error);
    return res.status(200).json({ isPremium: false });
  }
}
