import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const PanelsCtx = createContext(null)

function makeId(){
  // crypto.randomUUID() isn't available in some browser contexts; fall back safely.
  try{
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  }catch(_e){}
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function useIsNarrow(){
  const [narrow, setNarrow] = useState(false)
  useEffect(()=>{
    const m = window.matchMedia('(max-width: 900px)')
    const onChange = () => setNarrow(!!m.matches)
    onChange()
    if (m.addEventListener) m.addEventListener('change', onChange)
    else m.addListener(onChange)
    return ()=>{
      if (m.removeEventListener) m.removeEventListener('change', onChange)
      else m.removeListener(onChange)
    }
  },[])
  return narrow
}

export function PanelsProvider({ children }){
  const isNarrow = useIsNarrow()
  const [panels, setPanels] = useState([]) // [{ id, type, title, props }]
  const [history, setHistory] = useState([]) // stack of previous `panels` arrays

  function openPanel(type, { title, props, replaceAll = false, pushHistory = false } = {}){
    if (isNarrow){
      window.alert('This panel view is disabled on phone-sized screens. Please use a larger display.')
      return
    }
    setPanels(prev=>{
      if (pushHistory){
        setHistory(h => [...h, prev])
      }
      const idx = prev.findIndex(p => p.type === type)
      if (idx >= 0){
        const next = [...prev]
        next[idx] = { ...next[idx], title: title ?? next[idx].title, props: props ?? next[idx].props }
        return replaceAll ? [next[idx]] : next
      }
      if (!replaceAll && prev.length >= 2){
        window.alert('You can open at most two panels at a time.')
        return prev
      }
      const newPanel = { id: makeId(), type, title: title || type, props: props || {} }
      return replaceAll ? [newPanel] : [...prev, newPanel]
    })
  }

  function closePanel(id){
    setPanels(prev => prev.filter(p => p.id !== id))
  }

  function closeAll(){
    setPanels([])
  }

  const canGoBack = history.length > 0
  function goBack(){
    setHistory(h=>{
      if (!h.length) return h
      const next = [...h]
      const prevPanels = next.pop()
      setPanels(prevPanels || [])
      return next
    })
  }

  const value = useMemo(()=>({
    isNarrow,
    panels,
    canGoBack,
    openPanel,
    closePanel,
    closeAll,
    goBack,
  }),[isNarrow, panels])

  return <PanelsCtx.Provider value={value}>{children}</PanelsCtx.Provider>
}

export function usePanels(){
  const ctx = useContext(PanelsCtx)
  if (!ctx) throw new Error('usePanels must be used within PanelsProvider')
  return ctx
}


