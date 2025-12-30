import { auth } from '../lib/firebase'
import {
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import { getCallable } from '../lib/callable.js'

export default function Login(){
  async function onGoogleSignIn(){
    try{
      const provider = new GoogleAuthProvider()
      const cred = await signInWithPopup(auth, provider)
      // Ensure we have a Firestore profile (username defaults to Google displayName; photo defaults to Google photoURL).
      const ensure = getCallable('userEnsureProfile')
      await ensure({})
      window.location.href = '/community'
    }catch(e){
      alert(e?.message || String(e))
    }
  }

  return (
    <div style={{maxWidth:520, margin:'40px auto', padding:'0 1rem'}}>
      <h2>Login</h2>

      <div style={{marginTop:10}}>
        <button type="button" onClick={onGoogleSignIn}>
          Continue with Google
        </button>
      </div>
    </div>
  )
}
