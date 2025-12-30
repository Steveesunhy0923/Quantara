import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Timestamp, addDoc, collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { db, auth } from '../../../lib/firebase.js'
import { extractFirstUrl } from '../panelUtils.js'
import { adminDeleteComment } from '../../../lib/moderation.js'
import { formatFirebaseError } from '../../../lib/errors.js'
import { DEFAULT_AVATAR_URL } from '../../../lib/placeholders.js'

export default function CommentsPanel({ postId, postTitle }){
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [indexUrl, setIndexUrl] = useState('')
  const [replyTo, setReplyTo] = useState(null) // { id, preview }
  const [isSteveAdmin, setIsSteveAdmin] = useState(false)

  useEffect(()=>{
    setLoadErr('')
    setIndexUrl('')

    const q = query(
      collection(db, 'comments'),
      where('postId', '==', postId),
      orderBy('pinned', 'desc'),
      orderBy('likes', 'desc'),
      orderBy('timestamp', 'desc'),
      limit(200)
    )

    const fallback = query(
      collection(db, 'comments'),
      where('postId', '==', postId),
      orderBy('timestamp', 'desc'),
      limit(200)
    )

    let unsub = onSnapshot(
      q,
      (qs)=>setItems(qs.docs.map(d=>({ id:d.id, ...d.data() }))),
      (e)=>{
        const msg = e?.message || String(e)
        setLoadErr(msg)
        setIndexUrl(extractFirstUrl(msg))
        unsub()
        unsub = onSnapshot(
          fallback,
          (qs)=>setItems(qs.docs.map(d=>({ id:d.id, ...d.data() }))),
          (e2)=>{
            const msg2 = e2?.message || String(e2)
            setLoadErr(msg2)
            setIndexUrl(extractFirstUrl(msg2))
          }
        )
      }
    )
    return ()=>unsub()
  },[postId])

  useEffect(()=>{
    ;(async()=>{
      if (!auth.currentUser){ setIsSteveAdmin(false); return }
      try{
        const tok = await auth.currentUser.getIdTokenResult(true)
        const isAdmin = !!tok?.claims?.admin
        const profSnap = await getDoc(doc(db, 'users', auth.currentUser.uid))
        const uname = profSnap.data()?.username || ''
        setIsSteveAdmin(isAdmin && uname === 'stevesunhy')
      }catch{
        setIsSteveAdmin(false)
      }
    })()
  },[])

  const title = useMemo(()=>postTitle ? `Comments · ${postTitle}` : 'Comments', [postTitle])

  async function submit(){
    if (!auth.currentUser){ window.alert('Login first'); return }
    const content = text.trim()
    if (!content) return
    setErr('')
    try{
      const uid = auth.currentUser.uid
      const profSnap = await getDoc(doc(db, 'users', uid))
      const prof = profSnap.data() || {}
      await addDoc(collection(db, 'comments'), {
        postId,
        replyToCommentId: replyTo?.id || null,
        author: uid,
        authorName: prof.username || auth.currentUser.displayName || 'anon',
        authorPhoto: prof.photoURL || auth.currentUser.photoURL || null,
        content,
        // Use a real Timestamp so Firestore rules (`timestamp is timestamp`) pass.
        timestamp: Timestamp.now(),
        likes: 0,
        pinned: false,
      })
      setText('')
      setReplyTo(null)
    }catch(e){
      setErr(formatFirebaseError(e))
    }
  }

  async function deleteComment(c){
    if (!auth.currentUser){ window.alert('Login first'); return }
    const mine = auth.currentUser.uid === c.author
    if (!mine && !isSteveAdmin){
      window.alert('You can only delete your own comments.')
      return
    }
    if (!window.confirm('Delete this comment?')) return
    if (isSteveAdmin && !mine){
      const reason = window.prompt('Reason for deletion (optional):', '') || ''
      await adminDeleteComment(c.id, reason)
    } else {
      await deleteDoc(doc(db, 'comments', c.id))
    }
  }

  return (
    <div style={{padding:12}}>
      <div style={{fontWeight:800, marginBottom:6}}>{title}</div>
      {!!loadErr && (
        <div style={{padding:'8px 10px',border:'1px solid #ffd7b5',background:'#fff7ed',color:'#8a4b00',borderRadius:8, marginBottom:10}}>
          <div>{loadErr.includes('requires an index') ? 'This query requires a Firestore index.' : loadErr}</div>
          {!!indexUrl && <div style={{marginTop:6}}><a href={indexUrl} target="_blank" rel="noreferrer">Create the index</a></div>}
        </div>
      )}
      {!!replyTo && (
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,padding:'8px 10px',border:'1px solid #e5e5e5',borderRadius:8,background:'#fafafa'}}>
          <div style={{fontSize:'.9rem',color:'#444'}}>Replying to: <span style={{fontFamily:'monospace'}}>{replyTo.id.slice(0,6)}…</span> {replyTo.preview ? `— "${replyTo.preview}"` : ''}</div>
          <span style={{marginLeft:'auto'}} />
          <button type="button" onClick={()=>setReplyTo(null)}>Cancel</button>
        </div>
      )}
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Write a comment…" style={{flex:1}} />
        <button type="button" onClick={submit}>Post</button>
      </div>
      {!!err && <div style={{marginTop:8,color:'#b00020'}}>{err}</div>}

      <div style={{marginTop:12, display:'flex', flexDirection:'column', gap:10}}>
        {items.map(c=>(
          <div key={c.id} style={{border:'1px solid #eee', borderRadius:10, padding:'10px 10px', background:'#fff'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <button
                type="button"
                onClick={()=>c.author && navigate(`/profile/${c.author}`)}
                style={{padding:0,border:'none',background:'transparent',cursor:c.author?'pointer':'default'}}
                title="View profile"
              >
                <img
                  src={c.authorPhoto || DEFAULT_AVATAR_URL}
                  alt=""
                  style={{width:24,height:24,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}}
                />
              </button>
              <button
                type="button"
                onClick={()=>c.author && navigate(`/profile/${c.author}`)}
                style={{padding:0,border:'none',background:'transparent',cursor:c.author?'pointer':'default',fontWeight:700}}
                title="View profile"
              >
                {c.authorName || 'anon'}
              </button>
              {c.pinned && <span style={{fontSize:'.8rem', color:'#8a4b00'}}>Pinned</span>}
              <span style={{marginLeft:'auto'}} />
              {!!auth.currentUser && (auth.currentUser.uid === c.author || isSteveAdmin) && (
                <button type="button" onClick={()=>deleteComment(c)} title="Delete comment">🗑️</button>
              )}
              <button
                type="button"
                onClick={()=>setReplyTo({ id: c.id, preview: (c.content || '').slice(0, 40) })}
              >
                Reply
              </button>
            </div>
            {c.replyToCommentId && (
              <div style={{marginTop:6, fontSize:'.85rem', color:'#666'}}>
                Reply to: <span style={{fontFamily:'monospace'}}>{String(c.replyToCommentId).slice(0,6)}…</span>
              </div>
            )}
            <div style={{marginTop:8, whiteSpace:'pre-wrap'}}>{c.content}</div>
          </div>
        ))}
        {items.length === 0 && <div style={{color:'#777'}}>No comments yet.</div>}
      </div>
    </div>
  )
}


