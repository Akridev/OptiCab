// api/ride-history.js
// Stores and retrieves last 3 ride searches
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

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
    // GET last 3 searches
    if (action === 'get') {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'deviceId = :did',
        ExpressionAttributeValues: { ':did': deviceId },
        ScanIndexForward: false,
        Limit: 2,
      }));
      return res.status(200).json({ history: result.Items || [] });
    }

    // SAVE a search (keep only last 2)
    if (action === 'save') {
      const { ride } = body;
      if (!ride) return res.status(400).json({ error: 'Ride data required' });

      // Save new entry
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: {
          deviceId,
          timestamp: new Date().toISOString(),
          prompt: ride.prompt || '',
          cheapestProvider: ride.cheapestProvider || null,
          cheapestPrice: ride.cheapestPrice || null,
        },
      }));

      // Clean up old entries (keep only last 2)
      const all = await docClient.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'deviceId = :did',
        ExpressionAttributeValues: { ':did': deviceId },
        ScanIndexForward: false,
        Limit: 10,
      }));

      if (all.Items && all.Items.length > 2) {
        const toDelete = all.Items.slice(2);
        for (const item of toDelete) {
          await docClient.send(new DeleteCommand({
            TableName: TABLE,
            Key: { deviceId: item.deviceId, timestamp: item.timestamp },
          }));
        }
      }

      return res.status(200).json({ saved: true });
    }

    return res.status(400).json({ error: 'Invalid action. Use: get, save' });
  } catch (error) {
    console.error('Ride history error:', error);
    return res.status(500).json({ error: 'Failed to manage ride history', details: error.message });
  }
}
