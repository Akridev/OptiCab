import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, TextInput, View, TouchableOpacity, ActivityIndicator, Linking, Alert, Keyboard, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

// 1. Define all supported apps in Singapore
const AVAILABLE_APPS = ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];

export default function App() {
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false); // Stripe checkout hook integration point
  const [isAutoPolling, setIsAutoPolling] = useState(false); // 30s background radar
  const [result, setResult] = useState(null);

  // 2. Track selected apps (Default: all checked)
  const [selectedApps, setSelectedApps] = useState(AVAILABLE_APPS);

  // Toggle helper for the checkbox filters
  const toggleAppSelection = (appName) => {
    if (selectedApps.includes(appName)) {
      // Don't let them uncheck everything
      if (selectedApps.length === 1) return;
      setSelectedApps(selectedApps.filter(app => app !== appName));
    } else {
      setSelectedApps([...selectedApps, appName]);
    }
  };

  // 3. Unified Search Function (Passes selected filters to backend)
  const handleSearchCommute = async (isBackgroundRefresh = false) => {
    if (!promptText.trim()) return;
    if (!isBackgroundRefresh) setLoading(true);

    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      let locationContext = "Geylang, Singapore"; // Fallback default
      
      if (status === 'granted') {
        let loc = await Location.getCurrentPositionAsync({});
        locationContext = `${loc.coords.latitude}, ${loc.coords.longitude}`;
      }

      // Call Vercel Agent API endpoint with explicit filters
      const response = await fetch('https://vercel.app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: promptText,
          currentGpsLocation: locationContext,
          allowedApps: selectedApps // Pass array of checked apps to backend
        }),
      });
      
      const data = await response.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      if (!isBackgroundRefresh) {
        Alert.alert('OptiCab Error', 'Failed to communicate with the AI Routing Agent.');
      }
    } finally {
      if (!isBackgroundRefresh) setLoading(false);
    }
  };

  // 4. Premium Automated 30-Second Background Radar Loop
  useEffect(() => {
    if (!isPremium || !isAutoPolling || !result) return;

    const radarTimer = setInterval(() => {
      handleSearchCommute(true);
    }, 30000);

    return () => clearInterval(radarTimer);
  }, [isPremium, isAutoPolling, result, selectedApps]);

  // 5. Broad-Scale Deep Linking Matrix
  const launchDeepLink = (provider) => {
    let url = '';
    
    // Official cross-platform production deep-link URI schemes mapping
    switch (provider.toLowerCase()) {
      case 'grab':
        url = `grab://open?screenType=BOOKING&pickupLat=1.3164&pickupLng=103.8830&dropoffLat=1.3048&dropoffLng=103.8318`;
        break;
      case 'tada':
        url = `tada://booking?pickup_lat=1.3164&pickup_lng=103.8830&dropoff_lat=1.3048&dropoff_lng=103.8318`;
        break;
      case 'gojek':
        url = `gojek://goforward?service=GO_CAR&pickup=1.3164,103.8830&destination=1.3048,103.8318`;
        break;
      case 'ryde':
        url = `ryde://booking?pickuplat=1.3164&pickuplng=103.8830&droplat=1.3048&droplng=103.8318`;
        break;
      case 'comfortdelgro':
        url = `cdgmobility://booking?pickup_lat=1.3164&pickup_lng=103.8830&dropoff_lat=1.3048&dropoff_lng=103.8318`;
        break;
      default:
        return;
    }

    Linking.openURL(url).catch(() => {
      Alert.alert('App Missing', `${provider} is not installed on this device.`);
    });
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>OptiCab</Text>
          <Text style={styles.subtitle}>Conversational Commute Assistant</Text>

          {/* Input Form Box */}
          <TextInput
            style={styles.input}
            placeholder="Where to? (e.g., Take me to Orchard road, avoid heavy jams)"
            placeholderTextColor="#999"
            value={promptText}
            onChangeText={setPromptText}
            onSubmitEditing={() => {
              Keyboard.dismiss();
              handleSearchCommute(false);
            }}
            returnKeyType="search"
          />

          {/* 🗹 Checkbox Filter Matrix Segment */}
          <Text style={styles.filterTitle}>Select Apps to Compare:</Text>
          <View style={styles.checkboxContainer}>
            {AVAILABLE_APPS.map((app) => {
              const isChecked = selectedApps.includes(app);
              return (
                <TouchableOpacity 
                  key={app} 
                  style={[styles.checkbox, isChecked ? styles.checkboxChecked : styles.checkboxUnchecked]}
                  onPress={() => toggleAppSelection(app)}
                >
                  <Text style={[styles.checkboxText, isChecked ? styles.textChecked : styles.textUnchecked]}>
                    {isChecked ? '✓ ' : '+ '} {app}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Actions Button Panel */}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.submitBtn} onPress={() => { Keyboard.dismiss(); handleSearchCommute(false); }}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Search Fares</Text>}
            </TouchableOpacity>

            {isPremium && result && (
              <TouchableOpacity 
                style={[styles.radarBtn, isAutoPolling ? styles.radarActive : styles.radarInactive]} 
                onPress={() => setIsAutoPolling(!isAutoPolling)}
              >
                <Text style={styles.radarBtnText(isAutoPolling)}>
                  {isAutoPolling ? '📡 Radar: ON (30s)' : '🛰️ Start Auto-Radar'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Render this fallback block if the input is flagged as invalid or unrelated */}
        {result && result.isInvalidInput && (
          <View style={styles.alertBox}>
            <Text style={[styles.alertText, { fontWeight: 'bold' }]}>{result.message}</Text>
          </View>
        )}

        {/* Render the core comparison layout ONLY if the input is valid transport parameters */}
        {result && !result.isInvalidInput && (
          <View style={{ marginBottom: 100 }}>
            <View style={styles.routeConfirm}>
              <Text style={styles.confirmText}>🗺️ Destination Locked: {result.extractedRoute.dropoff}</Text>
            </View>

            {result.alerts?.length > 0 && (
              <View style={styles.alertBox}>
                <Text style={styles.alertTitle}>⚠️ Live Status Advisory</Text>
                {result.alerts.map((alert, idx) => (
                  <Text key={idx} style={styles.alertText}>• {alert}</Text>
                ))}
              </View>
            )}

            <View style={styles.grid}>
              <TouchableOpacity style={styles.card} onPress={() => launchDeepLink(result.cheapest.provider)}>
                <Text style={styles.cardHeader}>💰 CHEAPEST</Text>
                <Text style={styles.price}>${result.cheapest.price.toFixed(2)}</Text>
                <Text style={styles.provider}>{result.cheapest.provider}</Text>
                <Text style={styles.tapToOpen}>Tap to open app →</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.card} onPress={() => launchDeepLink(result.fastest.provider)}>
                <Text style={styles.cardHeader}>⚡ FASTEST</Text>
                <Text style={styles.price}>${result.fastest.price.toFixed(2)}</Text>
                <Text style={styles.provider}>{result.fastest.provider}</Text>
                <Text style={styles.tapToOpen}>Tap to open app →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        </ScrollView>

        {/* Stripe Marketing Paywall Action Switch Footer */}
        {!isPremium && (
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => setIsPremium(true)}>
            <Text style={styles.upgradeText}>👑 Upgrade to unlock 30s Auto-Polling Radar</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#FAFAFA', 
    paddingHorizontal: 16, 
    paddingTop: 40 
  },
  title: { 
    fontSize: 34, 
    fontWeight: '900', 
    textAlign: 'center', 
    color: '#111' 
  },
  subtitle: { 
    fontSize: 13, 
    color: '#666', 
    textAlign: 'center', 
    marginBottom: 20, 
    marginTop: 4 
  },
  input: { 
    backgroundColor: '#FFF', 
    borderWidth: 1, 
    borderColor: '#E5E5E5', 
    borderRadius: 10, 
    padding: 14, 
    fontSize: 15, 
    color: '#111' 
  },
  filterTitle: { 
    fontSize: 14, 
    fontWeight: '700', 
    color: '#333', 
    marginTop: 16, 
    marginBottom: 8 
  },
  checkboxContainer: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginBottom: 4 
  },
  checkbox: { 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 20, 
    marginRight: 8, 
    marginBottom: 8, 
    borderWidth: 1 
  },
  checkboxUnchecked: { 
    backgroundColor: '#FFF', 
    borderColor: '#DDD' 
  },
  checkboxChecked: { 
    backgroundColor: '#111', 
    borderColor: '#111' 
  },
  checkboxText: { 
    fontSize: 12, 
    fontWeight: '600' 
  },
  textChecked: { 
    color: '#FFF' 
  },
  textUnchecked: { 
    color: '#555' 
  },
  buttonRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginTop: 8, 
    marginBottom: 16 
  },
  submitBtn: { 
    backgroundColor: '#111', 
    flex: 1, 
    padding: 14, 
    borderRadius: 8, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  btnText: { 
    color: '#FFF', 
    fontWeight: '700', 
    fontSize: 15 
  },
  radarBtn: { 
    flex: 1, 
    padding: 14, 
    borderRadius: 8, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginLeft: 8 
  },
  radarInactive: { 
    backgroundColor: '#E8F0FE', 
    borderWidth: 1, 
    borderColor: '#1A73E8' 
  },
  radarActive: { 
    backgroundColor: '#1A73E8' 
  },
  radarBtnText: (active) => ({ 
    fontWeight: '700', 
    fontSize: 14, 
    color: active ? '#FFF' : '#1A73E8' 
  }),
  routeConfirm: { 
    backgroundColor: '#F1F3F5', 
    padding: 12, 
    borderRadius: 8, 
    marginBottom: 12 
  },
  confirmText: { 
    fontSize: 13, 
    fontWeight: '600', 
    color: '#495057', 
    textAlign: 'center' 
  },
  alertBox: { 
    backgroundColor: '#FFF3CD', 
    borderLeftWidth: 4, 
    borderLeftColor: '#FFC107', 
    padding: 10, 
    borderRadius: 6, 
    marginBottom: 16 
  },
  alertTitle: { 
    fontSize: 12, 
    fontWeight: '700', 
    color: '#856404', 
    marginBottom: 4 
  },
  alertText: { 
    fontSize: 11, 
    color: '#856404' 
  },
  grid: { 
    flexDirection: 'row', 
    justifyContent: 'space-between' 
  },
  card: { 
    backgroundColor: '#FFF', 
    width: '48%', 
    borderRadius: 14, 
    padding: 16, 
    borderWidth: 1, 
    borderColor: '#EAEAEA', 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, 
    shadowOpacity: 0.03, 
    shadowRadius: 4, 
    elevation: 2 
  },
  cardHeader: { 
    fontSize: 11, 
    fontWeight: '700', 
    color: '#666', 
    marginBottom: 8 
  },
  price: { 
    fontSize: 28, 
    fontWeight: '800', 
    color: '#111' 
  },
  provider: { 
    fontSize: 14, 
    color: '#444', 
    marginTop: 2, 
    fontWeight: '600' 
  },
  tapToOpen: { 
    fontSize: 10, 
    color: '#007BFF', 
    marginTop: 14, 
    fontWeight: '600' 
  },
  upgradeBtn: { 
    backgroundColor: '#1A73E8', 
    padding: 15, 
    borderRadius: 10, 
    alignItems: 'center', 
    position: 'absolute', 
    bottom: 30, 
    left: 16, 
    right: 16 
  }
});
