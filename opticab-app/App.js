import { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, Text, TextInput, View, TouchableOpacity, ActivityIndicator, Linking, Keyboard, ScrollView, Platform, Modal, Image, Animated, StatusBar } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';

// Platform-safe notification handler (notifications don't work on web)
const scheduleNotification = async (content) => {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.scheduleNotificationAsync({ content, trigger: null });
  } catch {}
};
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PaymentWebView } from './WebViewWrapper';

// On web, payment opens in new tab instead of WebView
const openPaymentWeb = (url) => {
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
  }
};

// ─── Config ───
const API_URL = 'https://opticab-backend.vercel.app/api/recommendation';
const CREATE_PAYMENT_URL = 'https://opticab-backend.vercel.app/api/create-payment';
const PAYMENT_FORM_URL = 'https://opticab-backend.vercel.app/api/payment-form';
const SUBSCRIPTION_STATUS_URL = 'https://opticab-backend.vercel.app/api/subscription-status';
const SAVED_ROUTES_URL = 'https://opticab-backend.vercel.app/api/saved-routes';
const RIDE_HISTORY_URL = 'https://opticab-backend.vercel.app/api/ride-history';
const FARE_REFRESH_URL = 'https://opticab-backend.vercel.app/api/fare-refresh';

// ─── Theme ───
const COLORS = {
  teal: '#1D4E5F',
  tealLight: '#2A6B7C',
  gold: '#F2C94C',
  goldDark: '#D4A93A',
  bg: '#F5F7FA',
  white: '#FFFFFF',
  card: '#FFFFFF',
  text: '#1D4E5F',
  textLight: '#5A7A86',
  textMuted: '#8FA8B2',
  border: '#E2EBF0',
  alert: '#FFF8E1',
  alertBorder: '#F2C94C',
  error: '#E74C3C',
  success: '#27AE60',
};

const AVAILABLE_APPS = ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro'];

const getTimeString = (minutesFromNow) => {
  const now = new Date();
  const futureTime = new Date(now.getTime() + minutesFromNow * 60 * 1000);
  return futureTime.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' });
};

const getDropoffName = (dropoff) => {
  if (!dropoff) return 'Unknown location';
  if (typeof dropoff === 'string') {
    const cleaned = dropoff.trim();
    if (!cleaned || cleaned === 'null' || cleaned === 'NIL') return 'Unknown location';
    return cleaned;
  }
  return dropoff.address || dropoff.name || 'Unknown location';
};

// ─── Custom Popup Component ───
function CustomAlert({ visible, title, message, buttons, onClose }) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={popupStyles.overlay}>
        <View style={popupStyles.container}>
          {title && <Text style={popupStyles.title}>{title}</Text>}
          {message && <Text style={popupStyles.message}>{message}</Text>}
          <View style={popupStyles.buttonRow}>
            {(buttons || [{ text: 'OK', onPress: onClose }]).map((btn, i) => (
              <TouchableOpacity
                key={i}
                style={[popupStyles.button, btn.style === 'cancel' ? popupStyles.buttonCancel : popupStyles.buttonPrimary]}
                onPress={() => { onClose(); btn.onPress?.(); }}
              >
                <Text style={[popupStyles.buttonText, btn.style === 'cancel' && popupStyles.buttonTextCancel]}>{btn.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const popupStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(29,78,95,0.6)', justifyContent: 'center', padding: 28 },
  container: { backgroundColor: '#fff', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 10 },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.teal, marginBottom: 8 },
  message: { fontSize: 14, color: COLORS.textLight, lineHeight: 20, marginBottom: 20 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  button: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  buttonPrimary: { backgroundColor: COLORS.teal },
  buttonCancel: { backgroundColor: COLORS.border },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  buttonTextCancel: { color: COLORS.textLight },
});

// ─── Main App ───
export default function App() {
  // Splash
  const [showSplash, setShowSplash] = useState(true);
  const splashOpacity = useRef(new Animated.Value(1)).current;

  // Alert state
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', buttons: null });
  const showAlert = (title, message, buttons) => setAlertConfig({ visible: true, title, message, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  // Core state
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [isAutoPolling, setIsAutoPolling] = useState(false);
  const [result, setResult] = useState(null);
  const [resolvedCoords, setResolvedCoords] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
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
  const [radarRefreshing, setRadarRefreshing] = useState(false);
  const [lastRouteData, setLastRouteData] = useState(null);
  const lastPriceRef = useRef(null); // Track previous cheapest price for drop detection

  // Setup notifications on mount (native only)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
        });
      }
    })();
  }, []);
  const [selectedApps, setSelectedApps] = useState(AVAILABLE_APPS);
  const [checkingSubscription, setCheckingSubscription] = useState(true);
  const [pickupIsCurrentLocation, setPickupIsCurrentLocation] = useState(false);

  // Splash animation
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(splashOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => setShowSplash(false));
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Device ID + email
  useEffect(() => {
    (async () => {
      try {
        let id = await AsyncStorage.getItem('opticab_device_id');
        if (!id) {
          if (Platform.OS === 'android' && Application.getAndroidId) id = Application.getAndroidId();
          if (!id) id = `opticab-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
          await AsyncStorage.setItem('opticab_device_id', id);
        }
        setDeviceId(id);
        const savedEmail = await AsyncStorage.getItem('opticab_email');
        if (savedEmail) setUserEmail(savedEmail);
      } catch { setDeviceId(`opticab-${Date.now()}-${Math.random().toString(36).slice(2)}`); }
    })();
  }, []);

  // Check subscription
  useEffect(() => { if (userEmail) checkSubscriptionStatus(); }, [userEmail]);

  const checkSubscriptionStatus = async () => {
    if (!userEmail) { setCheckingSubscription(false); return; }
    try {
      const res = await fetch(SUBSCRIPTION_STATUS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail }) });
      const data = await res.json();
      setIsPremium(data.isPremium === true);
    } catch {} finally { setCheckingSubscription(false); }
  };

  // Load routes + history
  useEffect(() => { if (deviceId) { loadSavedRoutes(); loadRideHistory(); } }, [deviceId]);

  const loadSavedRoutes = async () => {
    try {
      const res = await fetch(SAVED_ROUTES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, action: 'get' }) });
      const data = await res.json();
      setSavedRoutes({ home: data.home || null, work: data.work || null });
    } catch {}
  };

  const loadRideHistory = async () => {
    try {
      const res = await fetch(RIDE_HISTORY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, action: 'get' }) });
      const data = await res.json();
      setRideHistory(data.history || []);
    } catch {}
  };

  const saveCurrentRoute = () => {
    if (!deviceId || !promptText.trim()) { showAlert('No Route', 'Enter a destination first.'); return; }
    showAlert('Save Route', 'Save this as:', [
      { text: 'Cancel', style: 'cancel' },
      { text: '🏠 Home', onPress: () => doSaveRoute('home') },
      { text: '💼 Work', onPress: () => doSaveRoute('work') },
    ]);
  };

  const doSaveRoute = async (type) => {
    try {
      const res = await fetch(SAVED_ROUTES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, action: 'save', type, prompt: promptText }) });
      const data = await res.json();
      setSavedRoutes({ home: data.home || null, work: data.work || null });
      showAlert('Saved!', `${type === 'home' ? 'Home' : 'Work'} route updated.`);
    } catch { showAlert('Error', 'Could not save route.'); }
  };

  const saveToHistory = async (resultData) => {
    if (!deviceId || !resultData?.extractedRoute) return;
    try {
      await fetch(RIDE_HISTORY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, action: 'save', ride: { prompt: promptText, cheapestProvider: resultData.cheapest?.provider, cheapestPrice: resultData.cheapest?.price } }) });
      loadRideHistory();
    } catch {}
  };

  // Lightweight fare refresh for Fare-Watch (skips LLM + routing)
  const fareWatchRefresh = async () => {
    if (!lastRouteData) return;
    try {
      const response = await fetch(FARE_REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastRouteData),
      });
      const data = await response.json();
      if (data && !data.error) {
        // Check for price drop
        const newCheapest = data.cheapest?.price;
        const prevPrice = lastPriceRef.current;
        if (prevPrice && newCheapest && newCheapest < prevPrice) {
          const savings = (prevPrice - newCheapest).toFixed(2);
          scheduleNotification({
              title: '💰 Price Dropped!',
              body: `${data.cheapest.provider} now $${newCheapest.toFixed(2)} (was $${prevPrice.toFixed(2)}) — save $${savings}`,
              sound: true,
            });
        }
        lastPriceRef.current = newCheapest;
        setResult(data);
      }
    } catch {}
  };

  // Payment
  const handleUpgrade = () => setShowEmailPrompt(true);

  const handlePaymentMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.status === 'success') { setShowPaymentModal(false); setIsPremium(true); showAlert('🎉 Welcome to Premium!', 'Fare-Watch is now unlocked.'); }
    } catch {}
  };

  const toggleAppSelection = (appName) => {
    if (selectedApps.includes(appName)) {
      if (selectedApps.length === 1) return;
      setSelectedApps(selectedApps.filter(app => app !== appName));
    } else { setSelectedApps([...selectedApps, appName]); }
  };

  // Search
  const handleSearchCommute = useCallback(async (isBackgroundRefresh = false) => {
    if (!promptText.trim()) return;
    if (!isBackgroundRefresh) setLoading(true);
    try {
      const hasFromKeyword = /\bfrom\b/i.test(promptText);
      const hasTwoPostalCodes = (promptText.match(/\b\d{6}\b/g) || []).length >= 2;
      const hasExplicitPickupBeforeTo = /^[^]*?\S+\s+to\s+/i.test(promptText) && !/\b(take|bring|go|get)\s+(me\s+)?to\b/i.test(promptText);
      const userSpecifiedPickup = hasFromKeyword || hasTwoPostalCodes || hasExplicitPickupBeforeTo;

      let locationContext = null;
      let coords = null;

      if (!userSpecifiedPickup) {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          const permResult = await Location.requestForegroundPermissionsAsync();
          status = permResult.status;
          if (status !== 'granted') {
            showAlert('Location Required', 'Please specify a "from" location or enable GPS.');
            setLoading(false);
            return;
          }
        }
        let loc = await Location.getCurrentPositionAsync({});
        coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        locationContext = `${coords.lat}, ${coords.lng}`;
      }

      if (coords) setResolvedCoords(coords);
      setPickupIsCurrentLocation(!userSpecifiedPickup);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: promptText, currentGpsLocation: locationContext, allowedApps: selectedApps }),
      });
      const data = await response.json();
      setResult(data);
      if (!isBackgroundRefresh && data && !data.isInvalidInput) {
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 300);
        saveToHistory(data);
        // Cache route data for Fare-Watch lightweight refreshes
        if (data.extractedRoute) {
          lastPriceRef.current = data.cheapest?.price || null;
          setLastRouteData({
            pickupLat: resolvedCoords?.lat || null,
            pickupLng: resolvedCoords?.lng || null,
            dropoffName: getDropoffName(data.extractedRoute.dropoff),
            distanceKm: data.cheapest?.rideDuration ? Math.round(data.cheapest.rideDuration * 25 / 60 * 10) / 10 : 8,
            allowedApps: selectedApps,
            pickupDisplay: getDropoffName(data.extractedRoute.pickup),
            dropoffDisplay: getDropoffName(data.extractedRoute.dropoff),
            pickupIsCurrentLocation: data.extractedRoute.pickupIsCurrentLocation || false,
          });
        }
      }
    } catch (err) {
      if (!isBackgroundRefresh) showAlert('Error', 'Failed to communicate with OptiCab.');
    } finally { if (!isBackgroundRefresh) setLoading(false); }
  }, [promptText, selectedApps]);

  // Radar
  useEffect(() => {
    if (!isPremium || !isAutoPolling || !result) return;
    setRadarCountdown(30);
    const radarTimer = setInterval(async () => {
      setRadarRefreshing(true);
      await fareWatchRefresh();
      setRadarRefreshing(false);
      setRadarCountdown(30);
    }, 30000);
    const countdownTimer = setInterval(() => { setRadarCountdown(prev => prev > 0 ? prev - 1 : 0); }, 1000);
    return () => { clearInterval(radarTimer); clearInterval(countdownTimer); };
  }, [isPremium, isAutoPolling, result]);

  // App config for deep linking
  const APPS = {
    grab: { scheme: 'grab://', iosStore: 'https://apps.apple.com/sg/app/grab-superapp/id647268330', androidStore: 'https://play.google.com/store/apps/details?id=com.grabtaxi.passenger' },
    tada: { scheme: 'tada://', iosStore: 'https://apps.apple.com/sg/app/tada-ride-hailing/id1412329684', androidStore: 'https://play.google.com/store/apps/details?id=io.mvlchain.tada' },
    gojek: { scheme: 'gojek://', iosStore: 'https://apps.apple.com/sg/app/gojek/id944875099', androidStore: 'https://play.google.com/store/apps/details?id=com.gojek.app' },
    ryde: { scheme: 'ryde://', iosStore: 'https://apps.apple.com/sg/app/ryde-ride-hailing-more/id979806982', androidStore: 'https://play.google.com/store/apps/details?id=com.rydesharing.ryde' },
    comfortdelgro: { scheme: 'cdgzig://', iosStore: 'https://apps.apple.com/sg/app/cdg-zig-taxis-cars/id954951647', androidStore: 'https://play.google.com/store/apps/details?id=com.codigo.comfort' },
  };

  const launchDeepLink = async (provider, dropoffName) => {
    const destination = dropoffName || 'your destination';
    const key = provider.toLowerCase();

    // Walk option — always open maps
    if (key === 'walk (healthy option)') {
      const origin = `${resolvedCoords?.lat ?? 1.3048},${resolvedCoords?.lng ?? 103.8318}`;
      const url = Platform.OS === 'ios'
        ? `https://maps.apple.com/?saddr=${origin}&daddr=${encodeURIComponent(destination)}&dirflg=w`
        : `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${encodeURIComponent(destination)}&travelmode=walking`;
      Linking.openURL(url);
      return;
    }

    const app = APPS[key];
    if (!app) return;

    // Copy destination to clipboard
    Clipboard.setStringAsync(destination);

    showAlert(`Opening ${provider}`, `📋 Destination copied!\n\n"${destination}"\n\nPaste it in the "To" field after the app opens.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open', onPress: async () => {
        try {
          await Linking.openURL(app.scheme);
        } catch {
          await Linking.openURL(Platform.OS === 'ios' ? app.iosStore : app.androidStore);
        }
      }},
    ]);
  };

  // ─── RENDER ───
  if (showSplash) {
    return (
      <Animated.View style={[styles.splash, { opacity: splashOpacity }]}>  
        <StatusBar barStyle="light-content" backgroundColor={COLORS.teal} />
        <Image source={require('./assets/logo.png')} style={styles.splashLogo} resizeMode="contain" />
      </Animated.View>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
        <ScrollView showsVerticalScrollIndicator={false} ref={scrollViewRef}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>OptiCab</Text>
            <Text style={styles.subtitle}>Cheap & Quick</Text>
            {isPremium && <Text style={styles.premiumBadge}>Premium</Text>}
          </View>

          {/* Input */}
          <TextInput
            style={styles.input}
            placeholder="Where to? (e.g., Take me to Bishan)"
            placeholderTextColor={COLORS.textMuted}
            value={promptText}
            onChangeText={setPromptText}
            onSubmitEditing={() => { Keyboard.dismiss(); handleSearchCommute(false); }}
            returnKeyType="search"
          />

          {/* Quick Access */}
          <View style={styles.quickRow}>
            {savedRoutes.home && (
              <TouchableOpacity style={styles.quickChip} onPress={() => setPromptText(savedRoutes.home)}>
                <Text style={styles.quickChipText}>🏠 Home</Text>
              </TouchableOpacity>
            )}
            {savedRoutes.work && (
              <TouchableOpacity style={styles.quickChip} onPress={() => setPromptText(savedRoutes.work)}>
                <Text style={styles.quickChipText}>💼 Work</Text>
              </TouchableOpacity>
            )}
            {promptText.trim().length > 0 && (
              <TouchableOpacity style={styles.quickChipOutline} onPress={saveCurrentRoute}>
                <Text style={styles.quickChipOutlineText}>💾 Save</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.quickChipOutline} onPress={() => setShowHistory(!showHistory)}>
              <Text style={styles.quickChipOutlineText}>{showHistory ? '✕' : '📋'} History</Text>
            </TouchableOpacity>
          </View>

          {/* History */}
          {showHistory && (
            <View style={styles.historyPanel}>
              {rideHistory.length === 0 ? <Text style={styles.historyMeta}>No searches yet.</Text> :
                rideHistory.slice(0, 2).map((ride, idx) => (
                  <TouchableOpacity key={idx} style={styles.historyItem} onPress={() => { setPromptText(ride.prompt); setShowHistory(false); }}>
                    <Text style={styles.historyRoute}>{ride.prompt}</Text>
                    {ride.cheapestProvider && <Text style={styles.historyMeta}>{ride.cheapestProvider} ${ride.cheapestPrice?.toFixed(2)}</Text>}
                  </TouchableOpacity>
                ))
              }
            </View>
          )}

          {/* App Filter */}
          <Text style={styles.filterTitle}>Compare:</Text>
          <View style={styles.checkboxRow}>
            {AVAILABLE_APPS.map((app) => {
              const isChecked = selectedApps.includes(app);
              return (
                <TouchableOpacity key={app} style={[styles.chip, isChecked ? styles.chipActive : styles.chipInactive]} onPress={() => toggleAppSelection(app)}>
                  <Text style={[styles.chipText, isChecked ? styles.chipTextActive : styles.chipTextInactive]}>{isChecked ? '✓' : '+'} {app}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.searchBtn} onPress={() => { Keyboard.dismiss(); handleSearchCommute(false); }}>
              {loading && !isAutoPolling ? <ActivityIndicator color={COLORS.teal} /> : <Text style={styles.searchBtnText}>Search Fares</Text>}
            </TouchableOpacity>
            {isPremium && (
              <TouchableOpacity
                style={[styles.radarBtn, isAutoPolling && styles.radarBtnActive]}
                onPress={async () => {
                  if (isAutoPolling) {
                    setIsAutoPolling(false);
                  } else {
                    Keyboard.dismiss();
                    setIsAutoPolling(true);
                    await handleSearchCommute(false);
                  }
                }}
              >
                {(loading && isAutoPolling) || radarRefreshing ? <ActivityIndicator color={isAutoPolling ? COLORS.gold : COLORS.teal} /> :
                  <Text style={[styles.radarBtnText, isAutoPolling && styles.radarBtnTextActive]}>
                    {isAutoPolling ? `📡 ${radarCountdown}s` : '🛰️ Fare-Watch'}
                  </Text>
                }
              </TouchableOpacity>
            )}
          </View>

          {/* Error / Invalid */}
          {result && (result.isInvalidInput || result.error) && (
            <View style={styles.alertBox}>
              <Text style={styles.alertText}>{result.message || result.error || 'Something went wrong.'}</Text>
            </View>
          )}

          {/* Results */}
          {result && !result.isInvalidInput && result.extractedRoute && (
            <View style={{ marginBottom: 100 }}>
              <View style={styles.routeBox}>
                <Text style={styles.routeText}>{result.extractedRoute.pickupIsCurrentLocation ? '📌 Current: ' : '📍 From: '}{getDropoffName(result.extractedRoute.pickup)}</Text>
                <Text style={styles.routeText}>🏁 To: {getDropoffName(result.extractedRoute.dropoff)}</Text>
              </View>

              {result.alerts?.length > 0 && (
                <View style={styles.alertBox}>
                  <Text style={styles.alertTitle}>⚠️ Live Advisory</Text>
                  {result.alerts.map((alert, idx) => <Text key={idx} style={styles.alertText}>• {alert}</Text>)}
                </View>
              )}

              {result.cheapest.provider === result.fastest.provider ? (
                <TouchableOpacity style={styles.cardFull} onPress={() => launchDeepLink(result.cheapest.provider, getDropoffName(result.extractedRoute.dropoff))}>
                  <Text style={styles.cardLabel}>💰⚡ CHEAPEST & FASTEST</Text>
                  <Text style={styles.cardPrice}>${result.cheapest.price.toFixed(2)}</Text>
                  <Text style={styles.cardProvider}>{result.cheapest.provider}</Text>
                  {result.cheapest.carType && <Text style={styles.cardCarType}>🚘 {result.cheapest.carType}</Text>}
                  {result.cheapest.eta != null && <Text style={styles.cardTiming}>🚗 Pickup: {result.cheapest.eta} min ({getTimeString(result.cheapest.eta)})</Text>}
                  {result.cheapest.rideDuration != null && <Text style={styles.cardTiming}>📍 Dropoff: {result.cheapest.rideDuration} min ({getTimeString(result.cheapest.eta + result.cheapest.rideDuration)})</Text>}
                  <Text style={styles.cardCta}>{result.cheapest.provider.toLowerCase().includes('walk') ? 'Open Maps →' : 'Tap to book →'}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.cardRow}>
                  <TouchableOpacity style={styles.card} onPress={() => launchDeepLink(result.cheapest.provider, getDropoffName(result.extractedRoute.dropoff))}>
                    <Text style={styles.cardLabel}>💰 CHEAPEST</Text>
                    <Text style={styles.cardPrice}>${result.cheapest.price.toFixed(2)}</Text>
                    <Text style={styles.cardProvider}>{result.cheapest.provider}</Text>
                    {result.cheapest.carType && <Text style={styles.cardCarType}>🚘 {result.cheapest.carType}</Text>}
                    {result.cheapest.eta != null && <Text style={styles.cardTiming}>🚗 Pickup: {result.cheapest.eta} min ({getTimeString(result.cheapest.eta)})</Text>}
                    {result.cheapest.rideDuration != null && <Text style={styles.cardTiming}>📍 Dropoff: {result.cheapest.rideDuration} min ({getTimeString(result.cheapest.eta + result.cheapest.rideDuration)})</Text>}
                    <Text style={styles.cardCta}>{result.cheapest.provider.toLowerCase().includes('walk') ? 'Maps →' : 'Book →'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.card} onPress={() => launchDeepLink(result.fastest.provider, getDropoffName(result.extractedRoute.dropoff))}>
                    <Text style={styles.cardLabel}>⚡ FASTEST</Text>
                    <Text style={styles.cardPrice}>${result.fastest.price.toFixed(2)}</Text>
                    <Text style={styles.cardProvider}>{result.fastest.provider}</Text>
                    {result.fastest.carType && <Text style={styles.cardCarType}>🚘 {result.fastest.carType}</Text>}
                    {result.fastest.eta != null && <Text style={styles.cardTiming}>🚗 Pickup: {result.fastest.eta} min ({getTimeString(result.fastest.eta)})</Text>}
                    {result.fastest.rideDuration != null && <Text style={styles.cardTiming}>📍 Dropoff: {result.fastest.rideDuration} min ({getTimeString(result.fastest.eta + result.fastest.rideDuration)})</Text>}
                    <Text style={styles.cardCta}>Book →</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Upgrade Footer */}
        {!isPremium && (
          <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade}>
            <Text style={styles.upgradeBtnText}>👑 Upgrade to Premium</Text>
            <Text style={styles.upgradeBtnSub}>Runs automated Fare-Watch every 30s</Text>
          </TouchableOpacity>
        )}

        {/* Custom Alert */}
        <CustomAlert {...alertConfig} onClose={hideAlert} />

        {/* Email Modal */}
        {showEmailPrompt && (
          <Modal visible={true} transparent animationType="fade" onRequestClose={() => setShowEmailPrompt(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(29,78,95,0.6)', justifyContent: 'center', padding: 24 }}>
              <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: COLORS.teal, marginBottom: 8 }}>Enter Email</Text>
                <Text style={{ fontSize: 13, color: COLORS.textLight, marginBottom: 16 }}>Used to manage your subscription.</Text>
                <TextInput
                  style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16 }}
                  placeholder="you@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={emailInput}
                  onChangeText={setEmailInput}
                />
                <TouchableOpacity
                  onPress={async () => {
                    Keyboard.dismiss();
                    if (!emailInput || !emailInput.includes('@')) { showAlert('Invalid', 'Please enter a valid email.'); return; }
                    const email = emailInput.trim().toLowerCase();
                    setUserEmail(email);
                    AsyncStorage.setItem('opticab_email', email);
                    setShowEmailPrompt(false);
                    try {
                      const response = await fetch(CREATE_PAYMENT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
                      const data = await response.json();
                      if (data.clientSecret && data.publishableKey) {
                        const url = `${PAYMENT_FORM_URL}?clientSecret=${encodeURIComponent(data.clientSecret)}&publishableKey=${encodeURIComponent(data.publishableKey)}`;
                        if (Platform.OS === 'web') {
                          window.open(url, '_blank');
                          showAlert('Payment Opened', 'Complete payment in the new tab. Once done, your premium will activate.');
                        } else {
                          setPaymentUrl(url);
                          setShowPaymentModal(true);
                        }
                      } else { showAlert('Error', data.details || 'Payment setup failed.'); }
                    } catch (e) { showAlert('Network Error', e.message); }
                  }}
                  style={{ backgroundColor: COLORS.gold, padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 }}
                >
                  <Text style={{ color: COLORS.teal, fontWeight: '800', fontSize: 16 }}>Continue</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowEmailPrompt(false)} style={{ padding: 10, alignItems: 'center' }}>
                  <Text style={{ color: COLORS.textMuted }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* Payment Modal */}
        <Modal visible={showPaymentModal} animationType="slide" onRequestClose={() => setShowPaymentModal(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowPaymentModal(false)}>
                <Text style={styles.modalClose}>✕ Close</Text>
              </TouchableOpacity>
            </View>
            {paymentUrl && (
              <PaymentWebView uri={paymentUrl} onMessage={handlePaymentMessage} style={{ flex: 1 }} />
            )}
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}


const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: COLORS.teal, justifyContent: 'center', alignItems: 'center' },
  splashLogo: { width: 220, height: 220 },
  container: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 20 },
  header: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 32, fontWeight: '900', color: COLORS.teal },
  subtitle: { fontSize: 13, color: COLORS.textMuted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 },
  premiumBadge: { fontSize: 11, color: COLORS.gold, fontWeight: '700', marginTop: 4, backgroundColor: COLORS.teal, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  input: { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, padding: 14, fontSize: 15, color: COLORS.text },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginBottom: 4, gap: 8 },
  quickChip: { backgroundColor: COLORS.teal, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  quickChipText: { color: COLORS.gold, fontSize: 13, fontWeight: '600' },
  quickChipOutline: { borderWidth: 1.5, borderColor: COLORS.teal, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  quickChipOutlineText: { color: COLORS.teal, fontSize: 12, fontWeight: '600' },
  historyPanel: { backgroundColor: COLORS.white, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  historyItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  historyRoute: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  historyMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  filterTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textLight, marginTop: 12, marginBottom: 6 },
  checkboxRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  chipActive: { backgroundColor: COLORS.teal, borderColor: COLORS.teal },
  chipInactive: { backgroundColor: COLORS.white, borderColor: COLORS.border },
  chipText: { fontSize: 11, fontWeight: '600' },
  chipTextActive: { color: COLORS.gold },
  chipTextInactive: { color: COLORS.textLight },
  actionRow: { flexDirection: 'row', marginTop: 4, marginBottom: 16, gap: 8 },
  searchBtn: { flex: 1, backgroundColor: COLORS.gold, padding: 14, borderRadius: 10, alignItems: 'center' },
  searchBtnText: { color: COLORS.teal, fontWeight: '800', fontSize: 15 },
  radarBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.teal, alignItems: 'center', justifyContent: 'center' },
  radarBtnActive: { backgroundColor: COLORS.teal, borderColor: COLORS.teal },
  radarBtnText: { fontWeight: '700', fontSize: 13, color: COLORS.teal },
  radarBtnTextActive: { color: COLORS.gold },
  alertBox: { backgroundColor: COLORS.alert, borderLeftWidth: 4, borderLeftColor: COLORS.alertBorder, padding: 12, borderRadius: 8, marginBottom: 16 },
  alertTitle: { fontSize: 12, fontWeight: '700', color: COLORS.teal, marginBottom: 4 },
  alertText: { fontSize: 12, color: COLORS.textLight },
  routeBox: { backgroundColor: COLORS.white, padding: 12, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  routeText: { fontSize: 13, fontWeight: '600', color: COLORS.text, textAlign: 'center' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  card: { flex: 1, backgroundColor: COLORS.white, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, shadowColor: COLORS.teal, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardFull: { backgroundColor: COLORS.white, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: COLORS.border, shadowColor: COLORS.teal, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted, marginBottom: 6, letterSpacing: 0.5 },
  cardPrice: { fontSize: 28, fontWeight: '900', color: COLORS.teal },
  cardProvider: { fontSize: 14, color: COLORS.textLight, fontWeight: '600', marginTop: 2 },
  cardCarType: { fontSize: 11, color: COLORS.textMuted, marginTop: 3, fontStyle: 'italic' },
  cardTiming: { fontSize: 11, color: COLORS.textLight, marginTop: 4 },
  cardCta: { fontSize: 11, color: COLORS.gold, fontWeight: '700', marginTop: 12 },
  upgradeBtn: { backgroundColor: COLORS.teal, padding: 15, borderRadius: 12, alignItems: 'center', position: 'absolute', bottom: 30, left: 16, right: 16, shadowColor: COLORS.teal, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  upgradeBtnText: { color: COLORS.gold, fontWeight: '800', fontSize: 15 },
  upgradeBtnSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  modalHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalClose: { fontSize: 16, color: COLORS.textLight, fontWeight: '600' },
});
