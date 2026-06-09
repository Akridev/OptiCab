// api/stripe-cancel.js
// Redirect page when user cancels Stripe checkout

export default function handler(req, res) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OptiCab - Checkout Cancelled</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { text-align: center; padding: 40px; background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 400px; }
    h1 { font-size: 24px; color: #111; margin-bottom: 8px; }
    p { color: #666; font-size: 15px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>No worries!</h1>
    <p>You can upgrade to OptiCab Premium anytime from the app. Close this page to go back.</p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
