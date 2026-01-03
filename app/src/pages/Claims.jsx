import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { auth, db } from '../lib/firebase.js'

function fmtTs(ts){
  try{
    return ts?.toDate ? ts.toDate().toLocaleString() : ''
  }catch{
    return ''
  }
}

export default function Claims(){
  const [user, setUser] = useState(auth.currentUser)
  const [tab, setTab] = useState('claims') // 'claims' | 'reports'
  const [claims, setClaims] = useState([])
  const [reports, setReports] = useState([])
  const [err, setErr] = useState('')

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, (u)=>setUser(u))
    return ()=>unsub()
  },[])

  useEffect(()=>{
    setErr('')
    setClaims([])
    setReports([])
    if (!user){
      window.location.href = '/login'
      return
    }
    // Note: access is enforced by Firestore rules (stevesunhy admin).
    const qClaims = query(collection(db, 'claims'), orderBy('createdAt', 'desc'), limit(200))
    const qReports = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200))
    const u1 = onSnapshot(qClaims, (qs)=>{
      setClaims(qs.docs.map(d=>({ id:d.id, ...d.data() })))
    }, (e)=>setErr(e?.message || String(e)))
    const u2 = onSnapshot(qReports, (qs)=>{
      setReports(qs.docs.map(d=>({ id:d.id, ...d.data() })))
    }, (e)=>setErr(e?.message || String(e)))
    return ()=>{ u1(); u2() }
  },[user])

  const rows = useMemo(()=>{
    const list = (tab === 'claims') ? claims : reports
    return Array.isArray(list) ? list : []
  },[tab, claims, reports])

  return (
    <div style={{maxWidth:980, margin:'0 auto', padding:'16px 16px 80px'}}>
      <h2 style={{marginTop:0}}>Claims</h2>
      <div style={{display:'flex', gap:8, margin:'8px 0 14px'}}>
        <button type="button" onClick={()=>setTab('claims')} disabled={tab==='claims'}>Claims</button>
        <button type="button" onClick={()=>setTab('reports')} disabled={tab==='reports'}>Reports</button>
        <span style={{marginLeft:'auto', color:'#666', fontSize:'.9rem'}}>{rows.length}</span>
      </div>

      {!!err && <div style={{margin:'10px 0', color:'#b00020'}}>{err}</div>}

      {rows.length === 0 && <div style={{color:'#777'}}>No items.</div>}

      <div style={{display:'flex', flexDirection:'column', gap:10}}>
        {rows.map((r)=>(
          <div key={r.id} style={{border:'1px solid #eee', borderRadius:10, padding:'10px 10px', background:'#fff'}}>
            <div style={{display:'flex', gap:10, alignItems:'baseline', flexWrap:'wrap'}}>
              <div style={{fontWeight:900}}>
                {tab === 'claims' ? (r.subject || '(no subject)') : (`Report: ${r.targetType || 'unknown'}`)}
              </div>
              <div style={{color:'#666', fontSize:'.9rem'}}>{fmtTs(r.createdAt)}</div>
              <span style={{marginLeft:'auto'}} />
              <div style={{fontFamily:'monospace', fontSize:'.85rem', color:'#666'}}>{String(r.uid || '').slice(0, 10)}…</div>
            </div>
            {tab === 'claims' ? (
              <div style={{marginTop:8, whiteSpace:'pre-wrap'}}>{r.message || ''}</div>
            ) : (
              <div style={{marginTop:8}}>
                <div style={{color:'#444', whiteSpace:'pre-wrap'}}><b>Reason:</b> {r.reason || ''}</div>
                <div style={{color:'#666', fontSize:'.9rem', marginTop:6}}>
                  <b>Target:</b> {JSON.stringify(r.target || {})}
                </div>
                {!!r.proofURL && (
                  <div style={{marginTop:8}}>
                    <a href={r.proofURL} target="_blank" rel="noreferrer">View proof image</a>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}


