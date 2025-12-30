import { httpsCallable } from 'firebase/functions'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, functions, getAppCheckToken } from './firebase.js'

function isHostedOrigin(){
  if (typeof window === 'undefined') return false
  const h = window.location.hostname || ''
  return h.endsWith('.web.app') || h.endsWith('.firebaseapp.com')
}

function normalizeName(name){
  const fnName = String(name || '').trim()
  if (!fnName) throw new Error('Missing callable name')
  return fnName
}

async function waitForAuthUser(timeoutMs = 2000){
  if (auth.currentUser) return auth.currentUser
  return await new Promise((resolve)=>{
    const t = setTimeout(()=>{
      unsub()
      resolve(null)
    }, Math.max(0, Number(timeoutMs) || 0))
    const unsub = onAuthStateChanged(auth, (u)=>{
      if (u){
        clearTimeout(t)
        unsub()
        resolve(u)
      }
    })
  })
}

// Calls Firebase callable functions.
// - On localhost: use the Firebase SDK httpsCallable() directly.
// - On Firebase Hosting: call same-origin `/api/<name>` and attach the ID token explicitly.
//   (Some environments block/strip auth headers when using httpsCallableFromURL.)
export async function callCallable(name, data){
  const fnName = normalizeName(name)
  const payload = data || {}

  if (!isHostedOrigin()){
    const fn = httpsCallable(functions, fnName)
    return await fn(payload)
  }

  // Hosted: manual callable protocol over same-origin fetch
  const u = await waitForAuthUser(2500)
  const token = u ? await u.getIdToken(true) : null
  // App Check is NOT automatically attached to manual fetch() calls.
  // If Functions App Check enforcement is enabled, we must send X-Firebase-AppCheck ourselves.
  const appCheckToken = await getAppCheckToken(false)
  const res = await fetch(`/api/${encodeURIComponent(fnName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
    },
    body: JSON.stringify({ data: payload }),
  })

  let json = null
  try{
    json = await res.json()
  }catch(_e){}

  if (res.ok){
    return { data: json?.result }
  }

  // Callable error format: { error: { status, message, details } }
  const err = json?.error || {}
  const message = err?.message || `Callable failed (${res.status})`
  const code = err?.status ? `functions/${String(err.status).toLowerCase()}` : 'functions/internal'
  const e = new Error(message)
  e.code = code
  if (err?.details != null) e.details = err.details
  throw e
}

// Convenience wrapper used throughout the app:
// const fn = getCallable('myFunction'); await fn({ ... })
export function getCallable(name){
  const fnName = normalizeName(name)
  return async (data)=>await callCallable(fnName, data)
}


