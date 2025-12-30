import { useEffect, useRef, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { auth } from '../lib/firebase.js'
import { ensureGamification, gameStateDocRef, levelFromXp, xpForLevel } from '../lib/gamification.js'

function shapeGameState(d){
  const xp = Number(d?.xp || 0) || 0
  const level = Number(d?.level || 0) || 0
  const equippedBadgeId = String(d?.equippedBadgeId || '')
  const safeLevel = Math.max(0, Math.trunc(level))
  const safeXp = Math.max(0, Math.trunc(xp))
  const curLevelXp = xpForLevel(safeLevel)
  const nextLevelXp = xpForLevel(safeLevel + 1)
  const progress = nextLevelXp > curLevelXp ? (safeXp - curLevelXp) / (nextLevelXp - curLevelXp) : 0
  return {
    xp: safeXp,
    level: Math.max(safeLevel, levelFromXp(safeXp)),
    equippedBadgeId,
    curLevelXp,
    nextLevelXp,
    progress: Math.max(0, Math.min(1, progress)),
  }
}

/**
 * Subscribes to gamification state for a given uid.
 * For the signed-in user, it also best-effort ensures the doc exists.
 */
export function useGamification(uid){
  const [state, setState] = useState(()=>shapeGameState(null))
  const [loading, setLoading] = useState(!!uid)
  const [error, setError] = useState('')
  const ensuredRef = useRef(false)

  useEffect(()=>{
    setError('')
    if (!uid){
      setState(shapeGameState(null))
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = onSnapshot(
      gameStateDocRef(uid),
      (snap)=>{
        setState(shapeGameState(snap.exists() ? snap.data() : null))
        setLoading(false)
      },
      (e)=>{
        setError(e?.message || 'Failed to load gamification')
        setLoading(false)
      }
    )
    return ()=>unsub()
  },[uid])

  // Best-effort: ensure a gamification doc exists for the signed-in user.
  // (This is safe even if you’re viewing someone else’s uid; the callable uses auth.uid server-side.)
  useEffect(()=>{
    ensuredRef.current = false
  },[uid])

  useEffect(()=>{
    if (!uid) return
    if (ensuredRef.current) return
    ensuredRef.current = true
    ensureGamification().catch(()=>{})
  },[uid])

  return { ...state, loading, error }
}


