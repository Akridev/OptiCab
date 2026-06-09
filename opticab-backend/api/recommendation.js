// opticab-backend/api/recommendation.js
import Exa from 'exa-js';
import { generateText } from 'ai';
import { groq } from '@ai-sdk/groq';

const exa = new Exa(process.env.EXA_API_KEY);

// ─────────────────────────────────────────────
// Exa: Multi-layer unstructured intelligence
// Domain-pinpointed, fast mode, 4-hour temporal constraint
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// LTA DataMall: Real-time traffic incidents
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// NEA: Real-time 2-hour weather nowcast (data.gov.sg)
// No API key needed — free public endpoint
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// OneMap Postal Code Resolution
// ─────────────────────────────────────────────

async function resolvePostalCode(postalCode) {
  // OneMap Search API resolves Singapore postal codes to addresses + coordinates
  const response = await fetch(
    `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postalCode}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
  );
  const data = await response.json();
  if (data.results && data.results.length > 0) {
    const result = data.results[0];
    // OneMap returns "NIL" as a string when no building name exists — treat as empty
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

// Sanitize display names — never show "NIL", "null", or empty strings
function sanitizeDisplayName(name, fallback = 'Unknown location') {
  if (!name) return fallback;
  const str = typeof name === 'string' ? name.trim() : String(name).trim();
  if (!str || /^(nil|null|undefined|unknown)$/i.test(str)) return fallback;
  // Remove leading "NIL, " or trailing ", NIL" fragments
  return str.replace(/\bNIL\b,?\s*/gi, '').replace(/,?\s*\bNIL\b/gi, '').trim() || fallback;
}

// ─────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { userPrompt, currentGpsLocation, allowedApps } = body;
  const activePlatforms = allowedApps || ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];

  if (!userPrompt || !userPrompt.trim()) {
    return res.status(200).json({ isInvalidInput: true, message: "Please enter a valid destination!" });
  }

  try {
    // 1. Guard Step
    const { text: classificationOutput } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: `You are the safety gatekeeper for OptiCab Singapore. Analyze the user prompt. 
               Determine if the input is a genuine request to travel somewhere, catch a ride, or navigate to a destination.
               IMPORTANT: Singapore postal codes (6-digit numbers like 238801, 018956, 540123) ARE valid travel destinations. Treat them as VALID.
               Street names, building names, MRT station names, and area names are all VALID travel requests.
               Only return "INVALID" if the input is completely unrelated to travel (e.g., math questions, cooking recipes, general chit-chat, nonsense).
               Return exactly: "VALID" or "INVALID".`,
      prompt: `User Prompt: "${userPrompt}"`,
    });

    if (classificationOutput.trim() === 'INVALID') {
      return res.status(200).json({
        isInvalidInput: true,
        message: "🤖 OptiCab Assistant: I can only help with travel and transport planning in Singapore. Please enter a destination or a ride request!"
      });
    }

    // 2. Resolve postal codes via OneMap before LLM parsing
    let enrichedPrompt = userPrompt;
    const postalCodes = extractPostalCodes(userPrompt);
    const resolvedPostals = {};

    for (const code of postalCodes) {
      const resolved = await resolvePostalCode(code);
      if (resolved) {
        resolvedPostals[code] = resolved;
        // Replace postal code with actual address in the prompt for Groq
        const label = resolved.buildingName
          ? `${resolved.buildingName}, ${resolved.address}`
          : resolved.address;
        enrichedPrompt = enrichedPrompt.replace(code, label);
      }
    }

    // 3. Route Parsing (uses enriched prompt with resolved addresses)
    const { text: llmOutput } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: `You are the brain of OptiCab Singapore. Analyze the user's prompt and current location context.
               
               Extract the following information:
               - "pickup": ONLY set this if the user EXPLICITLY indicates a starting location using words like "from", or uses a "X to Y" pattern where X is clearly a different location from Y. If the user just states a single destination (even with passenger info), set pickup to null. The system will use their GPS location.
               - "dropoff": the destination name or address (the "to" location, or the only location if just one is given)
               - "distanceKm": estimated distance in km between pickup and dropoff. If user provides explicit pickup, estimate from that location to dropoff. Otherwise estimate from the GPS coordinates to dropoff.
               - "passengers": number of passengers (default 1 if not mentioned). Count adults + children + babies.
               - "needsBabySeat": true if user mentions baby, infant, toddler, child, kid, or any child aged 7 or below (default false). If all children mentioned are aged 8 or above, set this to false — they do not need a child seat.
               - "needsLargeVehicle": true if passengers > 4 or user mentions 6-seater, 7-seater, large vehicle, MPV, van (default false)
               - "childAges": array of integers representing the ages of each child/baby/infant/toddler mentioned. Use context clues: "baby" = 1, "infant" = 0, "toddler" = 2. If user says "4 year old" put [4]. If "1 baby and 1 4 year old" put [1, 4]. If no children mentioned, return empty array [].
               Return ONLY a valid raw JSON object. Do not wrap in markdown boxes.`,
      prompt: `Current Location Context (GPS): ${currentGpsLocation}. User Request: "${enrichedPrompt}"`,
    });

    const parsedContext = JSON.parse(llmOutput.trim());
    const targetDistance = parseFloat(parsedContext.distanceKm);
    const passengers = parseInt(parsedContext.passengers) || 1;
    const needsBabySeat = parsedContext.needsBabySeat === true;
    const needsLargeVehicle = parsedContext.needsLargeVehicle === true || passengers > 4;
    const childAges = Array.isArray(parsedContext.childAges) ? parsedContext.childAges.filter(a => typeof a === 'number') : [];
    const resolvedPickup = parsedContext.pickup || currentGpsLocation;

    // Smart child seat tier logic:
    // - If ANY child is aged 0–3 → must use "Age 1–3" seat
    // - If ALL children are aged 4–7 → can use cheaper "Age 4–7" seat
    // - If ALL children are aged 8+ → no child seat needed at all (standard car)
    // - If no specific ages given but needsBabySeat is true → default to "Age 1–3" (safest)
    let childSeatTier = 'none'; // 'none' | 'age1to7' | 'age4to7'
    if (needsBabySeat) {
      if (childAges.length === 0) {
        // User said "baby"/"kid" without specifying age — assume youngest tier
        childSeatTier = 'age1to7';
      } else {
        const youngestChild = Math.min(...childAges);
        if (youngestChild >= 8) {
          // All children are 8+ — no child seat required, treat as regular passengers
          childSeatTier = 'none';
        } else if (youngestChild >= 4) {
          childSeatTier = 'age4to7';
        } else {
          childSeatTier = 'age1to7';
        }
      }
    }

    // Override needsBabySeat if all children are 8+ (no seat needed — saves money)
    const effectiveNeedsBabySeat = childSeatTier !== 'none';

    // Verify dropoff against OneMap for consistent, official address with postal code
    let dropoffDisplay = parsedContext.dropoff;

    // If the dropoff was a postal code, use the pre-resolved address directly
    if (postalCodes.length >= 2 && resolvedPostals[postalCodes[1]]) {
      const resolved = resolvedPostals[postalCodes[1]];
      dropoffDisplay = resolved.buildingName
        ? `${resolved.buildingName}, ${resolved.address}`
        : resolved.address;
    } else if (postalCodes.length === 1 && !parsedContext.pickup && resolvedPostals[postalCodes[0]]) {
      // Only one postal code and no explicit pickup = it's the dropoff
      const resolved = resolvedPostals[postalCodes[0]];
      dropoffDisplay = resolved.buildingName
        ? `${resolved.buildingName}, ${resolved.address}`
        : resolved.address;
    } else {
      try {
        const dropoffQuery = typeof parsedContext.dropoff === 'string' ? parsedContext.dropoff : parsedContext.dropoff?.address || '';
        if (dropoffQuery) {
          const searchRes = await fetch(
            `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(dropoffQuery)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
          );
          const searchData = await searchRes.json();
          if (searchData.results && searchData.results.length > 0) {
            const top = searchData.results[0];
            const building = top.BUILDING && top.BUILDING !== 'NIL' ? `${top.BUILDING}, ` : '';
            dropoffDisplay = `${building}${top.ADDRESS}`;
          }
        }
      } catch {
        // Keep Groq's interpretation if OneMap fails
      }
    }

    // 3. Concurrent data fetch: Fares + LTA Traffic + Exa Weather
    // Also reverse geocode the pickup if it's raw coordinates
    let pickupDisplayName = resolvedPickup;

    // If pickup was resolved from a postal code, use the enriched address directly
    if (postalCodes.length >= 1 && parsedContext.pickup) {
      // Check if the first postal code was the pickup (appears before "to" keyword)
      const firstPostal = postalCodes[0];
      if (resolvedPostals[firstPostal]) {
        const resolved = resolvedPostals[firstPostal];
        pickupDisplayName = resolved.buildingName
          ? `${resolved.buildingName}, ${resolved.address}`
          : resolved.address;
      }
    }

    if (/^\d+\.\d+,\s*\d+\.\d+$/.test(resolvedPickup)) {
      // It's coordinates — reverse geocode via OneMap
      try {
        const [lat, lng] = resolvedPickup.split(',').map(s => s.trim());
        // Get OneMap token for auth
        const tokenRes = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: process.env.ONEMAP_EMAIL, password: process.env.ONEMAP_PASSWORD }),
        });
        const tokenData = await tokenRes.json();
        const token = tokenData.access_token;

        const revGeoResponse = await fetch(
          `https://www.onemap.gov.sg/api/public/revgeocode?location=${lat},${lng}&buffer=100&addressType=All`,
          { headers: { Authorization: token } }
        );
        const revGeoData = await revGeoResponse.json();
        if (revGeoData.GeocodeInfo && revGeoData.GeocodeInfo.length > 0) {
          const info = revGeoData.GeocodeInfo[0];
          const building = info.BUILDINGNAME && info.BUILDINGNAME !== 'NIL' ? info.BUILDINGNAME : '';
          const road = info.ROAD && info.ROAD !== 'NIL' ? info.ROAD : '';
          const block = info.BLOCK && info.BLOCK !== 'NIL' ? info.BLOCK : '';
          if (building && road) {
            pickupDisplayName = `${building}, ${road}`;
          } else if (block && road) {
            pickupDisplayName = `${block} ${road}`;
          } else if (road) {
            pickupDisplayName = road;
          }
          // else keep coordinates as fallback
        }
      } catch {
        // Keep coordinates as fallback if OneMap is unavailable
      }
    }

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

    const [fareMatrix, ltaIncidents, weatherForecasts, exaLayers, dropoffIntel] = await Promise.all([faresPromise, ltaPromise, weatherPromise, exaPromise, dropoffIntelPromise]);

    // 4. Analyze traffic conditions using LTA live data
    // Parse pickup coordinates for incident proximity check
    const pickupCoords = resolvedPickup.includes(',')
      ? { lat: parseFloat(resolvedPickup.split(',')[0]), lng: parseFloat(resolvedPickup.split(',')[1]) }
      : null;

    // Check for incidents near the route (pickup area + dropoff area)
    let routeIncidents = [];
    if (pickupCoords) {
      routeIncidents = findIncidentsNearRoute(ltaIncidents, pickupCoords.lat, pickupCoords.lng, 1.5);
    }

    // Categorize incidents
    const hasAccident = routeIncidents.some(i => /accident|collision/i.test(i.Type));
    const hasRoadWork = routeIncidents.some(i => /road work|roadwork/i.test(i.Type));
    const hasHeavyTraffic = routeIncidents.some(i => /heavy traffic|congestion/i.test(i.Type));
    const hasBreakdown = routeIncidents.some(i => /breakdown|stalled/i.test(i.Type));
    const isTrafficDisrupted = hasAccident || hasHeavyTraffic || hasBreakdown;

    // Weather from NEA real-time 2-hour nowcast
    const dropoffStr = typeof parsedContext.dropoff === 'string' ? parsedContext.dropoff : '';
    const isRaining = isRainingNearArea(weatherForecasts, dropoffStr);

    // 5. Walkable Intervention Layer
    if (targetDistance <= 1.2 && !isRaining && !needsLargeVehicle && !needsBabySeat) {
      const walkTime = Math.round(targetDistance * 12);

      const carOptions = [];
      if (activePlatforms.includes('Grab')) carOptions.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: fareMatrix.grab.rideDurationMinutes, carType: 'JustGrab 4-Seater' });
      if (activePlatforms.includes('TADA')) carOptions.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: fareMatrix.tada.rideDurationMinutes, carType: 'TADA Standard 4-Seater' });
      if (activePlatforms.includes('Gojek')) carOptions.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: fareMatrix.gojek.rideDurationMinutes, carType: 'GoCar 4-Seater' });
      if (activePlatforms.includes('Ryde')) carOptions.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: fareMatrix.ryde.rideDurationMinutes, carType: 'RydeX 4-Seater' });
      if (activePlatforms.includes('ComfortDelGro')) carOptions.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: fareMatrix.cdg.rideDurationMinutes, carType: 'ComfortRIDE 4-Seater' });

      const sortedFastestCar = carOptions.sort((a, b) => a.eta - b.eta)[0];

      return res.status(200).json({
        isInvalidInput: false,
        extractedRoute: { pickup: sanitizeDisplayName(pickupDisplayName), dropoff: sanitizeDisplayName(dropoffDisplay) },
        cheapest: { provider: 'Walk (Healthy Option)', price: 0.00, eta: 0, rideDuration: walkTime },
        fastest: sortedFastestCar,
        alerts: ["💡 OptiCab Agent Note: Your destination is walkable and weather conditions are clear. Walk to save money!"],
      });
    }

    // 6. Standard Multi-App Flow
    const PROVIDER_FEATURES = {
      Grab: { largeVehicle: true, babySeat: true },
      TADA: { largeVehicle: false, babySeat: false },
      Gojek: { largeVehicle: false, babySeat: false },
      Ryde: { largeVehicle: false, babySeat: false },
      ComfortDelGro: { largeVehicle: true, babySeat: true },
    };

    // Car type labels based on provider + requirements + child age tier
    const CAR_TYPES = {
      Grab: {
        standard: 'JustGrab 4-Seater',
        babySeat_age1to7: 'GrabFamily 4-Seater (Child Seat, Age 1–3)',
        babySeat_age4to7: 'GrabFamily 4-Seater (Child Seat, Age 4–7)',
        largeVehicle: 'Grab 6-Seater',
        largeBaby_age1to7: 'GrabFamily 6-Seater (Child Seat, Age 1–3)',
        largeBaby_age4to7: 'GrabFamily 6-Seater (Child Seat, Age 4–7)',
      },
      TADA: {
        standard: 'TADA Standard 4-Seater',
        babySeat_age1to7: 'TADA Standard 4-Seater',
        babySeat_age4to7: 'TADA Standard 4-Seater',
        largeVehicle: 'TADA Standard 4-Seater',
        largeBaby_age1to7: 'TADA Standard 4-Seater',
        largeBaby_age4to7: 'TADA Standard 4-Seater',
      },
      Gojek: {
        standard: 'GoCar 4-Seater',
        babySeat_age1to7: 'GoCar 4-Seater',
        babySeat_age4to7: 'GoCar 4-Seater',
        largeVehicle: 'GoCar 4-Seater',
        largeBaby_age1to7: 'GoCar 4-Seater',
        largeBaby_age4to7: 'GoCar 4-Seater',
      },
      Ryde: {
        standard: 'RydeX 4-Seater',
        babySeat_age1to7: 'RydeX 4-Seater',
        babySeat_age4to7: 'RydeX 4-Seater',
        largeVehicle: 'RydeX 4-Seater',
        largeBaby_age1to7: 'RydeX 4-Seater',
        largeBaby_age4to7: 'RydeX 4-Seater',
      },
      ComfortDelGro: {
        standard: 'ComfortRIDE 4-Seater',
        babySeat_age1to7: 'ComfortRIDE Family (Child Seat, Age 1–3)',
        babySeat_age4to7: 'ComfortRIDE Family (Child Seat, Age 4–7)',
        largeVehicle: 'ComfortRIDE 6-Seater',
        largeBaby_age1to7: 'ComfortRIDE Family 6-Seater (Child Seat, Age 1–3)',
        largeBaby_age4to7: 'ComfortRIDE Family 6-Seater (Child Seat, Age 4–7)',
      },
    };

    // Determine which car type variant to use — picks cheapest eligible seat tier
    function getCarType(provider) {
      const types = CAR_TYPES[provider];
      if (!types) return 'Standard 4-Seater';

      if (effectiveNeedsBabySeat && needsLargeVehicle) {
        return childSeatTier === 'age4to7' ? types.largeBaby_age4to7 : types.largeBaby_age1to7;
      }
      if (effectiveNeedsBabySeat) {
        return childSeatTier === 'age4to7' ? types.babySeat_age4to7 : types.babySeat_age1to7;
      }
      if (needsLargeVehicle) return types.largeVehicle;
      return types.standard;
    }

    let optionsPool = [];
    if (activePlatforms.includes('Grab')) optionsPool.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: fareMatrix.grab.rideDurationMinutes, carType: getCarType('Grab') });
    if (activePlatforms.includes('TADA')) optionsPool.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: fareMatrix.tada.rideDurationMinutes, carType: getCarType('TADA') });
    if (activePlatforms.includes('Gojek')) optionsPool.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: fareMatrix.gojek.rideDurationMinutes, carType: getCarType('Gojek') });
    if (activePlatforms.includes('Ryde')) optionsPool.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: fareMatrix.ryde.rideDurationMinutes, carType: getCarType('Ryde') });
    if (activePlatforms.includes('ComfortDelGro')) optionsPool.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: fareMatrix.cdg.rideDurationMinutes, carType: getCarType('ComfortDelGro') });

    if (effectiveNeedsBabySeat) {
      optionsPool = optionsPool.filter(opt => PROVIDER_FEATURES[opt.provider]?.babySeat);
    }
    if (needsLargeVehicle) {
      optionsPool = optionsPool.filter(opt => PROVIDER_FEATURES[opt.provider]?.largeVehicle);
    }

    if (optionsPool.length === 0) {
      return res.status(200).json({
        isInvalidInput: true,
        message: "🤖 No providers available for your requirements. Try enabling Grab or ComfortDelGro — they support baby seats and large vehicles."
      });
    }

    // Apply traffic delays from LTA live data
    if (isTrafficDisrupted) {
      const delayMinutes = hasAccident ? 10 : 5;
      optionsPool.forEach(opt => {
        opt.eta += Math.round(delayMinutes * 0.5); // pickup delay
        opt.rideDuration += delayMinutes; // ride duration delay
      });
    }
    if (isRaining) {
      optionsPool.forEach(opt => {
        opt.eta += 3; // rain = harder to find drivers
        opt.rideDuration += 4; // slower driving in rain
      });
    }

    // Exa multi-layer intelligence analysis
    const socialHighlights = exaLayers.socialResults?.results?.flatMap(r => r.highlights) || [];
    const mrtHighlights = exaLayers.mrtResults?.results?.flatMap(r => r.highlights) || [];
    const eventHighlights = exaLayers.eventResults?.results?.flatMap(r => r.highlights) || [];
    const dropoffTips = dropoffIntel?.results?.flatMap(r => r.highlights) || [];

    // MRT disruption = massive surge (thousands spill onto roads)
    const hasMrtDisruption = mrtHighlights.some(h => /disruption|delay|breakdown|fault/i.test(h));
    // Event ending = predicted surge
    const hasEventSurge = eventHighlights.length > 0;
    // Social chatter confirms ground-level congestion
    const hasSocialCongestion = socialHighlights.some(h => /jam|stuck|surge|wait|delay|slow/i.test(h));

    // Apply Exa-derived penalties
    if (hasMrtDisruption) {
      optionsPool.forEach(opt => {
        opt.eta += 5; // Everyone booking at once
        opt.rideDuration += 8; // Roads flooded with displaced commuters
      });
    }
    if (hasEventSurge) {
      optionsPool.forEach(opt => {
        opt.eta += 3; // Higher demand, fewer available drivers
      });
    }
    if (hasSocialCongestion) {
      optionsPool.forEach(opt => {
        opt.rideDuration += 5; // Ground reports confirm gridlock
      });
    }

    // Build alerts from all data sources
    const alerts = [];
    if (hasAccident) {
      const accidentDetails = routeIncidents.find(i => /accident|collision/i.test(i.Type));
      alerts.push(`🚨 Live accident detected near your route: ${accidentDetails?.Message || 'Details unavailable'}`);
    }
    if (hasHeavyTraffic) alerts.push("🚗 Heavy traffic congestion detected on your route (LTA Live Data).");
    if (hasRoadWork) alerts.push("🚧 Road works in progress along your route — expect minor delays.");
    if (hasBreakdown) alerts.push("⚠️ Vehicle breakdown reported near your route.");
    if (isRaining) alerts.push("🌧️ Rain detected in the area — expect longer pickup times and slower driving.");
    if (hasMrtDisruption) {
      const mrtDetail = mrtHighlights[0]?.slice(0, 120) || 'MRT line affected';
      alerts.push(`� Train disruption detected: ${mrtDetail} — expect surge pricing and longer waits.`);
    }
    if (hasEventSurge) {
      const eventDetail = eventHighlights[0]?.slice(0, 100) || 'Major event nearby';
      alerts.push(`🏟️ Predicted surge: ${eventDetail} — high demand expected.`);
    }
    if (hasSocialCongestion) {
      alerts.push("📡 Drivers reporting active gridlock in the area (social feeds).");
    }
    if (dropoffTips.length > 0) {
      alerts.push(`📍 Drop-off tip: ${dropoffTips[0].slice(0, 120)}`);
    }
    if (effectiveNeedsBabySeat) {
      const tierLabel = childSeatTier === 'age4to7' ? 'Age 4–7 (cheaper tier)' : 'Age 1–3';
      alerts.push(`👶 Child seat requested (${tierLabel}) — showing only providers with child seat support.`);
    } else if (needsBabySeat && childAges.length > 0 && Math.min(...childAges) >= 8) {
      alerts.push("👦 Child is 8+ — no child seat required by law. Booking standard car to save cost.");
    }
    if (needsLargeVehicle) alerts.push(`� ${passengers} passengers — showing 6/7-seater options (higher fare applies).`);

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
    return res.status(500).json({
      error: "Agent engine failed to map parameters.",
      details: error.message,
    });
  }
}
