// Web version — uses iframe since react-native-webview doesn't support web
export function PaymentWebView({ uri, onMessage, style }) {
  return (
    <iframe
      src={uri}
      style={{ flex: 1, border: 'none', width: '100%', height: '100%' }}
      title="Payment"
    />
  );
}
