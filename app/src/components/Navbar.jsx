import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { usePanels } from './panels/PanelsContext.jsx'
import { useGamification } from '../hooks/useGamification.js'

export default function Navbar(){
  const [user, setUser] = useState(null)
  const navigate = useNavigate()
  const { openPanel, isNarrow } = usePanels()
  const [unreadTotal, setUnreadTotal] = useState(0)
  const game = useGamification(user?.uid || null)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  useEffect(()=>{
    setUnreadTotal(0)
    if (!user) return
    // Best-effort unread total (for badge). Limit keeps it cheap.
    const ordered = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(100)
    )
    const fallback = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid),
      limit(100)
    )

    function compute(qs){
      let total = 0
      for (const d of qs.docs){
        const u = Number(d.data()?.unreadCounts?.[user.uid] || 0)
        if (u > 0) total += u
      }
      setUnreadTotal(total)
    }

    let unsub = onSnapshot(ordered, compute, (err)=>{
      unsub()
      unsub = onSnapshot(fallback, compute, (_e)=>{})
      void err
    })
    return ()=>unsub()
  },[user])

  const badgeText = useMemo(()=>{
    if (!unreadTotal) return ''
    return unreadTotal > 9 ? '9+' : String(unreadTotal)
  },[unreadTotal])

  return (
    <nav id="topbar">
      <Link to="/">Home</Link>
      <Link to="/wiki">Wiki</Link>
      <Link to="/challenge">Challenge</Link>
      <Link to="/community">Community</Link>
      <Link to="/archive">Problem&nbsp;Archive</Link>
      <span style={{marginLeft:'auto'}} />
      {!user && (
        <button onClick={()=>navigate('/login')}>Login</button>
      )}
      {!!user && (
        <>
          {/* Level + XP progress (left of Chats) */}
          <div
            title={`Level ${game.level} • XP ${game.xp}/${game.nextLevelXp} • ${Math.max(0, game.nextLevelXp - game.xp)} XP to level up`}
            style={{
              display:'inline-flex',
              alignItems:'center',
              gap:10,
              padding:'6px 10px',
              borderRadius:999,
              background:'linear-gradient(135deg, rgba(99,102,241,.22), rgba(16,185,129,.14))',
              border:'1px solid rgba(255,255,255,.15)',
              color:'#fff',
              userSelect:'none',
              cursor:'default',
              minWidth: 200,
            }}
          >
            <span style={{fontSize:13, fontWeight:900, letterSpacing:'.2px'}}>
              Lv {game.level}
            </span>
            <span
              style={{
                flex: 1,
                height: 10,
                borderRadius: 999,
                background: 'rgba(255,255,255,.14)',
                overflow: 'hidden',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
              }}
              aria-label="XP progress"
            >
              <span
                style={{
                  display:'block',
                  height:'100%',
                  width:`${Math.round(game.progress * 100)}%`,
                  background:'linear-gradient(90deg,#60a5fa,#34d399)',
                }}
              />
            </span>
            <span style={{fontSize:12, fontWeight:800, opacity:.9, fontVariantNumeric:'tabular-nums'}}>
              {Math.max(0, game.nextLevelXp - game.xp)} XP
            </span>
          </div>
          <button
            onClick={()=>openPanel('chat', { title:'Chats', props:{ mode:'home' }, replaceAll:false, pushHistory:false })}
            disabled={isNarrow}
            title={isNarrow ? 'Chats disabled on small screens' : 'Open chats'}
          >
            Chats
          </button>
          <button onClick={()=>signOut(auth)}>Logout</button>
          <button
            type="button"
            onClick={()=>navigate(`/profile/${user.uid}`)}
            style={{position:'relative', padding:0, border:'none', background:'transparent', marginLeft:'.5rem', cursor:'pointer'}}
            aria-label="Open profile"
          >
            <img
              src={user.photoURL || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="100%" height="100%" fill="%23ccc"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="10" fill="%23666">?</text></svg>'}
              alt="profile"
              style={{width:28,height:28,borderRadius:'50%',display:'block'}}
            />
            {!!badgeText && (
              <span
                style={{
                  position:'absolute',
                  right:-6,
                  top:-6,
                  minWidth:18,
                  height:18,
                  padding:'0 5px',
                  borderRadius:999,
                  background:'#e11d48',
                  color:'#fff',
                  fontSize:12,
                  fontWeight:800,
                  display:'inline-flex',
                  alignItems:'center',
                  justifyContent:'center',
                  border:'2px solid #222',
                  lineHeight:1
                }}
                title={`${unreadTotal} unread messages`}
              >
                {badgeText}
              </span>
            )}
          </button>
        </>
      )}
    </nav>
  )
}
