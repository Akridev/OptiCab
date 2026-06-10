// api/fare-refresh.js
// Lightweight endpoint for Fare-Watch refreshes
// Skips: Guard LLM, postal resolution, route parsing, OneMap routing
// Only recalculates: Fares + LTA traffic + Weather + Exa intelligence
import Exa from 'exa-js';

const exa = new Exa(process.env.EXA_API_KEY);

async function getExaTransportAlerts(dropoffName) {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const socialPromise = exa.search(
    `Singapore drivers reporting active congestion or ride app surge issues near ${dropoffName} right now`,
    { type: "keyword", numResults: 2, startPublishedDate: fourHoursAgo, includeDomains: ["x.com", "reddit.com", "hardwarezone.com.sg"], contents: { highlights: true } }
  ).catch(() => ({ results: [] }));
  const mrtPromise = exa.search(
    `SMRT SBS transit train service disruption delay breakdown Singapore`,
    { type: "keyword", numResults: 2, startPublishedDate: fourHoursAgo, includeDomains: ["channelnewsasia.com", "straitstimes.com", "mothership.sg", "lta.gov.sg"], contents: { highlights: true } }
  ).catch(() => ({ results: [] }));
  const todayStr = new Date().toISOString().split('T')[0];
  const eventPromise = exa.search(
    `Major events concerts conventions ending today ${todayStr} Singapore National Stadium Expo Marina Bay Sands`,
    { type: "keyword", numResults: 2, startPublishedDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), includeDomains: ["channelnewsasia.com", "straitstimes.com", "mothership.sg", "timeout.com"], contents: { highlights: true } }
  ).catch(() => ({ results: [] }));
  const [socialResults, mrtResults, eventResults] = await Promise.all([socialPromise, mrtPromise, eventPromise]);
  return { socialResults, mrtResults, eventResults };
}

async function getLtaTrafficIncidents() {
  const response = await fetch('http://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents', {
    headers: { AccountKey: process.env.LTA_ACCOUNT_KEY, accept: 'application/json' },
  });
  const data = await response.json();
  return data.value || [];
}

async function getCurrentWeather() {
  const response = await fetch('https://api.data.gov.sg/v1/environment/2-hour-weather-forecast');
  const data = await response.json();
  return data.items?.[0]?.forecasts || [];
}

function isRainingNearArea(forecasts, dropoffName) {
  const rainKeywords = /rain|shower|thunder|storm/i;
  const dropoffLower = (typeof dropoffName === 'string' ? dropoffName : '').toLowerCase();
  for (const f of forecasts) {
    const areaLower = f.area.toLowerCase();
    const isNearby = dropoffLower.includes(areaLower) || areaLower.includes(dropoffLower) || dropoffLower.split(' ').some(word => word.length > 3 && areaLower.includes(word));
    if (isNearby && rainKeywords.test(f.forecast)) return true;
  }
  const rainyAreas = forecasts.filter(f => rainKeywords.test(f.forecast));
  return rainyAreas.length >= forecasts.length * 0.5;
}

function findIncidentsNearRoute(incidents, lat, lng, radiusKm = 1.5) {
  return incidents.filter(i => {
    const dist = Math.sqrt(Math.pow(i.Latitude - lat, 2) + Math.pow(i.Longitude - lng, 2)) * 111;
    return dist <= radiusKm;
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(200).end(); }
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { pickupLat, pickupLng, dropoffName, distanceKm, needsLargeVehicle, allowedApps, pickupDisplay, dropoffDisplay, pickupIsCurrentLocation } = body;

  if (!distanceKm) return res.status(400).json({ error: 'Distance required' });

  const activePlatforms = allowedApps || ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];

  try {
    // Parallel: Fares + LTA + Weather + Exa
    const faresPromise = fetch('https://opticab-backend.vercel.app/api/fares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickupLocation: `${pickupLat},${pickupLng}`, dropoffLocation: dropoffName, distanceKmOverride: distanceKm, needsLargeVehicle: needsLargeVehicle || false }),
    }).then(r => r.json());

    const ltaPromise = getLtaTrafficIncidents().catch(() => []);
    const weatherPromise = getCurrentWeather().catch(() => []);
    const exaPromise = getExaTransportAlerts(dropoffName || '').catch(() => ({ socialResults: { results: [] }, mrtResults: { results: [] }, eventResults: { results: [] } }));

    const [fareMatrix, ltaIncidents, weatherForecasts, exaLayers] = await Promise.all([faresPromise, ltaPromise, weatherPromise, exaPromise]);

    // Traffic analysis
    let routeIncidents = [];
    if (pickupLat && pickupLng) {
      routeIncidents = findIncidentsNearRoute(ltaIncidents, pickupLat, pickupLng);
    }

    const hasAccident = routeIncidents.some(i => /accident|collision/i.test(i.Type));
    const hasRoadWork = routeIncidents.some(i => /road work|roadwork/i.test(i.Type));
    const hasHeavyTraffic = routeIncidents.some(i => /heavy traffic|congestion/i.test(i.Type));
    const hasBreakdown = routeIncidents.some(i => /breakdown|stalled/i.test(i.Type));
    const isTrafficDisrupted = hasAccident || hasHeavyTraffic || hasBreakdown;
    const isRaining = isRainingNearArea(weatherForecasts, dropoffName || '');

    // Build options
    let optionsPool = [];
    if (activePlatforms.includes('Grab')) optionsPool.push({ provider: 'Grab', price: fareMatrix.grab.estimatedFare, eta: fareMatrix.grab.baseEtaMinutes, rideDuration: fareMatrix.grab.rideDurationMinutes });
    if (activePlatforms.includes('TADA')) optionsPool.push({ provider: 'TADA', price: fareMatrix.tada.estimatedFare, eta: fareMatrix.tada.baseEtaMinutes, rideDuration: fareMatrix.tada.rideDurationMinutes });
    if (activePlatforms.includes('Gojek')) optionsPool.push({ provider: 'Gojek', price: fareMatrix.gojek.estimatedFare, eta: fareMatrix.gojek.baseEtaMinutes, rideDuration: fareMatrix.gojek.rideDurationMinutes });
    if (activePlatforms.includes('Ryde')) optionsPool.push({ provider: 'Ryde', price: fareMatrix.ryde.estimatedFare, eta: fareMatrix.ryde.baseEtaMinutes, rideDuration: fareMatrix.ryde.rideDurationMinutes });
    if (activePlatforms.includes('ComfortDelGro')) optionsPool.push({ provider: 'ComfortDelGro', price: fareMatrix.cdg.estimatedFare, eta: fareMatrix.cdg.baseEtaMinutes, rideDuration: fareMatrix.cdg.rideDurationMinutes });

    // Apply delays
    if (isTrafficDisrupted) { const d = hasAccident ? 10 : 5; optionsPool.forEach(opt => { opt.eta += Math.round(d * 0.5); opt.rideDuration += d; }); }
    if (isRaining) { optionsPool.forEach(opt => { opt.eta += 3; opt.rideDuration += 4; }); }

    // Exa analysis
    const socialHighlights = exaLayers.socialResults?.results?.flatMap(r => r.highlights) || [];
    const mrtHighlights = exaLayers.mrtResults?.results?.flatMap(r => r.highlights) || [];
    const eventHighlights = exaLayers.eventResults?.results?.flatMap(r => r.highlights) || [];
    const hasMrtDisruption = mrtHighlights.some(h => /disruption|delay|breakdown|fault/i.test(h));
    const hasEventSurge = eventHighlights.length > 0;
    const hasSocialCongestion = socialHighlights.some(h => /jam|stuck|surge|wait|delay|slow/i.test(h));

    if (hasMrtDisruption) optionsPool.forEach(opt => { opt.eta += 5; opt.rideDuration += 8; });
    if (hasEventSurge) optionsPool.forEach(opt => { opt.eta += 3; });
    if (hasSocialCongestion) optionsPool.forEach(opt => { opt.rideDuration += 5; });

    // Alerts
    const alerts = [];
    if (hasAccident) alerts.push(`\uD83D\uDEA8 Live accident near your route.`);
    if (hasHeavyTraffic) alerts.push("\uD83D\uDE97 Heavy traffic on your route.");
    if (hasRoadWork) alerts.push("\uD83D\uDEA7 Road works along your route.");
    if (isRaining) alerts.push("\uD83C\uDF27\uFE0F Rain detected \u2014 longer pickup times.");
    if (hasMrtDisruption) alerts.push(`\uD83D\uDE86 Train disruption \u2014 surge expected.`);
    if (hasEventSurge) alerts.push(`\uD83C\uDFDF\uFE0F Event surge predicted.`);
    if (hasSocialCongestion) alerts.push("\uD83D\uDCE1 Drivers reporting gridlock.");

    const finalCheapest = [...optionsPool].sort((a, b) => a.price - b.price)[0];
    const finalFastest = [...optionsPool].sort((a, b) => a.eta - b.eta)[0];

    return res.status(200).json({
      isInvalidInput: false,
      extractedRoute: { pickup: pickupDisplay || 'Current Location', dropoff: dropoffDisplay || dropoffName, pickupIsCurrentLocation: pickupIsCurrentLocation || false },
      cheapest: finalCheapest,
      fastest: finalFastest,
      alerts,
    });
  } catch (error) {
    console.error('Fare refresh error:', error);
    return res.status(500).json({ error: 'Fare refresh failed', details: error.message });
  }
}
