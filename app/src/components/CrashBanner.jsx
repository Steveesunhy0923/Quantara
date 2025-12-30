import { useEffect, useState } from 'react'

export default function CrashBanner(){
  const [msg, setMsg] = useState('')

  useEffect(()=>{
    function onError(e){
      const m = e?.message || (e?.error?.message) || 'Unknown error'
      setMsg(String(m))
    }
    function onRejection(e){
      const r = e?.reason
      const m = r?.message || String(r || 'Unhandled rejection')
      setMsg(String(m))
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return ()=>{
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  },[])

  if (!msg) return null
  return (
    <div style={{
      position:'fixed',
      left:12,
      right:12,
      bottom:12,
      zIndex: 5000,
      padding:'10px 12px',
      borderRadius:10,
      border:'1px solid #ffd7b5',
      background:'#fff7ed',
      color:'#8a4b00',
      boxShadow:'0 10px 26px rgba(0,0,0,.15)',
      fontSize:'.9rem',
      wordBreak:'break-word',
      display:'flex',
      gap:10,
      alignItems:'center',
    }}>
      <div style={{flex:1}}>Runtime error: {msg}</div>
      <button type="button" onClick={()=>setMsg('')}>Hide</button>
    </div>
  )
}


