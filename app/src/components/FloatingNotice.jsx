import { useEffect, useMemo, useState } from 'react'

const DISMISS_KEY = 'quantara_notice_challenge_pause_2026_01_24'

function isWithinWindowLocal(now){
  // Show during Jan 24 → Feb 10 (inclusive) in the user's local time.
  const start = new Date(2026, 0, 24, 0, 0, 0, 0) // Jan is 0
  const endExclusive = new Date(2026, 1, 11, 0, 0, 0, 0) // Feb 11 00:00 (exclusive)
  return now >= start && now < endExclusive
}

export default function FloatingNotice(){
  const [dismissed, setDismissed] = useState(false)

  const shouldShowByDate = useMemo(()=>{
    try{
      return isWithinWindowLocal(new Date())
    }catch{
      return true
    }
  },[])

  useEffect(()=>{
    try{
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1')
    }catch{
      // If storage is blocked, just show the notice.
    }
  },[])

  const onDismiss = ()=>{
    setDismissed(true)
    try{ window.localStorage.setItem(DISMISS_KEY, '1') }catch{ /* ignore */ }
  }

  if (!shouldShowByDate) return null
  if (dismissed) return null

  return (
    <div className="floating-notice" role="status" aria-live="polite">
      <div className="floating-notice__title">Challenge section pause</div>
      <div className="floating-notice__body">
        Challenge section stops from <b>Jan 24</b> to <b>Feb 10</b>.
      </div>
      <button className="floating-notice__close" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  )
}

