import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { db, auth, storage } from '../lib/firebase'
import { latexMarkupToHTML, renderLatex } from '../lib/latex'
import { onAuthStateChanged } from 'firebase/auth'
import { deleteObject, ref as storageRef } from 'firebase/storage'
import { usePanels } from '../components/panels/PanelsContext.jsx'
import { sendPostMessage } from '../lib/chat.js'

const BIG_CATEGORIES = ['Discussion','Q&A','Write-ups','Wiki build','Chatty']
const DROPDOWN_CATEGORIES = new Set(['Discussion','Q&A','Write-ups','Wiki build'])
const LEVELS = ['Middle school','High school','College','Math competition','Graduate','Other']
const DEFAULT_SUBJECTS = ['algebra','geometry','number theory','combinatorics','calculus','linear algebra','probability','statistics','analysis','topology','logic','set theory','discrete math']
const PINNED_CHANNELS = ['announcement','general']

export default function Community(){
  const [user, setUser] = useState(null)
  const [selectedBig, setSelectedBig] = useState('Discussion')
  const [selectedChannel, setSelectedChannel] = useState('general')
  const [expanded, setExpanded] = useState(()=>Object.fromEntries(BIG_CATEGORIES.map(c=>[c, c==='Discussion'])))
  const [levelFilters, setLevelFilters] = useState(new Set())
  const [subjectFilter, setSubjectFilter] = useState('')
  const [forums, setForums] = useState([]) // [{id,bigCategory,channel,deleted}]
  const [isSteveAdmin, setIsSteveAdmin] = useState(false)
  const [posts, setPosts] = useState([])
  const [lightbox, setLightbox] = useState(null) // { urls: string[], index: number }
  const [actionErr, setActionErr] = useState('')
  const [starredSet, setStarredSet] = useState(new Set())
  // Optimistic star change tracking to avoid "double count" (optimistic + server increment).
  // postId -> { base: number, delta: 1|-1 }
  const [starPending, setStarPending] = useState({})
  const navigate = useNavigate()
  const location = useLocation()
  const { openPanel, closeAll } = usePanels()

  // Restore selected channel from URL params (so NewPost can send you back to the channel you posted to).
  useEffect(()=>{
    const sp = new URLSearchParams(location.search || '')
    const big = sp.get('big')
    const ch = sp.get('ch')
    const sub = sp.get('sub')
    const lvls = sp.get('lvls')
    if (big && BIG_CATEGORIES.includes(big)) setSelectedBig(big)
    if (ch) setSelectedChannel(ch)
    if (sub) setSubjectFilter(sub)
    if (lvls){
      const set = new Set(String(lvls).split(',').map(s=>s.trim()).filter(Boolean))
      setLevelFilters(set)
    }
  },[location.search])

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return () => unsub()
  },[])

  useEffect(()=>{
    (async()=>{
      if (!auth.currentUser){ setIsSteveAdmin(false); return }
      try{
        const tok = await auth.currentUser.getIdTokenResult(true)
        const isAdmin = !!tok?.claims?.admin
        const profSnap = await getDoc(doc(db, 'users', auth.currentUser.uid))
        const uname = profSnap.data()?.username || ''
        setIsSteveAdmin(isAdmin && uname === 'stevesunhy')
      }catch(_e){
        setIsSteveAdmin(false)
      }
    })()
  },[user])

  // Forums list
  useEffect(()=>{
    const q = query(collection(db, 'forums'), orderBy('bigCategory','asc'), orderBy('channel','asc'), limit(500))
    const unsub = onSnapshot(q, (qs)=>{
      const list = qs.docs.map(d=>({ id:d.id, ...d.data() }))
        .filter(x=>!x.deleted)
      setForums(list)
    }, (_e)=>{})
    return ()=>unsub()
  },[])

  // Keep a local set of starred postIds for the current user (for rendering filled stars)
  useEffect(()=>{
    if (!user){
      setStarredSet(new Set())
      return
    }
    const q = query(collection(db, 'users', user.uid, 'stars'), orderBy('createdAt', 'desc'), limit(300))
    const unsub = onSnapshot(
      q,
      (qs)=>{
        setStarredSet(new Set(qs.docs.map(d=>d.id)))
      },
      (_e)=>{}
    )
    return ()=>unsub()
  },[user])

  useEffect(()=>{
    // Fetch recent posts; we filter client-side for richer filters.
    const q = query(collection(db,'communityPosts'), orderBy('time','desc'), limit(200))
    const unsub = onSnapshot(q, async (qs)=>{
      const arr = []
      for (const d of qs.docs){ arr.push({ id:d.id, ...d.data(), _ref:d.ref }) }
      setPosts(arr)
    })
    return () => unsub()
  },[])

  const filteredPosts = useMemo(()=>{
    return posts.filter(p=>{
      const big = p.bigCategory || 'Discussion'
      const ch = p.channel || p.discussion || ''
      if (selectedBig && big !== selectedBig) return false
      if (DROPDOWN_CATEGORIES.has(selectedBig) && selectedChannel && ch !== selectedChannel) return false
      if (levelFilters.size > 0){
        const lvl = p.level || ''
        if (!lvl || !levelFilters.has(lvl)) return false
      }
      if (subjectFilter){
        const subs = Array.isArray(p.subjects) ? p.subjects : []
        if (!subs.includes(subjectFilter)) return false
      }
      return true
    })
  },[posts, selectedBig, selectedChannel, levelFilters, subjectFilter])

  const channelsByBig = useMemo(()=>{
    const map = Object.fromEntries(BIG_CATEGORIES.map(c=>[c, new Set()]))
    // Seed defaults for Discussion
    DEFAULT_SUBJECTS.forEach(s=>map['Discussion'].add(s))
    // Pinned channels for the first four categories
    ;['Discussion','Q&A','Write-ups','Wiki build'].forEach(cat=>{
      PINNED_CHANNELS.forEach(ch=>map[cat].add(ch))
    })
    for (const f of forums){
      if (!f.bigCategory || !f.channel) continue
      if (!map[f.bigCategory]) map[f.bigCategory] = new Set()
      map[f.bigCategory].add(f.channel)
    }
    const out = {}
    for (const [k, set] of Object.entries(map)){
      const list = Array.from(set).sort((a,b)=>String(a).localeCompare(String(b)))
      // Ensure pinned channels are always at the top (announcement, general)
      if (DROPDOWN_CATEGORIES.has(k)){
        const pinned = PINNED_CHANNELS.filter(p=>list.includes(p))
        const rest = list.filter(x=>!PINNED_CHANNELS.includes(x))
        out[k] = [...pinned, ...rest]
      } else {
        out[k] = list
      }
    }
    return out
  },[forums])

  async function addChannel(bigCategory){
    if (!auth.currentUser){ window.alert('Login first'); return }
    const name = window.prompt(`New channel under ${bigCategory}:`, '')
    if (!name) return
    const channel = name.trim()
    if (!channel) return
    const id = `${bigCategory}:${channel}`.replace(/\s+/g,' ').slice(0,120)
    try{
      await setDoc(doc(db, 'forums', id), {
        bigCategory,
        channel,
        createdBy: auth.currentUser.uid,
        createdAt: Timestamp.now(),
        deleted: false,
      }, { merge: true })
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function deleteForum(bigCategory, channel){
    if (!isSteveAdmin) return
    if (PINNED_CHANNELS.includes(channel) && DROPDOWN_CATEGORIES.has(bigCategory)){
      window.alert('Pinned channels cannot be deleted.')
      return
    }
    if (!window.confirm(`Delete forum "${bigCategory} / ${channel}"?`)) return
    const id = `${bigCategory}:${channel}`.replace(/\s+/g,' ').slice(0,120)
    await updateDoc(doc(db, 'forums', id), {
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: auth.currentUser.uid,
    })
  }

  // Clear optimistic star deltas once the server-updated starCount comes in.
  useEffect(()=>{
    setStarPending(prev=>{
      if (!prev || Object.keys(prev).length === 0) return prev
      const byId = new Map(posts.map(p=>[p.id, Number(p.starCount || 0)]))
      let changed = false
      const next = { ...prev }
      for (const [postId, pending] of Object.entries(prev)){
        const cur = byId.get(postId)
        if (typeof cur === 'number' && cur !== pending.base){
          delete next[postId]
          changed = true
        }
      }
      return changed ? next : prev
    })
  },[posts])

  async function toggleStar(p){
    if (!auth.currentUser) { window.alert('Login first'); return }
    setActionErr('')
    try{
      const uid = auth.currentUser.uid
      const ref = doc(db, 'users', uid, 'stars', p.id)
      const snap = await getDoc(ref)
      if (snap.exists()){
        await deleteDoc(ref)
        setStarPending(prev => ({ ...prev, [p.id]: { base: Number(p.starCount || 0), delta: -1 } }))
      } else {
        // Use a real Timestamp so Firestore rules can validate the type.
        await setDoc(ref, { createdAt: Timestamp.now() })
        setStarPending(prev => ({ ...prev, [p.id]: { base: Number(p.starCount || 0), delta: 1 } }))
      }
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function likePost(p){
    if (!auth.currentUser) { window.alert('Login first'); return }
    setActionErr('')
    try{
      const uid = auth.currentUser.uid
      const likeRef = doc(db, `communityPosts/${p.id}/likes/${uid}`)
      const snap = await getDoc(likeRef)
      if (snap.exists()){
        await deleteDoc(likeRef) // unlike
      } else {
        await setDoc(likeRef, { createdAt: serverTimestamp() }) // like
      }
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function deletePost(p){
    if (!auth.currentUser) { window.alert('Login first'); return }
    if (auth.currentUser.uid !== p.author) { window.alert('You can only delete your own posts.'); return }
    if (!window.confirm('Delete this post?')) return

    // Best-effort cleanup of images (author-only per Storage rules)
    if (Array.isArray(p.imageURLs) && p.imageURLs.length){
      await Promise.allSettled(
        p.imageURLs.map(async (u)=>{
          try{
            await deleteObject(storageRef(storage, u))
          }catch(_e){
            // ignore; we still delete the post doc
          }
        })
      )
    }

    await deleteDoc(doc(db,'communityPosts',p.id))
  }

  async function sendPostToChat(p){
    if (!auth.currentUser){ window.alert('Login first'); return }
    // Open a picker panel that lets user search their friend list with avatar previews.
    openPanel('share', {
      title: 'Send to…',
      props: { kind:'post', postId: p.id, postTitle: p.title || 'Untitled' },
      replaceAll: true,
      pushHistory: true,
    })
  }

  function openNewPostShortcut(){
    if (!auth.currentUser){ window.alert('Login first'); return }
    const params = new URLSearchParams()
    params.set('big', selectedBig)
    if (DROPDOWN_CATEGORIES.has(selectedBig)) params.set('ch', selectedChannel || 'general')
    if (subjectFilter) params.set('sub', subjectFilter)
    if (levelFilters.size) params.set('lvls', Array.from(levelFilters).join(','))
    const returnTo = `/community?${params.toString()}`

    const np = new URLSearchParams()
    np.set('big', selectedBig)
    if (DROPDOWN_CATEGORIES.has(selectedBig)) np.set('ch', selectedChannel || 'general')
    if (subjectFilter) np.set('sub', subjectFilter)
    np.set('return', returnTo)
    navigate(`/new?${np.toString()}`)
  }

  return (
    <div id="main" style={{width:'100%'}}>
      <aside id="sidebar">
        <button id="new-post-btn" onClick={()=>{ if(!user){alert('Please login first');return;} navigate('/new') }}>＋</button>
        <div style={{padding:'6px 0 10px'}}>
          <div style={{fontSize:'.85rem', color:'#666', margin:'6px 0'}}>Categories</div>
          {BIG_CATEGORIES.map(big=>(
            <div key={big} style={{marginBottom:6}}>
              <button
                type="button"
                onClick={()=>{
                  setSelectedBig(big)
                  if (!DROPDOWN_CATEGORIES.has(big)){
                    setSelectedChannel('')
                  } else {
                    const list = channelsByBig[big] || []
                    const preferred = list.includes('general') ? 'general' : (list[0] || '')
                    setSelectedChannel(preferred)
                  }
                  setExpanded(prev=>({ ...prev, [big]: !prev[big] }))
                }}
                style={{width:'100%', textAlign:'left'}}
              >
                {big} {DROPDOWN_CATEGORIES.has(big) ? (expanded[big] ? '▾' : '▸') : ''}
              </button>
              {DROPDOWN_CATEGORIES.has(big) && expanded[big] && (
                <div style={{paddingLeft:10, marginTop:4, display:'flex', flexDirection:'column', gap:4}}>
                  <button type="button" onClick={()=>addChannel(big)} style={{textAlign:'left'}}>＋ Add channel</button>
                  {(channelsByBig[big] || []).map(ch=>(
                    <div key={`${big}:${ch}`} style={{display:'flex', alignItems:'center', gap:6}}>
                      <button
                        type="button"
                        onClick={()=>{ setSelectedBig(big); setSelectedChannel(ch) }}
                        style={{flex:1, textAlign:'left', fontWeight:(selectedBig===big && selectedChannel===ch)?700:400}}
                      >
                        {ch}
                      </button>
                      {isSteveAdmin && !(PINNED_CHANNELS.includes(ch) && ['Discussion','Q&A','Write-ups','Wiki build'].includes(big)) && (
                        <button type="button" onClick={()=>deleteForum(big, ch)} title="Delete forum">🗑️</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{borderTop:'1px solid #eee', paddingTop:10}}>
          <div style={{fontSize:'.85rem', color:'#666', marginBottom:6}}>Filters</div>
          <div style={{fontSize:'.85rem', color:'#777'}}>Levels</div>
          {LEVELS.map(lvl=>(
            <label key={lvl} style={{display:'flex', gap:6, alignItems:'center', fontSize:'.9rem'}}>
              <input
                type="checkbox"
                checked={levelFilters.has(lvl)}
                onChange={()=>{
                  setLevelFilters(prev=>{
                    const next = new Set(prev)
                    if (next.has(lvl)) next.delete(lvl); else next.add(lvl)
                    return next
                  })
                }}
              />
              {lvl}
            </label>
          ))}
          <div style={{marginTop:8}}>
            <div style={{fontSize:'.85rem', color:'#777'}}>Subject</div>
            <select value={subjectFilter} onChange={e=>setSubjectFilter(e.target.value)} style={{width:'100%'}}>
              <option value="">(any)</option>
              {DEFAULT_SUBJECTS.map(s=>(<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
        </div>
      </aside>
      <section id="content">
        <div style={{display:'flex', alignItems:'center', gap:10, margin:'6px 0 12px 0'}}>
          <div style={{fontWeight:900}}>
            {selectedBig}{DROPDOWN_CATEGORIES.has(selectedBig) ? ` · ${selectedChannel || 'general'}` : ''}
          </div>
          <span style={{marginLeft:'auto'}} />
          <button type="button" onClick={openNewPostShortcut}>＋ New post</button>
        </div>
        {!!actionErr && (
          <div style={{padding:'8px 10px', margin:'10px 0', border:'1px solid #ffd7b5', background:'#fff7ed', color:'#8a4b00', borderRadius:8}}>
            Action error: {actionErr}
          </div>
        )}
        {filteredPosts.length===0 && <div>No posts yet.</div>}
        {filteredPosts.map(p=> (
          <PostCard
            key={p.id}
            post={p}
            onLike={()=>likePost(p)}
            onToggleStar={()=>toggleStar(p)}
            isStarred={starredSet.has(p.id)}
            starPending={starPending[p.id] || null}
            // Reddit-style: clicking 💬 or the post opens the full post view (big images + all comments)
            onOpenComments={()=>{
              closeAll()
              openPanel('post', { title: p.title || 'Post', props: { postId: p.id } })
            }}
            onOpenPost={()=>{
              closeAll()
              openPanel('post', { title: p.title || 'Post', props: { postId: p.id } })
            }}
            onOpenPermalink={()=>navigate(`/community/post/${p.id}`)}
            onDelete={()=>deletePost(p)}
            onSendToChat={()=>sendPostToChat(p)}
            onOpenImage={(urls, index)=>setLightbox({ urls, index })}
          />
        ))}
      </section>
      {lightbox && (
        <Lightbox
          urls={lightbox.urls}
          index={lightbox.index}
          onClose={()=>setLightbox(null)}
          onSetIndex={(idx)=>setLightbox({ ...lightbox, index: idx })}
        />
      )}

      {/* Bottom-left Starred button (desktop only via PanelsProvider gating). */}
      <button
        type="button"
        onClick={()=>{
          closeAll()
          openPanel('stars', { title: 'Starred posts', props: {} })
        }}
        style={{
          position:'fixed',
          left:16,
          bottom:16,
          zIndex: 1100,
          padding:'.55rem .8rem',
          borderRadius:999,
          border:'1px solid #ddd',
          background:'#fff',
          boxShadow:'0 8px 22px rgba(0,0,0,.12)',
          cursor:'pointer'
        }}
        title="Open starred posts"
      >
        ⭐ Starred
      </button>
    </div>
  )
}

function PostCard({ post, onLike, onToggleStar, isStarred, starPending, onOpenComments, onOpenPost, onOpenPermalink, onDelete, onOpenImage, onSendToChat }){
  const ref = useRef(null)
  const [topComments, setTopComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [commentErr, setCommentErr] = useState('')
  const [commentLoadErr, setCommentLoadErr] = useState('')
  const [commentIndexUrl, setCommentIndexUrl] = useState('')
  const [authorCache, setAuthorCache] = useState({}) // uid -> { username, photoURL }
  const navigate = useNavigate()
  useEffect(()=>{
    if (!ref.current) return
    ref.current.innerHTML = `\n      <div class="post-body">${latexMarkupToHTML(post.post||'')}</div>\n    `
    renderLatex(ref.current)
  },[post])
  const canDelete = !!auth.currentUser && auth.currentUser.uid === post.author
  const canPin = !!auth.currentUser && auth.currentUser.uid === post.author

  useEffect(()=>{
    // Load top 2 comments for this post.
    // Primary: pinned desc, likes desc, timestamp desc (requires composite index).
    // Fallback: timestamp desc (still may require an index, but is the most likely to work).
    setCommentLoadErr('')
    setCommentIndexUrl('')

    const ranked = query(
      collection(db, 'comments'),
      where('postId', '==', post.id),
      orderBy('pinned', 'desc'),
      orderBy('likes', 'desc'),
      orderBy('timestamp', 'desc'),
      limit(2)
    )

    const fallback = query(
      collection(db, 'comments'),
      where('postId', '==', post.id),
      orderBy('timestamp', 'desc'),
      limit(2)
    )

    let unsub = onSnapshot(
      ranked,
      (qs)=>setTopComments(qs.docs.map(d=>({ id: d.id, ...d.data() }))),
      (err)=>{
        // Common: FAILED_PRECONDITION: The query requires an index.
        const msg = err?.message || String(err)
        setCommentLoadErr(msg)
        setCommentIndexUrl(extractFirstUrl(msg))
        unsub()
        unsub = onSnapshot(
          fallback,
          (qs)=>setTopComments(qs.docs.map(d=>({ id: d.id, ...d.data() }))),
          (err2)=>{
            const msg2 = err2?.message || String(err2)
            setCommentLoadErr(msg2)
            setCommentIndexUrl(extractFirstUrl(msg2))
          }
        )
      }
    )

    return ()=>unsub()
  },[post.id])

  async function submitComment(){
    if (!auth.currentUser){ window.alert('Login first'); return }
    const content = commentText.trim()
    if (!content) return
    setCommentErr('')
    try{
      // Pull username + photoURL from the user's profile doc so comments aren't "anon"
      const uid = auth.currentUser.uid
      const profSnap = await getDoc(doc(db, 'users', uid))
      const prof = profSnap.data() || {}
      await addDoc(collection(db, 'comments'), {
        postId: post.id,
        replyToCommentId: null,
        author: uid,
        authorName: prof.username || auth.currentUser.displayName || 'anon',
        authorPhoto: prof.photoURL || auth.currentUser.photoURL || null,
        content,
        timestamp: serverTimestamp(),
        likes: 0,
        pinned: false,
      })
      setCommentText('')
    }catch(e){
      setCommentErr(e?.message || String(e))
    }
  }

  useEffect(()=>{
    // Fill missing authorName/authorPhoto for older comments by looking up /users/{uid}
    const missing = new Set()
    for (const c of topComments){
      const uid = c.author
      if (!uid) continue
      if (c.authorName && c.authorPhoto) continue
      if (authorCache[uid]) continue
      missing.add(uid)
    }
    if (!missing.size) return

    ;(async()=>{
      const updates = {}
      await Promise.all(Array.from(missing).map(async (uid)=>{
        try{
          const s = await getDoc(doc(db, 'users', uid))
          const d = s.data() || {}
          updates[uid] = { username: d.username || 'anon', photoURL: d.photoURL || null }
        }catch(_e){
          updates[uid] = { username: 'anon', photoURL: null }
        }
      }))
      setAuthorCache(prev => ({ ...prev, ...updates }))
    })()
  },[topComments, authorCache])

  async function toggleCommentLike(c){
    if (!auth.currentUser){ window.alert('Login first'); return }
    const uid = auth.currentUser.uid
    const likeRef = doc(db, `comments/${c.id}/likes/${uid}`)
    const snap = await getDoc(likeRef)
    if (snap.exists()){
      await deleteDoc(likeRef)
    } else {
      await setDoc(likeRef, { createdAt: serverTimestamp() })
    }
  }

  async function deleteComment(c){
    if (!auth.currentUser){ window.alert('Login first'); return }
    if (auth.currentUser.uid !== c.author){ window.alert('You can only delete your own comments.'); return }
    if (!window.confirm('Delete this comment?')) return
    await deleteDoc(doc(db, 'comments', c.id))
  }

  async function togglePin(c){
    if (!canPin) return
    await updateDoc(doc(db, 'comments', c.id), {
      pinned: !c.pinned,
      pinnedAt: serverTimestamp(),
    })
  }

  return (
    <article className="post-card">
      <div style={{display:'flex',alignItems:'center',gap:'.4rem',marginBottom:'.3rem'}}>
        <img src={post.authorPhoto||'https://via.placeholder.com/24'} style={{width:24,height:24,borderRadius:'50%'}} />
        <span className="author">{post.authorName||'anon'}</span>
      </div>
      <h3 style={{cursor:'pointer'}} onClick={onOpenPost} title="Open post">{post.title}</h3>
      <small>
        {(post.bigCategory || 'Discussion')} · {(post.channel || post.discussion || 'misc')} · {post.time?.toDate? post.time.toDate().toLocaleString(): new Date().toLocaleString()}
        {Array.isArray(post.subjects) && post.subjects.length ? ` · ${post.subjects.join(', ')}` : ''}
        {!!post.level ? ` · ${post.level}` : ''}
      </small>
      <div ref={ref} />
      {Array.isArray(post.imageURLs) && post.imageURLs.length > 0 && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:6,margin:'.6rem 0 0'}}>
          {post.imageURLs.map((u, idx)=>(
            <button
              key={`${u}-${idx}`}
              type="button"
              onClick={()=>onOpenImage(post.imageURLs, idx)}
              style={{padding:0,border:'none',background:'transparent',cursor:'pointer'}}
              aria-label={`Open image ${idx+1}`}
            >
              <img src={u} loading="lazy" alt="" style={{width:'100%',height:120,objectFit:'cover',borderRadius:8,border:'1px solid #ddd'}} />
            </button>
          ))}
        </div>
      )}
      <div style={{marginTop:10}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <input
            value={commentText}
            onChange={e=>setCommentText(e.target.value)}
            placeholder="Add a comment…"
            style={{flex:1}}
          />
          <button type="button" onClick={submitComment}>Post</button>
        </div>
        {!!commentErr && <div style={{marginTop:6, color:'#b00020'}}>{commentErr}</div>}
        {!!commentLoadErr && (
          <div style={{marginTop:6, color:'#8a4b00', fontSize:'.9rem', wordBreak:'break-word'}}>
            <div>Comment feed error: {commentLoadErr.includes('requires an index') ? 'This query requires a Firestore index.' : commentLoadErr}</div>
            {!!commentIndexUrl && (
              <div style={{marginTop:4}}>
                <a href={commentIndexUrl} target="_blank" rel="noreferrer">Create the index in Firebase Console</a>
              </div>
            )}
          </div>
        )}

        {topComments.length > 0 && (
          <div style={{marginTop:10, display:'flex', flexDirection:'column', gap:8}}>
            {topComments.map(c=>(
              <div key={c.id} style={{border:'1px solid #eee', borderRadius:8, padding:'8px 10px', background:'#fafafa'}}>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <button
                    type="button"
                    onClick={()=>c.author && navigate(`/profile/${c.author}`)}
                    style={{padding:0,border:'none',background:'transparent',cursor:c.author?'pointer':'default'}}
                    title="View profile"
                  >
                    <img
                      src={c.authorPhoto || authorCache[c.author]?.photoURL || 'https://via.placeholder.com/24'}
                      alt=""
                      style={{width:24,height:24,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={()=>c.author && navigate(`/profile/${c.author}`)}
                    style={{padding:0,border:'none',background:'transparent',cursor:c.author?'pointer':'default',fontSize:'.9rem', color:'#444', fontWeight:600}}
                    title="View profile"
                  >
                    {c.authorName || authorCache[c.author]?.username || 'anon'}
                  </button>
                  {c.pinned && <span style={{fontSize:'.8rem', color:'#8a4b00'}}>Pinned</span>}
                  <span style={{marginLeft:'auto', display:'flex', gap:6}}>
                    {!!auth.currentUser && auth.currentUser.uid === c.author && (
                      <button type="button" onClick={()=>deleteComment(c)} title="Delete comment">🗑️</button>
                    )}
                    {canPin && (
                      <button type="button" onClick={()=>togglePin(c)} title="Pin/unpin">📌</button>
                    )}
                    <button type="button" onClick={()=>toggleCommentLike(c)} title="Like comment">
                      ❤️ <span>{c.likes || 0}</span>
                    </button>
                  </span>
                </div>
                <div style={{marginTop:4, whiteSpace:'pre-wrap'}}>{c.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="post-actions">
        <button type="button" onClick={onToggleStar} title={isStarred ? 'Unstar' : 'Star'}>
          {isStarred ? '⭐' : '☆'} <span>{
            Math.max(
              0,
              Number(post.starCount || 0) + (starPending && Number(post.starCount || 0) === Number(starPending.base || 0) ? Number(starPending.delta || 0) : 0)
            )
          }</span>
        </button>
        <button className="like-btn" onClick={onLike}>👍 <span>{post.likes||0}</span></button>
        <button className="comment-btn" onClick={onOpenComments}>💬 <span>{post.comments||0}</span></button>
        <button type="button" onClick={onOpenPost} title="Open post in panel">↗</button>
        <button type="button" onClick={onOpenPermalink} title="Open post page">🔗</button>
        <button type="button" onClick={onSendToChat} title="Send to chat">✉</button>
        <span style={{marginLeft:'auto'}}>
          {canDelete && (
            <button type="button" className="del-btn" onClick={onDelete} aria-label="Delete post">
              🗑️
            </button>
          )}
        </span>
      </div>
    </article>
  )
}

function extractFirstUrl(text){
  if (!text) return ''
  const m = String(text).match(/https?:\/\/[^\s]+/i)
  return m ? m[0] : ''
}

function Lightbox({ urls, index, onClose, onSetIndex }){
  const url = urls[index]

  useEffect(()=>{
    function onKey(e){
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onSetIndex((index - 1 + urls.length) % urls.length)
      if (e.key === 'ArrowRight') onSetIndex((index + 1) % urls.length)
    }
    window.addEventListener('keydown', onKey)
    return ()=>window.removeEventListener('keydown', onKey)
  },[index, urls.length, onClose, onSetIndex])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,.85)',
        display:'flex', alignItems:'center', justifyContent:'center',
        zIndex: 1000, padding: 16
      }}
    >
      <div onClick={e=>e.stopPropagation()} style={{maxWidth:'min(1100px, 100%)', width:'100%'}}>
        <div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{color:'#fff', fontSize:'.9rem'}}>{index+1} / {urls.length}</div>
          <div style={{display:'flex', gap:8}}>
            <button type="button" onClick={()=>onSetIndex((index - 1 + urls.length) % urls.length)}>Prev</button>
            <button type="button" onClick={()=>onSetIndex((index + 1) % urls.length)}>Next</button>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'center'}}>
          <img
            src={url}
            alt=""
            style={{maxWidth:'100%', maxHeight:'80vh', objectFit:'contain', borderRadius:10, background:'#111'}}
          />
        </div>
      </div>
    </div>
  )
}
