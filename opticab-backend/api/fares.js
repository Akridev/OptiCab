// opticab-backend/api/fares.js
// Multi-Provider Fare Matrix Engine (Vercel Serverless Function)
// Simulates real-time pricing across 5 Singapore ride-hailing platforms

const FARE_CONFIG = {
  grab: {
    baseFare: 3.00,
    perKmRate: 0.55,
    perMinRate: 0.22,
    bookingFee: 1.00,
    minFare: 5.00,
    baseEta: 4,
    surgeCapMultiplier: 3.0,
  },
  tada: {
    baseFare: 2.80,
    perKmRate: 0.50,
    perMinRate: 0.20,
    bookingFee: 0.00,
    minFare: 4.50,
    baseEta: 6,
    surgeCapMultiplier: 2.0,
  },
  gojek: {
    baseFare: 2.90,
    perKmRate: 0.52,
    perMinRate: 0.21,
    bookingFee: 0.80,
    minFare: 4.80,
    baseEta: 5,
    surgeCapMultiplier: 2.5,
  },
  ryde: {
    baseFare: 2.60,
    perKmRate: 0.45,
    perMinRate: 0.19,
    bookingFee: 0.50,
    minFare: 4.00,
    baseEta: 7,
    surgeCapMultiplier: 1.8,
  },
  cdg: {
    baseFare: 3.20,
    perKmRate: 0.60,
    perMinRate: 0.25,
    bookingFee: 2.30,
    minFare: 5.50,
    baseEta: 5,
    surgeCapMultiplier: 1.5,
  },
};

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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

function computeEta(providerKey, distanceKm, surgeMultiplier) {
  const config = FARE_CONFIG[providerKey];
  const surgeEtaDiscount = surgeMultiplier > 1.3 ? -1 : 0;
  const rideDurationMinutes = Math.round((distanceKm / 25) * 60);
  const fleetNoise = Math.floor(Math.random() * 5) - 2;
  const totalEta = config.baseEta + surgeEtaDiscount + fleetNoise + rideDurationMinutes;
  return Math.max(2, Math.min(25, totalEta));
}

function calculateFare(providerKey, distanceKm, sgHour) {
  const config = FARE_CONFIG[providerKey];
  const surge = getSurgeMultiplier(providerKey, sgHour);
  const chargeableKm = Math.max(0, distanceKm - 1.0);
  const distanceCharge = chargeableKm * config.perKmRate;
  const estimatedRideMinutes = Math.max(3, Math.round((distanceKm / 25) * 60));
  const timeCharge = estimatedRideMinutes * config.perMinRate;
  const surgedFare = (config.baseFare + distanceCharge + timeCharge) * surge + config.bookingFee;
  const finalFare = Math.max(config.minFare, surgedFare);

  return {
    estimatedFare: parseFloat(finalFare.toFixed(2)),
    baseEtaMinutes: computeEta(providerKey, distanceKm, surge),
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const { pickupLocation, dropoffLocation, distanceKmOverride } = body;

    let distanceKm;
    if (distanceKmOverride && typeof distanceKmOverride === 'number') {
      distanceKm = distanceKmOverride;
    } else {
      const pickup = parseCoordinates(pickupLocation);
      const dropoff = parseCoordinates(dropoffLocation);
      if (pickup && dropoff) {
        distanceKm = haversineDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
      } else {
        distanceKm = 8.5;
      }
    }

    distanceKm = Math.max(0.5, Math.min(50, distanceKm));
    const sgHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' })).getHours();

    const responsePayload = {
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      sgHour,
      grab: calculateFare('grab', distanceKm, sgHour),
      tada: calculateFare('tada', distanceKm, sgHour),
      gojek: calculateFare('gojek', distanceKm, sgHour),
      ryde: calculateFare('ryde', distanceKm, sgHour),
      cdg: calculateFare('cdg', distanceKm, sgHour),
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Fare engine error:', error);
    return res.status(500).json({ error: 'Fare matrix computation failed.', details: error.message });
  }
}
