// Native version — this file is used on Android/iOS
// On web, WebViewWrapper.web.js is used instead (Metro platform extension)
import { WebView } from 'react-native-webview';

export function PaymentWebView({ uri, onMessage, style }) {
  return <WebView source={{ uri }} onMessage={onMessage} style={style} />;
}
