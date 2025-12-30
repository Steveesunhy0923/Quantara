import { useEffect, useMemo, useState } from 'react'
import { collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { auth, db } from '../../../lib/firebase.js'
import { usePanels } from '../PanelsContext.jsx'

export default function StarsPanel(){
  const { openPanel, closeAll } = usePanels()
  const [stars, setStars] = useState([]) // [{ postId, createdAt }]
  const [posts, setPosts] = useState({}) // postId -> post data
  const [err, setErr] = useState('')

  useEffect(()=>{
    setErr('')
    if (!auth.currentUser){
      setStars([])
      setPosts({})
      return
    }
    const uid = auth.currentUser.uid
    const q = query(collection(db, 'users', uid, 'stars'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(
      q,
      (qs)=>{
        const list = qs.docs.map(d=>({ postId: d.id, ...d.data() }))
        setStars(list)
      },
      (e)=>setErr(e?.message || String(e))
    )
    return ()=>unsub()
  },[])

  useEffect(()=>{
    // Fetch post docs for the current star list (best-effort).
    const need = stars.map(s=>s.postId).filter(Boolean)
    if (!need.length){
      setPosts({})
      return
    }
    ;(async()=>{
      const next = {}
      await Promise.all(need.map(async (pid)=>{
        try{
          const snap = await getDoc(doc(db, 'communityPosts', pid))
          if (snap.exists()) next[pid] = { id: snap.id, ...snap.data() }
        }catch(_e){}
      }))
      setPosts(next)
    })()
  },[stars])

  async function unstar(postId){
    if (!auth.currentUser) return
    const uid = auth.currentUser.uid
    await deleteDoc(doc(db, 'users', uid, 'stars', postId))
  }

  const rows = useMemo(()=>stars.map(s=>posts[s.postId]).filter(Boolean), [stars, posts])

  if (!auth.currentUser){
    return <div style={{padding:12}}>Login to view starred posts.</div>
  }

  return (
    <div style={{padding:12}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={{fontWeight:900}}>Starred posts</div>
        <span style={{marginLeft:'auto', color:'#666', fontSize:'.9rem'}}>{rows.length}</span>
      </div>
      {!!err && <div style={{color:'#b00020', marginBottom:8}}>{err}</div>}
      {rows.length === 0 && <div style={{color:'#777'}}>No starred posts yet.</div>}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {rows.map(p=>(
          <div key={p.id} style={{border:'1px solid #eee', borderRadius:10, padding:'10px 10px', background:'#fff'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div
                style={{fontWeight:800, cursor:'pointer'}}
                onClick={()=>{
                  // Do NOT closeAll() first; we want Return to restore this Stars panel.
                  // replaceAll will swap the dock content to the post view, and pushHistory records the current panels.
                  openPanel('post', { title: p.title || 'Post', props: { postId: p.id }, replaceAll: true, pushHistory: true })
                }}
              >
                {p.title || 'Untitled'}
              </div>
              <span style={{marginLeft:'auto'}} />
              <div style={{color:'#666', fontSize:'.9rem'}}>⭐ {p.starCount || 0}</div>
              <button type="button" onClick={()=>unstar(p.id)} title="Remove star">✕</button>
            </div>
            <div style={{marginTop:4, color:'#666', fontSize:'.9rem'}}>
              {(p.discussion || 'misc').toUpperCase()} · {p.time?.toDate ? p.time.toDate().toLocaleString() : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


