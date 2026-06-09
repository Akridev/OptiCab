// opticab-backend/api/fares.js
// Multi-Provider Fare Matrix Engine (Vercel Serverless Function)
// Uses OneMap Singapore for real road distance & driving time

const FARE_CONFIG = {
  grab: {
    baseFare: 4.80,
    perKmRate: 1.20,
    perMinRate: 0.30,
    bookingFee: 2.00,
    minFare: 8.00,
    baseEta: 3,
    surgeCapMultiplier: 2.5,
  },
  tada: {
    baseFare: 4.00,
    perKmRate: 1.05,
    perMinRate: 0.28,
    bookingFee: 0.00,
    minFare: 7.00,
    baseEta: 5,
    surgeCapMultiplier: 1.8,
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
    baseFare: 3.50,
    perKmRate: 0.95,
    perMinRate: 0.25,
    bookingFee: 1.00,
    minFare: 6.50,
    baseEta: 6,
    surgeCapMultiplier: 1.6,
  },
  cdg: {
    baseFare: 4.20,
    perKmRate: 1.30,
    perMinRate: 0.33,
    bookingFee: 3.30,
    minFare: 9.00,
    baseEta: 3,
    surgeCapMultiplier: 1.5,
  },
};

// ─────────────────────────────────────────────
// OneMap Integration: Auth, Geocode, Route
// ─────────────────────────────────────────────

let cachedToken = null;
let tokenExpiry = 0;

async function getOneMapToken() {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const response = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ONEMAP_EMAIL,
      password: process.env.ONEMAP_PASSWORD,
    }),
  });
  const data = await response.json();
  cachedToken = data.access_token;
  // Token lasts 3 days, refresh after 2 days
  tokenExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

async function geocodeLocation(searchQuery, token) {
  const encoded = encodeURIComponent(searchQuery);
  const response = await fetch(
    `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encoded}&returnGeom=Y&getAddrDetails=Y&pageNum=1`,
    { headers: { Authorization: token } }
  );
  const data = await response.json();
  if (data.results && data.results.length > 0) {
    return { lat: parseFloat(data.results[0].LATITUDE), lng: parseFloat(data.results[0].LONGITUDE) };
  }
  return null;
}

async function getOneMapRoute(startLat, startLng, endLat, endLng, token) {
  const response = await fetch(
    `https://www.onemap.gov.sg/api/public/routingsvc/route?start=${startLat},${startLng}&end=${endLat},${endLng}&routeType=drive`,
    { headers: { Authorization: token } }
  );
  const data = await response.json();
  if (data.route_summary) {
    return {
      distanceKm: data.route_summary.total_distance / 1000,
      durationMinutes: Math.round(data.route_summary.total_time / 60),
    };
  }
  return null;
}

// ─────────────────────────────────────────────
// Fare Calculation Logic
// ─────────────────────────────────────────────

function parseCoordinates(locationString) {
  if (!locationString || typeof locationString !== 'string') return null;
  const parts = locationString.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

function getSurgeMultiplier(providerKey, sgHour) {
  const config = FARE_CONFIG[providerKey];
  let rawSurge = 1.0;

  if (sgHour >= 7 && sgHour < 9) rawSurge = 1.6;
  else if (sgHour >= 17 && sgHour < 20) rawSurge = 1.9;
  else if (sgHour >= 23 || sgHour < 1) rawSurge = 1.4;
  else rawSurge = 1.0;

  return Math.min(rawSurge, config.surgeCapMultiplier);
}

function computeEta(providerKey, surgeMultiplier) {
  const config = FARE_CONFIG[providerKey];
  const surgeEtaDiscount = surgeMultiplier > 1.3 ? -1 : 0;
  const fleetNoise = Math.floor(Math.random() * 3) - 1;
  const totalEta = config.baseEta + surgeEtaDiscount + fleetNoise;
  return Math.max(2, Math.min(10, totalEta));
}

function calculateFare(providerKey, distanceKm, rideDurationMinutes, sgHour) {
  const config = FARE_CONFIG[providerKey];
  const surge = getSurgeMultiplier(providerKey, sgHour);
  const chargeableKm = Math.max(0, distanceKm - 1.0);
  const distanceCharge = chargeableKm * config.perKmRate;
  const timeCharge = rideDurationMinutes * config.perMinRate;
  const surgedFare = (config.baseFare + distanceCharge + timeCharge) * surge + config.bookingFee;
  const finalFare = Math.max(config.minFare, surgedFare);

  return {
    estimatedFare: parseFloat(finalFare.toFixed(2)),
    baseEtaMinutes: computeEta(providerKey, surge),
    rideDurationMinutes,
    surgeMultiplier: surge,
    breakdown: {
      baseFare: config.baseFare,
      distanceCharge: parseFloat(distanceCharge.toFixed(2)),
      timeCharge: parseFloat(timeCharge.toFixed(2)),
      bookingFee: config.bookingFee,
      surgeApplied: surge > 1.0,
    },
  };
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const { pickupLocation, dropoffLocation, distanceKmOverride, needsLargeVehicle } = body;

    let distanceKm;
    let rideDurationMinutes;

    // Try OneMap for real road distance
    try {
      const token = await getOneMapToken();

      // Resolve coordinates
      let pickupCoords = parseCoordinates(pickupLocation);
      let dropoffCoords = parseCoordinates(dropoffLocation);

      // Geocode place names if needed
      if (!pickupCoords && pickupLocation) {
        pickupCoords = await geocodeLocation(pickupLocation, token);
      }
      if (!dropoffCoords && dropoffLocation) {
        const dropoffStr = typeof dropoffLocation === 'object' ? dropoffLocation.address || JSON.stringify(dropoffLocation) : dropoffLocation;
        dropoffCoords = await geocodeLocation(dropoffStr, token);
      }

      // Get driving route from OneMap
      if (pickupCoords && dropoffCoords) {
        const route = await getOneMapRoute(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng, token);
        if (route) {
          distanceKm = route.distanceKm;
          rideDurationMinutes = route.durationMinutes;
        }
      }
    } catch (oneMapError) {
      console.warn('OneMap fallback — using LLM estimate:', oneMapError.message);
    }

    // Fallback: use LLM-provided distance if OneMap failed
    if (!distanceKm) {
      distanceKm = distanceKmOverride && typeof distanceKmOverride === 'number' ? distanceKmOverride : 8.5;
    }
    if (!rideDurationMinutes) {
      rideDurationMinutes = Math.max(3, Math.round((distanceKm / 30) * 60)); // estimate at 30 km/h
    }

    distanceKm = Math.max(0.5, Math.min(50, distanceKm));
    rideDurationMinutes = Math.max(3, Math.min(60, rideDurationMinutes));

    const sgHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' })).getHours();

    // Large vehicle multiplier (6/7-seater MPV pricing is ~1.5x standard sedan)
    const vehicleMultiplier = needsLargeVehicle ? 1.5 : 1.0;

    const applyVehicleMultiplier = (fareResult) => ({
      ...fareResult,
      estimatedFare: parseFloat((fareResult.estimatedFare * vehicleMultiplier).toFixed(2)),
    });

    const responsePayload = {
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      rideDurationMinutes,
      sgHour,
      source: distanceKm !== distanceKmOverride ? 'onemap' : 'llm-estimate',
      grab: applyVehicleMultiplier(calculateFare('grab', distanceKm, rideDurationMinutes, sgHour)),
      tada: applyVehicleMultiplier(calculateFare('tada', distanceKm, rideDurationMinutes, sgHour)),
      gojek: applyVehicleMultiplier(calculateFare('gojek', distanceKm, rideDurationMinutes, sgHour)),
      ryde: applyVehicleMultiplier(calculateFare('ryde', distanceKm, rideDurationMinutes, sgHour)),
      cdg: applyVehicleMultiplier(calculateFare('cdg', distanceKm, rideDurationMinutes, sgHour)),
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Fare engine error:', error);
    return res.status(500).json({ error: 'Fare matrix computation failed.', details: error.message });
  }
}
