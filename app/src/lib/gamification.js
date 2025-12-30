import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from './firebase.js'
import { getCallable } from './callable.js'

// -----------------------------------------
// Shared concepts (client-side)
// -----------------------------------------

export const ACHIEVEMENT_TIERS = /** @type {const} */ (['bronze', 'silver', 'gold', 'legendary'])

export function gameStateDocRef(uid){
  return doc(db, 'users', String(uid), 'gameState', 'main')
}

export function achievementsColPath(uid){
  return `users/${String(uid)}/achievements`
}

export function badgesColPath(uid){
  return `users/${String(uid)}/badges`
}

export function levelFromXp(xp){
  const x = Math.max(0, Number(xp) || 0)
  const xp100 = xpForLevel(100) // 50500
  if (x < xp100){
    // 10 * L*(L+1)/2 <= x  => 5L^2 + 5L - x <= 0
    const disc = 25 + 20 * x
    const L = Math.floor((-5 + Math.sqrt(disc)) / 10)
    return Math.max(0, L)
  }
  return 100 + Math.floor((x - xp100) / 1000)
}

export function xpForLevel(level){
  const L = Math.max(0, Math.trunc(Number(level) || 0))
  if (L <= 0) return 0
  if (L <= 100){
    return Math.trunc(10 * (L * (L + 1)) / 2)
  }
  const xp100 = Math.trunc(10 * (100 * 101) / 2)
  return xp100 + 1000 * (L - 100)
}

// -----------------------------------------
// Cloud Function entrypoints (secure writes)
// -----------------------------------------

export async function ensureGamification(){
  const fn = getCallable('gamificationEnsure')
  const res = await fn({})
  return res?.data || null
}

/**
 * Adds XP to the current user.
 * @param {number} amount positive integer
 * @param {string} reason short string (for audit + debugging)
 * @param {object|null} meta optional structured metadata
 */
export async function addXp(amount, reason = '', meta = null){
  const fn = getCallable('gamificationAddXp')
  const res = await fn({ amount, reason, meta })
  return res?.data || null
}

export async function equipBadge(badgeId){
  const fn = getCallable('gamificationEquipBadge')
  const res = await fn({ badgeId: String(badgeId || '') })
  return res?.data || null
}

export async function dailyCheckIn(){
  const fn = getCallable('gamificationDailyCheckIn')
  const res = await fn({})
  return res?.data || null
}

// Admin-only: add custom achievement to a user (intended for stevesunhy admin tooling)
export async function adminAddAchievement({ uid = '', name = '', condition = '', tier = 'bronze' }){
  const fn = getCallable('gamificationAdminAddAchievement')
  const res = await fn({ uid, name, condition, tier })
  return res?.data || null
}

// Admin-only (debug)
export async function debugGrantAchievement({ uid = '', achievementId = '', tier = 'bronze', meta = null }){
  const fn = getCallable('gamificationDebugGrantAchievement')
  const res = await fn({ uid, achievementId, tier, meta })
  return res?.data || null
}

// Admin-only (debug)
export async function debugGrantBadge({ uid = '', badgeId = '', meta = null }){
  const fn = getCallable('gamificationDebugGrantBadge')
  const res = await fn({ uid, badgeId, meta })
  return res?.data || null
}

// -----------------------------------------
// Small helper for subscribing without a hook
// -----------------------------------------

export function subscribeMyGameState(onValue, onError){
  const u = auth.currentUser
  if (!u) return ()=>{}
  return onSnapshot(gameStateDocRef(u.uid), (snap)=>{
    onValue(snap.exists() ? (snap.data() || null) : null)
  }, onError)
}


