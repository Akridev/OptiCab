// api/fare-feedback.js
// Stores actual fares paid by users for ML training data
// Table: opticab-fare-actuals (partition key: id, sort key: timestamp)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = 'opticab-fare-actuals';
const DEVICE_TABLE = 'opticab-fare-actuals'; // same table, queried by deviceId-timestamp GSI

// Singapore ride-hailing fare sanity bounds:
//   Minimum realistic fare: $5.00 (absolute floor across all providers)
//   Maximum realistic fare: distanceKm * $4.50 + $8 booking/surcharge buffer
//   Hard cap: $120 (airport + midnight surcharges on very long trips)
function isReasonableFare(actualFare, distanceKm, estimatedFare) {
  if (actualFare < 5.0) return { ok: false, reason: 'Below minimum fare ($5.00).' };
  if (actualFare > 120) return { ok: false, reason: 'Exceeds maximum realistic fare ($120).' };

  // Distance-based upper bound (if we have distance)
  if (distanceKm && distanceKm > 0) {
    const maxExpected = distanceKm * 4.5 + 8;
    if (actualFare > maxExpected) {
      return { ok: false, reason: `Fare $${actualFare} seems high for ${distanceKm}km (max expected ~$${maxExpected.toFixed(2)}).` };
    }
  }

  // Estimate cross-check: reject if >3x or <0.3x the OptiCab estimate
  // This catches typos like "125" instead of "12.5"
  if (estimatedFare && estimatedFare > 0) {
    const ratio = actualFare / estimatedFare;
    if (ratio > 3.0) return { ok: false, reason: `Fare $${actualFare} is more than 3x the estimate ($${estimatedFare}).` };
    if (ratio < 0.3) return { ok: false, reason: `Fare $${actualFare} is less than 30% of the estimate ($${estimatedFare}).` };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const {
    deviceId,
    provider,       // e.g. 'Grab'
    actualFare,     // number — what the user actually paid
    estimatedFare,  // number — what OptiCab predicted
    distanceKm,
    durationMin,
    hour,           // 0–23 Singapore time
    dayOfWeek,      // 0=Sun … 6=Sat
    wasRaining,     // boolean
    nearbyTaxis,    // number or null
    pickupArea,     // string — general area name for geo context
    dropoffArea,
  } = body;

  // ── Layer 1: Basic field validation ──────────────────────────────────────
  const VALID_PROVIDERS = ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];
  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider.' });
  }
  if (typeof actualFare !== 'number' || isNaN(actualFare)) {
    return res.status(400).json({ error: 'actualFare must be a number.' });
  }

  // ── Layer 2: Distance-based fare bounds + estimate cross-check ───────────
  const fareCheck = isReasonableFare(actualFare, distanceKm, estimatedFare);
  if (!fareCheck.ok) {
    // Silently drop (200 OK) rather than error — user doesn't need to know
    // Log for monitoring but don't store the bad data
    console.warn('fare-feedback rejected:', fareCheck.reason, { actualFare, distanceKm, estimatedFare, provider });
    return res.status(200).json({ success: true, note: 'feedback noted' });
  }

  const timestamp = new Date().toISOString();
  const today = timestamp.split('T')[0]; // YYYY-MM-DD
  const sgHour = hour ?? new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' })).getHours();
  const sgDay  = dayOfWeek ?? new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' })).getDay();
  const safeDeviceId = deviceId || 'anonymous';

  try {
    // ── Layer 3: Device rate limiting — max 10 submissions per device per day ─
    if (safeDeviceId !== 'anonymous') {
      const countResult = await docClient.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'deviceId-timestamp-index', // GSI: deviceId (partition) + timestamp (sort)
        KeyConditionExpression: 'deviceId = :did AND begins_with(#ts, :today)',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':did': safeDeviceId, ':today': today },
        Select: 'COUNT',
      })).catch(() => ({ Count: 0 })); // If GSI doesn't exist yet, skip the check

      if (countResult.Count >= 10) {
        console.warn('fare-feedback rate limited:', safeDeviceId);
        return res.status(429).json({ error: 'Too many submissions today. Thank you for your help!' });
      }
    }

    // ── Store the validated feedback ─────────────────────────────────────────
    await docClient.send(new PutCommand({
      TableName: TABLE,
      Item: {
        id: randomUUID(),
        timestamp,
        deviceId: safeDeviceId,
        provider,
        actualFare:    parseFloat(actualFare.toFixed(2)),
        estimatedFare: estimatedFare ? parseFloat(estimatedFare.toFixed(2)) : null,
        error:         estimatedFare ? parseFloat((actualFare - estimatedFare).toFixed(2)) : null,
        distanceKm:    distanceKm  || null,
        durationMin:   durationMin || null,
        hour:          sgHour,
        dayOfWeek:     sgDay,
        wasRaining:    wasRaining === true,
        nearbyTaxis:   nearbyTaxis ?? null,
        pickupArea:    pickupArea  || null,
        dropoffArea:   dropoffArea || null,
        validatedAt:   timestamp,
      },
    }));

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('fare-feedback error:', error);
    return res.status(500).json({ error: 'Failed to save feedback.', details: error.message });
  }
}
