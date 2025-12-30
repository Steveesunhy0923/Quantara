import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db, functions } from '../../../lib/firebase.js'
import { callCallable } from '../../../lib/callable.js'
import { DEFAULT_AVATAR_URL } from '../../../lib/placeholders.js'

async function getUserBrief(uid){
  const s = await getDoc(doc(db, 'users', uid))
  const d = s.data() || {}
  return { uid, username: d.username || 'anon', photoURL: d.photoURL || null }
}

export default function GroupMembersPanel({ chatId }){
  const [user, setUser] = useState(auth.currentUser)
  const [chat, setChat] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [err, setErr] = useState('')
  const [busyUid, setBusyUid] = useState(null)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  useEffect(()=>{
    setErr('')
    if (!chatId) return
    const unsub = onSnapshot(doc(db, 'chats', chatId), (s)=>{
      setChat(s.exists() ? ({ id:s.id, ...s.data() }) : null)
    }, (e)=>setErr(e?.message || String(e)))
    return ()=>unsub()
  },[chatId])

  useEffect(()=>{
    const ps = Array.isArray(chat?.participants) ? chat.participants : []
    if (!ps.length) return
    const missing = ps.filter(uid=>uid && !profiles[uid])
    if (!missing.length) return
    ;(async()=>{
      const updates = {}
      await Promise.all(missing.map(async (uid)=>{
        try{
          updates[uid] = await getUserBrief(uid)
        }catch(_e){
          updates[uid] = { uid, username:'anon', photoURL:null }
        }
      }))
      setProfiles(prev=>({ ...prev, ...updates }))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[chat])

  const meIsAdmin = useMemo(()=>{
    if (!user || !chat) return false
    if (chat.createdBy === user.uid) return true
    return !!chat.admins?.[user.uid]
  },[chat, user])

  async function remove(uid){
    if (!user || !chatId) return
    setErr('')
    setBusyUid(uid)
    try{
      await callCallable('groupRemoveMember', { chatId, uid })
    }catch(e){
      setErr(e?.message || String(e))
    }finally{
      setBusyUid(null)
    }
  }

  if (!user){
    return <div style={{padding:12}}>Login to view members.</div>
  }
  if (!chat){
    return <div style={{padding:12, color:'#777'}}>Loading…</div>
  }

  const participants = Array.isArray(chat.participants) ? chat.participants : []
  const rows = participants.map(uid=>profiles[uid] || { uid, username:'anon', photoURL:null })
    .sort((a,b)=>String(a.username||'').localeCompare(String(b.username||'')))

  return (
    <div style={{padding:12}}>
      <div style={{fontWeight:900, marginBottom:10}}>Members</div>
      {!!err && <div style={{marginBottom:10, color:'#b00020'}}>{err}</div>}

      <div style={{color:'#666', fontSize:'.9rem', marginBottom:10}}>
        {rows.length} people · Creator: {profiles[chat.createdBy]?.username || 'unknown'}
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {rows.map(r=>{
          const isCreator = r.uid === chat.createdBy
          const isAdmin = !!chat.admins?.[r.uid] || isCreator
          const canRemove = meIsAdmin && !isCreator && r.uid !== user.uid
          return (
            <div key={r.uid} style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff'}}>
              <img src={r.photoURL || DEFAULT_AVATAR_URL} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
              <div style={{minWidth:0}}>
                <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{r.username || 'anon'}</div>
                <div style={{color:'#666', fontSize:'.85rem'}}>{isCreator ? 'Creator' : (isAdmin ? 'Admin' : 'Member')}</div>
              </div>
              <span style={{marginLeft:'auto'}} />
              {canRemove && (
                <button type="button" onClick={()=>remove(r.uid)} disabled={busyUid === r.uid}>
                  {busyUid === r.uid ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}


