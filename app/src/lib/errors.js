import { getAppCheckStatus } from './firebase.js'

export function formatFirebaseError(e){
  if (!e) return 'Unknown error'
  const code = typeof e.code === 'string' ? e.code : ''
  const msg = e?.message ? String(e.message) : String(e)
  const base = (code && msg && !msg.toLowerCase().includes(code.toLowerCase()))
    ? `${code}: ${msg}`
    : (msg || (code ? String(code) : 'Unknown error'))

  // If Firestore/Storage App Check enforcement is enabled, failures commonly surface as generic permission-denied.
  // Add a high-signal hint when we can detect App Check is broken (reCAPTCHA error, missing token, etc.).
  if (isPermissionDenied(e)){
    try{
      const st = getAppCheckStatus?.()
      const appCheckCode = String(st?.error?.code || '')
      const hasToken = !!st?.tokenPrefix
      const hasAppCheckError = !!appCheckCode
      // Only blame App Check when it actually looks broken (missing token or explicit appCheck/* error).
      if (st?.enabled && (!hasToken || appCheckCode.startsWith('appCheck/'))){
        return `${base} (App Check may be involved: ${hasAppCheckError ? appCheckCode : 'no token yet'}. If App Check enforcement is enabled for this API, missing/invalid tokens will cause permission-denied. Check Firebase Console → App Check settings + your reCAPTCHA v3 site key allowed domains; also try disabling ad blockers.)`
      }
    }catch(_e){
      // ignore
    }
  }

  return base
}

export function isPermissionDenied(e){
  const code = String(e?.code || '').toLowerCase()
  // Firestore errors are like "permission-denied". Callable wrapper uses "functions/permission-denied".
  return code === 'permission-denied' || code === 'firestore/permission-denied' || code === 'functions/permission-denied'
}


