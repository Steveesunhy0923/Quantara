import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { auth, db, storage } from '../lib/firebase'
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { onAuthStateChanged } from 'firebase/auth'
import { useGamification } from '../hooks/useGamification.js'
import { adminAddAchievement, dailyCheckIn, equipBadge } from '../lib/gamification.js'

export default function Profile(){
  const params = useParams()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [editable, setEditable] = useState(false)
  const game = useGamification(profile?.uid || null)
  const [achievements, setAchievements] = useState([])
  const [badges, setBadges] = useState([])
  const [adminForm, setAdminForm] = useState({ name:'', condition:'', tier:'bronze' })
  const [busy, setBusy] = useState(false)

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

  useEffect(()=>{
    if (!profile?.uid) return
    const uid = profile.uid
    const achQ = query(collection(db, 'users', uid, 'achievements'), orderBy('unlockedAt', 'desc'), limit(200))
    const badgesQ = query(collection(db, 'users', uid, 'badges'), orderBy('earnedAt', 'desc'), limit(200))
    const unsubA = onSnapshot(achQ, (qs)=>{
      setAchievements(qs.docs.map(d=>({ id: d.id, ...(d.data() || {}) })))
    }, ()=>{})
    const unsubB = onSnapshot(badgesQ, (qs)=>{
      setBadges(qs.docs.map(d=>({ id: d.id, ...(d.data() || {}) })))
    }, ()=>{})
    return ()=>{
      unsubA()
      unsubB()
    }
  },[profile?.uid])

  const tierStyle = useMemo(()=>({
    bronze: { bg:'#7c4a1d' },
    silver: { bg:'#4b5563' },
    gold: { bg:'#8a6b00' },
    legendary: { bg:'#6d28d9' },
  }),[])

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

  async function onCheckIn(){
    if (!editable) return
    try{
      setBusy(true)
      const res = await dailyCheckIn()
      if (res?.alreadyCheckedIn) alert('Already checked in today!')
      else alert('Checked in! +2 XP')
    }catch(e){
      alert(e?.message || String(e))
    }finally{
      setBusy(false)
    }
  }

  async function onEquipBadge(id){
    if (!editable) return
    try{
      setBusy(true)
      await equipBadge(id)
    }catch(e){
      alert(e?.message || String(e))
    }finally{
      setBusy(false)
    }
  }

  async function onAddAchievement(){
    if (!editable) return
    try{
      setBusy(true)
      await adminAddAchievement({ uid: profile.uid, ...adminForm })
      setAdminForm({ name:'', condition:'', tier:'bronze' })
      alert('Achievement added')
    }catch(e){
      alert(e?.message || String(e))
    }finally{
      setBusy(false)
    }
  }

  if (!profile) return <div style={{padding:16}}>Loading…</div>
  return (
    <div style={{maxWidth:500, margin:'40px auto', padding:'0 1rem'}}>
      <h2>{profile.username}'s Profile</h2>
      <div style={{margin:'10px 0 18px', padding:12, border:'1px solid #e5e7eb', borderRadius:12, background:'#fff'}}>
        <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10}}>
          <div style={{fontWeight:900}}>Level {game.level}</div>
          <div style={{color:'#555', fontSize:13}}>XP {game.xp} / {game.nextLevelXp}</div>
        </div>
        <div style={{height:10, background:'#e5e7eb', borderRadius:999, overflow:'hidden', marginTop:8}}>
          <div style={{width:`${Math.round(game.progress*100)}%`, height:'100%', background:'linear-gradient(90deg,#6366f1,#10b981)'}} />
        </div>
        {editable && (
          <div style={{display:'flex', gap:10, flexWrap:'wrap', marginTop:10}}>
            <button onClick={onCheckIn} disabled={busy}>Daily check-in (+2 XP)</button>
            {!!game.equippedBadgeId && (
              <button onClick={()=>onEquipBadge('')} disabled={busy}>Unequip badge</button>
            )}
          </div>
        )}
      </div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
        <img src={profile.photoURL} alt="avatar" style={{width:120,height:120,borderRadius:'50%',objectFit:'cover',border:'2px solid #ddd'}} />
        {editable && <input type="file" accept="image/*" onChange={onPick} style={{marginTop:'.5rem'}} />}
        <label style={{fontSize:'.9rem',color:'#555',marginTop:'1rem'}}>About</label>
        <textarea rows={6} value={profile.about} readOnly={!editable} onChange={e=>setProfile({...profile, about: e.target.value})} style={{width:'100%',resize:'vertical'}} />
        {editable && <button onClick={onSave} style={{marginTop:'.8rem'}}>Save profile</button>}
      </div>

      <div style={{marginTop:24}}>
        <h3 style={{marginBottom:10}}>Badges</h3>
        {!badges.length && <div style={{color:'#666'}}>No badges yet.</div>}
        {!!badges.length && (
          <div style={{display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10}}>
            {badges.map(b=>{
              const tier = String(b.tier || 'bronze')
              const active = String(game.equippedBadgeId || '') === String(b.badgeId || b.id)
              const s = tierStyle[tier] || tierStyle.bronze
              return (
                <div key={b.id} style={{border:'1px solid #e5e7eb', borderRadius:12, padding:10, background: active ? 'rgba(16,185,129,.08)' : '#fff'}}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}>
                    <div style={{fontWeight:900}}>{String(b.name || b.badgeId || b.id)}</div>
                    <span style={{padding:'2px 8px', borderRadius:999, background:s.bg, color:'#fff', fontSize:12, fontWeight:900}}>
                      {tier}
                    </span>
                  </div>
                  {editable && (
                    <div style={{marginTop:8}}>
                      <button onClick={()=>onEquipBadge(String(b.badgeId || b.id))} disabled={busy}>
                        {active ? 'Equipped' : 'Equip'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{marginTop:24}}>
        <h3 style={{marginBottom:10}}>Achievements</h3>
        {!achievements.length && <div style={{color:'#666'}}>No achievements yet.</div>}
        {!!achievements.length && (
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {achievements.map(a=>{
              const tier = String(a.tier || 'bronze')
              const s = tierStyle[tier] || tierStyle.bronze
              return (
                <div key={a.id} style={{border:'1px solid #e5e7eb', borderRadius:12, padding:10, background:'#fff'}}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}>
                    <div style={{fontWeight:900}}>{String(a.name || a.achievementId || a.id)}</div>
                    <span style={{padding:'2px 8px', borderRadius:999, background:s.bg, color:'#fff', fontSize:12, fontWeight:900}}>
                      {tier}
                    </span>
                  </div>
                  {!!a.condition && <div style={{marginTop:6, color:'#555', fontSize:13}}>{String(a.condition)}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editable && profile.username === 'stevesunhy' && (
        <div style={{marginTop:26, padding:12, border:'1px solid #f59e0b', borderRadius:12, background:'rgba(245,158,11,.08)'}}>
          <h3 style={{marginTop:0}}>Admin: Add achievement</h3>
          <div style={{display:'grid', gap:8}}>
            <input
              placeholder="Achievement name"
              value={adminForm.name}
              onChange={e=>setAdminForm({...adminForm, name:e.target.value})}
            />
            <input
              placeholder="Condition"
              value={adminForm.condition}
              onChange={e=>setAdminForm({...adminForm, condition:e.target.value})}
            />
            <select value={adminForm.tier} onChange={e=>setAdminForm({...adminForm, tier:e.target.value})}>
              <option value="bronze">bronze</option>
              <option value="silver">silver</option>
              <option value="gold">gold</option>
              <option value="legendary">legendary</option>
            </select>
            <button onClick={onAddAchievement} disabled={busy || !adminForm.name.trim()}>
              Add achievement
            </button>
            <div style={{color:'#7c2d12', fontSize:13}}>
              Note: requires admin claim (use Admin Claim page if needed).
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
