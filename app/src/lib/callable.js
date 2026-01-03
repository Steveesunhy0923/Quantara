import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase.js'

function normalizeName(name){
  const fnName = String(name || '').trim()
  if (!fnName) throw new Error('Missing callable name')
  return fnName
}

// Calls Firebase callable functions.
// Always use the Firebase SDK callable protocol.
// Note: Firebase Hosting rewrites do NOT support proxying callable (https.onCall) functions.
export async function callCallable(name, data){
  const fnName = normalizeName(name)
  const payload = data || {}
  const fn = httpsCallable(functions, fnName)
  return await fn(payload)
}

// Convenience wrapper used throughout the app:
// const fn = getCallable('myFunction'); await fn({ ... })
export function getCallable(name){
  const fnName = normalizeName(name)
  return async (data)=>await callCallable(fnName, data)
}


