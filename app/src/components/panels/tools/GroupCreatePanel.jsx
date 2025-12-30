import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db, functions } from '../../../lib/firebase.js'
import { usePanels } from '../PanelsContext.jsx'
import { callCallable } from '../../../lib/callable.js'
import { DEFAULT_AVATAR_URL } from '../../../lib/placeholders.js'

async function getUserBrief(uid){
  const s = await getDoc(doc(db, 'users', uid))
  const d = s.data() || {}
  return { uid, username: d.username || 'anon', photoURL: d.photoURL || null }
}

export default function GroupCreatePanel(){
  const { openPanel } = usePanels()
  const [user, setUser] = useState(auth.currentUser)
  const [friendships, setFriendships] = useState([])
  const [profiles, setProfiles] = useState({})
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState([]) // uids (excluding me)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  useEffect(()=>{
    setErr('')
    setFriendships([])
    if (!user) return
    const q = query(collection(db, 'friendships'), where('users', 'array-contains', user.uid), limit(250))
    const unsub = onSnapshot(q, (qs)=>{
      setFriendships(qs.docs.map(d=>({ id:d.id, ...d.data() })))
    }, (e)=>setErr(e?.message || String(e)))
    return ()=>unsub()
  },[user])

  const friendUids = useMemo(()=>{
    if (!user) return []
    return friendships
      .filter(f=>f.status === 'accepted')
      .map(f=>((Array.isArray(f.users) ? f.users : []).find(u=>u && u !== user.uid) || null))
      .filter(Boolean)
  },[friendships, user])

  useEffect(()=>{
    if (!user) { setProfiles({}); return }
    const missing = friendUids.filter(uid=>uid && !profiles[uid])
    if (!missing.length) return
    ;(async()=>{
      const updates = {}
      await Promise.all(missing.map(async (uid)=>{
        try{
          const p = await getUserBrief(uid)
          updates[uid] = { username: p.username, photoURL: p.photoURL }
        }catch(_e){
          updates[uid] = { username:'anon', photoURL:null }
        }
      }))
      setProfiles(prev=>({ ...prev, ...updates }))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[friendUids, user])

  const friends = useMemo(()=>{
    const s = String(search || '').trim().toLowerCase()
    const rows = friendUids.map(uid=>({ uid, ...(profiles[uid] || {}) }))
      .sort((a,b)=>String(a.username||'').localeCompare(String(b.username||'')))
    if (!s) return rows
    return rows.filter(r=>String(r.username||'').toLowerCase().includes(s))
  },[friendUids, profiles, search])

  const selectedSet = useMemo(()=>new Set(selected), [selected])

  async function onCreate(){
    if (!user) return
    setErr('')
    if (selected.length < 2){
      setErr('Select at least 2 friends (group size >= 3 including you).')
      return
    }
    setLoading(true)
    try{
      const res = await callCallable('groupCreate', { title: title.trim(), memberUids: selected })
      const chatId = res?.data?.chatId
      if (!chatId) throw new Error('Server did not return chatId')
      openPanel('chat', { title: title.trim() || 'Group chat', props:{ mode:'thread', chatId }, replaceAll:true, pushHistory:true })
    }catch(e){
      const code = e?.code || ''
      const msg = e?.message || String(e)
      const details = e?.details ? ` — ${typeof e.details === 'string' ? e.details : JSON.stringify(e.details)}` : ''
      setErr(`${code ? code + ': ' : ''}${msg}${details}`)
    }finally{
      setLoading(false)
    }
  }

  if (!user){
    return <div style={{padding:12}}>Login to create group chats.</div>
  }

  return (
    <div style={{padding:12}}>
      <div style={{fontWeight:900, marginBottom:10}}>Create group chat</div>
      {!!err && <div style={{marginBottom:10, color:'#b00020'}}>{err}</div>}

      <label style={{display:'block', fontSize:'.9rem', color:'#444', marginBottom:6}}>Group name (optional)</label>
      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Geometry Squad" style={{width:'100%', marginBottom:10}} />

      <label style={{display:'block', fontSize:'.9rem', color:'#444', marginBottom:6}}>Add friends (pick at least 2)</label>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search friends…" style={{width:'100%', marginBottom:10}} />

      <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:12}}>
        {friends.slice(0, 50).map(f=>(
          <button
            key={f.uid}
            type="button"
            onClick={()=>{
              setSelected(prev=>{
                if (prev.includes(f.uid)) return prev.filter(x=>x !== f.uid)
                return [...prev, f.uid]
              })
            }}
            style={{
              display:'flex', alignItems:'center', gap:10,
              border:'1px solid #eee', borderRadius:10, padding:'8px 10px',
              background: selectedSet.has(f.uid) ? '#111827' : '#fff',
              color: selectedSet.has(f.uid) ? '#fff' : '#111',
              cursor:'pointer',
              textAlign:'left',
            }}
          >
            <img src={f.photoURL || DEFAULT_AVATAR_URL} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',border:'1px solid rgba(0,0,0,.15)'}} />
            <div style={{fontWeight:900}}>{f.username || 'anon'}</div>
            <span style={{marginLeft:'auto', fontWeight:900}}>{selectedSet.has(f.uid) ? '✓' : '+'}</span>
          </button>
        ))}
        {friends.length === 0 && <div style={{color:'#777'}}>No friends yet.</div>}
      </div>

      <button type="button" onClick={onCreate} disabled={loading} style={{width:'100%'}}>
        {loading ? 'Creating…' : `Create (${selected.length + 1} people)`}
      </button>
    </div>
  )
}


