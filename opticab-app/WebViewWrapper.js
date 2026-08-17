// Native version — this file is used on Android/iOS
// On web, WebViewWrapper.web.js is used instead (Metro platform extension)
import { Platform, Text } from 'react-native';

// Lazy import so the web bundle never tries to resolve react-native-webview
let WebView = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

export function PaymentWebView({ uri, onMessage, style }) {
  if (Platform.OS === 'web') {
    return (
      <iframe
        src={uri}
        style={{ flex: 1, border: 'none', width: '100%', height: '100%' }}
        title="Payment"
      />
    );
  }
  return <WebView source={{ uri }} onMessage={onMessage} style={style} />;
}
