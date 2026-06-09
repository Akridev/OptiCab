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
               If it is completely unrelated (e.g., math questions, cooking recipes, general chit-chat, nonsense characters), 
               return exactly: "INVALID". Otherwise, if it is a travel request, return exactly: "VALID".`,
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
               Estimate the approximate distance in kilometers between pickup and dropoff.
               Return ONLY a valid raw JSON object with keys: "dropoff", "distanceKm". Do not wrap in markdown boxes.`,
      prompt: `Current Location Context: ${currentGpsLocation}. User Request: "${userPrompt}"`,
    });

    const parsedContext = JSON.parse(llmOutput.trim());
    const targetDistance = parseFloat(parsedContext.distanceKm);

    // 3. Query Exa and AWS Lambda concurrently
    const exaPromise = exa.search(
      `Singapore active weather alerts downpour rain or road closures near ${parsedContext.dropoff}`,
      { type: "auto", numResults: 1, contents: { highlights: true } }
    );

    const lambdaPromise = fetch(process.env.AWS_LAMBDA_FARES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupLocation: currentGpsLocation,
        dropoffLocation: parsedContext.dropoff,
        distanceKmOverride: targetDistance, // Pass LLM-extracted distance — avoids re-deriving from strings
      }),
    }).then(res => res.json());

    const [fareMatrix, exaResults] = await Promise.all([lambdaPromise, exaPromise]);
    const weatherHighlights = exaResults.results.flatMap(r => r.highlights);
    const isRaining = weatherHighlights.some(text => /rain|downpour|thunderstorm|flood/i.test(text));

    // 4. Walkable Intervention Layer
    if (targetDistance <= 1.2 && !isRaining) {
      const walkTime = Math.round(targetDistance * 12);
      
      const carOptions = [];
      if (activePlatforms.includes('Grab')) carOptions.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes });
      if (activePlatforms.includes('TADA')) carOptions.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes });
      if (activePlatforms.includes('Gojek')) carOptions.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes });
      if (activePlatforms.includes('Ryde')) carOptions.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes });
      if (activePlatforms.includes('ComfortDelGro')) carOptions.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes });

      const sortedFastestCar = carOptions.sort((a, b) => a.eta - b.eta)[0];

      return res.status(200).json({
        isInvalidInput: false,
        extractedRoute: { pickup: currentGpsLocation, dropoff: parsedContext.dropoff },
        cheapest: { provider: 'Walk (Healthy Option)', price: 0.00, eta: walkTime },
        fastest: sortedFastestCar,
        alerts: ["💡 OptiCab Agent Note: Your destination is walkable and weather conditions are clear. Walk to save money!"]
      });
    }

    // 5. Standard Core Multi-App Mapping Flow
    const optionsPool = [];
    if (activePlatforms.includes('Grab')) optionsPool.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes });
    if (activePlatforms.includes('TADA')) optionsPool.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes });
    if (activePlatforms.includes('Gojek')) optionsPool.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes });
    if (activePlatforms.includes('Ryde')) optionsPool.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes });
    if (activePlatforms.includes('ComfortDelGro')) optionsPool.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes });

    const isTrafficHeavy = weatherHighlights.some(text => /accident|jam|closure|congestion/i.test(text));
    if (isTrafficHeavy) {
      optionsPool.forEach(opt => { opt.eta += 8; });
    }

    const finalCheapest = [...optionsPool].sort((a, b) => a.price - b.price)[0];
    const finalFastest = [...optionsPool].sort((a, b) => a.eta - b.eta)[0];

    return res.status(200).json({
      isInvalidInput: false,
      extractedRoute: { pickup: currentGpsLocation, dropoff: parsedContext.dropoff },
      cheapest: finalCheapest,
      fastest: finalFastest,
      alerts: isTrafficHeavy ? ["⚠️ Heavy traffic detected along your route vector."] : []
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