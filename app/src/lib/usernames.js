import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from './firebase.js'

export function normalizeUsername(input){
  const raw = String(input || '').trim()
  const lower = raw.toLowerCase()
  // Keep in sync with Firestore rules: 3-32 chars.
  // Allow common username chars (older accounts may have used these).
  if (!/^[a-z0-9._-]{3,32}$/.test(lower)) return null
  return lower
}

// Resolve uid by username using the `usernames/{usernameLower}` index when available.
// Falls back to querying `users` (for older accounts created before the index existed).
export async function resolveUidByUsername(usernameInput){
  const raw = String(usernameInput || '').trim()
  if (!raw) return null
  const u = normalizeUsername(raw)

  // Primary: usernames index
  if (u){
    try{
      const snap = await getDoc(doc(db, 'usernames', u))
      const uid = snap.exists() ? snap.data()?.uid : null
      if (uid) return String(uid)
    }catch(_e){}
  }

  // Fallback: users collection (non-unique; best-effort).
  // Try modern field first, then legacy `username` (case-sensitive).
  try{
    if (u){
      const qsLower = await getDocs(query(collection(db, 'users'), where('usernameLower', '==', u), limit(1)))
      if (!qsLower.empty) return qsLower.docs[0].id
    }
    const qsRaw = await getDocs(query(collection(db, 'users'), where('username', '==', raw), limit(1)))
    if (!qsRaw.empty) return qsRaw.docs[0].id
    if (u){
      const qsLegacyLower = await getDocs(query(collection(db, 'users'), where('username', '==', u), limit(1)))
      if (!qsLegacyLower.empty) return qsLegacyLower.docs[0].id
    }
  }catch(_e){}

  return null
}


