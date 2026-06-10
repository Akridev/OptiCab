// opticab-lambda/index.js
// AWS Lambda — Multi-Provider Fare Matrix Engine
// Simulates real-time pricing across 5 Singapore ride-hailing platforms
// Invoked by: opticab-backend/api/recommendation.js via AWS_LAMBDA_FARES_ENDPOINT

// ─────────────────────────────────────────────
// SECTION 1: Singapore Provider Fare Structures
// Based on publicly available 2024/2025 fare schedules
// ─────────────────────────────────────────────
const PROVIDER_BEHAVIOUR = {
  grab: {
    surgeBias: 1.15,
    calibration: 1.02,
    offPeakDiscount: 0.95,
  },
  tada: {
    surgeBias: 0.95,
    calibration: 0.95,
    offPeakDiscount: 0.98,
  },
  gojek: {
    surgeBias: 1.05,
    calibration: 0.98,
    offPeakDiscount: 0.97,
  },
  ryde: {
    surgeBias: 0.90,
    calibration: 0.95,
    offPeakDiscount: 0.99,
  },
  cdg: {
    surgeBias: 0.85,
    calibration: 0.96,
    offPeakDiscount: 1.00,
  },
};
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
    baseFare: 4.20,
    perKmRate: 1.10,
    perMinRate: 0.28,
    bookingFee: 1.20,
    minFare: 7.50,
    baseEta: 4,
    surgeCapMultiplier: 2.2,
  },
  ryde: {
    baseFare: 3.80,       // Budget-positioned, lowest base in market
    perKmRate: 0.95,
    perMinRate: 0.25,
    bookingFee: 0.80,
    minFare: 6.50,
    baseEta: 6,           // Smallest fleet, highest ETA variance
    surgeCapMultiplier: 1.6,
  },
  cdg: {
    baseFare: 4.60,       // ComfortDelGro — premium metered-taxi heritage pricing
    perKmRate: 1.15,
    perMinRate: 0.33,
    bookingFee: 1.50,     // CDG charges a higher booking fee via app
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
  const behaviour = PROVIDER_BEHAVIOUR[providerKey];

  let surge = 1.0;

  // Morning rush
  if (sgHour >= 7 && sgHour < 9) {
    surge = 1.35;
  }

  // Lunch
  else if (sgHour >= 12 && sgHour < 14) {
    surge = 1.10;
  }

  // Evening peak
  else if (sgHour >= 17 && sgHour < 20) {
    surge = 1.60;
  }

  // Late night
  else if (sgHour >= 23 || sgHour < 1) {
    surge = 1.25;
  }

  // Off peak
  else {
    surge = behaviour.offPeakDiscount;
  }

  surge *= behaviour.surgeBias;

  return Math.min(
    parseFloat(surge.toFixed(2)),
    config.surgeCapMultiplier
  );
}

// ─────────────────────────────────────────────
// SECTION 5: ETA Variance Model
// Adds realistic randomness (+/- fleet density noise) to ETAs
// Prevents all providers returning identical wait times
// ─────────────────────────────────────────────

function computeEta(providerKey, distanceKm, surgeMultiplier) {
  const config = FARE_CONFIG[providerKey];

  let eta = config.baseEta;

  if (distanceKm > 10)
    eta += 1;

  if (distanceKm > 20)
    eta += 1;

  if (surgeMultiplier > 1.4)
    eta -= 1;

  return Math.max(2, Math.min(10, eta));
}

// ─────────────────────────────────────────────
// SECTION 6: Core Fare Calculator
// Applies full pricing formula for a single provider
// Returns { estimatedFare, baseEtaMinutes, surgeMultiplier, breakdown }
// ─────────────────────────────────────────────

function calculateFare(providerKey, distanceKm, sgHour) {
  const config = FARE_CONFIG[providerKey];
  const behaviour = PROVIDER_BEHAVIOUR[providerKey];

  const surge = getSurgeMultiplier(providerKey, sgHour);

  const chargeableKm = Math.max(0, distanceKm - 1);

  const distanceCharge =
    chargeableKm * config.perKmRate;

let averageSpeed = 30;

if (sgHour >= 7 && sgHour < 9)
  averageSpeed = 24;
else if (sgHour >= 17 && sgHour < 20)
  averageSpeed = 22;
else if (sgHour >= 23 || sgHour < 1)
  averageSpeed = 32;

const estimatedRideMinutes =
  Math.max(
    4,
    Math.round((distanceKm / averageSpeed) * 60)
  );

  const timeCharge =
    estimatedRideMinutes * config.perMinRate;

  let subtotal =
    config.baseFare +
    distanceCharge +
    timeCharge;

  if(providerKey === "cdg"){
    subtotal *= (1 + ((surge - 1) * 0.5));
}
else{
    subtotal *= surge;
}

  subtotal += config.bookingFee;

  // Long trip adjustment
  if (distanceKm > 20)
    subtotal *= 1.05;

  if (distanceKm > 30)
    subtotal *= 1.08;

  // Short trip premium
  if (distanceKm < 3)
    subtotal += 1.5;

  // Weekend evenings behave differently
  const day = new Date(
    new Date().toLocaleString(
      "en-US",
      { timeZone: "Asia/Singapore" }
    )
  ).getDay();

  const isWeekend =
    day === 0 || day === 6;

if (
  isWeekend &&
  sgHour >= 18 &&
  sgHour <= 23
) {

  if (providerKey === "grab")
    subtotal *= 1.15;

  else if (providerKey === "gojek")
    subtotal *= 1.10;

  else if (providerKey === "tada")
    subtotal *= 1.05;

  else if (providerKey === "ryde")
    subtotal *= 1.07;

  else
    subtotal *= 1.02;
}
  // Calibration
  subtotal *= behaviour.calibration;
  // Off-peak promotion simulation
if (
  providerKey === "grab" &&
  sgHour >= 10 &&
  sgHour < 16
) {
  subtotal *= 0.96;
}
if (
  providerKey === "grab" &&
  sgHour >= 20 &&
  sgHour < 23
) {
  subtotal *= 0.98;
}
if (
  providerKey === "tada" &&
  distanceKm > 20
) {
  subtotal *= 1.03;
}

  const finalFare =
    Math.max(
      config.minFare,
      subtotal
    );

  return {
    estimatedFare: parseFloat(
      finalFare.toFixed(2)
    ),
    baseEtaMinutes: computeEta(
      providerKey,
      distanceKm,
      surge
    ),
    rideDurationMinutes:
      estimatedRideMinutes,
    surgeMultiplier: surge,
    breakdown: {
      baseFare: config.baseFare,
      distanceCharge: parseFloat(
        distanceCharge.toFixed(2)
      ),
      timeCharge: parseFloat(
        timeCharge.toFixed(2)
      ),
      bookingFee: config.bookingFee,
      surgeApplied: surge > 1.0,
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
