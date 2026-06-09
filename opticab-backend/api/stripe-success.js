// api/stripe-success.js
// Redirect page after successful Stripe checkout
// Returns a simple HTML page that tells the user to go back to the app

export default function handler(req, res) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OptiCab Premium - Success!</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { text-align: center; padding: 40px; background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 400px; }
    h1 { font-size: 24px; color: #111; margin-bottom: 8px; }
    p { color: #666; font-size: 15px; line-height: 1.5; }
    .emoji { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">🎉</div>
    <h1>Welcome to OptiCab Premium!</h1>
    <p>Your subscription is active. You can close this page and return to OptiCab — the 30s Auto-Polling Radar is now unlocked.</p>
    <p style="margin-top: 20px; font-size: 13px; color: #999;">Your premium status will sync automatically.</p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
