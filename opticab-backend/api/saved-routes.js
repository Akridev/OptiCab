// api/saved-routes.js
// CRUD for saved routes (Home, Work, etc.)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = 'opticab-saved-routes';

export default async function handler(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { deviceId } = body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  try {
    // GET saved routes
    if (req.method === 'GET' || (req.method === 'POST' && body.action === 'get')) {
      const result = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { deviceId },
      }));
      return res.status(200).json({ routes: result.Item?.routes || [] });
    }

    // SAVE a new route
    if (req.method === 'POST' && body.action === 'save') {
      const { route } = body;
      if (!route || !route.name || !route.prompt) {
        return res.status(400).json({ error: 'Route must have name and prompt' });
      }

      // Get existing routes
      const existing = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { deviceId },
      }));
      const routes = existing.Item?.routes || [];

      // Max 10 saved routes
      if (routes.length >= 10) {
        return res.status(400).json({ error: 'Maximum 10 saved routes reached' });
      }

      // Add new route with ID
      const newRoute = {
        id: `route-${Date.now()}`,
        name: route.name,
        prompt: route.prompt,
        createdAt: new Date().toISOString(),
      };
      routes.push(newRoute);

      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { deviceId, routes },
      }));

      return res.status(200).json({ routes, added: newRoute });
    }

    // DELETE a saved route
    if (req.method === 'POST' && body.action === 'delete') {
      const { routeId } = body;
      if (!routeId) return res.status(400).json({ error: 'Route ID required' });

      const existing = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { deviceId },
      }));
      const routes = (existing.Item?.routes || []).filter(r => r.id !== routeId);

      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { deviceId, routes },
      }));

      return res.status(200).json({ routes });
    }

    return res.status(400).json({ error: 'Invalid action. Use: get, save, delete' });
  } catch (error) {
    console.error('Saved routes error:', error);
    return res.status(500).json({ error: 'Failed to manage saved routes', details: error.message });
  }
}
