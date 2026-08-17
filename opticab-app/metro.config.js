const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// On web builds, redirect react-native-webview to the no-op web stub
// so it never throws "does not support this platform"
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-webview') {
    return {
      filePath: require.resolve('./WebViewWrapper.web.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
