import { useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, collection, doc, Timestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from '../../../lib/firebase.js'
import { formatFirebaseError } from '../../../lib/errors.js'

function randId(){
  try{ return crypto.randomUUID() }catch{ return String(Date.now()) }
}

export default function ReportPanel({ targetType, target, suggestedText = '' }){
  const [user, setUser] = useState(auth.currentUser)
  const [reason, setReason] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  useEffect(()=>setUser(auth.currentUser),[])

  const header = useMemo(()=>{
    const t = String(targetType || 'report')
    return `Report ${t}`
  },[targetType])

  async function submit(e){
    e.preventDefault()
    setErr('')
    if (!user){ setErr('Login required'); return }
    const r = reason.trim()
    if (!r) { setErr('Reason is required'); return }
    if (!file) { setErr('Proof image is required'); return }
    if (file.size > 10 * 1024 * 1024){ setErr('Image too large (max 10MB)'); return }
    if (!String(file.type || '').startsWith('image/')){ setErr('Proof must be an image'); return }

    setBusy(true)
    try{
      // Create report doc id first so Storage path is stable.
      const reportRef = doc(collection(db, 'reports'))
      const reportId = reportRef.id
      const ext = (String(file.name||'').includes('.') ? String(file.name).split('.').pop() : 'png').toLowerCase().slice(0,8) || 'png'
      const path = `reports/${user.uid}/${reportId}/${randId()}.${ext}`
      const rref = storageRef(storage, path)
      await uploadBytes(rref, file, { contentType: file.type || undefined })
      const proofURL = await getDownloadURL(rref)

      await setDoc(reportRef, {
        uid: user.uid,
        createdAt: Timestamp.now(),
        targetType: String(targetType || 'unknown'),
        target: (target && typeof target === 'object') ? target : {},
        reason: r.slice(0, 2000),
        proofURL,
        proofPath: path,
        ...(suggestedText ? { suggestedText: String(suggestedText).slice(0, 500) } : {}),
      }, { merge: false })

      setReason('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      window.alert('Report submitted. Thank you.')
    }catch(e2){
      setErr(formatFirebaseError(e2))
    }finally{
      setBusy(false)
    }
  }

  return (
    <div style={{padding:12}}>
      <div style={{fontWeight:900, marginBottom:8}}>{header}</div>
      {!!err && <div style={{marginBottom:10, color:'#b00020'}}>{err}</div>}

      <form onSubmit={submit} style={{display:'grid', gap:10}}>
        <div style={{color:'#666', fontSize:'.9rem'}}>
          Please provide a clear reason and an image proving the issue.
        </div>
        {!!suggestedText && (
          <div style={{border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fafafa'}}>
            <div style={{fontSize:'.85rem', color:'#666', marginBottom:4}}>Context</div>
            <div style={{whiteSpace:'pre-wrap'}}>{String(suggestedText).slice(0, 500)}</div>
          </div>
        )}
        <textarea
          value={reason}
          onChange={e=>setReason(e.target.value)}
          placeholder="Report reason…"
          rows={5}
          maxLength={2000}
          disabled={busy}
          required
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e)=>setFile(e.target.files?.[0] || null)}
        />
        <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</button>
      </form>
    </div>
  )
}


