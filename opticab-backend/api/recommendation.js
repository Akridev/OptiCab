// opticab-backend/api/recommendation.js
import Exa from 'exa-js';
import { generateText } from 'ai';
import { groq } from '@ai-sdk/groq';

const exa = new Exa(process.env.EXA_API_KEY);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Exa: Multi-layer unstructured intelligence
// Domain-pinpointed, fast mode, 4-hour temporal constraint
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getExaTransportAlerts(dropoffName) {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  // Layer 1: Real-time driver behavior & social scraping
  const socialPromise = exa.search(
    `Singapore drivers reporting active congestion or ride app surge issues near ${dropoffName} right now`,
    {
      type: "keyword",
      numResults: 2,
      startPublishedDate: fourHoursAgo,
      includeDomains: ["x.com", "reddit.com", "hardwarezone.com.sg"],
      contents: { highlights: true },
    }
  ).catch(() => ({ results: [] }));

  // Layer 2: MRT/train disruptions
  const mrtPromise = exa.search(
    `SMRT SBS transit train service disruption delay breakdown Singapore`,
    {
      type: "keyword",
      numResults: 2,
      startPublishedDate: fourHoursAgo,
      includeDomains: ["channelnewsasia.com", "straitstimes.com", "mothership.sg", "lta.gov.sg"],
      contents: { highlights: true },
    }
  ).catch(() => ({ results: [] }));

  // Layer 3: Event/concert surge prediction
  const todayStr = new Date().toISOString().split('T')[0];
  const eventPromise = exa.search(
    `Major events concerts conventions ending today ${todayStr} Singapore National Stadium Expo Marina Bay Sands`,
    {
      type: "keyword",
      numResults: 2,
      startPublishedDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      includeDomains: ["channelnewsasia.com", "straitstimes.com", "mothership.sg", "timeout.com"],
      contents: { highlights: true },
    }
  ).catch(() => ({ results: [] }));

  const [socialResults, mrtResults, eventResults] = await Promise.all([socialPromise, mrtPromise, eventPromise]);

  return { socialResults, mrtResults, eventResults };
}

// Layer 4: Building-specific drop-off intelligence
async function getDropoffIntel(dropoffName) {
  const result = await exa.search(
    `Best pickup point lobby drop-off advice taxi drivers at ${dropoffName} Singapore`,
    {
      type: "keyword",
      numResults: 1,
      includeDomains: ["reddit.com", "hardwarezone.com.sg", "tripadvisor.com"],
      contents: { highlights: true },
    }
  ).catch(() => ({ results: [] }));
  return result;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LTA DataMall: Real-time traffic incidents
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getLtaTrafficIncidents() {
  const response = await fetch('http://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents', {
    headers: {
      AccountKey: process.env.LTA_ACCOUNT_KEY,
      accept: 'application/json',
    },
  });
  const data = await response.json();
  return data.value || [];
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NEA: Real-time 2-hour weather nowcast (data.gov.sg)
// No API key needed â€” free public endpoint
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getCurrentWeather() {
  const response = await fetch('https://api.data.gov.sg/v1/environment/2-hour-weather-forecast');
  const data = await response.json();
  if (data.items && data.items.length > 0) {
    return data.items[0].forecasts || []; // Array of { area, forecast }
  }
  return [];
}

function isRainingNearArea(forecasts, dropoffName) {
  // Check if any forecast area matches or contains the dropoff name, and has rain
  const rainKeywords = /rain|shower|thunder|storm/i;
  const dropoffLower = (typeof dropoffName === 'string' ? dropoffName : '').toLowerCase();

  for (const f of forecasts) {
    const areaLower = f.area.toLowerCase();
    // Check if the area name overlaps with the dropoff (fuzzy match)
    const isNearby = dropoffLower.includes(areaLower) || areaLower.includes(dropoffLower) ||
      dropoffLower.split(' ').some(word => word.length > 3 && areaLower.includes(word));

    if (isNearby && rainKeywords.test(f.forecast)) {
      return true;
    }
  }

  // Also check if it's raining across most of Singapore (widespread rain)
  const rainyAreas = forecasts.filter(f => rainKeywords.test(f.forecast));
  if (rainyAreas.length >= forecasts.length * 0.5) {
    return true; // More than half of Singapore has rain
  }

  return false;
}

// Check if any incident is near a coordinate (within radiusKm)
function findIncidentsNearRoute(incidents, lat, lng, radiusKm = 1.0) {
  return incidents.filter((incident) => {
    const dLat = incident.Latitude - lat;
    const dLng = incident.Longitude - lng;
    // Quick approximate distance (works fine for Singapore's small area)
    const distKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
    return distKm <= radiusKm;
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OneMap Postal Code Resolution
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function resolvePostalCode(postalCode) {
  // OneMap Search API resolves Singapore postal codes to addresses + coordinates
  const response = await fetch(
    `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postalCode}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
  );
  const data = await response.json();
  if (data.results && data.results.length > 0) {
    const result = data.results[0];
    // OneMap returns "NIL" as a string when no building name exists â€” treat as empty
    const building = (result.BUILDING && result.BUILDING !== 'NIL') ? result.BUILDING : '';
    return {
      address: result.ADDRESS,
      buildingName: building,
      lat: parseFloat(result.LATITUDE),
      lng: parseFloat(result.LONGITUDE),
    };
  }
  return null;
}

// Extract 6-digit postal codes from text
function extractPostalCodes(text) {
  const matches = text.match(/\b\d{6}\b/g);
  return matches || [];
}

// Sanitize display names â€” never show "NIL", "null", or empty strings
function sanitizeDisplayName(name, fallback = 'Unknown location') {
  if (!name) return fallback;
  const str = typeof name === 'string' ? name.trim() : String(name).trim();
  if (!str || /^(nil|null|undefined|unknown)$/i.test(str)) return fallback;
  // Remove leading "NIL, " or trailing ", NIL" fragments
  return str.replace(/\bNIL\b,?\s*/gi, '').replace(/,?\s*\bNIL\b/gi, '').trim() || fallback;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OneMap Routing: Actual driving distance & duration
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let cachedToken = null;
let tokenExpiry = 0;

async function getOneMapToken() {
  // Reuse token if still valid (tokens last 3 days, we refresh after 2)
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const tokenRes = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ONEMAP_EMAIL, password: process.env.ONEMAP_PASSWORD }),
  });
  const tokenData = await tokenRes.json();
  cachedToken = tokenData.access_token;
  // Refresh after 2 days (token valid for 3)
  tokenExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

async function getDrivingDistance(startLat, startLng, endLat, endLng) {
  // OneMap Routing API â€” returns actual road distance and estimated drive time
  const token = await getOneMapToken();
  const url = `https://www.onemap.gov.sg/api/public/routingsvc/route?start=${startLat},${startLng}&end=${endLat},${endLng}&routeType=drive`;
  const response = await fetch(url, {
    headers: { Authorization: token },
  });
  const data = await response.json();

  if (data.route_summary) {
    return {
      distanceKm: parseFloat((data.route_summary.total_distance / 1000).toFixed(2)),
      durationMin: Math.round(data.route_summary.total_time / 60),
    };
  }
  return null; // Routing failed â€” caller should fall back
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Main Handler (Optimized: parallel execution)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { userPrompt, currentGpsLocation, allowedApps } = body;
  const activePlatforms = allowedApps || ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];

  if (!userPrompt || !userPrompt.trim()) {
    return res.status(200).json({ isInvalidInput: true, message: "Please enter a valid destination!" });
  }

  try {
    // â•â•â• PHASE 1: Guard LLM + Postal Resolution in PARALLEL â•â•â•
    const postalCodes = extractPostalCodes(userPrompt);

    const guardPromise = generateText({
      model: groq('llama-3.1-8b-instant'),
      system: `You are the safety gatekeeper for OptiCab Singapore. Analyze the user prompt. 
               Determine if the input is a genuine request to travel somewhere, catch a ride, or navigate to a destination.
               IMPORTANT: Singapore postal codes (6-digit numbers like 238801, 018956, 540123) ARE valid travel destinations. Treat them as VALID.
               Street names, building names, MRT station names, and area names are all VALID travel requests.
               Only return "INVALID" if the input is completely unrelated to travel (e.g., math questions, cooking recipes, general chit-chat, nonsense).
               Return exactly: "VALID" or "INVALID".`,
      prompt: `User Prompt: "${userPrompt}"`,
    });

    // All postal codes resolve in parallel (was sequential for-loop)
    const postalPromises = postalCodes.map(code =>
      resolvePostalCode(code).then(resolved => ({ code, resolved }))
    );

    const [guardResult, ...postalResults] = await Promise.all([guardPromise, ...postalPromises]);

    // Check guard â€” abort early if invalid
    if (guardResult.text.trim() === 'INVALID') {
      return res.status(200).json({
        isInvalidInput: true,
        message: "\uD83E\uDD16 OptiCab Assistant: I can only help with travel and transport planning in Singapore. Please enter a destination or a ride request!"
      });
    }

    // Build enriched prompt from resolved postals
    let enrichedPrompt = userPrompt;
    const resolvedPostals = {};
    for (const { code, resolved } of postalResults) {
      if (resolved) {
        resolvedPostals[code] = resolved;
        const label = resolved.buildingName
          ? `${resolved.buildingName}, ${resolved.address}`
          : resolved.address;
        enrichedPrompt = enrichedPrompt.replace(code, label);
      }
    }

    // â•â•â• PHASE 2: Route Parsing LLM (needs enriched prompt from Phase 1) â•â•â•
    const { text: llmOutput } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: `You are the brain of OptiCab Singapore. Analyze the user's prompt and current location context.
               IMPORTANT: Think beyond what the user literally typed. Consider what they ACTUALLY need to save money and stay safe.
               For example: a child aged 8+ does NOT need a child seat by Singapore law \u2014 don't flag it. A "kid" without an age should be assumed young (needs a seat). Always optimize for the cheapest safe option.
               
               Extract the following information:
               - "pickup": ONLY set this if the user EXPLICITLY indicates a starting location using words like "from", or uses a "X to Y" pattern where X is clearly a different location from Y. If the user just states a single destination (even with passenger info), set pickup to null. The system will use their GPS location.
               - "dropoff": the destination name or address (the "to" location, or the only location if just one is given)
               - "distanceKm": estimated distance in km between pickup and dropoff. If user provides explicit pickup, estimate from that location to dropoff. Otherwise estimate from the GPS coordinates to dropoff.
               - "passengers": number of passengers (default 1 if not mentioned). Count adults + children + babies.
               - "needsBabySeat": true if user mentions baby, infant, toddler, child, kid, or any child aged 7 or below (default false). If all children mentioned are aged 8 or above, set this to false \u2014 they do not need a child seat.
               - "needsLargeVehicle": true if passengers > 4 or user mentions 6-seater, 7-seater, large vehicle, MPV, van (default false)
               - "childAges": array of integers representing the ages of each child/baby/infant/toddler mentioned. Use context clues: "baby" = 1, "infant" = 0, "toddler" = 2. If user says "4 year old" put [4]. If "1 baby and 1 4 year old" put [1, 4]. If no children mentioned, return empty array [].
               Return ONLY a valid raw JSON object. Do not wrap in markdown boxes.`,
      prompt: `Current Location Context (GPS): ${currentGpsLocation}. User Request: "${enrichedPrompt}"`,
    });

    const parsedContext = JSON.parse(llmOutput.trim());
    let targetDistance = parseFloat(parsedContext.distanceKm);
    const passengers = parseInt(parsedContext.passengers) || 1;
    const needsBabySeat = parsedContext.needsBabySeat === true;
    const needsLargeVehicle = parsedContext.needsLargeVehicle === true || passengers > 4;
    const childAges = Array.isArray(parsedContext.childAges) ? parsedContext.childAges.filter(a => typeof a === 'number') : [];
    const resolvedPickup = parsedContext.pickup || currentGpsLocation;

    // Smart child seat tier logic
    let childSeatTier = 'none';
    if (needsBabySeat) {
      if (childAges.length === 0) {
        childSeatTier = 'age1to7';
      } else {
        const youngestChild = Math.min(...childAges);
        if (youngestChild >= 8) childSeatTier = 'none';
        else if (youngestChild >= 4) childSeatTier = 'age4to7';
        else childSeatTier = 'age1to7';
      }
    }
    const effectiveNeedsBabySeat = childSeatTier !== 'none';

    // â•â•â• PHASE 3: Dropoff Verify + Reverse Geocode + Driving Distance in PARALLEL â•â•â•
    // Resolve coordinates (sync from already-resolved postal data)
    let pickupLat = null, pickupLng = null;
    if (/^\d+\.\d+,\s*\d+\.\d+$/.test(resolvedPickup)) {
      [pickupLat, pickupLng] = resolvedPickup.split(',').map(s => parseFloat(s.trim()));
    } else if (postalCodes.length >= 1 && resolvedPostals[postalCodes[0]] && parsedContext.pickup) {
      pickupLat = resolvedPostals[postalCodes[0]].lat;
      pickupLng = resolvedPostals[postalCodes[0]].lng;
    }

    let dropoffLat = null, dropoffLng = null;
    if (postalCodes.length >= 2 && resolvedPostals[postalCodes[1]]) {
      dropoffLat = resolvedPostals[postalCodes[1]].lat;
      dropoffLng = resolvedPostals[postalCodes[1]].lng;
    } else if (postalCodes.length === 1 && !parsedContext.pickup && resolvedPostals[postalCodes[0]]) {
      dropoffLat = resolvedPostals[postalCodes[0]].lat;
      dropoffLng = resolvedPostals[postalCodes[0]].lng;
    }

    // Pre-set display names from postal codes (no network needed)
    let dropoffDisplay = parsedContext.dropoff;
    let pickupDisplayName = resolvedPickup;

    if (postalCodes.length >= 2 && resolvedPostals[postalCodes[1]]) {
      const r = resolvedPostals[postalCodes[1]];
      dropoffDisplay = r.buildingName ? `${r.buildingName}, ${r.address}` : r.address;
    } else if (postalCodes.length === 1 && !parsedContext.pickup && resolvedPostals[postalCodes[0]]) {
      const r = resolvedPostals[postalCodes[0]];
      dropoffDisplay = r.buildingName ? `${r.buildingName}, ${r.address}` : r.address;
    }
    if (postalCodes.length >= 1 && parsedContext.pickup && resolvedPostals[postalCodes[0]]) {
      const r = resolvedPostals[postalCodes[0]];
      pickupDisplayName = r.buildingName ? `${r.buildingName}, ${r.address}` : r.address;
    }

    // Task A: Verify dropoff via OneMap (only if not already resolved from postal code)
    const needsDropoffLookup = !dropoffLat;
    const dropoffVerifyPromise = needsDropoffLookup ? (async () => {
      try {
        const q = typeof parsedContext.dropoff === 'string' ? parsedContext.dropoff : parsedContext.dropoff?.address || '';
        if (q) {
          const res = await fetch(`https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`);
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const top = data.results[0];
            const bld = top.BUILDING && top.BUILDING !== 'NIL' ? `${top.BUILDING}, ` : '';
            dropoffDisplay = `${bld}${top.ADDRESS}`;
            dropoffLat = parseFloat(top.LATITUDE);
            dropoffLng = parseFloat(top.LONGITUDE);
          }
        }
      } catch { /* keep LLM interpretation */ }
    })() : Promise.resolve();

    // Task B: Reverse geocode pickup (only if raw GPS coordinates)
    const reverseGeocodePromise = /^\d+\.\d+,\s*\d+\.\d+$/.test(resolvedPickup) ? (async () => {
      try {
        const [lat, lng] = resolvedPickup.split(',').map(s => s.trim());
        const token = await getOneMapToken();
        const res = await fetch(
          `https://www.onemap.gov.sg/api/public/revgeocode?location=${lat},${lng}&buffer=100&addressType=All`,
          { headers: { Authorization: token } }
        );
        const data = await res.json();
        if (data.GeocodeInfo && data.GeocodeInfo.length > 0) {
          const info = data.GeocodeInfo[0];
          const building = info.BUILDINGNAME && info.BUILDINGNAME !== 'NIL' ? info.BUILDINGNAME : '';
          const road = info.ROAD && info.ROAD !== 'NIL' ? info.ROAD : '';
          const block = info.BLOCK && info.BLOCK !== 'NIL' ? info.BLOCK : '';
          if (building && road) pickupDisplayName = `${building}, ${road}`;
          else if (block && road) pickupDisplayName = `${block} ${road}`;
          else if (road) pickupDisplayName = road;
        }
      } catch { /* keep coordinates */ }
    })() : Promise.resolve();

    // Run A + B in parallel
    await Promise.all([dropoffVerifyPromise, reverseGeocodePromise]);

    // Now compute driving distance (needs both coords â€” dropoff may have just been resolved)
    let rideDurationFromRouting = null;
    if (pickupLat && pickupLng && dropoffLat && dropoffLng) {
      try {
        const routeResult = await getDrivingDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
        if (routeResult) {
          targetDistance = routeResult.distanceKm;
          rideDurationFromRouting = routeResult.durationMin;
        }
      } catch { /* fall back to LLM estimate */ }
    }

    // â•â•â• PHASE 4: Fares + LTA + Weather + Exa (already parallel) â•â•â•
    const faresPromise = fetch('https://opticab-backend.vercel.app/api/fares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupLocation: resolvedPickup,
        dropoffLocation: parsedContext.dropoff,
        distanceKmOverride: targetDistance,
        needsLargeVehicle,
      }),
    }).then(r => r.json());

    const ltaPromise = getLtaTrafficIncidents().catch(() => []);
    const weatherPromise = getCurrentWeather().catch(() => []);
    const exaPromise = getExaTransportAlerts(
      typeof parsedContext.dropoff === 'string' ? parsedContext.dropoff : ''
    ).catch(() => ({ socialResults: { results: [] }, mrtResults: { results: [] }, eventResults: { results: [] } }));
    const dropoffIntelPromise = getDropoffIntel(
      typeof parsedContext.dropoff === 'string' ? parsedContext.dropoff : ''
    ).catch(() => ({ results: [] }));

    const [fareMatrix, ltaIncidents, weatherForecasts, exaLayers, dropoffIntel] = await Promise.all([
      faresPromise, ltaPromise, weatherPromise, exaPromise, dropoffIntelPromise
    ]);

    // â•â•â• PHASE 5: Analysis & Response â•â•â•
    const pickupCoords = (pickupLat && pickupLng) ? { lat: pickupLat, lng: pickupLng } : null;
    let routeIncidents = [];
    if (pickupCoords) {
      routeIncidents = findIncidentsNearRoute(ltaIncidents, pickupCoords.lat, pickupCoords.lng, 1.5);
    }

    const hasAccident = routeIncidents.some(i => /accident|collision/i.test(i.Type));
    const hasRoadWork = routeIncidents.some(i => /road work|roadwork/i.test(i.Type));
    const hasHeavyTraffic = routeIncidents.some(i => /heavy traffic|congestion/i.test(i.Type));
    const hasBreakdown = routeIncidents.some(i => /breakdown|stalled/i.test(i.Type));
    const isTrafficDisrupted = hasAccident || hasHeavyTraffic || hasBreakdown;

    const dropoffStr = typeof parsedContext.dropoff === 'string' ? parsedContext.dropoff : '';
    const isRaining = isRainingNearArea(weatherForecasts, dropoffStr);

    // Walkable Intervention Layer
    if (targetDistance <= 1.2 && !isRaining && !needsLargeVehicle && !needsBabySeat) {
      const walkTime = Math.round(targetDistance * 12);
      const carOptions = [];
      if (activePlatforms.includes('Grab')) carOptions.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.grab.rideDurationMinutes, carType: 'JustGrab 4-Seater' });
      if (activePlatforms.includes('TADA')) carOptions.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.tada.rideDurationMinutes, carType: 'TADA Standard 4-Seater' });
      if (activePlatforms.includes('Gojek')) carOptions.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.gojek.rideDurationMinutes, carType: 'GoCar 4-Seater' });
      if (activePlatforms.includes('Ryde')) carOptions.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.ryde.rideDurationMinutes, carType: 'RydeX 4-Seater' });
      if (activePlatforms.includes('ComfortDelGro')) carOptions.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.cdg.rideDurationMinutes, carType: 'ComfortRIDE 4-Seater' });
      const sortedFastestCar = carOptions.sort((a, b) => a.eta - b.eta)[0];
      return res.status(200).json({
        isInvalidInput: false,
        extractedRoute: { pickup: sanitizeDisplayName(pickupDisplayName), dropoff: sanitizeDisplayName(dropoffDisplay) },
        cheapest: { provider: 'Walk (Healthy Option)', price: 0.00, eta: 0, rideDuration: walkTime },
        fastest: sortedFastestCar,
        alerts: ["\uD83D\uDCA1 OptiCab Agent Note: Your destination is walkable and weather conditions are clear. Walk to save money!"],
      });
    }

    // Standard Multi-App Flow
    const PROVIDER_FEATURES = {
      Grab: { largeVehicle: true, babySeat: true },
      TADA: { largeVehicle: false, babySeat: false },
      Gojek: { largeVehicle: false, babySeat: false },
      Ryde: { largeVehicle: false, babySeat: false },
      ComfortDelGro: { largeVehicle: true, babySeat: true },
    };

    const CAR_TYPES = {
      Grab: { standard: 'JustGrab 4-Seater', babySeat_age1to7: 'GrabFamily 4-Seater (Child Seat, Age 1\u20133)', babySeat_age4to7: 'GrabFamily 4-Seater (Child Seat, Age 4\u20137)', largeVehicle: 'Grab 6-Seater', largeBaby_age1to7: 'GrabFamily 6-Seater (Child Seat, Age 1\u20133)', largeBaby_age4to7: 'GrabFamily 6-Seater (Child Seat, Age 4\u20137)' },
      TADA: { standard: 'TADA Standard 4-Seater', babySeat_age1to7: 'TADA Standard 4-Seater', babySeat_age4to7: 'TADA Standard 4-Seater', largeVehicle: 'TADA Standard 4-Seater', largeBaby_age1to7: 'TADA Standard 4-Seater', largeBaby_age4to7: 'TADA Standard 4-Seater' },
      Gojek: { standard: 'GoCar 4-Seater', babySeat_age1to7: 'GoCar 4-Seater', babySeat_age4to7: 'GoCar 4-Seater', largeVehicle: 'GoCar 4-Seater', largeBaby_age1to7: 'GoCar 4-Seater', largeBaby_age4to7: 'GoCar 4-Seater' },
      Ryde: { standard: 'RydeX 4-Seater', babySeat_age1to7: 'RydeX 4-Seater', babySeat_age4to7: 'RydeX 4-Seater', largeVehicle: 'RydeX 4-Seater', largeBaby_age1to7: 'RydeX 4-Seater', largeBaby_age4to7: 'RydeX 4-Seater' },
      ComfortDelGro: { standard: 'ComfortRIDE 4-Seater', babySeat_age1to7: 'ComfortRIDE Family (Child Seat, Age 1\u20133)', babySeat_age4to7: 'ComfortRIDE Family (Child Seat, Age 4\u20137)', largeVehicle: 'ComfortRIDE 6-Seater', largeBaby_age1to7: 'ComfortRIDE Family 6-Seater (Child Seat, Age 1\u20133)', largeBaby_age4to7: 'ComfortRIDE Family 6-Seater (Child Seat, Age 4\u20137)' },
    };

    function getCarType(provider) {
      const types = CAR_TYPES[provider];
      if (!types) return 'Standard 4-Seater';
      if (effectiveNeedsBabySeat && needsLargeVehicle) return childSeatTier === 'age4to7' ? types.largeBaby_age4to7 : types.largeBaby_age1to7;
      if (effectiveNeedsBabySeat) return childSeatTier === 'age4to7' ? types.babySeat_age4to7 : types.babySeat_age1to7;
      if (needsLargeVehicle) return types.largeVehicle;
      return types.standard;
    }

    let optionsPool = [];
    if (activePlatforms.includes('Grab')) optionsPool.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.grab.rideDurationMinutes, carType: getCarType('Grab') });
    if (activePlatforms.includes('TADA')) optionsPool.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.tada.rideDurationMinutes, carType: getCarType('TADA') });
    if (activePlatforms.includes('Gojek')) optionsPool.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.gojek.rideDurationMinutes, carType: getCarType('Gojek') });
    if (activePlatforms.includes('Ryde')) optionsPool.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.ryde.rideDurationMinutes, carType: getCarType('Ryde') });
    if (activePlatforms.includes('ComfortDelGro')) optionsPool.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: rideDurationFromRouting || fareMatrix.cdg.rideDurationMinutes, carType: getCarType('ComfortDelGro') });

    if (effectiveNeedsBabySeat) optionsPool = optionsPool.filter(opt => PROVIDER_FEATURES[opt.provider]?.babySeat);
    if (needsLargeVehicle) optionsPool = optionsPool.filter(opt => PROVIDER_FEATURES[opt.provider]?.largeVehicle);

    if (optionsPool.length === 0) {
      return res.status(200).json({ isInvalidInput: true, message: "\uD83E\uDD16 No providers available for your requirements. Try enabling Grab or ComfortDelGro \u2014 they support baby seats and large vehicles." });
    }

    // Apply traffic + weather delays
    if (isTrafficDisrupted) { const d = hasAccident ? 10 : 5; optionsPool.forEach(opt => { opt.eta += Math.round(d * 0.5); opt.rideDuration += d; }); }
    if (isRaining) { optionsPool.forEach(opt => { opt.eta += 3; opt.rideDuration += 4; }); }

    // Exa intelligence analysis
    const socialHighlights = exaLayers.socialResults?.results?.flatMap(r => r.highlights) || [];
    const mrtHighlights = exaLayers.mrtResults?.results?.flatMap(r => r.highlights) || [];
    const eventHighlights = exaLayers.eventResults?.results?.flatMap(r => r.highlights) || [];
    const dropoffTips = dropoffIntel?.results?.flatMap(r => r.highlights) || [];

    const hasMrtDisruption = mrtHighlights.some(h => /disruption|delay|breakdown|fault/i.test(h));
    const hasEventSurge = eventHighlights.length > 0;
    const hasSocialCongestion = socialHighlights.some(h => /jam|stuck|surge|wait|delay|slow/i.test(h));

    if (hasMrtDisruption) optionsPool.forEach(opt => { opt.eta += 5; opt.rideDuration += 8; });
    if (hasEventSurge) optionsPool.forEach(opt => { opt.eta += 3; });
    if (hasSocialCongestion) optionsPool.forEach(opt => { opt.rideDuration += 5; });

    // Build alerts
    const alerts = [];
    if (hasAccident) { const d = routeIncidents.find(i => /accident|collision/i.test(i.Type)); alerts.push(`\uD83D\uDEA8 Live accident detected near your route: ${d?.Message || 'Details unavailable'}`); }
    if (hasHeavyTraffic) alerts.push("\uD83D\uDE97 Heavy traffic congestion detected on your route (LTA Live Data).");
    if (hasRoadWork) alerts.push("\uD83D\uDEA7 Road works in progress along your route \u2014 expect minor delays.");
    if (hasBreakdown) alerts.push("\u26A0\uFE0F Vehicle breakdown reported near your route.");
    if (isRaining) alerts.push("\uD83C\uDF27\uFE0F Rain detected in the area \u2014 expect longer pickup times and slower driving.");
    if (hasMrtDisruption) { alerts.push(`\uD83D\uDE86 Train disruption detected: ${mrtHighlights[0]?.slice(0, 120) || 'MRT line affected'} \u2014 expect surge pricing and longer waits.`); }
    if (hasEventSurge) { alerts.push(`\uD83C\uDFDF\uFE0F Predicted surge: ${eventHighlights[0]?.slice(0, 100) || 'Major event nearby'} \u2014 high demand expected.`); }
    if (hasSocialCongestion) alerts.push("\uD83D\uDCE1 Drivers reporting active gridlock in the area (social feeds).");
    if (dropoffTips.length > 0) alerts.push(`\uD83D\uDCCD Drop-off tip: ${dropoffTips[0].slice(0, 120)}`);
    if (effectiveNeedsBabySeat) { const tierLabel = childSeatTier === 'age4to7' ? 'Age 4\u20137 (cheaper tier)' : 'Age 1\u20133'; alerts.push(`\uD83D\uDC76 Child seat requested (${tierLabel}) \u2014 showing only providers with child seat support.`); }
    else if (needsBabySeat && childAges.length > 0 && Math.min(...childAges) >= 8) { alerts.push("\uD83D\uDC66 Child is 8+ \u2014 no child seat required by law. Booking standard car to save cost."); }
    if (needsLargeVehicle) alerts.push(`\uD83D\uDE90 ${passengers} passengers \u2014 showing 6/7-seater options (higher fare applies).`);

    const finalCheapest = [...optionsPool].sort((a, b) => a.price - b.price)[0];
    const finalFastest = [...optionsPool].sort((a, b) => a.eta - b.eta)[0];

    return res.status(200).json({
      isInvalidInput: false,
      extractedRoute: { pickup: sanitizeDisplayName(pickupDisplayName), dropoff: sanitizeDisplayName(dropoffDisplay) },
      cheapest: finalCheapest,
      fastest: finalFastest,
      alerts,
      trafficSource: routeIncidents.length > 0 ? 'lta-datamall-live' : 'clear',
    });

  } catch (error) {
    console.error("OptiCab backend failure:", error);
    return res.status(500).json({ error: "Agent engine failed to map parameters.", details: error.message });
  }
}

