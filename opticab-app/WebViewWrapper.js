// Native version — used on Android/iOS
// WebViewWrapper.web.js is the web version (Metro platform extension)
// react-native-webview is NOT imported at the top level to avoid
// it throwing "does not support this platform" during web bundling.
import { Platform } from 'react-native';

export function PaymentWebView({ uri, onMessage, style }) {
  if (Platform.OS === 'web') {
    // Should never reach here — WebViewWrapper.web.js handles web.
    // Fallback iframe in case bundler doesn't resolve the .web.js extension.
    return (
      <iframe
        src={uri}
        style={{ flex: 1, border: 'none', width: '100%', height: '100%' }}
        title="Payment"
      />
    );
  }

  // Dynamic require keeps react-native-webview out of the web bundle entirely
  const { WebView } = require('react-native-webview');
  return <WebView source={{ uri }} onMessage={onMessage} style={style} />;
}
