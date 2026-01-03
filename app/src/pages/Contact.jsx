import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { auth, db } from '../lib/firebase.js'

export default function Contact(){
  const [user, setUser] = useState(auth.currentUser)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, (u)=>setUser(u))
    return ()=>unsub()
  },[])

  async function submit(e){
    e.preventDefault()
    setErr('')
    setOk(false)
    if (!user){
      window.location.href = '/login'
      return
    }
    const s = subject.trim()
    const m = message.trim()
    if (!s) { setErr('Subject is required'); return }
    if (!m) { setErr('Message is required'); return }
    setBusy(true)
    try{
      await addDoc(collection(db, 'claims'), {
        uid: user.uid,
        email: user.email || null,
        subject: s.slice(0, 180),
        message: m.slice(0, 8000),
        createdAt: Timestamp.now(),
      })
      setSubject('')
      setMessage('')
      setOk(true)
    }catch(e2){
      setErr(e2?.message || String(e2))
    }finally{
      setBusy(false)
    }
  }

  return (
    <div style={{maxWidth:720, margin:'0 auto', padding:'24px 16px 80px'}}>
      <h2 style={{marginTop:0}}>Contact us</h2>
      <div style={{color:'#666', marginBottom:12}}>
        File a claim or write to the Quantara Team. (Login required.)
      </div>

      {!!err && <div style={{margin:'10px 0', color:'#b00020'}}>{err}</div>}
      {!!ok && <div style={{margin:'10px 0', color:'#166534'}}>Sent! We’ll review it soon.</div>}

      <form onSubmit={submit} style={{display:'grid', gap:10}}>
        <input
          value={subject}
          onChange={e=>setSubject(e.target.value)}
          placeholder="Subject"
          maxLength={180}
          disabled={busy}
          required
        />
        <textarea
          value={message}
          onChange={e=>setMessage(e.target.value)}
          placeholder="Write your message…"
          rows={8}
          maxLength={8000}
          disabled={busy}
          required
        />
        <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
    </div>
  )
}


