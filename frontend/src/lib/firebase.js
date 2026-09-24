/**
 * Firebase client: sign-in (email and password, Google, phone OTP), password
 * reset, and FCM push registration.
 *
 * Everything here is optional. With no VITE_FIREBASE_* variables the module
 * reports `configured: false`, the UI hides the sign-in screen, and the app
 * behaves exactly as it did before auth existed. Nothing throws.
 *
 * The SDK is imported lazily so the ~200 KB Firebase bundle is only fetched
 * by users who actually open the sign-in sheet.
 */

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
}

export const configured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId)

/**
 * The one service worker URL (offline cache + push). It carries the public
 * Firebase web config so the worker can handle background pushes, and a dev
 * flag that turns its caching off under the Vite dev server. Page load and
 * push registration must use exactly this URL, or they would replace each
 * other's worker.
 */
export function swUrl() {
  const q = new URLSearchParams()
  if (configured) {
    q.set('apiKey', cfg.apiKey); q.set('projectId', cfg.projectId)
    q.set('appId', cfg.appId); q.set('messagingSenderId', cfg.messagingSenderId || '')
  }
  if (!import.meta.env.PROD) q.set('dev', '1')
  return '/sw.js?' + q.toString()
}

let appPromise = null

async function getApp() {
  if (!configured) throw new Error('Firebase is not configured')
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp, getApps } = await import('firebase/app')
      return getApps().length ? getApps()[0] : initializeApp(cfg)
    })()
  }
  return appPromise
}

/** Host:port of the local Auth emulator, when one is configured. */
export const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || ''

let authInstance = null

export async function getAuthInstance() {
  if (authInstance) return authInstance
  const [{ getAuth, connectAuthEmulator }, app] =
    await Promise.all([import('firebase/auth'), getApp()])
  authInstance = getAuth(app)
  if (emulatorHost) {
    // Point the SDK at the local emulator: no SMS is sent and no Firebase
    // billing or console setup is needed to exercise the full OTP flow.
    connectAuthEmulator(authInstance, `http://${emulatorHost}`, { disableWarnings: true })
  }
  return authInstance
}

/**
 * Build the invisible reCAPTCHA that Firebase requires before it will send
 * an SMS. It is recreated whenever the host element is remounted, so a
 * cancelled sign-in does not leave a stale verifier behind.
 */
export async function ensureRecaptcha(containerId = 'recaptcha-container') {
  const { RecaptchaVerifier } = await import('firebase/auth')
  const auth = await getAuthInstance()
  if (window.__ntRecaptcha) {
    try { window.__ntRecaptcha.clear() } catch { /* already gone */ }
    window.__ntRecaptcha = null
  }
  window.__ntRecaptcha = new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
  return window.__ntRecaptcha
}

/** Send the OTP. Returns a confirmation object you pass to `confirmCode`. */
export async function sendOtp(phoneE164, containerId) {
  const { signInWithPhoneNumber } = await import('firebase/auth')
  const auth = await getAuthInstance()
  const verifier = await ensureRecaptcha(containerId)
  return signInWithPhoneNumber(auth, phoneE164, verifier)
}

export async function confirmCode(confirmation, code) {
  const result = await confirmation.confirm(code)
  return result.user
}

/* ----------------------------------------------------- email & Google */
export async function signUpEmail(name, email, password) {
  const { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } = await import('firebase/auth')
  const auth = await getAuthInstance()
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  if (name) await updateProfile(cred.user, { displayName: name })
  // Verification unlocks nothing essential, but an unverified address can
  // never be granted the admin role, so ask for it up front.
  try { await sendEmailVerification(cred.user) } catch { /* rate-limited: they can resend later */ }
  await cred.user.getIdToken(true)
  return cred.user
}

export async function signInEmail(email, password) {
  const { signInWithEmailAndPassword } = await import('firebase/auth')
  const auth = await getAuthInstance()
  return (await signInWithEmailAndPassword(auth, email, password)).user
}

export async function signInGoogle() {
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth')
  const auth = await getAuthInstance()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return (await signInWithPopup(auth, provider)).user
}

export async function resetPassword(email) {
  const { sendPasswordResetEmail } = await import('firebase/auth')
  const auth = await getAuthInstance()
  await sendPasswordResetEmail(auth, email)
}

export async function resendVerification() {
  const { sendEmailVerification } = await import('firebase/auth')
  const auth = await getAuthInstance()
  if (auth.currentUser) await sendEmailVerification(auth.currentUser)
}

export async function signOut() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_DATA' })
  if (!configured) return
  const { signOut: fbSignOut } = await import('firebase/auth')
  const auth = await getAuthInstance()
  await fbSignOut(auth)
}

/** Subscribe to auth-state changes. Returns an unsubscribe function. */
export async function onUser(callback) {
  if (!configured) { callback(null); return () => {} }
  const { onAuthStateChanged } = await import('firebase/auth')
  const auth = await getAuthInstance()
  return onAuthStateChanged(auth, callback)
}

/** Current ID token, or '' when signed out. Used as the Bearer credential. */
export async function idToken(forceRefresh = false) {
  if (!configured) return ''
  const auth = await getAuthInstance()
  const user = auth.currentUser
  return user ? user.getIdToken(forceRefresh) : ''
}

/**
 * Ask for notification permission and return an FCM registration token.
 * Returns '' for every ordinary refusal — unsupported browser, permission
 * denied, no service worker — so callers never need a try/catch.
 */
export async function requestPushToken({ ask = true } = {}) {
  if (!configured) return ''
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return ''
  try {
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
    if (!(await isSupported())) return ''
    // Only prompt when the user asked for alerts; otherwise reuse a grant.
    if (Notification.permission !== 'granted') {
      if (!ask || (await Notification.requestPermission()) !== 'granted') return ''
    }
    // One service worker (sw.js) serves both offline caching and push.
    const registration = await navigator.serviceWorker.register(swUrl())
    const app = await getApp()
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
    return await getToken(getMessaging(app), {
      ...(vapidKey ? { vapidKey } : {}),
      serviceWorkerRegistration: registration,
    })
  } catch (err) {
    console.warn('push registration skipped:', err?.message || err)
    return ''
  }
}

/** Foreground push handler — FCM does not show a banner while the tab is open. */
export async function onForegroundPush(handler) {
  if (!configured) return () => {}
  try {
    const { getMessaging, onMessage, isSupported } = await import('firebase/messaging')
    if (!(await isSupported())) return () => {}
    const app = await getApp()
    return onMessage(getMessaging(app), handler)
  } catch {
    return () => {}
  }
}
