import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../../../lib/firebase.js'
import { latexMarkupToHTML, renderLatex } from '../../../lib/latex.js'
import CommentsPanel from './CommentsPanel.jsx'
import { adminBanUser, adminDeletePost } from '../../../lib/moderation.js'

export default function PostPanel({ postId }){
  const [post, setPost] = useState(null)
  const [err, setErr] = useState('')
  const [isSteveAdmin, setIsSteveAdmin] = useState(false)

  useEffect(()=>{
    setErr('')
    const unsub = onSnapshot(
      doc(db, 'communityPosts', postId),
      (snap)=>{
        if (!snap.exists()){
          setErr('Post not found')
          setPost(null)
          return
        }
        setPost({ id: snap.id, ...snap.data() })
      },
      (e)=>setErr(e?.message || String(e))
    )
    return ()=>unsub()
  },[postId])

  useEffect(()=>{
    ;(async()=>{
      if (!auth.currentUser){ setIsSteveAdmin(false); return }
      try{
        const tok = await auth.currentUser.getIdTokenResult(true)
        const isAdmin = !!tok?.claims?.admin
        // Username check is enforced server-side too, but this hides UI for others.
        const meSnap = await getDoc(doc(db, 'users', auth.currentUser.uid))
        const uname = meSnap.data()?.username || ''
        setIsSteveAdmin(isAdmin && uname === 'stevesunhy')
      }catch(_e){
        setIsSteveAdmin(false)
      }
    })()
  },[])

  useEffect(()=>{
    // Render LaTeX inside the post body once post loads
    if (!post) return
    const el = document.getElementById(`post-body-${postId}`)
    if (!el) return
    el.innerHTML = `<div class="post-body">${latexMarkupToHTML(post.post || '')}</div>`
    renderLatex(el)
  },[post, postId])

  const shareUrl = useMemo(()=>{
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/community/post/${postId}`
  },[postId])

  async function copyLink(){
    try{
      await navigator.clipboard.writeText(shareUrl)
      window.alert('Link copied!')
    }catch(_e){
      window.prompt('Copy link:', shareUrl)
    }
  }

  async function modDelete(){
    if (!isSteveAdmin) return
    const reason = window.prompt('Reason for deletion (optional):', '') || ''
    if (!window.confirm('Delete this post?')) return
    try{
      await adminDeletePost(postId, reason)
      window.alert('Post deleted (user notified).')
    }catch(e){
      window.alert(e?.message || String(e))
    }
  }

  async function modBan(){
    if (!isSteveAdmin || !post?.author) return
    const options = [
      ['1 hr', 60*60*1000],
      ['1 day', 24*60*60*1000],
      ['1 week', 7*24*60*60*1000],
      ['1 month', 30*24*60*60*1000],
      ['1 year', 365*24*60*60*1000],
      ['Permanent', 0],
    ]
    const label = window.prompt(`Ban duration: ${options.map(o=>o[0]).join(', ')}`, '1 day')
    if (!label) return
    const found = options.find(o=>o[0].toLowerCase() === label.toLowerCase())
    if (!found){ window.alert('Unknown duration'); return }
    const reason = window.prompt('Reason (optional):', '') || ''
    if (!window.confirm(`Ban user for ${found[0]}?`)) return
    try{
      await adminBanUser(post.author, found[1], reason)
      window.alert('User banned (user notified).')
    }catch(e){
      window.alert(e?.message || String(e))
    }
  }

  if (err){
    return <div style={{padding:12, color:'#b00020'}}>{err}</div>
  }

  if (!post){
    return <div style={{padding:12, color:'#777'}}>Loading post…</div>
  }

  return (
    <div style={{padding:12}}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{fontSize:'1.2rem', fontWeight:900}}>{post.title || 'Untitled'}</div>
        <div style={{color:'#666', fontSize:'.95rem'}}>⭐ {post.starCount || 0}</div>
        <span style={{marginLeft:'auto'}} />
        {isSteveAdmin && (
          <>
            <button type="button" onClick={modBan} title="Ban post author">Ban author</button>
            <button type="button" onClick={modDelete} title="Delete post (notify author)">Mod delete</button>
          </>
        )}
        <button type="button" onClick={copyLink}>Copy link</button>
        <a href={shareUrl} style={{textDecoration:'none'}}><button type="button">Open page</button></a>
      </div>
      <div style={{marginTop:4, color:'#666', fontSize:'.9rem'}}>
        {(post.discussion || 'misc').toUpperCase()} · {post.time?.toDate ? post.time.toDate().toLocaleString() : ''}
      </div>

      {Array.isArray(post.imageURLs) && post.imageURLs.length > 0 && (
        <div style={{marginTop:12, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:10}}>
          {post.imageURLs.map((u, i)=>(
            <a key={`${u}-${i}`} href={u} target="_blank" rel="noreferrer" style={{display:'block'}}>
              <img src={u} alt="" style={{width:'100%', height:220, objectFit:'cover', borderRadius:10, border:'1px solid #ddd'}} />
            </a>
          ))}
        </div>
      )}

      <div id={`post-body-${postId}`} style={{marginTop:12}} />

      <div style={{marginTop:16}}>
        <CommentsPanel postId={postId} postTitle={post.title} />
      </div>
    </div>
  )
}


