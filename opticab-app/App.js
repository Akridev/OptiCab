import { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, Text, TextInput, View, TouchableOpacity, ActivityIndicator, Linking, Alert, Keyboard, ScrollView, Platform, Modal } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';

// ─────────────────────────────────────────────
// CONFIG — swap this to your live Vercel URL once deployed
// ─────────────────────────────────────────────
const API_URL = 'https://opticab-backend.vercel.app/api/recommendation';
const CREATE_PAYMENT_URL = 'https://opticab-backend.vercel.app/api/create-payment';
const PAYMENT_FORM_URL = 'https://opticab-backend.vercel.app/api/payment-form';
const SUBSCRIPTION_STATUS_URL = 'https://opticab-backend.vercel.app/api/subscription-status';
const SAVED_ROUTES_URL = 'https://opticab-backend.vercel.app/api/saved-routes';
const RIDE_HISTORY_URL = 'https://opticab-backend.vercel.app/api/ride-history';

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
  if (!dropoff) return 'Unknown location';
  if (typeof dropoff === 'string') {
    const cleaned = dropoff.trim();
    if (!cleaned || cleaned === 'null' || cleaned === 'NIL') return 'Unknown location';
    return cleaned;
  }
  return dropoff.address || dropoff.name || 'Unknown location';
};

export default function App() {
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [isAutoPolling, setIsAutoPolling] = useState(false);
  const [result, setResult] = useState(null);
  const [resolvedCoords, setResolvedCoords] = useState(null);
  const [pickupIsCurrentLocation, setPickupIsCurrentLocation] = useState(false);
  const [deviceId, setDeviceId] = useState(null);
  const [checkingSubscription, setCheckingSubscription] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [savedRoutes, setSavedRoutes] = useState({ home: null, work: null });
  const [rideHistory, setRideHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const scrollViewRef = useRef(null);
  const [radarCountdown, setRadarCountdown] = useState(30);

  // Get or generate a stable device ID + load saved email
  useEffect(() => {
    (async () => {
      try {
        let id = await AsyncStorage.getItem('opticab_device_id');
        if (!id) {
          if (Platform.OS === 'android' && Application.getAndroidId) {
            id = Application.getAndroidId();
          }
          if (!id) {
            id = `opticab-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
          }
          await AsyncStorage.setItem('opticab_device_id', id);
        }
        setDeviceId(id);

        // Load saved email
        const savedEmail = await AsyncStorage.getItem('opticab_email');
        if (savedEmail) setUserEmail(savedEmail);
      } catch (err) {
        const fallbackId = `opticab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setDeviceId(fallbackId);
      }
    })();
  }, []);

  // Check subscription status on app load and when returning from Stripe
  useEffect(() => {
    if (!userEmail) return;
    checkSubscriptionStatus();
  }, [userEmail]);

  // Load saved routes and history when deviceId is ready
  useEffect(() => {
    if (!deviceId) return;
    loadSavedRoutes();
    loadRideHistory();
  }, [deviceId]);

  const checkSubscriptionStatus = async () => {
    if (!userEmail) {
      setCheckingSubscription(false);
      return;
    }
    try {
      const response = await fetch(SUBSCRIPTION_STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail }),
      });
      const data = await response.json();
      setIsPremium(data.isPremium === true);
    } catch {} finally {
      setCheckingSubscription(false);
    }
  };

  const handleUpgrade = async () => {
    // Always show email prompt (user can confirm or change their email)
    setShowEmailPrompt(true);
  };

  const promptEmailAndroid = () => {
    if (userEmail) setEmailInput(userEmail);
    setShowEmailPrompt(true);
  };

  const confirmEmailAndroid = async () => {
    if (!emailInput || !emailInput.includes('@')) {
      Alert.alert('Invalid', 'Please enter a valid email.');
      return;
    }
    const email = emailInput.trim().toLowerCase();
    setUserEmail(email);
    await AsyncStorage.setItem('opticab_email', email);
    setShowEmailPrompt(false);
    Alert.alert('Loading...', 'Setting up payment...');
    await startPayment(email);
  };

  const startPayment = async (email) => {
    try {
      // First check if already premium
      const statusRes = await fetch(SUBSCRIPTION_STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const statusData = await statusRes.json();
      if (statusData.isPremium) {
        setIsPremium(true);
        Alert.alert('Already Premium!', 'Your subscription is active. Fare-Watch is unlocked.');
        return;
      }
    } catch {
      // Status check failed — proceed to payment anyway
    }

    // Not premium — start payment
    try {
      const response = await fetch(CREATE_PAYMENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (data.clientSecret && data.publishableKey) {
        const url = `${PAYMENT_FORM_URL}?clientSecret=${encodeURIComponent(data.clientSecret)}&publishableKey=${encodeURIComponent(data.publishableKey)}`;
        setPaymentUrl(url);
        setShowPaymentModal(true);
      } else {
        Alert.alert('Payment Error', data.details || data.error || 'Could not start payment.');
      }
    } catch (err) {
      Alert.alert('Network Error', 'Please check your connection and try again.');
    }
  };

  const loadSavedRoutes = async () => {
    try {
      const res = await fetch(SAVED_ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, action: 'get' }),
      });
      const data = await res.json();
      setSavedRoutes({ home: data.home || null, work: data.work || null });
    } catch {}
  };

  const loadRideHistory = async () => {
    try {
      const res = await fetch(RIDE_HISTORY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, action: 'get' }),
      });
      const data = await res.json();
      setRideHistory(data.history || []);
    } catch {}
  };

  const saveCurrentRoute = async () => {
    if (!deviceId || !promptText.trim()) {
      Alert.alert('No route', 'Enter a destination first before saving.');
      return;
    }
    Alert.alert('Save Route', 'Save this as:', [
      { text: 'Cancel', style: 'cancel' },
      { text: '🏠 Home', onPress: () => doSaveRoute('home') },
      { text: '💼 Work', onPress: () => doSaveRoute('work') },
    ]);
  };

  const doSaveRoute = async (type) => {
    try {
      const res = await fetch(SAVED_ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, action: 'save', type, prompt: promptText }),
      });
      const data = await res.json();
      setSavedRoutes({ home: data.home || null, work: data.work || null });
      Alert.alert('Saved!', `${type === 'home' ? 'Home' : 'Work'} route updated.`);
    } catch {
      Alert.alert('Error', 'Could not save route.');
    }
  };

  const saveToHistory = async (resultData) => {
    if (!deviceId || !resultData?.extractedRoute) return;
    try {
      await fetch(RIDE_HISTORY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          action: 'save',
          ride: {
            prompt: promptText,
            cheapestProvider: resultData.cheapest?.provider,
            cheapestPrice: resultData.cheapest?.price,
          },
        }),
      });
      // Refresh history after save
      loadRideHistory();
    } catch {}
  };

  const handlePaymentMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.status === 'success') {
        setShowPaymentModal(false);
        setIsPremium(true);
        Alert.alert('🎉 Welcome to Premium!', 'Fare-Watch is now unlocked.');
      }
    } catch {}
  };

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
      // Detects: "from X to Y", "643658 to 650350", "bukit batok to orchard"
      // But NOT: "take me to orchard" (no explicit pickup)
      const hasFromKeyword = /\bfrom\b/i.test(promptText);
      const hasTwoPostalCodes = (promptText.match(/\b\d{6}\b/g) || []).length >= 2;
      const hasExplicitPickupBeforeTo = /^[^]*?\S+\s+to\s+/i.test(promptText) && !/\b(take|bring|go|get)\s+(me\s+)?to\b/i.test(promptText);
      const userSpecifiedPickup = hasFromKeyword || hasTwoPostalCodes || hasExplicitPickupBeforeTo;

      let locationContext = null;
      let coords = null;

      if (!userSpecifiedPickup) {
        // Check existing permission status first — don't bug the user if already granted
        let { status } = await Location.getForegroundPermissionsAsync();

        if (status !== 'granted') {
          // Only show info popup if permission hasn't been granted yet
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

          // Now request permission
          const permResult = await Location.requestForegroundPermissionsAsync();
          status = permResult.status;

          if (status !== 'granted') {
            Alert.alert(
              'Location Required',
              'OptiCab cannot detect your pickup location without GPS permission. Please specify a "from" location in your message (e.g., "from Bukit Batok to Orchard") or enable location access in your device settings.',
              [{ text: 'OK' }]
            );
            setLoading(false);
            return;
          }
        }

        // Permission granted — get location silently
        let loc = await Location.getCurrentPositionAsync({});
        coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        locationContext = `${coords.lat}, ${coords.lng}`;
      }

      // Store live coords so deep links can use them as pickup point
      if (coords) setResolvedCoords(coords);
      setPickupIsCurrentLocation(!userSpecifiedPickup);

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
      // Auto-scroll to results
      if (!isBackgroundRefresh && data && !data.isInvalidInput) {
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 300);
      }
      // Auto-save to history (non-blocking)
      if (!isBackgroundRefresh && data && !data.isInvalidInput && data.extractedRoute) {
        saveToHistory(data);
      }
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

    setRadarCountdown(30);
    const radarTimer = setInterval(() => {
      handleSearchCommute(true);
      setRadarCountdown(30);
    }, 30000);

    const countdownTimer = setInterval(() => {
      setRadarCountdown(prev => prev > 0 ? prev - 1 : 30);
    }, 1000);

    return () => { clearInterval(radarTimer); clearInterval(countdownTimer); };
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
        <ScrollView showsVerticalScrollIndicator={false} ref={scrollViewRef}>
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

          {/* Saved Routes Quick-Access */}
          {(savedRoutes.home || savedRoutes.work) && (
            <View style={styles.savedRoutesRow}>
              {savedRoutes.home && (
                <TouchableOpacity style={styles.savedRouteChip} onPress={() => setPromptText(savedRoutes.home)}>
                  <Text style={styles.savedRouteText}>🏠 Home</Text>
                </TouchableOpacity>
              )}
              {savedRoutes.work && (
                <TouchableOpacity style={styles.savedRouteChip} onPress={() => setPromptText(savedRoutes.work)}>
                  <Text style={styles.savedRouteText}>💼 Work</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Save Route + History buttons */}
          <View style={styles.quickActionsRow}>
            {promptText.trim().length > 0 && (
              <TouchableOpacity style={styles.saveRouteBtn} onPress={saveCurrentRoute}>
                <Text style={styles.saveRouteBtnText}>💾 Save Route</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.historyBtn} onPress={() => setShowHistory(!showHistory)}>
              <Text style={styles.historyBtnText}>{showHistory ? '✕ Hide History' : '📋 History'}</Text>
            </TouchableOpacity>
          </View>

          {/* History Panel */}
          {showHistory && (
            <View style={styles.historyPanel}>
              <Text style={styles.historyTitle}>Recent Searches</Text>
              {rideHistory.length === 0 ? (
                <Text style={styles.historyMeta}>No searches yet.</Text>
              ) : (
                rideHistory.slice(0, 2).map((ride, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.historyItem}
                    onPress={() => { setPromptText(ride.prompt); setShowHistory(false); }}
                  >
                    <Text style={styles.historyRoute}>{ride.prompt}</Text>
                    {ride.cheapestProvider && (
                      <Text style={styles.historyMeta}>{ride.cheapestProvider} ${ride.cheapestPrice?.toFixed(2)}</Text>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

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
                  {isAutoPolling ? `📡 Refreshing in ${radarCountdown}s` : '🛰️ Fare-Watch'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Invalid input or error warning block */}
          {result && (result.isInvalidInput || result.error) && (
            <View style={styles.alertBox}>
              <Text style={[styles.alertText, { fontWeight: 'bold' }]}>{result.message || result.error || 'Something went wrong. Please try again.'}</Text>
            </View>
          )}

          {/* Core comparison layout */}
          {result && !result.isInvalidInput && result.extractedRoute && (
            <View style={{ marginBottom: 100 }}>
              <View style={styles.routeConfirm}>
                <Text style={styles.confirmText}>{result.extractedRoute.pickupIsCurrentLocation ? '📌 Current: ' : '📍 From: '}{getDropoffName(result.extractedRoute.pickup)}</Text>
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

              {result.cheapest.provider === result.fastest.provider ? (
                /* Combined card — same provider is both cheapest and fastest */
                <View style={styles.gridSingle}>
                  <TouchableOpacity
                    style={styles.cardFull}
                    onPress={() => launchDeepLink(result.cheapest.provider, getDropoffName(result.extractedRoute.dropoff))}
                  >
                    <Text style={styles.cardHeader}>💰⚡ CHEAPEST & FASTEST</Text>
                    <Text style={styles.price}>${result.cheapest.price.toFixed(2)}</Text>
                    <Text style={styles.provider}>{result.cheapest.provider}</Text>
                    {result.cheapest.carType && (
                      <Text style={styles.carType}>🚘 {result.cheapest.carType}</Text>
                    )}
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
                </View>
              ) : (
                /* Two separate cards */
                <View style={styles.grid}>
                  <TouchableOpacity
                    style={styles.card}
                    onPress={() => launchDeepLink(result.cheapest.provider, getDropoffName(result.extractedRoute.dropoff))}
                  >
                    <Text style={styles.cardHeader}>💰 CHEAPEST</Text>
                    <Text style={styles.price}>${result.cheapest.price.toFixed(2)}</Text>
                    <Text style={styles.provider}>{result.cheapest.provider}</Text>
                    {result.cheapest.carType && (
                      <Text style={styles.carType}>🚘 {result.cheapest.carType}</Text>
                    )}
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

                  <TouchableOpacity
                    style={styles.card}
                    onPress={() => launchDeepLink(result.fastest.provider, getDropoffName(result.extractedRoute.dropoff))}
                  >
                    <Text style={styles.cardHeader}>⚡ FASTEST</Text>
                    <Text style={styles.price}>${result.fastest.price.toFixed(2)}</Text>
                    <Text style={styles.provider}>{result.fastest.provider}</Text>
                    {result.fastest.carType && (
                      <Text style={styles.carType}>🚘 {result.fastest.carType}</Text>
                    )}
                    {result.fastest.eta != null && (
                      <Text style={styles.timing}>🚗 Pickup: {result.fastest.eta} min ({getTimeString(result.fastest.eta)})</Text>
                    )}
                    {result.fastest.rideDuration != null && (
                      <Text style={styles.timing}>📍 Dropoff: {result.fastest.rideDuration} min ({getTimeString(result.fastest.eta + result.fastest.rideDuration)})</Text>
                    )}
                    <Text style={styles.tapToOpen}>Tap to open app →</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Stripe Paywall Footer */}
        {!isPremium && (
          <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade}>
            <Text style={styles.upgradeText}>👑 Upgrade to unlock 30s Auto-Polling Radar</Text>
          </TouchableOpacity>
        )}

        {/* Email Prompt Modal (Android) */}
        {showEmailPrompt && (
          <Modal visible={true} transparent animationType="fade" onRequestClose={() => setShowEmailPrompt(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
              <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Enter Email</Text>
                <Text style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Your email is used to manage your subscription.</Text>
                <TextInput
                  style={{ borderWidth: 1, borderColor: '#DDD', borderRadius: 8, padding: 12, fontSize: 15, marginBottom: 16 }}
                  placeholder="you@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={emailInput}
                  onChangeText={setEmailInput}
                />
                <TouchableOpacity
                  onPress={async () => {
                    Keyboard.dismiss();
                    if (!emailInput || !emailInput.includes('@')) {
                      Alert.alert('Invalid', 'Please enter a valid email.');
                      return;
                    }
                    const email = emailInput.trim().toLowerCase();
                    setUserEmail(email);
                    AsyncStorage.setItem('opticab_email', email);
                    setShowEmailPrompt(false);
                    try {
                      const response = await fetch(CREATE_PAYMENT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email }),
                      });
                      const data = await response.json();
                      if (data.clientSecret && data.publishableKey) {
                        setPaymentUrl(`${PAYMENT_FORM_URL}?clientSecret=${encodeURIComponent(data.clientSecret)}&publishableKey=${encodeURIComponent(data.publishableKey)}`);
                        setShowPaymentModal(true);
                      } else {
                        Alert.alert('Payment Error', data.details || data.error || 'Failed');
                      }
                    } catch (e) {
                      Alert.alert('Network Error', e.message);
                    }
                  }}
                  style={{ backgroundColor: '#111', padding: 14, borderRadius: 8, alignItems: 'center', marginBottom: 10 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Continue</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowEmailPrompt(false)}
                  style={{ padding: 10, alignItems: 'center' }}
                >
                  <Text style={{ color: '#666', fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* Payment Modal */}
        <Modal
          visible={showPaymentModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => { setShowPaymentModal(false); setIsPremium(true); }}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setShowPaymentModal(false); setIsPremium(true); }}>
                <Text style={styles.modalClose}>✕ Close</Text>
              </TouchableOpacity>
            </View>
            {paymentUrl && (
              <WebView
                source={{ uri: paymentUrl }}
                onMessage={handlePaymentMessage}
                style={{ flex: 1 }}
              />
            )}
          </SafeAreaView>
        </Modal>
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
  gridSingle: {
    flexDirection: 'row',
    justifyContent: 'center',
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
  cardFull: {
    backgroundColor: '#FFF',
    width: '100%',
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
  carType: {
    fontSize: 11,
    color: '#666',
    marginTop: 3,
    fontWeight: '500',
    fontStyle: 'italic',
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
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  modalClose: {
    fontSize: 16,
    color: '#666',
    fontWeight: '600',
  },
  savedRoutesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    marginBottom: 4,
  },
  savedRouteChip: {
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  savedRouteText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A73E8',
  },
  quickActionsRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  saveRouteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  saveRouteBtnText: {
    fontSize: 12,
    color: '#1A73E8',
    fontWeight: '600',
  },
  historyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  historyBtnText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  historyPanel: {
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  historyItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  historyRoute: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  historyMeta: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
});
