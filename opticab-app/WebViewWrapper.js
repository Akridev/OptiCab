import { Platform } from 'react-native';

let WebViewComponent = null;

if (Platform.OS !== 'web') {
  WebViewComponent = require('react-native-webview').WebView;
}

export function PaymentWebView({ uri, onMessage, style }) {
  if (Platform.OS === 'web') {
    return (
      <iframe
        src={uri}
        style={{ flex: 1, border: 'none', width: '100%', height: '100%', ...style }}
        title="Payment"
      />
    );
  }
  return <WebViewComponent source={{ uri }} onMessage={onMessage} style={style} />;
}
