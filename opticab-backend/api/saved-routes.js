// api/saved-routes.js
// Save and retrieve Home/Work routes only
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = 'opticab-saved-routes';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(200).end(); }
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { deviceId, action } = body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  try {
    // GET saved routes
    if (action === 'get') {
      const result = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { deviceId },
      }));
      return res.status(200).json({
        home: result.Item?.home || null,
        work: result.Item?.work || null,
      });
    }

    // SAVE Home or Work
    if (action === 'save') {
      const { type, prompt } = body;
      if (!type || !prompt || (type !== 'home' && type !== 'work')) {
        return res.status(400).json({ error: 'Type must be "home" or "work" with a prompt' });
      }

      // Get existing to preserve the other field
      const existing = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { deviceId },
      }));

      const item = {
        deviceId,
        home: existing.Item?.home || null,
        work: existing.Item?.work || null,
      };
      item[type] = prompt;

      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: item,
      }));

      return res.status(200).json({ home: item.home, work: item.work });
    }

    return res.status(400).json({ error: 'Invalid action. Use: get, save' });
  } catch (error) {
    console.error('Saved routes error:', error);
    return res.status(500).json({ error: 'Failed to manage saved routes', details: error.message });
  }
}
