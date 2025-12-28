import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { auth, db, storage } from '../lib/firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { onAuthStateChanged } from 'firebase/auth'

export default function Profile(){
  const params = useParams()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [editable, setEditable] = useState(false)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  useEffect(()=>{
    (async()=>{
      if (!user && !params.uid) return
      const uid = params.uid || user?.uid
      if (!uid) return
      setEditable(!!user && user.uid===uid)
      const snap = await getDoc(doc(db,'users',uid))
      const data = snap.data() || {}
      setProfile({ uid, username: data.username||'anon', about: data.about||'', photoURL: data.photoURL||'https://via.placeholder.com/120' })
    })()
  },[user, params.uid])

  async function onPick(e){
    if (!editable) return
    const f = e.target.files?.[0]
    if (!f) return
    // Matches Storage rules: /avatars/{userId}/{allPaths=**}
    const r = ref(storage, `avatars/${profile.uid}/avatar`)
    await uploadBytes(r,f)
    const url = await getDownloadURL(r)
    await setDoc(doc(db,'users',profile.uid), { photoURL: url }, { merge:true })
    setProfile({ ...profile, photoURL: url })
    alert('Profile picture updated')
  }

  async function onSave(){
    await setDoc(doc(db,'users',profile.uid), { about: profile.about }, { merge:true })
    alert('Profile saved')
  }

  if (!profile) return <div style={{padding:16}}>Loading…</div>
  return (
    <div style={{maxWidth:500, margin:'40px auto', padding:'0 1rem'}}>
      <h2>{profile.username}'s Profile</h2>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
        <img src={profile.photoURL} alt="avatar" style={{width:120,height:120,borderRadius:'50%',objectFit:'cover',border:'2px solid #ddd'}} />
        {editable && <input type="file" accept="image/*" onChange={onPick} style={{marginTop:'.5rem'}} />}
        <label style={{fontSize:'.9rem',color:'#555',marginTop:'1rem'}}>About</label>
        <textarea rows={6} value={profile.about} readOnly={!editable} onChange={e=>setProfile({...profile, about: e.target.value})} style={{width:'100%',resize:'vertical'}} />
        {editable && <button onClick={onSave} style={{marginTop:'.8rem'}}>Save profile</button>}
      </div>
    </div>
  )
}
