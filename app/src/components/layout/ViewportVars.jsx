import { useEffect } from 'react'

// Sets CSS variables based on live layout measurements (responsive to all screens + zoom).
export default function ViewportVars(){
  useEffect(()=>{
    const root = document.documentElement
    const topbar = document.getElementById('topbar')
    if (!topbar) return

    function set(){
      const h = Math.max(0, Math.round(topbar.getBoundingClientRect().height || 0))
      root.style.setProperty('--topbar-h', `${h}px`)
    }

    set()
    // ResizeObserver isn't supported in some browsers; fall back to window resize only.
    let ro = null
    try{
      if (typeof ResizeObserver !== 'undefined'){
        ro = new ResizeObserver(()=>set())
        ro.observe(topbar)
      }
    }catch(_e){
      ro = null
    }
    window.addEventListener('resize', set)
    return ()=>{
      try{ ro?.disconnect?.() }catch(_e){}
      window.removeEventListener('resize', set)
    }
  },[])

  return null
}


