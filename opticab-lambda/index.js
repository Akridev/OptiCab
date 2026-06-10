// opticab-lambda/index.js
// AWS Lambda — Multi-Provider Fare Matrix Engine
// Simulates real-time pricing across 5 Singapore ride-hailing platforms
// Invoked by: opticab-backend/api/recommendation.js via AWS_LAMBDA_FARES_ENDPOINT

// ─────────────────────────────────────────────
// SECTION 1: Singapore Provider Fare Structures
// Based on publicly available 2024/2025 fare schedules
// ─────────────────────────────────────────────

const FARE_CONFIG = {
  grab: {
    baseFare: 4.80,       // Flag-fall (SGD)
    perKmRate: 1.20,      // Per km after first km
    perMinRate: 0.30,     // Per minute of ride time
    bookingFee: 2.00,     // Platform booking fee
    minFare: 8.00,        // Minimum chargeable fare
    baseEta: 3,           // Base ETA in minutes (largest fleet = fastest avg)
    surgeCapMultiplier: 2.5,
  },
  tada: {
    baseFare: 4.00,       // TADA runs zero-commission, slightly cheaper base
    perKmRate: 1.05,
    perMinRate: 0.28,
    bookingFee: 0.00,     // TADA's key differentiator: no booking fee
    minFare: 7.00,
    baseEta: 5,           // Smaller fleet than Grab
    surgeCapMultiplier: 1.8, // TADA caps surge more aggressively
  },
  gojek: {
    baseFare: 4.50,
    perKmRate: 1.10,
    perMinRate: 0.28,
    bookingFee: 1.50,
    minFare: 7.50,
    baseEta: 4,
    surgeCapMultiplier: 2.2,
  },
  ryde: {
    baseFare: 3.50,       // Budget-positioned, lowest base in market
    perKmRate: 0.95,
    perMinRate: 0.25,
    bookingFee: 1.00,
    minFare: 6.50,
    baseEta: 6,           // Smallest fleet, highest ETA variance
    surgeCapMultiplier: 1.6,
  },
  cdg: {
    baseFare: 4.20,       // ComfortDelGro — premium metered-taxi heritage pricing
    perKmRate: 1.30,
    perMinRate: 0.33,
    bookingFee: 3.30,     // CDG charges a higher booking fee via app
    minFare: 9.00,
    baseEta: 3,
    surgeCapMultiplier: 1.5, // Traditional taxi — regulated, low surge ceiling
  },
};

// ─────────────────────────────────────────────
// SECTION 2: Haversine Distance Calculator
// Computes great-circle distance between two lat/lng coordinate pairs
// Returns distance in kilometres
// ─────────────────────────────────────────────

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─────────────────────────────────────────────
// SECTION 3: Coordinate Parser
// Handles both "lat, lng" string format and plain place name strings
// Returns { lat, lng } or null if unparseable
// ─────────────────────────────────────────────

function parseCoordinates(locationString) {
  if (!locationString || typeof locationString !== 'string') return null;

  const parts = locationString.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null; // Place name string — distance will use LLM-derived estimate
}

// ─────────────────────────────────────────────
// SECTION 4: Surge Multiplier Engine
// Models time-of-day surge based on Singapore commute patterns
// Peak windows: Morning rush (7–9am), Evening rush (5:30–8pm), Late night (11pm–1am)
// ─────────────────────────────────────────────

function getSurgeMultiplier(providerKey, sgHour) {
  const config = FARE_CONFIG[providerKey];

  let rawSurge = 1.0;

  // Morning peak
  if (sgHour >= 7 && sgHour < 9) {
    rawSurge = 1.6;
  }
  // Evening peak — highest demand window
  else if (sgHour >= 17 && sgHour < 20) {
    rawSurge = 1.9;
  }
  // Late-night premium (post-MRT hours)
  else if (sgHour >= 23 || sgHour < 1) {
    rawSurge = 1.4;
  }
  // Standard off-peak
  else {
    rawSurge = 1.0;
  }

  // Each provider has a hard cap on how high surge can go
  return Math.min(rawSurge, config.surgeCapMultiplier);
}

// ─────────────────────────────────────────────
// SECTION 5: ETA Variance Model
// Adds realistic randomness (+/- fleet density noise) to ETAs
// Prevents all providers returning identical wait times
// ─────────────────────────────────────────────

function computeEta(providerKey, distanceKm, surgeMultiplier) {
  const config = FARE_CONFIG[providerKey];

  // ETA = pickup wait time only (not ride duration)
  // Higher surge = more drivers active = slightly faster pickup
  const surgeEtaDiscount = surgeMultiplier > 1.3 ? -1 : 0;

  // Random fleet noise: ±1 minute
  const fleetNoise = Math.floor(Math.random() * 3) - 1;

  const totalEta = config.baseEta + surgeEtaDiscount + fleetNoise;

  // Clamp: 2–10 min pickup window (realistic for Singapore)
  return Math.max(2, Math.min(10, totalEta));
}

// ─────────────────────────────────────────────
// SECTION 6: Core Fare Calculator
// Applies full pricing formula for a single provider
// Returns { estimatedFare, baseEtaMinutes, surgeMultiplier, breakdown }
// ─────────────────────────────────────────────

function calculateFare(providerKey, distanceKm, sgHour) {
  const config = FARE_CONFIG[providerKey];
  const surge = getSurgeMultiplier(providerKey, sgHour);

  // Distance charge: first 1km is covered by base fare, per-km kicks in after
  const chargeableKm = Math.max(0, distanceKm - 1.0);
  const distanceCharge = chargeableKm * config.perKmRate;

  // Time charge: estimated ride minutes at 25 km/h urban average
  const estimatedRideMinutes = Math.max(3, Math.round((distanceKm / 25) * 60));
  const timeCharge = estimatedRideMinutes * config.perMinRate;

  // Apply surge multiplier (booking fee is excluded from surge — it's fixed)
  const surgedFare = (config.baseFare + distanceCharge + timeCharge) * surge + config.bookingFee;

  // Enforce minimum fare floor
  const finalFare = Math.max(config.minFare, surgedFare);

  return {
    estimatedFare: parseFloat(finalFare.toFixed(2)),
    baseEtaMinutes: computeEta(providerKey, distanceKm, surge),
    rideDurationMinutes: estimatedRideMinutes,
    surgeMultiplier: surge,
    breakdown: {
      baseFare: config.baseFare,
      perKmRate: config.perKmRate,
      perMinRate: config.perMinRate,
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      chargeableKm: parseFloat(chargeableKm.toFixed(2)),
      distanceCharge: parseFloat(distanceCharge.toFixed(2)),
      estimatedRideMinutes,
      timeCharge: parseFloat(timeCharge.toFixed(2)),
      bookingFee: config.bookingFee,
      surgeMultiplier: surge,
      surgeApplied: surge > 1.0,
      subtotalBeforeSurge: parseFloat((config.baseFare + distanceCharge + timeCharge).toFixed(2)),
      subtotalAfterSurge: parseFloat(((config.baseFare + distanceCharge + timeCharge) * surge).toFixed(2)),
      minFare: config.minFare,
      minFareApplied: finalFare === config.minFare,
    },
  };
}

// ─────────────────────────────────────────────
// SECTION 7: AWS Lambda Entry Point Handler
// ─────────────────────────────────────────────

export const handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { pickupLocation, dropoffLocation, distanceKmOverride } = body;

    // Resolve distance — prefer coordinate math, fall back to LLM-extracted estimate
    let distanceKm;

    if (distanceKmOverride && typeof distanceKmOverride === 'number') {
      // Backend already computed distance via LLM extraction — use it directly
      distanceKm = distanceKmOverride;
    } else {
      const pickup = parseCoordinates(pickupLocation);
      const dropoff = parseCoordinates(dropoffLocation);

      if (pickup && dropoff) {
        distanceKm = haversineDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
      } else {
        // Place name strings with no coordinate data — use Singapore average trip distance
        distanceKm = 8.5;
      }
    }

    // Clamp distance to sensible Singapore bounds (max island crossing ~50km)
    distanceKm = Math.max(0.5, Math.min(50, distanceKm));

    // Get Singapore local hour for surge calculation (UTC+8)
    const sgHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' })).getHours();

    // Compute fares for all 5 providers
    const grab = calculateFare('grab', distanceKm, sgHour);
    const tada = calculateFare('tada', distanceKm, sgHour);
    const gojek = calculateFare('gojek', distanceKm, sgHour);
    const ryde = calculateFare('ryde', distanceKm, sgHour);
    const cdg = calculateFare('cdg', distanceKm, sgHour);

    const responsePayload = {
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      sgHour,
      grab,
      tada,
      gojek,
      ryde,
      cdg,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(responsePayload),
    };
  } catch (error) {
    console.error('OptiCab Lambda fare engine error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Fare matrix computation failed.', details: error.message }),
    };
  }
};
