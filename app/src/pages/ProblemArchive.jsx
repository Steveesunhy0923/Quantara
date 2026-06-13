import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getIdTokenResult, onAuthStateChanged } from 'firebase/auth'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db, storage } from '../lib/firebase'
import { latexMarkupToHTML, renderLatexSoon } from '../lib/latex'
import { getCallable } from '../lib/callable.js'

const LEVELS = [
  { key:'apprentice', label:'Apprentice' },
  { key:'journeyman', label:'Journeyman' },
  { key:'scholar', label:'Scholar' },
  { key:'grandmaster', label:'Grandmaster' },
]

function nowMillis(){ return Date.now() }

function normalizeConceptKey(s){
  const t = String(s || '').trim().toLowerCase()
  const slug = t
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
  return slug
}

function looksLikeLatex(raw){
  const s = String(raw || '').trim()
  if (!s) return false
  const hasDelims =
    s.includes('\\(') || s.includes('\\)') ||
    s.includes('\\[') || s.includes('\\]') ||
    /\$\$[\s\S]+?\$\$/.test(s) ||
    /\$[^$]+\$/.test(s)
  const hasBackslash = s.includes('\\')
  return hasDelims || hasBackslash
}

function LatexView({ src = '' }){
  const ref = useRef(null)
  useEffect(()=>{
    const el = ref.current
    if (!el) return
    const raw = String(src || '').trim()
    if (!raw){
      el.textContent = ''
      return
    }
    if (!looksLikeLatex(raw)){
      el.textContent = raw
      return
    }
    const hasDelims =
      raw.includes('\\(') || raw.includes('\\)') ||
      raw.includes('\\[') || raw.includes('\\]') ||
      /\$\$[\s\S]+?\$\$/.test(raw) ||
      /\$[^$]+\$/.test(raw)
    const wrapped = hasDelims ? raw : `\\[${raw}\\]`
    el.innerHTML = latexMarkupToHTML(wrapped)
    const cancel = renderLatexSoon(el, { timeout: 1800 })
    return ()=>cancel()
  },[src])
  return <div ref={ref} />
}

export default function ProblemArchive(){
  const params = useParams()
  const dateKeyParam = params.dateKey ? String(params.dateKey) : ''
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [state, setState] = useState({ loading:true, rows:[], error:null }) // archive list
  const [detail, setDetail] = useState({ loading:false, levels:{}, error:null })
  const [levelKey, setLevelKey] = useState('apprentice')

  const [solutions, setSolutions] = useState({ loading:false, rows:[], error:null })
  const [activeSolutionKey, setActiveSolutionKey] = useState('')
  const [sourceState, setSourceState] = useState({ loading:false, data:null, error:null })
  const [editingSolutionKey, setEditingSolutionKey] = useState('')

  const [showAddSolution, setShowAddSolution] = useState(false)
  const [concept, setConcept] = useState('')
  const [blocks, setBlocks] = useState([{ type:'text', text:'' }])
  const [savingSolution, setSavingSolution] = useState(false)
  const [solutionErr, setSolutionErr] = useState('')

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  useEffect(()=>{
    let cancelled = false
    ;(async()=>{
      try{
        if (!user){ setIsAdmin(false); return }
        const tok = await getIdTokenResult(user, true)
        if (!cancelled) setIsAdmin(!!tok?.claims?.admin)
      }catch{
        if (!cancelled) setIsAdmin(false)
      }
    })()
    return ()=>{ cancelled = true }
  },[user])

  useEffect(()=>{
    (async()=>{
      // List mode: show past problems by date (group levels).
      if (dateKeyParam) return
      setState({ loading:true, rows:[], error:null })
      try{
        const qs = await getDocs(query(collectionGroup(db, 'levels'), orderBy('dateKey','desc'), limit(800)))
        const now = nowMillis()
        const byDate = new Map()
        for (const d of qs.docs){
          const data = d.data() || {}
          const dateKey = String(data.dateKey || '').trim() || d.ref.parent?.parent?.id
          const levelKey = String(data.levelKey || d.id || '').trim().toLowerCase()
          const pub = data.publishAt?.toMillis ? data.publishAt.toMillis() : (typeof data.publishAt === 'number' ? data.publishAt : 0)
          if (pub && pub > now) continue
          if (!dateKey || !levelKey) continue
          if (!byDate.has(dateKey)){
            byDate.set(dateKey, { dateKey, levels:{} })
          }
          const row = byDate.get(dateKey)
          row.levels[levelKey] = {
            levelKey,
            difficulty: String(data.difficulty || '').trim(),
            publishAt: pub || 0,
          }
        }

        // Legacy fallback: include `dailyChallenges/{dateKey}` docs that existed before per-level migration.
        // Only include if the date doesn't already have any levels.
        try{
          const legacyQs = await getDocs(query(collection(db, 'dailyChallenges'), orderBy('dateKey','desc'), limit(400)))
          for (const d of legacyQs.docs){
            const data = d.data() || {}
            const dateKey = String(data.dateKey || d.id || '').trim()
            if (!dateKey) continue
            if (byDate.has(dateKey)) continue
            const pub = data.publishAt?.toMillis ? data.publishAt.toMillis() : (typeof data.publishAt === 'number' ? data.publishAt : 0)
            if (pub && pub > now) continue
            byDate.set(dateKey, {
              dateKey,
              levels: {
                apprentice: { levelKey:'apprentice', difficulty: String(data.difficulty || 'Apprentice'), publishAt: pub || 0 }
              }
            })
          }
        }catch(_e){}

        const rows = Array.from(byDate.values()).sort((a,b)=> String(b.dateKey).localeCompare(String(a.dateKey)))
        setState({ loading:false, rows, error:null })
      }catch(err){
        setState({ loading:false, rows:[], error: err?.message || String(err) })
      }
    })()
  },[dateKeyParam])

  useEffect(()=>{
    (async()=>{
      // Detail mode: load all levels for a dateKey.
      if (!dateKeyParam) return
      setDetail({ loading:true, levels:{}, error:null })
      try{
        const qs = await getDocs(collection(db, 'dailyChallenges', dateKeyParam, 'levels'))
    const now = nowMillis()
        const levels = {}
        for (const d of qs.docs){
          const data = d.data() || {}
          const pub = data.publishAt?.toMillis ? data.publishAt.toMillis() : (typeof data.publishAt === 'number' ? data.publishAt : 0)
          if (pub && pub > now) continue
          const k = String(data.levelKey || d.id || '').trim().toLowerCase()
          if (!k) continue
          levels[k] = { id:d.id, ...data }
        }

        // Legacy fallback: if no levels exist, show the legacy doc as Apprentice.
        if (!Object.keys(levels).length){
          try{
            const legacy = await getDoc(doc(db, 'dailyChallenges', dateKeyParam))
            if (legacy.exists()){
              const data = legacy.data() || {}
              const pub = data.publishAt?.toMillis ? data.publishAt.toMillis() : (typeof data.publishAt === 'number' ? data.publishAt : 0)
              if (!pub || pub <= now){
                levels.apprentice = { id: legacy.id, ...data, levelKey:'apprentice', difficulty: data.difficulty || 'Apprentice' }
              }
            }
          }catch(_e){}
        }

        setDetail({ loading:false, levels, error:null })
      }catch(err){
        setDetail({ loading:false, levels:{}, error: err?.message || String(err) })
      }
    })()
  },[dateKeyParam])

  useEffect(()=>{
    // Default level tab for detail: first available.
    if (!dateKeyParam) return
    const avail = Object.keys(detail.levels || {})
    if (avail.length && !avail.includes(levelKey)){
      setLevelKey(avail[0])
    }
  },[dateKeyParam, detail.levels, levelKey])

  useEffect(()=>{
    (async()=>{
      if (!dateKeyParam) return
      if (!levelKey) return
      const ch = detail.levels?.[levelKey]
      const deadlineAtMs = ch?.deadlineAt?.toMillis ? ch.deadlineAt.toMillis() : null
      // Gate solutions until after deadline (7pm ET next day).
      if (!deadlineAtMs || Date.now() < deadlineAtMs){
        setSolutions({ loading:false, rows:[], error:null })
        setActiveSolutionKey('')
        return
      }

      setSolutions({ loading:true, rows:[], error:null })
      try{
        const qs = await getDocs(collection(db, 'dailyChallenges', dateKeyParam, 'levels', levelKey, 'solutions'))
        const rows = qs.docs.map(d=>({ id:d.id, ...d.data() }))
        // Order: official first, then by createdAt.
        rows.sort((a,b)=>{
          if (a.id === 'official') return -1
          if (b.id === 'official') return 1
          const am = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
          const bm = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
          return bm - am
        })
        setSolutions({ loading:false, rows, error:null })
        setActiveSolutionKey(rows[0]?.id || '')
      }catch(err){
        setSolutions({ loading:false, rows:[], error: err?.message || String(err) })
      }
    })()
  },[dateKeyParam, levelKey, detail.levels])

  useEffect(()=>{
    (async()=>{
      if (!dateKeyParam) { setSourceState({ loading:false, data:null, error:null }); return }
      const ch = detail.levels?.[levelKey]
      if (!ch) { setSourceState({ loading:false, data:null, error:null }); return }
      const deadlineAtMs = ch.deadlineAt?.toMillis ? ch.deadlineAt.toMillis() : null
      if (!deadlineAtMs || Date.now() < deadlineAtMs){
        setSourceState({ loading:false, data:null, error:null })
        return
      }
      setSourceState({ loading:true, data:null, error:null })
      try{
        const fn = getCallable('challengeGetDailySource')
        const res = await fn({ dateKey: dateKeyParam, levelKey })
        setSourceState({ loading:false, data: res.data || null, error:null })
      }catch(e){
        setSourceState({ loading:false, data:null, error: e?.message || String(e) })
      }
    })()
  },[dateKeyParam, levelKey, detail.levels])

  function resetSolutionEditor(){
    setConcept('')
    setBlocks([{ type:'text', text:'' }])
    setSolutionErr('')
    setEditingSolutionKey('')
  }

  async function insertSolutionImage(idx){
    if (!user) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async ()=>{
      const file = input.files?.[0]
      if (!file) return
      const conceptKey = normalizeConceptKey(concept || 'solution')
      if (!conceptKey){ setSolutionErr('Enter a concept first'); return }
      try{
        setSavingSolution(true)
        const ext = (file.type || '').includes('png') ? 'png' : ((file.type || '').includes('webp') ? 'webp' : 'jpg')
        const path = `dailySolutions/${user.uid}/${dateKeyParam}/${levelKey}/${conceptKey}/${Date.now()}.${ext}`
        const r = storageRef(storage, path)
        await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' })
        const url = await getDownloadURL(r)
        setBlocks(prev=>{
          const next = [...prev]
          next.splice(idx+1, 0, { type:'image', imageURL: url, caption:'' }, { type:'text', text:'' })
          return next.slice(0, 12)
        })
      }catch(e){
        setSolutionErr(e?.message || String(e))
      }finally{
        setSavingSolution(false)
      }
    }
    input.click()
  }

  async function saveSolution(){
    if (!dateKeyParam) return
    if (!user){ alert('Login first'); return }
    setSolutionErr('')
    const conceptTrim = String(concept || '').trim()
    const conceptKey = editingSolutionKey || normalizeConceptKey(conceptTrim)
    if (!conceptTrim || conceptTrim.length < 2) { setSolutionErr('Concept is required (min 2 chars)'); return }
    if (!conceptKey || conceptKey.length < 2) { setSolutionErr('Concept must contain letters/numbers'); return }
    if (conceptKey === 'official' && !isAdmin){ setSolutionErr('Only admins can create the official solution'); return }
    // Must be concept-unique per problem/level (enforced by doc id).
    const cleaned = blocks
      .map(b=>{
        if (b.type === 'text') return { type:'text', text:String(b.text || '').trim() }
        return { type:'image', imageURL:String(b.imageURL || '').trim(), caption:String(b.caption || '').trim() }
      })
      .filter(b=> (b.type === 'text' ? b.text.length > 0 : !!b.imageURL))
      .slice(0, 12)
    if (!cleaned.length){ setSolutionErr('Write something in the solution'); return }
    try{
      setSavingSolution(true)
      let username = user.displayName || 'anon'
      try{
        const snap = await getDoc(doc(db, 'users', user.uid))
        const u = snap.data()
        if (u?.username) username = String(u.username)
      }catch(_e){}
      const solRef = doc(db, 'dailyChallenges', dateKeyParam, 'levels', levelKey, 'solutions', conceptKey)
      if (editingSolutionKey){
        await setDoc(solRef, {
          concept: conceptTrim,
          conceptKey,
          blocks: cleaned,
          approved: false,
          approvedAt: null,
          approvedBy: null,
          updatedAt: serverTimestamp(),
        }, { merge: true })
      } else {
        await setDoc(solRef, {
          dateKey: dateKeyParam,
          levelKey,
          concept: conceptTrim,
          conceptKey,
          blocks: cleaned,
          createdBy: user.uid,
          createdByUsername: username,
          approved: false,
          approvedAt: null,
          approvedBy: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: false })
      }
      setShowAddSolution(false)
      resetSolutionEditor()
      // Refresh list
      const qs = await getDocs(collection(db, 'dailyChallenges', dateKeyParam, 'levels', levelKey, 'solutions'))
      const rows = qs.docs.map(d=>({ id:d.id, ...d.data() }))
      rows.sort((a,b)=>{
        if (a.id === 'official') return -1
        if (b.id === 'official') return 1
        const am = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
        const bm = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
        return bm - am
      })
      setSolutions({ loading:false, rows, error:null })
      setActiveSolutionKey(conceptKey)
    }catch(e){
      setSolutionErr(e?.message || String(e))
    }finally{
      setSavingSolution(false)
    }
  }

  async function onEditSolution(sol){
    if (!sol) return
    setShowAddSolution(true)
    setEditingSolutionKey(String(sol.id || ''))
    setConcept(String(sol.concept || sol.id || ''))
    setBlocks(Array.isArray(sol.blocks) && sol.blocks.length ? sol.blocks : [{ type:'text', text:'' }])
    setSolutionErr('')
  }

  async function onDeleteSolution(sol){
    if (!sol?.id) return
    if (!user){ alert('Login first'); return }
    if (!window.confirm('Delete this solution?')) return
    try{
      await deleteDoc(doc(db, 'dailyChallenges', dateKeyParam, 'levels', levelKey, 'solutions', String(sol.id)))
      // Refresh list
      const qs = await getDocs(collection(db, 'dailyChallenges', dateKeyParam, 'levels', levelKey, 'solutions'))
      const rows = qs.docs.map(d=>({ id:d.id, ...d.data() }))
      rows.sort((a,b)=>{
        if (a.id === 'official') return -1
        if (b.id === 'official') return 1
        const am = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
        const bm = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
        return bm - am
      })
      setSolutions({ loading:false, rows, error:null })
      setActiveSolutionKey(rows[0]?.id || '')
    }catch(e){
      alert(e?.message || String(e))
    }
  }

  async function onApproveSolution(sol){
    if (!isAdmin) return
    if (!sol?.id) return
    try{
      await setDoc(doc(db, 'dailyChallenges', dateKeyParam, 'levels', levelKey, 'solutions', String(sol.id)), {
        approved: true,
        approvedAt: serverTimestamp(),
        approvedBy: auth.currentUser?.uid || null,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      // Refresh list
      const qs = await getDocs(collection(db, 'dailyChallenges', dateKeyParam, 'levels', levelKey, 'solutions'))
      const rows = qs.docs.map(d=>({ id:d.id, ...d.data() }))
      rows.sort((a,b)=>{
        if (a.id === 'official') return -1
        if (b.id === 'official') return 1
        const am = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
        const bm = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
        return bm - am
      })
      setSolutions({ loading:false, rows, error:null })
      setActiveSolutionKey(String(sol.id))
    }catch(e){
      alert(e?.message || String(e))
    }
  }

  return (
    <div style={{padding:16, width:'100%', maxWidth: 900, margin:'0 auto'}}>
      <h1>Problem Archive</h1>
      <p style={{color:'#666', marginTop:0}}>
        Past daily problems (shown after they publish at <b>8:00pm ET</b>).
      </p>

      {!dateKeyParam && (
        <>
      {state.loading && <div>Loading…</div>}
      {!!state.error && <div style={{color:'#a00'}}>{state.error}</div>}

      {!state.loading && !state.error && (
        <div style={{display:'grid', gap:10}}>
              {state.rows.map(r=>(
                <div key={r.dateKey} style={{border:'1px solid #eee', borderRadius:10, background:'#fff', padding:12}}>
              <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12}}>
                    <div style={{fontWeight:900, fontSize:'1.05rem'}}>{r.dateKey}</div>
                    <div style={{display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end'}}>
                      {LEVELS.filter(l=>r.levels?.[l.key]).map(l=>(
                        <span key={l.key} style={{padding:'2px 10px', borderRadius:999, background:'#f3f4f6', color:'#111', fontSize:12, fontWeight:800}}>
                          {l.label}
                        </span>
                      ))}
                    </div>
              </div>
              <div style={{marginTop:8}}>
                    <Link to={`/archive/${encodeURIComponent(r.dateKey)}`} style={{textDecoration:'none', color:'#1a73e8', fontWeight:800}}>
                  View
                </Link>
              </div>
            </div>
          ))}

              {!state.rows.length && (
            <div style={{border:'1px solid #eee', borderRadius:10, background:'#fff', padding:12, color:'#666'}}>
              No problems yet.
            </div>
          )}
        </div>
          )}
        </>
      )}

      {!!dateKeyParam && (
        <>
          <div style={{margin:'10px 0 14px'}}>
            <Link to="/archive" style={{textDecoration:'none', color:'#1a73e8', fontWeight:800}}>← Back to archive</Link>
          </div>
          <h2 style={{marginTop:0}}>{dateKeyParam}</h2>

          <div style={{display:'flex', gap:8, flexWrap:'wrap', margin:'10px 0 14px'}}>
            {LEVELS.map(l=>{
              const active = levelKey === l.key
              const exists = !!detail.levels?.[l.key]
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={()=>setLevelKey(l.key)}
                  disabled={!exists}
                  style={{
                    padding:'8px 12px',
                    borderRadius:999,
                    border: active ? '1px solid #111' : '1px solid #ddd',
                    background: active ? '#111' : '#fff',
                    color: active ? '#fff' : '#111',
                    opacity: exists ? 1 : 0.45,
                  }}
                  title={exists ? '' : 'Not posted for this difficulty'}
                >
                  {l.label}
                </button>
              )
            })}
          </div>

          {detail.loading && <div>Loading…</div>}
          {!!detail.error && <div style={{color:'#a00'}}>{detail.error}</div>}

          {!detail.loading && !detail.error && (
            <div style={{border:'1px solid #eee', borderRadius:12, background:'#fff', padding:12}}>
              {detail.levels?.[levelKey] ? (
                <>
                  <div style={{color:'#666', fontSize:'.95rem', marginBottom:8}}>
                    Difficulty: <b>{String(detail.levels[levelKey].difficulty || LEVELS.find(x=>x.key===levelKey)?.label || '')}</b>
                  </div>
                  <LatexView src={detail.levels[levelKey].questionLatex || ''} />
                  {!!detail.levels[levelKey].imageURL && (
                    <img
                      src={detail.levels[levelKey].imageURL}
                      alt="Daily problem"
                      style={{width:'100%', maxHeight:520, objectFit:'contain', background:'#fafafa', borderRadius:8, border:'1px solid #eee', marginTop:10}}
                    />
                  )}
                  {sourceState.loading && (
                    <div style={{marginTop:10, color:'#666'}}>Loading source…</div>
                  )}
                  {!!sourceState.error && (
                    <div style={{marginTop:10, color:'#a00'}}>{sourceState.error}</div>
                  )}
                  {!!sourceState.data?.source?.sourceName && (
                    <div style={{marginTop:10, padding:'10px 12px', border:'1px solid #eee', borderRadius:10, background:'#fafafa'}}>
                      <div style={{fontWeight:900, marginBottom:4}}>Source</div>
                      <div style={{color:'#222'}}>
                        {sourceState.data.source.sourceName}{' '}
                        {sourceState.data.source.sourceUrl ? (
                          <a href={sourceState.data.source.sourceUrl} target="_blank" rel="noreferrer">(link)</a>
                        ) : null}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{color:'#666'}}>No problem posted for this difficulty.</div>
              )}
            </div>
          )}

          {/* Solutions */}
          <div style={{marginTop:16}}>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <h3 style={{margin:'0'}}>Solutions</h3>
              <span style={{marginLeft:'auto'}} />
              <button
                type="button"
                onClick={()=>{
                  setShowAddSolution(v=>!v)
                  if (!showAddSolution) resetSolutionEditor()
                }}
                disabled={!user || !detail.levels?.[levelKey]}
                title={!user ? 'Login to add a solution' : (!detail.levels?.[levelKey] ? 'Pick an available difficulty first' : '')}
                style={{padding:'8px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff'}}
              >
                {showAddSolution ? 'Close' : 'Add solution'}
              </button>
            </div>

            {!!solutions.error && <div style={{color:'#a00', marginTop:8}}>{solutions.error}</div>}

            {solutions.loading && <div style={{marginTop:8}}>Loading…</div>}

            {!solutions.loading && !solutions.error && (
              <>
                {/* Gate solutions until deadline to prevent cheating */}
                {(() => {
                  const ch = detail.levels?.[levelKey]
                  const dl = ch?.deadlineAt?.toMillis ? ch.deadlineAt.toMillis() : null
                  if (!dl) return null
                  if (Date.now() < dl){
                    return (
                      <div style={{marginTop:10, padding:12, border:'1px solid #eee', borderRadius:12, background:'#fff', color:'#666'}}>
                        Solutions will be visible after the deadline (<b>7:00pm ET next day</b>).
                      </div>
                    )
                  }
                  return null
                })()}

                {!solutions.rows.length && (
                  <div style={{marginTop:10, padding:12, border:'1px solid #eee', borderRadius:12, background:'#fff', color:'#666'}}>
                    No solutions yet.
                  </div>
                )}

                {!!solutions.rows.length && (
                  <div style={{marginTop:10}}>
                    <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:10}}>
                      {solutions.rows.map((s, idx)=>{
                        const label =
                          s.id === 'official'
                            ? 'Solution 1 (Official)'
                            : `Solution ${idx+1} (${s.concept || s.id})`
                        const active = activeSolutionKey === s.id
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={()=>setActiveSolutionKey(s.id)}
                            style={{
                              padding:'7px 10px',
                              borderRadius:999,
                              border: active ? '1px solid #111' : '1px solid #ddd',
                              background: active ? '#111' : '#fff',
                              color: active ? '#fff' : '#111',
                              fontWeight:800,
                            }}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>

                    <div style={{border:'1px solid #eee', borderRadius:12, background:'#fff', padding:12}}>
                      {solutions.rows.filter(s=>s.id===activeSolutionKey).map(s=>(
                        <div key={s.id}>
                          <div style={{color:'#666', fontSize:'.9rem', marginBottom:10}}>
                            Concept: <b>{s.concept || s.id}</b> · by <b>{s.createdByUsername || 'anon'}</b>
                            {user && (isAdmin || s.createdBy === user.uid) && (
                              <>
                                {' '}
                                <button type="button" onClick={()=>onEditSolution(s)} style={{marginLeft:10}}>
                                  Edit
                                </button>
                                <button type="button" onClick={()=>onDeleteSolution(s)} style={{marginLeft:8}}>
                                  Delete
                                </button>
                              </>
                            )}
                            {isAdmin && s.approved !== true && (
                              <button type="button" onClick={()=>onApproveSolution(s)} style={{marginLeft:8}}>
                                Approve
                              </button>
                            )}
                            {s.approved !== true && (
                              <span style={{marginLeft:10, color:'#a00', fontWeight:800}}>
                                Pending approval
                              </span>
                            )}
                          </div>
                          <div style={{display:'grid', gap:12}}>
                            {(Array.isArray(s.blocks) ? s.blocks : []).map((b, i)=>(
                              <div key={i}>
                                {b.type === 'image' ? (
                                  <figure style={{margin:0}}>
                                    <img src={b.imageURL} alt={b.caption || 'solution image'} style={{width:'100%', borderRadius:10, border:'1px solid #eee'}} />
                                    {!!b.caption && <figcaption style={{marginTop:6, color:'#555', fontSize:13}}>{b.caption}</figcaption>}
                                  </figure>
                                ) : (
                                  <LatexView src={b.text || ''} />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {showAddSolution && (
              <div style={{marginTop:12, padding:12, border:'1px solid #eee', borderRadius:12, background:'#fff'}}>
                <div style={{display:'grid', gap:10}}>
                  <div>
                    <div style={{fontWeight:800, marginBottom:6}}>Concept (must be unique)</div>
                    <input
                      value={concept}
                      onChange={e=>setConcept(e.target.value)}
                      placeholder='e.g. "roots of unity"'
                      disabled={savingSolution}
                      style={{width:'100%', padding:10, borderRadius:10, border:'1px solid #ddd'}}
                    />
                    {concept.trim().toLowerCase() === 'official' && !isAdmin && (
                      <div style={{marginTop:6, color:'#a00', fontSize:13}}>“official” is reserved for admins.</div>
                    )}
                  </div>

                  <div>
                    <div style={{fontWeight:800, marginBottom:6}}>Solution blocks</div>
                    <div style={{display:'grid', gap:10}}>
                      {blocks.map((b, idx)=>(
                        <div key={idx} style={{border:'1px solid #eee', borderRadius:12, padding:10, background:'#fafafa'}}>
                          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                            <div style={{fontWeight:900}}>{b.type === 'image' ? 'Image' : 'Text'}</div>
                            <span style={{marginLeft:'auto'}} />
                            <button
                              type="button"
                              onClick={()=>setBlocks(prev=>prev.filter((_,i)=>i!==idx))}
                              disabled={savingSolution || blocks.length <= 1}
                            >
                              Remove
                            </button>
                          </div>
                          {b.type === 'image' ? (
                            <>
                              <img src={b.imageURL} alt="solution" style={{width:'100%', borderRadius:10, border:'1px solid #eee', background:'#fff'}} />
                              <input
                                value={b.caption || ''}
                                onChange={e=>setBlocks(prev=>{
                                  const next = [...prev]
                                  next[idx] = { ...next[idx], caption: e.target.value }
                                  return next
                                })}
                                placeholder="Caption (optional)"
                                disabled={savingSolution}
                                style={{width:'100%', padding:10, borderRadius:10, border:'1px solid #ddd', marginTop:8}}
                              />
                            </>
                          ) : (
                            <textarea
                              value={b.text || ''}
                              onChange={e=>setBlocks(prev=>{
                                const next = [...prev]
                                next[idx] = { ...next[idx], text: e.target.value }
                                return next
                              })}
                              placeholder="Write LaTeX or plain text. To include an image mid-solution, use “Insert image” below."
                              disabled={savingSolution}
                              rows={5}
                              style={{width:'100%', padding:10, borderRadius:10, border:'1px solid #ddd', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'}}
                            />
                          )}
                          {b.type !== 'image' && (
                            <div style={{marginTop:8}}>
                              <button
                                type="button"
                                onClick={()=>insertSolutionImage(idx)}
                                disabled={savingSolution || !user}
                              >
                                Insert image after this block
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:10}}>
                      <button
                        type="button"
                        onClick={()=>setBlocks(prev=>[...prev, { type:'text', text:'' }].slice(0, 12))}
                        disabled={savingSolution || blocks.length >= 12}
                      >
                        Add text block
                      </button>
                      <button
                        type="button"
                        onClick={saveSolution}
                        disabled={savingSolution || !concept.trim() || !detail.levels?.[levelKey]}
                        style={{marginLeft:'auto', border:'1px solid #111', background:'#111', color:'#fff'}}
                      >
                        {savingSolution ? 'Saving…' : 'Publish solution'}
                      </button>
                    </div>
                    {!!solutionErr && <div style={{marginTop:8, color:'#a00'}}>{solutionErr}</div>}
                    <div style={{marginTop:8, color:'#666', fontSize:13}}>
                      Note: the concept must be different from other solutions because it becomes the tab label.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}




