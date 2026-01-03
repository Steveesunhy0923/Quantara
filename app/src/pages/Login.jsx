import { auth } from '../lib/firebase'
import {
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import { getCallable } from '../lib/callable.js'
import { useState } from 'react'

export default function Login(){
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function onGoogleSignIn(){
    setErr('')
    setBusy(true)
    try{
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
      // Ensure we have a Firestore profile (username defaults to Google displayName; photo defaults to Google photoURL).
      const ensure = getCallable('userEnsureProfile')
      await ensure({})
      window.location.href = '/community'
    }catch(e){
      setErr(e?.message || String(e))
    }finally{
      setBusy(false)
    }
  }

  return (
    <div style={{maxWidth:520, margin:'40px auto', padding:'0 1rem'}}>
      <h2>Login</h2>
      <div style={{color:'#666', marginTop:0}}>
        This site uses <b>Google sign-in only</b>.
      </div>

      {!!err && <div style={{margin:'10px 0', color:'#b00020'}}>{err}</div>}

      <div style={{marginTop:10}}>
        <button type="button" onClick={onGoogleSignIn} disabled={busy}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
      </div>
    </div>
  )
}
