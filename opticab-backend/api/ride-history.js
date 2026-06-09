// api/ride-history.js
// Stores and retrieves ride search history
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = 'opticab-ride-history';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { deviceId, action } = body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  try {
    // GET ride history (last 20 rides)
    if (action === 'get') {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'deviceId = :did',
        ExpressionAttributeValues: { ':did': deviceId },
        ScanIndexForward: false, // newest first
        Limit: 20,
      }));
      return res.status(200).json({ history: result.Items || [] });
    }

    // SAVE a ride to history
    if (action === 'save') {
      const { ride } = body;
      if (!ride) return res.status(400).json({ error: 'Ride data required' });

      const item = {
        deviceId,
        timestamp: new Date().toISOString(),
        pickup: ride.pickup || 'Unknown',
        dropoff: ride.dropoff || 'Unknown',
        cheapestProvider: ride.cheapestProvider || null,
        cheapestPrice: ride.cheapestPrice || null,
        fastestProvider: ride.fastestProvider || null,
        fastestPrice: ride.fastestPrice || null,
        prompt: ride.prompt || '',
      };

      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: item,
      }));

      return res.status(200).json({ saved: true, item });
    }

    return res.status(400).json({ error: 'Invalid action. Use: get, save' });
  } catch (error) {
    console.error('Ride history error:', error);
    return res.status(500).json({ error: 'Failed to manage ride history', details: error.message });
  }
}
