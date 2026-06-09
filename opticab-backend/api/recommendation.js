// opticab-backend/api/recommendation.js
import Exa from 'exa-js';
import { generateText } from 'ai';
import { groq } from '@ai-sdk/groq';

const exa = new Exa(process.env.EXA_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Explicitly parse body — Vercel ESM functions don't auto-parse JSON
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { userPrompt, currentGpsLocation, allowedApps } = body;
  const activePlatforms = allowedApps || ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];

  if (!userPrompt || !userPrompt.trim()) {
    return res.status(200).json({ isInvalidInput: true, message: "Please enter a valid destination!" });
  }

  try {
    // 1. Guard Step: Is this an actual transit/commute request or garbage input?
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

    // 2. Intrinsic Route Parsing (If the prompt is VALID)
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
      prompt: `Current Location Context (GPS): ${currentGpsLocation}. User Request: "${userPrompt}"`,
    });

    const parsedContext = JSON.parse(llmOutput.trim());
    const targetDistance = parseFloat(parsedContext.distanceKm);
    const passengers = parseInt(parsedContext.passengers) || 1;
    const needsBabySeat = parsedContext.needsBabySeat === true;
    const needsLargeVehicle = parsedContext.needsLargeVehicle === true || passengers > 4;

    // Use explicit pickup if user provided one, otherwise fall back to GPS
    const resolvedPickup = parsedContext.pickup || currentGpsLocation;

    // 3. Query Exa and AWS Lambda concurrently
    const exaPromise = exa.search(
      `Singapore active weather alerts downpour rain or road closures near ${parsedContext.dropoff}`,
      { type: "auto", numResults: 1, contents: { highlights: true } }
    );

    const lambdaPromise = fetch(`https://opticab-backend.vercel.app/api/fares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupLocation: resolvedPickup,
        dropoffLocation: parsedContext.dropoff,
        distanceKmOverride: targetDistance,
        needsLargeVehicle,
      }),
    }).then(r => r.json());

    const [fareMatrix, exaResults] = await Promise.all([lambdaPromise, exaPromise]);
    const weatherHighlights = exaResults.results.flatMap(r => r.highlights);
    const isRaining = weatherHighlights.some(text => /rain|downpour|thunderstorm|flood/i.test(text));

    // 4. Walkable Intervention Layer
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
        extractedRoute: { pickup: resolvedPickup, dropoff: parsedContext.dropoff },
        cheapest: { provider: 'Walk (Healthy Option)', price: 0.00, eta: 0, rideDuration: walkTime },
        fastest: sortedFastestCar,
        alerts: ["💡 OptiCab Agent Note: Your destination is walkable and weather conditions are clear. Walk to save money!"]
      });
    }

    // 5. Standard Core Multi-App Mapping Flow
    // Provider capabilities for special requirements
    const PROVIDER_FEATURES = {
      Grab: { largeVehicle: true, babySeat: true },       // GrabFamily has child seats, Grab6 for large groups
      TADA: { largeVehicle: false, babySeat: false },     // Standard sedans only
      Gojek: { largeVehicle: false, babySeat: false },    // Standard sedans only
      Ryde: { largeVehicle: false, babySeat: false },     // Standard sedans only
      ComfortDelGro: { largeVehicle: true, babySeat: true }, // CDG has MaxiCab + baby seat options
    };

    let optionsPool = [];
    if (activePlatforms.includes('Grab')) optionsPool.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: fareMatrix.grab.rideDurationMinutes });
    if (activePlatforms.includes('TADA')) optionsPool.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: fareMatrix.tada.rideDurationMinutes });
    if (activePlatforms.includes('Gojek')) optionsPool.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: fareMatrix.gojek.rideDurationMinutes });
    if (activePlatforms.includes('Ryde')) optionsPool.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: fareMatrix.ryde.rideDurationMinutes });
    if (activePlatforms.includes('ComfortDelGro')) optionsPool.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: fareMatrix.cdg.rideDurationMinutes });

    // Filter out providers that don't support baby seat if needed
    if (needsBabySeat) {
      optionsPool = optionsPool.filter(opt => PROVIDER_FEATURES[opt.provider]?.babySeat);
    }

    // Filter out providers that don't support large vehicles if needed
    if (needsLargeVehicle) {
      optionsPool = optionsPool.filter(opt => PROVIDER_FEATURES[opt.provider]?.largeVehicle);
    }

    // If all providers filtered out, return a helpful message
    if (optionsPool.length === 0) {
      return res.status(200).json({
        isInvalidInput: true,
        message: "🤖 No providers available for your requirements. Try enabling Grab or ComfortDelGro — they support baby seats and large vehicles."
      });
    }

    const isTrafficHeavy = weatherHighlights.some(text => /accident|jam|closure|congestion/i.test(text));
    if (isTrafficHeavy) {
      optionsPool.forEach(opt => { opt.eta += 8; });
    }

    // Build alerts
    const alerts = [];
    if (isTrafficHeavy) alerts.push("⚠️ Heavy traffic detected along your route vector.");
    if (needsBabySeat) alerts.push("👶 Baby seat requested — showing only providers with child seat support.");
    if (needsLargeVehicle) alerts.push(`👥 ${passengers} passengers — showing 6/7-seater options (higher fare applies).`);

    const finalCheapest = [...optionsPool].sort((a, b) => a.price - b.price)[0];
    const finalFastest = [...optionsPool].sort((a, b) => a.eta - b.eta)[0];

    return res.status(200).json({
      isInvalidInput: false,
      extractedRoute: { pickup: resolvedPickup, dropoff: parsedContext.dropoff },
      cheapest: finalCheapest,
      fastest: finalFastest,
      alerts,
    });

  } catch (error) {
    console.error("OptiCab backend failure:", error);
    return res.status(500).json({ 
      error: "Agent engine failed to map parameters.",
      details: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}