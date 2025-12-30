import { useEffect, useRef } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../../lib/firebase.js'
import { usePanels } from '../panels/PanelsContext.jsx'

// Keeps the chat sidebar open on desktop-sized screens whenever a user is logged in.
export default function ChatAutoOpen(){
  const { isNarrow, panels, openPanel } = usePanels()
  const openedRef = useRef(false)
  const panelsRef = useRef(panels)

  useEffect(()=>{ panelsRef.current = panels },[panels])

  useEffect(()=>{
    if (isNarrow) return
    const unsub = onAuthStateChanged(auth, (u)=>{
      if (!u){
        openedRef.current = false
        return
      }
      // Only auto-open once per session (user can still close it manually).
      if (openedRef.current) return
      const hasChat = (panelsRef.current || []).some(p => p.type === 'chat')
      if (hasChat) { openedRef.current = true; return }
      openPanel('chat', { title:'Chats', props:{ mode:'home' }, replaceAll:false, pushHistory:false })
      openedRef.current = true
    })
    return ()=>unsub()
  },[isNarrow, openPanel])

  return null
}


