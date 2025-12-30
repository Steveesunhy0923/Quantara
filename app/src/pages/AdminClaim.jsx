import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { getIdTokenResult } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { getCallable } from '../lib/callable.js'

export default function AdminClaim(){
  const [user, setUser] = useState(null)
  const [secret, setSecret] = useState('')
  const [state, setState] = useState({ loading:false, error:null, ok:null, claims:null })

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  async function refreshClaims(){
    if (!auth.currentUser) return
    const tok = await getIdTokenResult(auth.currentUser, true)
    setState(s=>({ ...s, claims: tok?.claims || null }))
  }

  async function onSetAdmin(){
    setState({ loading:true, error:null, ok:null, claims:null })
    try{
      if (!auth.currentUser) throw new Error('Please login first')
      const fn = getCallable('setAdmin')
      await fn({ password: secret })
      await refreshClaims()
      setState(s=>({ ...s, loading:false, ok:'Admin claim set. Refresh other tabs to apply.', error:null }))
    }catch(err){
      setState({ loading:false, error: err?.message || String(err), ok:null, claims:null })
    }
  }

  return (
    <div style={{padding:16, width:'100%', maxWidth: 720, margin:'0 auto'}}>
      <h1>Admin Tools</h1>
      <p style={{color:'#666', marginTop:0}}>
        This page calls the Cloud Function <code>setAdmin</code> to grant your account the <code>admin</code> claim.
      </p>

      {!user && <div style={{color:'#a00'}}>Login first, then come back to this page.</div>}

      <div style={{marginTop:12, padding:12, border:'1px solid #eee', borderRadius:10, background:'#fff'}}>
        <label style={{display:'block', fontSize:'.95rem', color:'#333', marginBottom:6}}>Admin secret</label>
        <input
          type="password"
          value={secret}
          onChange={e=>setSecret(e.target.value)}
          placeholder="Enter ADMIN_SECRET"
          style={{width:'100%', padding:10, borderRadius:8, border:'1px solid #ddd'}}
          disabled={!user || state.loading}
        />
        <div style={{display:'flex', gap:8, marginTop:10}}>
          <button
            onClick={onSetAdmin}
            disabled={!user || state.loading || !secret}
            style={{padding:'10px 14px', borderRadius:8, border:'1px solid #111', background:'#111', color:'#fff'}}
          >
            {state.loading ? 'Setting…' : 'Run setAdmin'}
          </button>
          <button
            onClick={refreshClaims}
            disabled={!user || state.loading}
            style={{padding:'10px 14px', borderRadius:8, border:'1px solid #ddd', background:'#fff', color:'#111'}}
          >
            Refresh claims
          </button>
        </div>

        {!!state.error && <div style={{marginTop:10, color:'#a00'}}>{state.error}</div>}
        {!!state.ok && <div style={{marginTop:10, color:'#0a0'}}>{state.ok}</div>}

        {state.claims && (
          <pre style={{marginTop:12, padding:10, background:'#fafafa', border:'1px solid #eee', borderRadius:8, overflowX:'auto'}}>
            {JSON.stringify(state.claims, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}


