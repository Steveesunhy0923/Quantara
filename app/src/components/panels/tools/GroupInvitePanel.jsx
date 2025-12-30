import { useEffect, useMemo, useState } from 'react'
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db, functions } from '../../../lib/firebase.js'
import { usePanels } from '../PanelsContext.jsx'
import { callCallable } from '../../../lib/callable.js'

async function getUserBrief(uid){
  const s = await getDoc(doc(db, 'users', uid))
  const d = s.data() || {}
  return { uid, username: d.username || 'anon', photoURL: d.photoURL || null }
}

export default function GroupInvitePanel({ chatId }){
  const { openPanel } = usePanels()
  const [user, setUser] = useState(auth.currentUser)
  const [qstr, setQstr] = useState('')
  const [results, setResults] = useState([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  useEffect(()=>{
    setErr('')
    const prefix = String(qstr || '').trim().toLowerCase()
    if (!prefix || prefix.length < 2){
      setResults([])
      return
    }
    if (!/^[a-z0-9._-]+$/.test(prefix)){
      setResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(async ()=>{
      try{
        const unameQ = query(
          collection(db, 'usernames'),
          orderBy(documentId()),
          where(documentId(), '>=', prefix),
          where(documentId(), '<=', prefix + '\uf8ff'),
          limit(8)
        )
        const qs = await getDocs(unameQ)
        const hits = qs.docs.map(d=>({ username: d.id, uid: d.data()?.uid || null })).filter(x=>!!x.uid)
        const profs = await Promise.all(hits.map(async (h)=>{
          try{
            const p = await getUserBrief(h.uid)
            return p
          }catch(_e){
            return { uid: h.uid, username: h.username, photoURL: null }
          }
        }))
        if (!cancelled) setResults(profs.filter(p=>p.uid && p.uid !== user?.uid))
      }catch(e){
        if (!cancelled) setErr(e?.message || String(e))
      }
    }, 150)
    return ()=>{
      cancelled = true
      clearTimeout(t)
    }
  },[qstr, user])

  const canInvite = useMemo(()=>!!user && !!chatId, [user, chatId])

  async function invite(uid){
    if (!canInvite) return
    setErr('')
    setLoading(true)
    try{
      await callCallable('groupInvite', { chatId, uid })
      openPanel('groupMembers', { title:'Members', props:{ chatId }, replaceAll:true, pushHistory:true })
    }catch(e){
      setErr(e?.message || String(e))
    }finally{
      setLoading(false)
    }
  }

  if (!user){
    return <div style={{padding:12}}>Login to invite.</div>
  }

  return (
    <div style={{padding:12}}>
      <div style={{fontWeight:900, marginBottom:10}}>Invite to group</div>
      {!!err && <div style={{marginBottom:10, color:'#b00020'}}>{err}</div>}
      <input value={qstr} onChange={e=>setQstr(e.target.value)} placeholder="Search username…" style={{width:'100%', marginBottom:10}} />
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {results.map(r=>(
          <div key={r.uid} style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff'}}>
            <img src={r.photoURL || 'https://via.placeholder.com/32'} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
            <div style={{fontWeight:900}}>{r.username || 'anon'}</div>
            <span style={{marginLeft:'auto'}} />
            <button type="button" onClick={()=>invite(r.uid)} disabled={!canInvite || loading}>
              Invite
            </button>
          </div>
        ))}
        {results.length === 0 && <div style={{color:'#777'}}>Type at least 2 characters.</div>}
      </div>
    </div>
  )
}


