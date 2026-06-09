// opticab-backend/api/recommendation.js
import Exa from 'exa-js';
import { generateText } from 'ai';
import { groq } from '@ai-sdk/groq';

const exa = new Exa(process.env.EXA_API_KEY);

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
    return {
      address: result.ADDRESS,
      buildingName: result.BUILDING || '',
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
               - "pickup": if the user explicitly mentions a pickup location (e.g., "from Bukit Gombak"), use that. Otherwise set to null (the system will use GPS).
               - "dropoff": the destination name or address
               - "distanceKm": estimated distance in km between pickup and dropoff. If user provides explicit pickup, estimate from that location to dropoff. Otherwise estimate from the GPS coordinates to dropoff.
               - "passengers": number of passengers (default 1 if not mentioned)
               - "needsBabySeat": true if user mentions baby, infant, toddler, child seat, or car seat (default false)
               - "needsLargeVehicle": true if passengers > 4 or user mentions 6-seater, 7-seater, large vehicle, MPV, van (default false)
               Return ONLY a valid raw JSON object. Do not wrap in markdown boxes.`,
      prompt: `Current Location Context (GPS): ${currentGpsLocation}. User Request: "${enrichedPrompt}"`,
    });

    const parsedContext = JSON.parse(llmOutput.trim());
    const targetDistance = parseFloat(parsedContext.distanceKm);
    const passengers = parseInt(parsedContext.passengers) || 1;
    const needsBabySeat = parsedContext.needsBabySeat === true;
    const needsLargeVehicle = parsedContext.needsLargeVehicle === true || passengers > 4;
    const resolvedPickup = parsedContext.pickup || currentGpsLocation;

    // 3. Concurrent data fetch: Fares + LTA Traffic + Exa Weather
    // Also reverse geocode the pickup if it's raw coordinates
    let pickupDisplayName = resolvedPickup;
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
          pickupDisplayName = info.BUILDINGNAME && info.BUILDINGNAME !== 'NIL'
            ? `${info.BUILDINGNAME}, ${info.ROAD}`
            : `${info.BLOCK || ''} ${info.ROAD}`.trim();
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

    const exaPromise = exa.search(
      `Singapore weather alert rain flood ${parsedContext.dropoff}`,
      { type: "auto", numResults: 1, contents: { highlights: true } }
    ).catch(() => ({ results: [] }));

    const [fareMatrix, ltaIncidents, exaResults] = await Promise.all([faresPromise, ltaPromise, exaPromise]);

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

    // Weather from Exa
    const weatherHighlights = exaResults.results?.flatMap(r => r.highlights) || [];
    const isRaining = weatherHighlights.some(text => /rain|downpour|thunderstorm|flood/i.test(text));

    // 5. Walkable Intervention Layer
    if (targetDistance <= 1.2 && !isRaining && !needsLargeVehicle && !needsBabySeat) {
      const walkTime = Math.round(targetDistance * 12);

      const carOptions = [];
      if (activePlatforms.includes('Grab')) carOptions.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: fareMatrix.grab.rideDurationMinutes });
      if (activePlatforms.includes('TADA')) carOptions.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: fareMatrix.tada.rideDurationMinutes });
      if (activePlatforms.includes('Gojek')) carOptions.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: fareMatrix.gojek.rideDurationMinutes });
      if (activePlatforms.includes('Ryde')) carOptions.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: fareMatrix.ryde.rideDurationMinutes });
      if (activePlatforms.includes('ComfortDelGro')) carOptions.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: fareMatrix.cdg.rideDurationMinutes });

      const sortedFastestCar = carOptions.sort((a, b) => a.eta - b.eta)[0];

      return res.status(200).json({
        isInvalidInput: false,
        extractedRoute: { pickup: pickupDisplayName, dropoff: parsedContext.dropoff },
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

    let optionsPool = [];
    if (activePlatforms.includes('Grab')) optionsPool.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: fareMatrix.grab.rideDurationMinutes });
    if (activePlatforms.includes('TADA')) optionsPool.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: fareMatrix.tada.rideDurationMinutes });
    if (activePlatforms.includes('Gojek')) optionsPool.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: fareMatrix.gojek.rideDurationMinutes });
    if (activePlatforms.includes('Ryde')) optionsPool.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: fareMatrix.ryde.rideDurationMinutes });
    if (activePlatforms.includes('ComfortDelGro')) optionsPool.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: fareMatrix.cdg.rideDurationMinutes });

    if (needsBabySeat) {
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

    // Build alerts from real data
    const alerts = [];
    if (hasAccident) {
      const accidentDetails = routeIncidents.find(i => /accident|collision/i.test(i.Type));
      alerts.push(`🚨 Live accident detected near your route: ${accidentDetails?.Message || 'Details unavailable'}`);
    }
    if (hasHeavyTraffic) alerts.push("🚗 Heavy traffic congestion detected on your route (LTA Live Data).");
    if (hasRoadWork) alerts.push("🚧 Road works in progress along your route — expect minor delays.");
    if (hasBreakdown) alerts.push("⚠️ Vehicle breakdown reported near your route.");
    if (isRaining) alerts.push("🌧️ Rain detected in the area — expect longer pickup times and slower driving.");
    if (needsBabySeat) alerts.push("👶 Baby seat requested — showing only providers with child seat support.");
    if (needsLargeVehicle) alerts.push(`👥 ${passengers} passengers — showing 6/7-seater options (higher fare applies).`);

    const finalCheapest = [...optionsPool].sort((a, b) => a.price - b.price)[0];
    const finalFastest = [...optionsPool].sort((a, b) => a.eta - b.eta)[0];

    return res.status(200).json({
      isInvalidInput: false,
      extractedRoute: { pickup: pickupDisplayName, dropoff: parsedContext.dropoff },
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
