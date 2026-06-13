import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'
import { doc, getDoc, getFirestore, setLogLevel as setFirestoreLogLevel } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { ReCaptchaV3Provider, getToken, initializeAppCheck } from 'firebase/app-check'

const firebaseConfig = {
  apiKey: 'AIzaSyCJTmL7fVTkf328MLSr-8je95CqtSxfMo0',
  projectId: 'quantara-1',
  authDomain: 'quantara-1.firebaseapp.com',
  // Keep this in sync with your Firebase project’s Storage bucket.
  // (The emulator/debug log shows the default bucket as `quantara-1.firebasestorage.app`.)
  storageBucket: 'quantara-1.firebasestorage.app',
  // App Check (and some other Firebase features) expect a Firebase App ID.
  // Prefer setting this via Vite env so you don’t hardcode config in source.
  appId: (import.meta?.env?.VITE_FIREBASE_APP_ID ?? '').toString().trim() || undefined,
  messagingSenderId: (import.meta?.env?.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').toString().trim() || undefined,
}

const singleton = (() => {
  try{
    // Persist instances across Vite Fast Refresh / dev reloads to avoid duplicate init.
    // eslint-disable-next-line no-undef
    const g = globalThis
    if (!g.__quantaraFirebaseSingleton) g.__quantaraFirebaseSingleton = {}
    return g.__quantaraFirebaseSingleton
  }catch(_e){
    return {}
  }
})()

const app = singleton.app || (()=>{
  const a = getApps().length ? getApp() : initializeApp(firebaseConfig)
  singleton.app = a
  return a
})()

// -----------------------------
// App Check (optional)
// -----------------------------
// If you enforce App Check for Firestore/Storage in Firebase Console, you MUST initialize it on the web client.
// To enable:
// - Create a reCAPTCHA v3 key
// - Add it as VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY in your Hosting env/build env
// - Redeploy
let appCheck = singleton.appCheck || null
// Track the latest App Check status so UI can show actionable errors when enforcement blocks requests.
const appCheckStatus = {
  enabled: false,
  tokenPrefix: null,
  error: null,
  siteKeyPrefix: null,
}


export function getAppCheckStatus(){
  return { ...appCheckStatus }
}

// Returns the current App Check token string (or null if App Check isn't initialized / token fetch fails).
// Useful when calling same-origin endpoints manually (e.g. Hosting rewrites) where Firebase SDK headers
// aren't automatically attached.
export async function getAppCheckToken(forceRefresh = false){
  if (!appCheck) return null
  try{
    const t = await getToken(appCheck, !!forceRefresh)
    return t?.token ? String(t.token) : null
  }catch(_e){
    return null
  }
}

try{
  if (typeof window !== 'undefined'){
    // Debug token support (local dev):
    // - Set VITE_APPCHECK_DEBUG_TOKEN=true to auto-generate one and print it in console.
    // - Or set VITE_APPCHECK_DEBUG_TOKEN=<token> to use a fixed token.
    const dbg = (import.meta?.env?.VITE_APPCHECK_DEBUG_TOKEN ?? '').toString().trim()
    if (dbg){
      // eslint-disable-next-line no-undef
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = (dbg === 'true') ? true : dbg
    }

    // Use a build-time env var for the App Check reCAPTCHA v3 site key.
    // Note: reCAPTCHA *site* keys are public; do NOT put secret keys here.
    // IMPORTANT: Avoid a hardcoded fallback — using the wrong key causes ReCAPTCHA 400s and breaks App Check.
    const siteKey =
      (import.meta?.env?.VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY ?? '').toString().trim()
      || (import.meta?.env?.VITE_FIREBASE_APPCHECK_RECAPTCHA_V3_SITE_KEY ?? '').toString().trim()
    // App Check requires a Firebase App ID for the web app (Project settings → Your apps → App ID).
    const appId = (app?.options?.appId ?? '').toString().trim()
    const looksLikePlaceholder = (v)=> typeof v === 'string' && v.includes('...')
    // Typical Firebase App ID format (web): 1:<projectNumber>:web:<alphanumeric>
    const isValidFirebaseWebAppId = (v)=> {
      if (typeof v !== 'string') return false
      const s = v.trim()
      if (!s) return false
      if (looksLikePlaceholder(s)) return false
      return /^1:\d+:web:[A-Za-z0-9]+$/.test(s)
    }

    if (siteKey && !appId){
      appCheckStatus.enabled = false
      appCheckStatus.tokenPrefix = null
      appCheckStatus.siteKeyPrefix = `${String(siteKey).slice(0, 10)}…`
      appCheckStatus.error = {
        code: 'appCheck/misconfigured',
        message: 'Missing Firebase App ID (VITE_FIREBASE_APP_ID). App Check cannot initialize.',
      }
      // eslint-disable-next-line no-console
      console.warn('[appCheck] Not initialized: missing Firebase App ID (VITE_FIREBASE_APP_ID).')
    } else if (siteKey && appId && !isValidFirebaseWebAppId(appId)){
      // This prevents noisy 400s like:
      // "Invalid app resource name: projects/<projectId>/apps/<appId>"
      appCheckStatus.enabled = false
      appCheckStatus.tokenPrefix = null
      appCheckStatus.siteKeyPrefix = `${String(siteKey).slice(0, 10)}…`
      appCheckStatus.error = {
        code: 'appCheck/misconfigured',
        message:
          `Invalid Firebase Web App ID (VITE_FIREBASE_APP_ID). ` +
          `Expected format like "1:<projectNumber>:web:<alphanumeric>". ` +
          `Make sure you copied the App ID from Firebase Console → Project settings → Your apps.`,
      }
      // eslint-disable-next-line no-console
      console.warn('[appCheck] Not initialized: invalid Firebase App ID:', appId)
    } else if (siteKey){
      appCheckStatus.siteKeyPrefix = `${String(siteKey).slice(0, 10)}…`
      if (!appCheck){
        appCheck = initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(siteKey),
          isTokenAutoRefreshEnabled: true,
        })
        singleton.appCheck = appCheck
      }
      appCheckStatus.enabled = true

      // Best-effort: eagerly fetch a token so we can surface meaningful diagnostics if it fails.
      // (If App Check is enforced in Firebase Console, Firestore/Storage will otherwise just throw permission-denied.)
      getToken(appCheck, /* forceRefresh */ true).then((t)=>{
        appCheckStatus.tokenPrefix = t?.token ? `${String(t.token).slice(0, 12)}…` : null
        appCheckStatus.error = null
      }).catch((e)=>{
        appCheckStatus.tokenPrefix = null
        appCheckStatus.error = { code: e?.code || null, message: e?.message || String(e) }
        // eslint-disable-next-line no-console
        console.warn('[appCheck] Token fetch failed:', appCheckStatus.error)
      })
    } else {
      // Explicitly record why App Check isn't running in this build.
      appCheckStatus.enabled = false
      appCheckStatus.tokenPrefix = null
      appCheckStatus.error = { code: 'appCheck/misconfigured', message: 'Missing VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY' }
    }
  }
}catch(_e){
  appCheck = null
}

// IMPORTANT: Initialize App Check before creating service instances so enforcement can attach tokens reliably.
// (Some setups require App Check to be initialized before Firestore/Auth/Storage/Functions instances are created.)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

// Optional debug mode: visit any page with `?fbdebug=1` to enable verbose SDK logs.
// This helps diagnose "missing or insufficient permissions" by showing auth + request context.
try{
  if (typeof window !== 'undefined'){
    // Expose handles for quick inspection in DevTools (always available).
    // eslint-disable-next-line no-underscore-dangle
    window.__fbdebug = { app, auth, db, storage, functions, appCheck, getAppCheckStatus }
    // eslint-disable-next-line no-underscore-dangle
    window.__fbdebug.version = 'fbdebug-appcheck-2025-12-29.2'

    // Convenience helper for debugging from DevTools:
    // `await __fbdebug.check()` prints auth + ban status in a single call.
    // eslint-disable-next-line no-underscore-dangle
    window.__fbdebug.check = async ()=>{
      const u = auth.currentUser
      let tok = null
      try{ tok = u ? await u.getIdTokenResult(true) : null }catch(_e){}
      let appCheckToken = null
      let appCheckTokenError = null
      const host = (typeof window !== 'undefined' ? (window.location?.host || '') : '')
      const origin = (typeof window !== 'undefined' ? (window.location?.origin || '') : '')
      const grecaptchaPresent = !!(typeof window !== 'undefined' && window.grecaptcha && typeof window.grecaptcha.execute === 'function')
      try{
        if (appCheck){
          // Force-refresh so you can validate it immediately after changing App Check settings.
          const t = await getToken(appCheck, /* forceRefresh */ true)
          appCheckToken = t?.token ? `${String(t.token).slice(0, 12)}…` : null
          // Keep status in sync for UI + debugging.
          appCheckStatus.enabled = true
          appCheckStatus.tokenPrefix = appCheckToken
          appCheckStatus.error = null
        }
      }catch(e){
        appCheckTokenError = {
          code: e?.code || null,
          message: e?.message || String(e),
        }
        // Keep status in sync for UI + debugging.
        appCheckStatus.enabled = !!appCheck
        appCheckStatus.tokenPrefix = null
        appCheckStatus.error = appCheckTokenError
      }
      let userDoc = null
      try{
        if (u){
          const snap = await getDoc(doc(db, 'users', u.uid))
          userDoc = snap.exists() ? (snap.data() || null) : null
        }
      }catch(_e){}
      // eslint-disable-next-line no-console
      console.log('[fbdebug.check]', {
        projectId: app?.options?.projectId || null,
        appId: app?.options?.appId || null,
        uid: u?.uid || null,
        email: u?.email || null,
        claims: tok?.claims || null,
        userDocExists: !!userDoc,
        banUntil: userDoc?.banUntil || null,
        banReason: userDoc?.banReason || null,
        username: userDoc?.username || null,
        appCheckEnabled: !!appCheck,
        appCheckTokenPrefix: appCheckToken,
        appCheckTokenError,
        appCheckSiteKeyPrefix: appCheckStatus.siteKeyPrefix,
        host,
        origin,
        grecaptchaPresent,
      })
      return {
        projectId: app?.options?.projectId || null,
        appId: app?.options?.appId || null,
        uid: u?.uid || null,
        claims: tok?.claims || null,
        userDoc,
        appCheckEnabled: !!appCheck,
        appCheckTokenPrefix: appCheckToken,
        appCheckTokenError,
        appCheckSiteKeyPrefix: appCheckStatus.siteKeyPrefix,
        host,
        origin,
        grecaptchaPresent,
      }
    }

    const sp = new URLSearchParams(window.location.search || '')
    const enabled = sp.get('fbdebug') === '1' || window.localStorage?.getItem('fbdebug') === '1'
    if (enabled){
      setFirestoreLogLevel('debug')
      // Log basic app identity.
      // eslint-disable-next-line no-console
      console.log('[fbdebug] projectId:', app?.options?.projectId, 'authDomain:', app?.options?.authDomain)
      auth.onAuthStateChanged(async (u)=>{
        try{
          const tok = u ? await u.getIdTokenResult(true) : null
          // eslint-disable-next-line no-console
          console.log('[fbdebug] auth state:', {
            uid: u?.uid || null,
            email: u?.email || null,
            claims: tok?.claims || null,
          })
          if (u){
            try{
              const userSnap = await getDoc(doc(db, 'users', u.uid))
              const userData = userSnap.exists() ? (userSnap.data() || {}) : null
              // eslint-disable-next-line no-console
              console.log('[fbdebug] users/{uid}:', {
                exists: userSnap.exists(),
                username: userData?.username || null,
                banUntil: userData?.banUntil || null,
                banReason: userData?.banReason || null,
              })
            }catch(e2){
              // eslint-disable-next-line no-console
              console.log('[fbdebug] failed reading users/{uid}:', e2?.message || String(e2))
            }
          }
        }catch(e){
          // eslint-disable-next-line no-console
          console.log('[fbdebug] auth token error:', e?.message || String(e))
        }
      })
    }
  }
}catch(_e){}
