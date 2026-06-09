// api/saved-routes.js
// Simple Home/Work saved routes (upsert — replaces if exists)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = 'opticab-saved-routes';

export default async function handler(req, res) {
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
      return res.status(200).json({ routes: result.Item?.routes || [] });
    }

    // SAVE (upsert) a route — only Home or Work allowed
    if (action === 'save') {
      const { route } = body;
      if (!route || !route.name || !route.prompt) {
        return res.status(400).json({ error: 'Route must have name and prompt' });
      }
      if (route.name !== 'Home' && route.name !== 'Work') {
        return res.status(400).json({ error: 'Only Home and Work routes are supported' });
      }

      // Get existing routes
      const existing = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { deviceId },
      }));
      let routes = existing.Item?.routes || [];

      // Upsert: replace if same name exists, otherwise add
      const idx = routes.findIndex(r => r.name === route.name);
      const newRoute = {
        id: `route-${route.name.toLowerCase()}`,
        name: route.name,
        prompt: route.prompt,
        updatedAt: new Date().toISOString(),
      };

      if (idx >= 0) {
        routes[idx] = newRoute;
      } else {
        routes.push(newRoute);
      }

      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { deviceId, routes },
      }));

      return res.status(200).json({ routes, saved: newRoute });
    }

    return res.status(400).json({ error: 'Invalid action. Use: get, save' });
  } catch (error) {
    console.error('Saved routes error:', error);
    return res.status(500).json({ error: 'Failed to manage saved routes', details: error.message });
  }
}
