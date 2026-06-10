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
// Taxi Availability: Real-time supply data from LTA
// Used to adjust surge pricing based on actual supply/demand
// ─────────────────────────────────────────────

async function getTaxiAvailability() {
  const response = await fetch('https://api.data.gov.sg/v1/transport/taxi-availability');
  const data = await response.json();
  if (data.features && data.features.length > 0) {
    const feature = data.features[0];
    return {
      coordinates: feature.geometry?.coordinates || [], // Array of [lng, lat] pairs
      totalCount: feature.properties?.taxi_count || 0,
      timestamp: feature.properties?.timestamp || null,
    };
  }
  return { coordinates: [], totalCount: 0, timestamp: null };
}

function countTaxisNearby(taxiCoordinates, lat, lng, radiusKm = 2.0) {
  // taxiCoordinates are [lng, lat] pairs (GeoJSON format)
  let count = 0;
  for (const coord of taxiCoordinates) {
    const taxiLng = coord[0];
    const taxiLat = coord[1];
    // Quick approximate distance (good enough for Singapore's small area)
    const dLat = (taxiLat - lat) * 111; // ~111km per degree latitude
    const dLng = (taxiLng - lng) * 111 * Math.cos(lat * Math.PI / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist <= radiusKm) count++;
  }
  return count;
}

// Compute a supply factor from nearby taxi count
// Returns a value between 0.0 (no supply) and 1.5+ (oversupply)
// Baseline: ~15 taxis within 2km is "normal" supply in Singapore
function computeSupplyFactor(nearbyTaxis) {
  const BASELINE = 15;
  if (nearbyTaxis === 0) return 0.3; // Very low supply
  return Math.min(2.0, nearbyTaxis / BASELINE);
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

function getSurgeMultiplier(providerKey, sgHour, supplyFactor = 1.0) {
  const config = FARE_CONFIG[providerKey];
  let rawSurge = 1.0;

  if (sgHour >= 7 && sgHour < 9) rawSurge = 1.6;
  else if (sgHour >= 17 && sgHour < 20) rawSurge = 1.9;
  else if (sgHour >= 23 || sgHour < 1) rawSurge = 1.4;
  else rawSurge = 1.0;

  // Adjust surge based on real taxi supply data:
  // High supply (factor > 1.0) = reduce surge (drivers available, less pressure)
  // Low supply (factor < 1.0) = keep or slightly increase surge
  if (supplyFactor >= 1.2) {
    // Oversupply: significantly reduce surge (plenty of drivers around)
    rawSurge = 1.0 + (rawSurge - 1.0) * 0.4; // Cut surge effect by 60%
  } else if (supplyFactor >= 0.8) {
    // Normal supply: moderate reduction
    rawSurge = 1.0 + (rawSurge - 1.0) * 0.7; // Cut surge effect by 30%
  }
  // Low supply (< 0.8): keep raw surge as-is (time-based estimate is appropriate)

  return Math.min(rawSurge, config.surgeCapMultiplier);
}

function computeEta(providerKey, surgeMultiplier, supplyFactor = 1.0) {
  const config = FARE_CONFIG[providerKey];
  const surgeEtaDiscount = surgeMultiplier > 1.3 ? -1 : 0;
  const fleetNoise = Math.floor(Math.random() * 3) - 1;

  // Supply-based ETA adjustment:
  // High supply = faster pickup, low supply = slower pickup
  let supplyEtaAdjust = 0;
  if (supplyFactor >= 1.5) supplyEtaAdjust = -2;      // Lots of drivers nearby
  else if (supplyFactor >= 1.0) supplyEtaAdjust = -1;  // Healthy supply
  else if (supplyFactor < 0.5) supplyEtaAdjust = 2;    // Very few drivers
  else if (supplyFactor < 0.8) supplyEtaAdjust = 1;    // Below average

  const totalEta = config.baseEta + surgeEtaDiscount + fleetNoise + supplyEtaAdjust;
  return Math.max(2, Math.min(10, totalEta));
}

function calculateFare(providerKey, distanceKm, rideDurationMinutes, sgHour, supplyFactor = 1.0) {
  const config = FARE_CONFIG[providerKey];
  const surge = getSurgeMultiplier(providerKey, sgHour, supplyFactor);
  const chargeableKm = Math.max(0, distanceKm - 1.0);
  const distanceCharge = chargeableKm * config.perKmRate;
  const timeCharge = rideDurationMinutes * config.perMinRate;
  const surgedFare = (config.baseFare + distanceCharge + timeCharge) * surge + config.bookingFee;
  const finalFare = Math.max(config.minFare, surgedFare);

  return {
    estimatedFare: parseFloat(finalFare.toFixed(2)),
    baseEtaMinutes: computeEta(providerKey, surge, supplyFactor),
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
    let pickupCoords = null;

    // Fetch taxi availability in parallel with OneMap routing
    const taxiPromise = getTaxiAvailability().catch(() => ({ coordinates: [], totalCount: 0, timestamp: null }));

    // Try OneMap for real road distance
    try {
      const token = await getOneMapToken();

      // Resolve coordinates
      pickupCoords = parseCoordinates(pickupLocation);
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

    // Resolve taxi supply data
    const taxiData = await taxiPromise;
    let supplyFactor = 1.0; // Default: neutral (no data)
    let nearbyTaxis = null;

    if (pickupCoords && taxiData.coordinates.length > 0) {
      nearbyTaxis = countTaxisNearby(taxiData.coordinates, pickupCoords.lat, pickupCoords.lng, 2.0);
      supplyFactor = computeSupplyFactor(nearbyTaxis);
    }

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
      supplyData: {
        nearbyTaxis,
        totalAvailable: taxiData.totalCount,
        supplyFactor: parseFloat(supplyFactor.toFixed(2)),
        timestamp: taxiData.timestamp,
      },
      grab: applyVehicleMultiplier(calculateFare('grab', distanceKm, rideDurationMinutes, sgHour, supplyFactor)),
      tada: applyVehicleMultiplier(calculateFare('tada', distanceKm, rideDurationMinutes, sgHour, supplyFactor)),
      gojek: applyVehicleMultiplier(calculateFare('gojek', distanceKm, rideDurationMinutes, sgHour, supplyFactor)),
      ryde: applyVehicleMultiplier(calculateFare('ryde', distanceKm, rideDurationMinutes, sgHour, supplyFactor)),
      cdg: applyVehicleMultiplier(calculateFare('cdg', distanceKm, rideDurationMinutes, sgHour, supplyFactor)),
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Fare engine error:', error);
    return res.status(500).json({ error: 'Fare matrix computation failed.', details: error.message });
  }
}
