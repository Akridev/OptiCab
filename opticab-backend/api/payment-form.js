// api/payment-form.js
// Serves the in-app Stripe Elements payment form (loaded in WebView)

export default function handler(req, res) {
  const { clientSecret, publishableKey } = req.query;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>OptiCab Premium</title>
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #FAFAFA;
      padding: 24px 16px;
      color: #111;
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
    }
    .header h1 {
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .header p {
      font-size: 14px;
      color: #666;
    }
    .price-tag {
      text-align: center;
      margin-bottom: 24px;
    }
    .price-tag .amount {
      font-size: 36px;
      font-weight: 900;
    }
    .price-tag .period {
      font-size: 14px;
      color: #888;
    }
    .features {
      background: #F1F3F5;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .features li {
      list-style: none;
      font-size: 13px;
      padding: 6px 0;
      color: #333;
    }
    .features li::before {
      content: "✓ ";
      color: #1A73E8;
      font-weight: bold;
    }
    #payment-element {
      margin-bottom: 20px;
    }
    #submit-btn {
      width: 100%;
      background: #111;
      color: #fff;
      border: none;
      padding: 16px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    #submit-btn:disabled {
      background: #999;
    }
    #error-message {
      color: #dc3545;
      font-size: 13px;
      margin-top: 12px;
      text-align: center;
    }
    #success-message {
      display: none;
      text-align: center;
      padding: 40px 20px;
    }
    #success-message .emoji { font-size: 48px; margin-bottom: 12px; }
    #success-message h2 { font-size: 20px; margin-bottom: 8px; }
    #success-message p { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div id="payment-form">
    <div class="header">
      <h1>OptiCab Premium</h1>
      <p>Unlock the full power of OptiCab</p>
    </div>

    <div class="price-tag">
      <span class="amount">$2.99</span>
      <span class="period">/ month</span>
    </div>

    <ul class="features">
      <li>Fare-Watch — live price tracking every 30s</li>
      <li>Real-time price drop alerts</li>
      <li>Never overpay — book at the cheapest window</li>
      <li>Cancel anytime</li>
    </ul>

    <div id="payment-element"></div>
    <button id="submit-btn" type="button">Subscribe Now</button>
    <div id="error-message"></div>
  </div>

  <div id="success-message">
    <div class="emoji">🎉</div>
    <h2>You're Premium!</h2>
    <p>Auto-Polling Radar is now unlocked. Closing...</p>
  </div>

  <script>
    const stripe = Stripe('${publishableKey}');
    const clientSecret = '${clientSecret}';

    const elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create('payment', {
      layout: 'tabs',
    });
    paymentElement.mount('#payment-element');

    const submitBtn = document.getElementById('submit-btn');
    const errorEl = document.getElementById('error-message');

    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing...';
      errorEl.textContent = '';

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (error) {
        errorEl.textContent = error.message;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Subscribe Now';
      } else {
        // Payment succeeded
        document.getElementById('payment-form').style.display = 'none';
        document.getElementById('success-message').style.display = 'block';
        // Notify the React Native app
        setTimeout(() => {
          window.ReactNativeWebView.postMessage(JSON.stringify({ status: 'success' }));
        }, 1500);
      }
    });
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
