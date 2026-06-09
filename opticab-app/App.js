import { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, TextInput, View, TouchableOpacity, ActivityIndicator, Linking, Alert, Keyboard, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

// ─────────────────────────────────────────────
// CONFIG — swap this to your live Vercel URL once deployed
// ─────────────────────────────────────────────
const API_URL = 'https://opticab-backend.vercel.app/api/recommendation';

// 1. Define all supported apps in Singapore
const AVAILABLE_APPS = ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];

// Helper: compute clock time from now + minutes offset (Singapore time)
const getTimeString = (minutesFromNow) => {
  const now = new Date();
  const futureTime = new Date(now.getTime() + minutesFromNow * 60 * 1000);
  // Format in Singapore timezone
  return futureTime.toLocaleTimeString('en-SG', { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true,
    timeZone: 'Asia/Singapore'
  });
};

// Helper: extract display name from dropoff (handles both string and object from backend)
const getDropoffName = (dropoff) => {
  if (!dropoff) return '';
  if (typeof dropoff === 'string') return dropoff;
  return dropoff.address || dropoff.name || JSON.stringify(dropoff);
};

export default function App() {
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false); // Stripe checkout hook integration point
  const [isAutoPolling, setIsAutoPolling] = useState(false); // 30s background radar
  const [result, setResult] = useState(null);
  const [resolvedCoords, setResolvedCoords] = useState(null); // Live GPS coords for deep links

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

  // 3. Unified Search Function — wrapped in useCallback to stabilise the radar useEffect dep
  const handleSearchCommute = useCallback(async (isBackgroundRefresh = false) => {
    if (!promptText.trim()) return;
    if (!isBackgroundRefresh) setLoading(true);

    try {
      // Check if user specified a "from" location — if so, we don't need GPS
      const userSpecifiedPickup = /\bfrom\b/i.test(promptText);

      let locationContext = null;
      let coords = null;

      if (!userSpecifiedPickup) {
        // Show informational alert before requesting permission
        const proceed = await new Promise((resolve) => {
          Alert.alert(
            'Location Permission Needed',
            'OptiCab needs your current location to detect your pickup point. Without it, we cannot search for fares.\n\nPlease allow location access when prompted.',
            [
              { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
              { text: 'OK, Continue', onPress: () => resolve(true) },
            ]
          );
        });

        if (!proceed) {
          setLoading(false);
          return;
        }

        let { status } = await Location.requestForegroundPermissionsAsync();

        if (status !== 'granted') {
          // Permission denied — prompt again
          Alert.alert(
            'Location Required',
            'OptiCab cannot detect your pickup location without GPS permission. Please specify a "from" location in your message (e.g., "from Bukit Batok to Orchard") or enable location access in your device settings.',
            [{ text: 'OK' }]
          );
          setLoading(false);
          return;
        }

        let loc = await Location.getCurrentPositionAsync({});
        coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        locationContext = `${coords.lat}, ${coords.lng}`;
      }

      // Store live coords so deep links can use them as pickup point
      if (coords) setResolvedCoords(coords);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: promptText,
          currentGpsLocation: locationContext, // null if user specified pickup in text
          allowedApps: selectedApps,
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
  }, [promptText, selectedApps]); // useCallback deps — radar closure always gets fresh values

  // 4. Premium Automated 30-Second Background Radar Loop
  useEffect(() => {
    if (!isPremium || !isAutoPolling || !result) return;

    const radarTimer = setInterval(() => {
      handleSearchCommute(true);
    }, 30000);

    return () => clearInterval(radarTimer);
  }, [isPremium, isAutoPolling, result, handleSearchCommute]);

  // 5. Deep Linking — uses live GPS coords as pickup, backend-resolved dropoff name
  const launchDeepLink = (provider, dropoffName) => {
    // Use live GPS if available, fall back to Geylang
    const pickupLat = resolvedCoords?.lat ?? 1.3048;
    const pickupLng = resolvedCoords?.lng ?? 103.8318;

    // Dropoff: backend returns a place name string — encode it for URI use
    // Provider apps resolve the name on their end; coordinates used where available
    const encodedDropoff = encodeURIComponent(dropoffName || '');

    let url = '';

    switch (provider.toLowerCase()) {
      case 'grab':
        url = `grab://open?screenType=BOOKING&pickupLat=${pickupLat}&pickupLng=${pickupLng}&dropoffQuery=${encodedDropoff}`;
        break;
      case 'tada':
        url = `tada://booking?pickup_lat=${pickupLat}&pickup_lng=${pickupLng}&dropoff_query=${encodedDropoff}`;
        break;
      case 'gojek':
        url = `gojek://goforward?service=GO_CAR&pickup=${pickupLat},${pickupLng}&destination_query=${encodedDropoff}`;
        break;
      case 'ryde':
        url = `ryde://booking?pickuplat=${pickupLat}&pickuplng=${pickupLng}&destination=${encodedDropoff}`;
        break;
      case 'comfortdelgro':
        url = `cdgmobility://booking?pickup_lat=${pickupLat}&pickup_lng=${pickupLng}&dropoff_query=${encodedDropoff}`;
        break;
      case 'walk (healthy option)':
        // Walk card: open Apple/Google Maps walking directions instead
        url = `https://www.google.com/maps/dir/?api=1&origin=${pickupLat},${pickupLng}&destination=${encodedDropoff}&travelmode=walking`;
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

          {/* Checkbox Filter Matrix */}
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
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={() => { Keyboard.dismiss(); handleSearchCommute(false); }}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Search Fares</Text>}
            </TouchableOpacity>

            {isPremium && result && (
              <TouchableOpacity
                style={[styles.radarBtn, isAutoPolling ? styles.radarActive : styles.radarInactive]}
                onPress={() => setIsAutoPolling(!isAutoPolling)}
              >
                <Text style={isAutoPolling ? styles.radarBtnTextActive : styles.radarBtnTextInactive}>
                  {isAutoPolling ? '📡 Radar: ON (30s)' : '🛰️ Start Auto-Radar'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Invalid input warning block */}
          {result && result.isInvalidInput && (
            <View style={styles.alertBox}>
              <Text style={[styles.alertText, { fontWeight: 'bold' }]}>{result.message}</Text>
            </View>
          )}

          {/* Core comparison layout */}
          {result && !result.isInvalidInput && (
            <View style={{ marginBottom: 100 }}>
              <View style={styles.routeConfirm}>
                <Text style={styles.confirmText}>📍 From: {getDropoffName(result.extractedRoute.pickup)}</Text>
                <Text style={styles.confirmText}>🏁 To: {getDropoffName(result.extractedRoute.dropoff)}</Text>
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
                {/* Cheapest card */}
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => launchDeepLink(result.cheapest.provider, getDropoffName(result.extractedRoute.dropoff))}
                >
                  <Text style={styles.cardHeader}>💰 CHEAPEST</Text>
                  <Text style={styles.price}>${result.cheapest.price.toFixed(2)}</Text>
                  <Text style={styles.provider}>{result.cheapest.provider}</Text>
                  {result.cheapest.eta != null && (
                    <Text style={styles.timing}>🚗 Pickup: {result.cheapest.eta} min ({getTimeString(result.cheapest.eta)})</Text>
                  )}
                  {result.cheapest.rideDuration != null && (
                    <Text style={styles.timing}>📍 Dropoff: {result.cheapest.rideDuration} min ({getTimeString(result.cheapest.eta + result.cheapest.rideDuration)})</Text>
                  )}
                  <Text style={styles.tapToOpen}>
                    {result.cheapest.provider.toLowerCase().includes('walk') ? 'Open Maps →' : 'Tap to open app →'}
                  </Text>
                </TouchableOpacity>

                {/* Fastest card */}
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => launchDeepLink(result.fastest.provider, getDropoffName(result.extractedRoute.dropoff))}
                >
                  <Text style={styles.cardHeader}>⚡ FASTEST</Text>
                  <Text style={styles.price}>${result.fastest.price.toFixed(2)}</Text>
                  <Text style={styles.provider}>{result.fastest.provider}</Text>
                  {result.fastest.eta != null && (
                    <Text style={styles.timing}>🚗 Pickup: {result.fastest.eta} min ({getTimeString(result.fastest.eta)})</Text>
                  )}
                  {result.fastest.rideDuration != null && (
                    <Text style={styles.timing}>📍 Dropoff: {result.fastest.rideDuration} min ({getTimeString(result.fastest.eta + result.fastest.rideDuration)})</Text>
                  )}
                  <Text style={styles.tapToOpen}>Tap to open app →</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Stripe Paywall Footer */}
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
    paddingTop: 40,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    color: '#111',
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111',
  },
  filterTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  checkboxContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  checkbox: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  checkboxUnchecked: {
    backgroundColor: '#FFF',
    borderColor: '#DDD',
  },
  checkboxChecked: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  checkboxText: {
    fontSize: 12,
    fontWeight: '600',
  },
  textChecked: {
    color: '#FFF',
  },
  textUnchecked: {
    color: '#555',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 16,
  },
  submitBtn: {
    backgroundColor: '#111',
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
  },
  radarBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  radarInactive: {
    backgroundColor: '#E8F0FE',
    borderWidth: 1,
    borderColor: '#1A73E8',
  },
  radarActive: {
    backgroundColor: '#1A73E8',
  },
  // Split radarBtnText into two static styles — functions in StyleSheet aren't valid
  radarBtnTextActive: {
    fontWeight: '700',
    fontSize: 14,
    color: '#FFF',
  },
  radarBtnTextInactive: {
    fontWeight: '700',
    fontSize: 14,
    color: '#1A73E8',
  },
  routeConfirm: {
    backgroundColor: '#F1F3F5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  confirmText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#495057',
    textAlign: 'center',
  },
  alertBox: {
    backgroundColor: '#FFF3CD',
    borderLeftWidth: 4,
    borderLeftColor: '#FFC107',
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#856404',
    marginBottom: 4,
  },
  alertText: {
    fontSize: 11,
    color: '#856404',
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    elevation: 2,
  },
  cardHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    marginBottom: 8,
  },
  price: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111',
  },
  provider: {
    fontSize: 14,
    color: '#444',
    marginTop: 2,
    fontWeight: '600',
  },
  timing: {
    fontSize: 11,
    color: '#555',
    marginTop: 4,
    fontWeight: '500',
  },
  tapToOpen: {
    fontSize: 10,
    color: '#007BFF',
    marginTop: 14,
    fontWeight: '600',
  },
  upgradeBtn: {
    backgroundColor: '#1A73E8',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    position: 'absolute',
    bottom: 30,
    left: 16,
    right: 16,
  },
  upgradeText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
