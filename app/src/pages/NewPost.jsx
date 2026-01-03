import { useEffect, useMemo, useRef, useState } from 'react'
import { auth, db, storage } from '../lib/firebase'
import { addDoc, collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useLocation, useNavigate } from 'react-router-dom'
import { getCallable } from '../lib/callable.js'
import { formatFirebaseError } from '../lib/errors.js'
import { DEFAULT_AVATAR_URL } from '../lib/placeholders.js'

export default function NewPost(){
  const [user, setUser] = useState(null)
  const [form, setForm] = useState({
    title:'',
    bigCategory:'Discussion',
    channel:'general',
    level:'',
    subjects:['algebra'],
    post:''
  })
  const [forums, setForums] = useState([])
  const [files, setFiles] = useState([])
  const [fileWarnings, setFileWarnings] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const fileInputRef = useRef(null)
  const [previews, setPreviews] = useState([]) // { key, url, name }
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, u=>{
      setUser(u)
      if (!u) window.location.href='/login'
    })
    return ()=>unsub()
  },[])

  // Prefill from query params: ?big=...&ch=...&sub=...&return=...
  useEffect(()=>{
    const sp = new URLSearchParams(location.search || '')
    const big = sp.get('big')
    const ch = sp.get('ch')
    const sub = sp.get('sub')
    setForm(prev=>{
      const next = { ...prev }
      if (big) next.bigCategory = big
      if (ch) next.channel = ch
      if (sub && !next.subjects.includes(sub)) next.subjects = Array.from(new Set([...next.subjects, sub]))
      return next
    })
  },[location.search])

  useEffect(()=>{
    const q = query(collection(db, 'forums'), orderBy('bigCategory','asc'), orderBy('channel','asc'), limit(500))
    const unsub = onSnapshot(q, (qs)=>{
      const list = qs.docs.map(d=>({ id:d.id, ...d.data() })).filter(x=>!x.deleted)
      setForums(list)
    }, (_e)=>{})
    return ()=>unsub()
  },[])

  const channels = useMemo(()=>{
    const pinnedCats = new Set(['Discussion','Q&A','Write-ups','Wiki build'])
    const pinned = pinnedCats.has(form.bigCategory) ? ['announcement','general'] : []
    const dyn = forums.filter(f=>f.bigCategory===form.bigCategory).map(f=>f.channel).filter(Boolean)
    const list = Array.from(new Set([...pinned, ...dyn])).sort((a,b)=>String(a).localeCompare(String(b)))
    // Ensure pinned channels are first
    if (pinned.length){
      const top = pinned.filter(x=>list.includes(x))
      const rest = list.filter(x=>!pinned.includes(x))
      return [...top, ...rest]
    }
    return list
  },[forums, form.bigCategory])

  const needsLevel = ['Discussion','Q&A','Write-ups'].includes(form.bigCategory)

  async function ensureForumExists(){
    // Create the forum doc if it doesn't exist yet (user-created channels).
    const id = `${form.bigCategory}:${form.channel}`.replace(/\s+/g,' ').slice(0,120)
    const ref = doc(db, 'forums', id)
    const snap = await getDoc(ref)
    if (snap.exists()) return
    await setDoc(ref, {
      bigCategory: form.bigCategory,
      channel: form.channel,
      createdBy: user.uid,
      createdAt: Timestamp.now(),
      deleted: false,
    }, { merge: true })
  }

  async function onSubmit(e){
    e.preventDefault()
    if (!user) return
    setErr('')
    setFileWarnings([])
    setIsSubmitting(true)
    const usr = await getDoc(doc(db,'users',user.uid))
    try{
      if (!form.channel.trim()) throw new Error('Pick a channel')
      if (!Array.isArray(form.subjects) || form.subjects.length === 0) throw new Error('Pick at least one subject')
      if (needsLevel && !form.level) throw new Error('Pick a level')

      await ensureForumExists()

      const base = {
      title: form.title,
      post: form.post,
      // Legacy field kept for older code paths: store channel.
      discussion: form.channel,
      bigCategory: form.bigCategory,
      channel: form.channel,
      subjects: form.subjects,
      ...(needsLevel ? { level: form.level } : {}),
      time: serverTimestamp(),
      likes: 0,
      comments: 0,
      starCount: 0,
      author: user.uid,
      authorName: usr.data()?.username,
      authorPhoto: usr.data()?.photoURL || DEFAULT_AVATAR_URL,
        hasImages: false,
      }

      // Announcements are server-only (created via Cloud Function) so they show as "Quantara Team".
      let postRef = null
      if (form.channel === 'announcement'){
        // Server enforces permissions; keep client error message generic.
        const fn = getCallable('adminCreateAnnouncementPost')
        const res = await fn({
          title: base.title,
          post: base.post,
          bigCategory: base.bigCategory,
          subjects: base.subjects,
          level: base.level || null,
        })
        const postId = res?.data?.postId
        if (!postId) throw new Error('Failed to create announcement post')
        postRef = doc(db, 'communityPosts', String(postId))
      } else {
        // Create post first to get a stable postId for Storage paths
        postRef = await addDoc(collection(db,'communityPosts'), base)
      }

      const picked = (files || []).slice(0, 6)
      let imageURLs = []
      if (picked.length){
        const problems = validateFiles(picked)
        if (problems.length){
          setFileWarnings(problems)
        }
        const tasks = picked.map(async (file)=>{
          const ct = normalizeContentType(file.type)
          if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(ct)) return null
          if (file.size > 5 * 1024 * 1024) return null
          const path = `community/${user.uid}/${postRef.id}/${cryptoRandom()}.${extFromType(ct)}`
          const r = storageRef(storage, path)
          await uploadBytes(r, file, { contentType: ct, customMetadata: { postId: postRef.id, author: user.uid } })
          return await getDownloadURL(r)
        })
        imageURLs = (await Promise.all(tasks)).filter(Boolean)
      }

      if (imageURLs.length){
        await updateDoc(postRef, { imageURLs, hasImages: true })
      }
    // Return to the channel we came from (if provided).
    const sp = new URLSearchParams(location.search || '')
    const ret = sp.get('return')
    if (ret) navigate(ret)
    else navigate('/community')
    }catch(e2){
      setErr(formatFirebaseError(e2))
      setIsSubmitting(false)
    }
  }

  useEffect(()=>{
    // Build preview URLs and clean them up when files change
    const next = (files || []).slice(0, 6).map(f=>{
      const key = `${f.name}-${f.size}-${f.lastModified}`
      return { key, name: f.name, url: URL.createObjectURL(f) }
    })
    setPreviews(next)
    return ()=>{ next.forEach(p=>URL.revokeObjectURL(p.url)) }
  },[files])

  return (
    <div style={{maxWidth:680, margin:'40px auto', padding:'0 1rem'}}>
      <h2>New Post</h2>
      {!!err && <div style={{margin:'8px 0', color:'#b00020'}}>{err}</div>}
      {!!fileWarnings.length && (
        <div style={{margin:'8px 0', color:'#8a4b00'}}>
          {fileWarnings.map((w, i)=>(<div key={`${w}-${i}`}>{w}</div>))}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <input placeholder="Title" required style={{width:'100%',fontSize:'1.1rem'}} value={form.title} onChange={e=>setForm({...form, title:e.target.value})} /><br />
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
          <div>
            <div style={{fontSize:'.9rem', color:'#555'}}>Category</div>
            <select value={form.bigCategory} onChange={e=>setForm({...form, bigCategory:e.target.value, channel:'', level:''})} style={{width:'100%'}}>
              {['Discussion','Q&A','Write-ups','Wiki build','Chatty'].map(c=>(<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <div style={{fontSize:'.9rem', color:'#555'}}>Channel</div>
            <input
              list="channels"
              placeholder="e.g. algebra"
              value={form.channel}
              onChange={e=>setForm({...form, channel:e.target.value})}
              style={{width:'100%'}}
              required
            />
            <datalist id="channels">
              {channels.map(c=>(<option key={c} value={c} />))}
            </datalist>
          </div>
        </div>

        {needsLevel && (
          <div style={{marginTop:10}}>
            <div style={{fontSize:'.9rem', color:'#555'}}>Level</div>
            <select required value={form.level} onChange={e=>setForm({...form, level:e.target.value})} style={{width:'100%'}}>
              <option value="" disabled>Choose level</option>
              {['Middle school','High school','College','Math competition','Graduate','Other'].map(l=>(<option key={l} value={l}>{l}</option>))}
            </select>
          </div>
        )}

        <div style={{marginTop:10}}>
          <div style={{fontSize:'.9rem', color:'#555'}}>Subjects (pick at least one)</div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(170px, 1fr))', gap:6, marginTop:6}}>
            {['algebra','geometry','number theory','combinatorics','calculus','linear algebra','probability','statistics','analysis','topology','logic','set theory','discrete math'].map(s=>(
              <label key={s} style={{display:'flex', gap:6, alignItems:'center'}}>
                <input
                  type="checkbox"
                  checked={form.subjects.includes(s)}
                  onChange={()=>{
                    setForm(prev=>{
                      const next = new Set(prev.subjects)
                      if (next.has(s)) next.delete(s); else next.add(s)
                      return { ...prev, subjects: Array.from(next) }
                    })
                  }}
                />
                {s}
              </label>
            ))}
          </div>
        </div>

        <textarea rows={10} placeholder="Your content (LaTeX allowed)" required value={form.post} onChange={e=>setForm({...form, post:e.target.value})} /><br />

        <div style={{margin:'10px 0'}}>
          <div style={{fontSize:'.9rem', color:'#555'}}>Images (up to 6, max 5MB each)</div>
          <div style={{fontSize:'.85rem', color:'#777', marginTop:4}}>
            Tip: you can pick images multiple times — we’ll keep appending them.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            multiple
            disabled={isSubmitting}
            onChange={e=>{
              const pickedNow = Array.from(e.target.files || [])
              const merged = mergeFiles(files, pickedNow)
              setFiles(merged)
              setFileWarnings(validateFiles(merged))
              // Allow picking the same file again in a future dialog
              e.target.value = ''
            }}
          />
          {!!files?.length && files.length > 6 && (
            <div style={{fontSize:'.85rem', color:'#8a4b00', marginTop:6}}>
              You selected {files.length} images; only the first 6 will be uploaded.
            </div>
          )}
          {!!files?.length && (
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={()=>{
                  setFiles([])
                  setFileWarnings([])
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                Clear images
              </button>
            </div>
          )}
          {!!files?.length && (
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(90px, 1fr))', gap:8, marginTop:10}}>
              {previews.map((p, i)=>(
                <div key={p.key} style={{position:'relative'}}>
                  <img
                    alt={p.name}
                    src={p.url}
                    style={{width:'100%', height:90, objectFit:'cover', borderRadius:8, border:'1px solid #ddd'}}
                  />
                  <button
                    type="button"
                    aria-label="Remove image"
                    disabled={isSubmitting}
                    onClick={()=>{
                      const next = files.filter((f, idx)=>idx !== i)
                      setFiles(next)
                      setFileWarnings(validateFiles(next))
                    }}
                    style={{
                      position:'absolute', top:6, right:6,
                      width:24, height:24, borderRadius:999,
                      border:'1px solid rgba(255,255,255,.6)',
                      background:'rgba(0,0,0,.55)', color:'#fff',
                      cursor:'pointer', lineHeight:'22px'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Publishing…' : 'Publish'}</button>
      </form>
    </div>
  )
}

function cryptoRandom(){
  const a = new Uint8Array(16)
  crypto.getRandomValues(a)
  return Array.from(a, b=>('0'+b.toString(16)).slice(-2)).join('')
}

function extFromType(t){
  if (t === 'image/png') return 'png'
  if (t === 'image/jpeg') return 'jpg'
  if (t === 'image/webp') return 'webp'
  if (t === 'image/svg+xml') return 'svg'
  return 'bin'
}

function normalizeContentType(t){
  if (t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg'
  if (t === 'image/svg') return 'image/svg+xml'
  return t
}

function validateFiles(list){
  const warnings = []
  const picked = (list || []).slice(0, 6)
  for (const f of picked){
    const ct = normalizeContentType(f.type)
    if (!ct){
      warnings.push(`"${f.name}": missing content type (try a different browser)`)
      continue
    }
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(ct)){
      // Common on iPhone: image/heic or image/heif
      warnings.push(`"${f.name}": unsupported type (${ct}). Use PNG/JPEG/WebP/SVG or export as JPEG.`)
    }
    if (f.size > 5 * 1024 * 1024){
      warnings.push(`"${f.name}": too large (${Math.round(f.size/1024/1024)}MB). Max is 5MB.`)
    }
  }
  return warnings
}

function mergeFiles(existing, added){
  const out = [...(existing || [])]
  const seen = new Set(out.map(f=>`${f.name}-${f.size}-${f.lastModified}`))
  for (const f of (added || [])){
    const key = `${f.name}-${f.size}-${f.lastModified}`
    if (!seen.has(key)){
      out.push(f)
      seen.add(key)
    }
  }
  return out
}
