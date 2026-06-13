import { useEffect, useMemo, useRef, useState } from 'react'
import { getIdTokenResult, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { useParams } from 'react-router-dom'
import { auth, db, storage } from '../lib/firebase'
import { latexMarkupToHTML, renderLatexSoon } from '../lib/latex'
import { getCallable } from '../lib/callable.js'

function nyParts(){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const get = (t)=> parts.find(p=>p.type===t)?.value
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`
  const hour = Number(get('hour') || 0)
  const minute = Number(get('minute') || 0)
  return { dateKey, hour, minute }
}

function addDaysDateKey(dateKey, deltaDays){
  const [y, m, d] = String(dateKey).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m-1, d))
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth()+1).padStart(2,'0')
  const dd = String(dt.getUTCDate()).padStart(2,'0')
  return `${yy}-${mm}-${dd}`
}

function defaultActiveDateKey(){
  // Active daily problem:
  // - from 8:00pm ET (publish) until next day 7:00pm ET (deadline) => dateKey of the publish day
  // - between 7pm and 8pm ET => no active problem (we show a gap message)
  const { dateKey, hour } = nyParts()
  if (hour >= 20) return dateKey
  if (hour < 19) return addDaysDateKey(dateKey, -1)
  return null
}

export default function DailyChallenge(){
  const params = useParams()
  const dateKey = useMemo(()=>{
    if (params.dateKey) return params.dateKey
    return defaultActiveDateKey()
  },[params.dateKey])
  const [levelKey, setLevelKey] = useState(()=>{
    try{
      const sp = new URLSearchParams(window.location.search || '')
      const v = String(sp.get('level') || '').trim().toLowerCase()
      if (['apprentice','journeyman','scholar','grandmaster'].includes(v)) return v
    }catch(_e){}
    return 'apprentice'
  })
  const [pickedLevel, setPickedLevel] = useState(null) // locked pick from server (string|null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [challenge, setChallenge] = useState({ loading:true, exists:false, data:null })

  const [answer, setAnswer] = useState('')
  const [conceptsGuess, setConceptsGuess] = useState(['','',''])
  const [hintUsed, setHintUsed] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [submitState, setSubmitState] = useState({ loading:false, result:null, error:null })
  const [revealState, setRevealState] = useState({ loading:false, result:null, error:null })
  const [sourceState, setSourceState] = useState({ loading:false, data:null, error:null })

  const [upload, setUpload] = useState({
    file:null,
    answer:'',
    questionLatex:'',
    hint:'',
    difficulty:'Apprentice',
    keyConcepts:['','',''],
    sourceName:'',
    sourceUrl:'',
    solutionBlocks:[{ type:'text', text:'' }], // official solution editor (optional)
    forceEdit:false,
    loading:false,
    error:null,
    ok:null
  })

  const questionRef = useRef(null)
  const answerPreviewRef = useRef(null)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, (u)=>{
      setUser(u || null)
      setAuthReady(true)
    })
    return ()=>unsub()
  },[])

  useEffect(()=>{
    (async()=>{
      if (!user){
        setProfile(null)
        setIsAdmin(false)
        return
      }
      const snap = await getDoc(doc(db,'users',user.uid))
      const data = snap.data() || {}
      setProfile({ uid: user.uid, username: data.username || 'anon' })

      try{
        // force refresh so newly granted claims take effect quickly
        const tok = await getIdTokenResult(user, true)
        setIsAdmin(!!tok?.claims?.admin)
      }catch{
        setIsAdmin(false)
      }
    })()
  },[user])

  useEffect(()=>{
    (async()=>{
      if (!user || !dateKey){
        setPickedLevel(null)
        return
      }
      try{
        const snap = await getDoc(doc(db, 'dailyChallenges', dateKey, 'userPicks', user.uid))
        if (!snap.exists()){
          setPickedLevel(null)
          return
        }
        const v = String(snap.data()?.levelKey || '').trim().toLowerCase()
        if (v && ['apprentice','journeyman','scholar','grandmaster'].includes(v)){
          setPickedLevel(v)
          setLevelKey(v)
        } else {
          setPickedLevel(null)
        }
      }catch{
        setPickedLevel(null)
      }
    })()
  },[user?.uid, dateKey])

  useEffect(()=>{
    (async()=>{
      if (!dateKey){
        setChallenge({ loading:false, exists:false, data:null })
        return
      }
      setChallenge({ loading:true, exists:false, data:null })
      // New model:
      // dailyChallenges/{dateKey}/levels/{levelKey}
      const snap = await getDoc(doc(db,'dailyChallenges',dateKey,'levels',levelKey))
      if (snap.exists()){
        setChallenge({ loading:false, exists:true, data: snap.data() })
        return
      }
      // Legacy fallback: dailyChallenges/{dateKey} (single difficulty stored at top-level)
      // Treat legacy as "apprentice" only, so old problems don't "disappear".
      if (levelKey !== 'apprentice'){
        setChallenge({ loading:false, exists:false, data:null })
        return
      }
      const legacy = await getDoc(doc(db,'dailyChallenges',dateKey))
      if (!legacy.exists()){
        setChallenge({ loading:false, exists:false, data:null })
        return
      }
      setChallenge({ loading:false, exists:true, data: legacy.data() })
    })()
  },[dateKey, levelKey, submitState.result?.dateKey, upload.ok])

  function normalizeConceptKey(s){
    const t = String(s || '').trim().toLowerCase()
    return t
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64)
  }

  async function insertOfficialSolutionImage(idx){
    if (!user) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async ()=>{
      const file = input.files?.[0]
      if (!file) return
      try{
        setUpload(u=>({ ...u, loading:true, error:null, ok:null }))
        const ext = (file.type || '').includes('png') ? 'png' : ((file.type || '').includes('webp') ? 'webp' : 'jpg')
        const conceptKey = 'official'
        const path = `dailySolutions/${user.uid}/${dateKey}/${levelKey}/${conceptKey}/${Date.now()}.${ext}`
        const r = ref(storage, path)
        await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' })
        const url = await getDownloadURL(r)
        setUpload(u=>{
          const blocks = Array.isArray(u.solutionBlocks) ? [...u.solutionBlocks] : [{ type:'text', text:'' }]
          blocks.splice(idx+1, 0, { type:'image', imageURL: url, caption:'' }, { type:'text', text:'' })
          return { ...u, solutionBlocks: blocks.slice(0, 12), loading:false }
        })
      }catch(e){
        setUpload(u=>({ ...u, loading:false, error: e?.message || String(e), ok:null }))
      }
    }
    input.click()
  }

  useEffect(()=>{
    setAnswer('')
    setConceptsGuess(['','',''])
    setHintUsed(false)
    setShowHint(false)
    setSubmitState({ loading:false, result:null, error:null })
    setRevealState({ loading:false, result:null, error:null })
  },[dateKey])

  useEffect(()=>{
    const el = questionRef.current
    if (!el) return
    if (!challenge.exists || !challenge.data?.questionLatex) return
    const raw = String(challenge.data.questionLatex || '').trim()
    if (!raw){
      el.textContent = ''
      return
    }

    // Classification rule:
    // - If there is no "\" and no explicit LaTeX delimiters, treat it as normal text.
    // - Otherwise, render as LaTeX/markup.
    const hasDelims =
      raw.includes('\\(') || raw.includes('\\)') ||
      raw.includes('\\[') || raw.includes('\\]') ||
      /\$\$[\s\S]+?\$\$/.test(raw) ||
      /\$[^$]+\$/.test(raw)
    const hasBackslash = raw.includes('\\')

    if (!hasBackslash && !hasDelims){
      el.textContent = raw
      return
    }

    // If the author didn't include delimiters but did use LaTeX commands, wrap as display math.
    const src = hasDelims ? raw : `\\[${raw}\\]`
    el.innerHTML = latexMarkupToHTML(src)
    const cancel = renderLatexSoon(el, { timeout: 1800 })
    return ()=>cancel()
  },[challenge.exists, challenge.data?.questionLatex])

  useEffect(()=>{
    const el = answerPreviewRef.current
    if (!el) return
    const a = String(answer || '').trim()
    if (!a){
      el.textContent = ''
      return
    }
    // Render answer as inline math by default.
    el.textContent = `\\(${a}\\)`
    const cancel = renderLatexSoon(el, { timeout: 1800 })
    return ()=>cancel()
  },[answer])

  // Uploader is admin-only and still requires the server-side allowlist.
  // Keep strict so the UI doesn't offer upload controls to users who will be rejected anyway.
  const canUpload = profile?.username === 'stevesunhy' && isAdmin

  const publishAtMs = challenge.data?.publishAt?.toMillis ? challenge.data.publishAt.toMillis() : null
  const deadlineAtMs = challenge.data?.deadlineAt?.toMillis ? challenge.data.deadlineAt.toMillis() : null
  const nowMs = Date.now()
  const isPublished = !publishAtMs || nowMs >= publishAtMs
  const isAfterDeadline = !!deadlineAtMs && nowMs >= deadlineAtMs
  const canSubmitNow = !!user && challenge.exists && isPublished && !isAfterDeadline

  async function onReveal(){
    if (!dateKey) return
    setRevealState({ loading:true, result:null, error:null })
    try{
      const fn = getCallable('challengeRevealDaily')
      const res = await fn({ dateKey, levelKey })
      setRevealState({ loading:false, result: res.data, error:null })
    }catch(err){
      setRevealState({ loading:false, result:null, error: err?.message || String(err) })
    }
  }

  // Auto-reveal: once the deadline passes, fetch and show results automatically.
  useEffect(()=>{
    if (!dateKey) return
    if (!user) return
    if (!challenge.exists) return
    const deadline = deadlineAtMs
    if (!deadline) return
    if (revealState.loading) return
    if (revealState.result?.status === 'revealed' || revealState.result?.status === 'no-submission') return

    const now = Date.now()
    if (now >= deadline){
      void onReveal()
      return
    }
    const ms = Math.max(0, deadline - now + 1500)
    const t = window.setTimeout(()=>{ void onReveal() }, ms)
    return ()=> window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dateKey, user?.uid, challenge.exists, deadlineAtMs])

  // Public source: fetch only after deadline (no submission required).
  useEffect(()=>{
    if (!dateKey) return
    if (!challenge.exists) return
    if (!deadlineAtMs) return
    if (Date.now() < deadlineAtMs) { setSourceState({ loading:false, data:null, error:null }); return }
    let cancelled = false
    ;(async()=>{
      setSourceState({ loading:true, data:null, error:null })
      try{
        const fn = getCallable('challengeGetDailySource')
        const res = await fn({ dateKey, levelKey })
        if (!cancelled) setSourceState({ loading:false, data: res.data || null, error:null })
      }catch(e){
        if (!cancelled) setSourceState({ loading:false, data:null, error: e?.message || String(e) })
      }
    })()
    return ()=>{ cancelled = true }
  },[dateKey, levelKey, challenge.exists, deadlineAtMs])

  async function onSubmit(){
    setSubmitState({ loading:true, result:null, error:null })
    try{
      const fn = getCallable('challengeSubmitDaily')
      const res = await fn({
        dateKey,
        levelKey,
        answer,
        usedHint: hintUsed,
        conceptsGuess: conceptsGuess.filter(s=>String(s||'').trim())
      })
      setSubmitState({ loading:false, result: res.data, error:null })
    }catch(err){
      setSubmitState({ loading:false, result:null, error: err?.message || String(err) })
    }
  }

  async function onPublish(){
    if (!canUpload) return
    setUpload(u=>({ ...u, loading:true, error:null, ok:null }))
    try{
      if (!upload.questionLatex.trim()) throw new Error('Enter the question (LaTeX)')
      if (!upload.answer.trim()) throw new Error('Enter the correct answer')

      let imageURL = ''
      if (upload.file){
        const storagePath = `dailyChallenges/${dateKey}/problem`
        const r = ref(storage, storagePath)
        await uploadBytes(r, upload.file)
        imageURL = await getDownloadURL(r)
      }

      const fn = getCallable('challengeUpsertDaily')
      await fn({
        dateKey,
        levelKey: String(upload.difficulty || '').trim().toLowerCase(),
        force: !!upload.forceEdit,
        imageURL,
        answer: upload.answer,
        questionLatex: upload.questionLatex,
        hint: upload.hint,
        difficulty: upload.difficulty,
        sourceName: upload.sourceName,
        sourceUrl: upload.sourceUrl,
        keyConcepts: upload.keyConcepts.filter(s=>String(s||'').trim()).slice(0,3)
      })

      // Optional: publish/update official solution (same system used in the archive).
      const levelKeySaved = String(upload.difficulty || '').trim().toLowerCase()
      const cleanedBlocks = (Array.isArray(upload.solutionBlocks) ? upload.solutionBlocks : [])
        .map(b=>{
          if (b.type === 'text') return { type:'text', text:String(b.text || '').trim() }
          return { type:'image', imageURL:String(b.imageURL || '').trim(), caption:String(b.caption || '').trim() }
        })
        .filter(b=> (b.type === 'text' ? b.text.length > 0 : !!b.imageURL))
        .slice(0, 12)
      if (cleanedBlocks.length){
        const solRef = doc(db, 'dailyChallenges', dateKey, 'levels', levelKeySaved, 'solutions', 'official')
        const existsSnap = await getDoc(solRef)
        if (existsSnap.exists()){
          await setDoc(solRef, {
            concept: 'Official',
            conceptKey: 'official',
            blocks: cleanedBlocks,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser.uid,
            updatedAt: serverTimestamp(),
          }, { merge: true })
        } else {
          await setDoc(solRef, {
            dateKey,
            levelKey: levelKeySaved,
            concept: 'Official',
            conceptKey: 'official',
            blocks: cleanedBlocks,
            createdBy: auth.currentUser.uid,
            createdByUsername: profile?.username || auth.currentUser.displayName || 'anon',
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: false })
        }
      }

      setUpload({
        file:null,
        answer:'',
        questionLatex:'',
        hint:'',
        difficulty:'Apprentice',
        keyConcepts:['','',''],
        sourceName:'',
        sourceUrl:'',
        solutionBlocks:[{ type:'text', text:'' }],
        forceEdit:false,
        loading:false,
        error:null,
        ok:'Published'
      })
    }catch(err){
      const msg = err?.message || String(err)
      // Keep error user-facing but generic (do not reference usernames).
      const hint =
        String(err?.code || '').includes('permission-denied')
          ? ' (Not authorized to publish. Make sure you have the admin claim and are using the correct account.)'
          : (
              String(err?.code || '').includes('failed-precondition') && msg.toLowerCase().includes('challenge key')
                ? ' (Server is missing the daily-challenge encryption key. Set CHALLENGE_ANSWER_KEY / challenge.answer_key and redeploy functions.)'
                : ''
            )
      setUpload(u=>({ ...u, loading:false, error: `${msg}${hint}`, ok:null }))
    }
  }

  return (
    <div style={{padding:16, width:'100%', maxWidth: 900, margin:'0 auto'}}>
      <h1>Daily Problem</h1>
      <p style={{color:'#666', marginTop:0}}>
        {dateKey ? <>DateKey: <b>{dateKey}</b></> : <>No active problem right now (gap from <b>7–8pm ET</b>). Check the <b>Problem Archive</b>.</>}
      </p>

      {dateKey && (
        <div style={{display:'flex', gap:8, flexWrap:'wrap', margin:'10px 0 14px'}}>
          {[
            ['apprentice','Apprentice'],
            ['journeyman','Journeyman'],
            ['scholar','Scholar'],
            ['grandmaster','Grandmaster'],
          ].map(([k,label])=>{
            const active = levelKey === k
            const locked = !!pickedLevel && pickedLevel !== k
            return (
              <button
                key={k}
                type="button"
                onClick={()=>{
                  if (pickedLevel && pickedLevel !== k) return
                  setLevelKey(k)
                  try{
                    const sp = new URLSearchParams(window.location.search || '')
                    sp.set('level', k)
                    window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`)
                  }catch(_e){}
                }}
                disabled={locked}
                title={locked ? 'You already picked a different difficulty for today.' : ''}
                style={{
                  padding:'8px 12px',
                  borderRadius:999,
                  border: active ? '1px solid #111' : '1px solid #ddd',
                  background: active ? '#111' : '#fff',
                  color: active ? '#fff' : '#111',
                  opacity: locked ? 0.45 : 1,
                }}
              >
                {label}
              </button>
            )
          })}
          {!!pickedLevel && (
            <span style={{alignSelf:'center', color:'#666', fontSize:'.95rem'}}>
              Pick locked: <b style={{textTransform:'capitalize'}}>{pickedLevel}</b>
            </span>
          )}
        </div>
      )}

      {challenge.loading && <div>Loading…</div>}
      {!challenge.loading && !challenge.exists && (
        <div style={{padding:12, border:'1px solid #eee', borderRadius:10, background:'#fff'}}>
          Today’s problem hasn’t been posted yet. Please check back soon.
        </div>
      )}

      {!!challenge.exists && (
        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:12}}>
          <div style={{padding:12, border:'1px solid #eee', borderRadius:10, background:'#fff'}}>
            {!!challenge.data?.difficulty && (
              <div style={{color:'#666', fontSize:'.9rem', marginBottom:8}}>
                Difficulty: <b>{challenge.data.difficulty}</b>
              </div>
            )}

            {!isPublished && (
              <div style={{padding:10, border:'1px solid #ffe7a3', borderRadius:10, background:'#fff8db', color:'#6a5200', marginBottom:10}}>
                This problem will be shown at <b>8:00pm ET</b>.
              </div>
            )}

            {isPublished && (
              <>
                <div ref={questionRef} />
                {challenge.data?.imageURL ? (
                  <img
                    src={challenge.data.imageURL}
                    alt="Daily problem"
                    style={{width:'100%', maxHeight:520, objectFit:'contain', background:'#fafafa', borderRadius:8, border:'1px solid #eee', marginTop:10}}
                  />
                ) : null}
              </>
            )}
          </div>

          <div style={{padding:12, border:'1px solid #eee', borderRadius:10, background:'#fff'}}>
            <h3 style={{marginTop:0}}>Submit your answer</h3>
            {!user && <div style={{color:'#a00'}}>Please login to submit.</div>}

            {!!deadlineAtMs && (
              <div style={{color:'#666', fontSize:'.95rem', marginTop:6}}>
                Deadline: <b>{new Date(deadlineAtMs).toLocaleString()}</b> (7:00pm ET next day)
              </div>
            )}

            {!!challenge.data?.hint && isPublished && (
              <div style={{marginTop:10}}>
                {!showHint && (
                  <button
                    type="button"
                    onClick={()=>{
                      setShowHint(true)
                      setHintUsed(true)
                    }}
                    disabled={!!submitState.result?.alreadySubmitted || !!submitState.result?.submitted}
                    style={{padding:'8px 12px', borderRadius:8, border:'1px solid #111', background:'#111', color:'#fff'}}
                    title="Using the hint caps your score at 80 (or 0 if incorrect)."
                  >
                    Use hint (80/0 scoring)
                  </button>
                )}
                {showHint && (
                  <div style={{marginTop:10, padding:10, border:'1px solid #eee', borderRadius:10, background:'#fafafa'}}>
                    <div style={{fontWeight:800, marginBottom:6}}>Hint (hintUsed = true)</div>
                    <div style={{whiteSpace:'pre-wrap'}}>{challenge.data.hint}</div>
                  </div>
                )}
              </div>
            )}

            <div style={{display:'grid', gap:8, marginTop:10}}>
              <input
                value={conceptsGuess[0]}
                onChange={e=>setConceptsGuess([e.target.value, conceptsGuess[1], conceptsGuess[2]])}
                placeholder="Key concept (optional)"
                style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
                disabled={!canSubmitNow || submitState.loading}
              />
              <input
                value={conceptsGuess[1]}
                onChange={e=>setConceptsGuess([conceptsGuess[0], e.target.value, conceptsGuess[2]])}
                placeholder="Key concept (optional)"
                style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
                disabled={!canSubmitNow || submitState.loading}
              />
              <input
                value={conceptsGuess[2]}
                onChange={e=>setConceptsGuess([conceptsGuess[0], conceptsGuess[1], e.target.value])}
                placeholder="Key concept (optional)"
                style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
                disabled={!canSubmitNow || submitState.loading}
              />
            </div>

            <div style={{display:'flex', gap:8, marginTop:8}}>
              <input
                value={answer}
                onChange={e=>setAnswer(e.target.value)}
                placeholder="Answer"
                style={{flex:1, padding:10, borderRadius:8, border:'1px solid #ddd'}}
                disabled={!canSubmitNow || submitState.loading}
              />
              <button
                onClick={onSubmit}
                disabled={!canSubmitNow || submitState.loading || !answer.trim()}
                style={{padding:'10px 14px', borderRadius:8, border:'1px solid #1a73e8', background:'#1a73e8', color:'#fff'}}
              >
                {submitState.loading ? 'Saving…' : (submitState.result?.updated ? 'Update' : 'Save')}
              </button>
            </div>

            <div style={{marginTop:10, padding:'10px 12px', border:'1px solid #eee', borderRadius:10, background:'#fafafa'}}>
              <div style={{fontWeight:800, marginBottom:6}}>Answer preview</div>
              <div
                ref={answerPreviewRef}
                style={{minHeight:22, color:'#111'}}
              />
              {!answer.trim() && <div style={{color:'#777', fontSize:'.9rem'}}>Type an answer above to preview it in LaTeX.</div>}
            </div>

            {!!submitState.error && <div style={{marginTop:10, color:'#a00'}}>{submitState.error}</div>}
            {!!submitState.result && (
              <div style={{marginTop:10}}>
                {submitState.result.submitted && (
                  <div>
                    <b>{submitState.result.updated ? 'Updated.' : 'Saved.'}</b>{' '}
                    You can change your answer any time before the deadline.
                  </div>
                )}
              </div>
            )}

            <div style={{marginTop:12}}>
              {!!revealState.error && <div style={{marginTop:8, color:'#a00'}}>{revealState.error}</div>}
              {!!deadlineAtMs && !isAfterDeadline && (
                <div style={{color:'#666', fontSize:'.95rem'}}>
                  Results will appear automatically after the deadline.
                </div>
              )}
              {revealState.loading && isAfterDeadline && (
                <div style={{color:'#666'}}>Revealing result…</div>
              )}
              {!!revealState.result && (
                <div style={{marginTop:8}}>
                  {revealState.result.status === 'pending' && (
                    <div style={{color:'#666'}}>Results are not available yet.</div>
                  )}
                  {revealState.result.status === 'no-submission' && (
                    <div style={{color:'#666'}}>No submission found for you.</div>
                  )}
                  {revealState.result.status === 'revealed' && (
                    <div>
                      Result: <b>{revealState.result.isCorrect ? 'Correct' : 'Incorrect'}</b> — Points: <b>{revealState.result.points}</b>
                      {!revealState.result.isCorrect && revealState.result.conceptHit ? <span> (key concept credit)</span> : null}
                      {revealState.result.usedHint ? <span> (hint used)</span> : null}
                      {!!revealState.result.source?.sourceName && (
                        <div style={{marginTop:10, padding:'10px 12px', border:'1px solid #eee', borderRadius:10, background:'#fafafa'}}>
                          <div style={{fontWeight:900, marginBottom:4}}>Source</div>
                          <div style={{color:'#222'}}>
                            {revealState.result.source.sourceName}{' '}
                            {revealState.result.source.sourceUrl ? (
                              <a href={revealState.result.source.sourceUrl} target="_blank" rel="noreferrer">
                                (link)
                              </a>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {canUpload && (
        <div style={{marginTop:18, padding:12, border:'1px solid #ddd', borderRadius:10, background:'#fff'}}>
          <h3 style={{marginTop:0}}>Post today’s problem (admin only)</h3>
          <div style={{display:'grid', gap:8}}>
            <label style={{fontSize:'.95rem', color:'#333'}}>Difficulty</label>
            <select value={upload.difficulty} onChange={e=>setUpload(u=>({ ...u, difficulty: e.target.value }))}>
              {['Apprentice','Journeyman','Scholar','Grandmaster'].map(x=>(
                <option key={x} value={x}>{x}</option>
              ))}
            </select>

            <label style={{display:'flex', alignItems:'center', gap:8, color:'#333'}}>
              <input
                type="checkbox"
                checked={!!upload.forceEdit}
                onChange={e=>setUpload(u=>({ ...u, forceEdit: !!e.target.checked }))}
                disabled={upload.loading}
              />
              Force edit if locked (use only to fix mistakes; marks as edited)
            </label>

            <div style={{display:'grid', gap:8}}>
              <div style={{fontWeight:900, marginTop:6}}>Source (hidden until reveal)</div>
              <input
                value={upload.sourceName}
                onChange={e=>setUpload(u=>({ ...u, sourceName: e.target.value }))}
                placeholder="Source name (e.g. AOPS, AMC, textbook)"
                style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
                disabled={upload.loading}
              />
              <input
                value={upload.sourceUrl}
                onChange={e=>setUpload(u=>({ ...u, sourceUrl: e.target.value }))}
                placeholder="Source link (https://...)"
                style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
                disabled={upload.loading}
              />
              <div style={{color:'#666', fontSize:13}}>
                This will be hidden until after the deadline to reduce cheating.
              </div>
            </div>

            <label style={{fontSize:'.95rem', color:'#333'}}>Question (LaTeX)</label>
            <textarea
              rows={8}
              value={upload.questionLatex}
              onChange={e=>setUpload(u=>({ ...u, questionLatex: e.target.value }))}
              placeholder="Type the problem in LaTeX (MathJax supported)."
              style={{padding:10, borderRadius:8, border:'1px solid #ddd', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'}}
              disabled={upload.loading}
            />

            <label style={{fontSize:'.95rem', color:'#333'}}>Optional image</label>
            <input type="file" accept="image/*" onChange={e=>setUpload(u=>({ ...u, file: e.target.files?.[0] || null }))} />

            <label style={{fontSize:'.95rem', color:'#333'}}>Hint (optional)</label>
            <textarea
              rows={4}
              value={upload.hint}
              onChange={e=>setUpload(u=>({ ...u, hint: e.target.value }))}
              placeholder="Hint text"
              style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
              disabled={upload.loading}
            />

            <label style={{fontSize:'.95rem', color:'#333'}}>Key concepts (max 3, used for 60-point partial credit)</label>
            {upload.keyConcepts.map((v, idx)=>(
              <input
                key={idx}
                value={v}
                onChange={e=>{
                  const next = [...upload.keyConcepts]
                  next[idx] = e.target.value
                  setUpload(u=>({ ...u, keyConcepts: next }))
                }}
                placeholder={`Key concept ${idx+1}`}
                style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
                disabled={upload.loading}
              />
            ))}

            <div style={{marginTop:4, padding:12, border:'1px solid #eee', borderRadius:12, background:'#fafafa'}}>
              <div style={{fontWeight:900, marginBottom:6}}>Official solution (optional)</div>
              <div style={{color:'#666', fontSize:13, marginBottom:10}}>
                Use one text box, then insert an image in the middle to continue with another text box, etc.
              </div>
              <div style={{display:'grid', gap:10}}>
                {(Array.isArray(upload.solutionBlocks) ? upload.solutionBlocks : [{ type:'text', text:'' }]).map((b, idx)=>(
                  <div key={idx} style={{border:'1px solid #eee', borderRadius:12, padding:10, background:'#fff'}}>
                    <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                      <div style={{fontWeight:900}}>{b.type === 'image' ? 'Image' : 'Text'}</div>
                      <span style={{marginLeft:'auto'}} />
                      <button
                        type="button"
                        onClick={()=>setUpload(u=>{
                          const blocks = (Array.isArray(u.solutionBlocks) ? u.solutionBlocks : []).filter((_,i)=>i!==idx)
                          return { ...u, solutionBlocks: blocks.length ? blocks : [{ type:'text', text:'' }] }
                        })}
                        disabled={upload.loading}
                      >
                        Remove
                      </button>
                    </div>
                    {b.type === 'image' ? (
                      <>
                        <img src={b.imageURL} alt="solution" style={{width:'100%', borderRadius:10, border:'1px solid #eee', background:'#fff'}} />
                        <input
                          value={b.caption || ''}
                          onChange={e=>setUpload(u=>{
                            const blocks = Array.isArray(u.solutionBlocks) ? [...u.solutionBlocks] : []
                            blocks[idx] = { ...blocks[idx], caption: e.target.value }
                            return { ...u, solutionBlocks: blocks }
                          })}
                          placeholder="Caption (optional)"
                          disabled={upload.loading}
                          style={{width:'100%', padding:10, borderRadius:10, border:'1px solid #ddd', marginTop:8}}
                        />
                      </>
                    ) : (
                      <>
                        <textarea
                          rows={4}
                          value={b.text || ''}
                          onChange={e=>setUpload(u=>{
                            const blocks = Array.isArray(u.solutionBlocks) ? [...u.solutionBlocks] : []
                            blocks[idx] = { ...blocks[idx], text: e.target.value }
                            return { ...u, solutionBlocks: blocks }
                          })}
                          placeholder="Write LaTeX or plain text."
                          style={{padding:10, borderRadius:8, border:'1px solid #ddd', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', width:'100%'}}
                          disabled={upload.loading}
                        />
                        <div style={{marginTop:8}}>
                          <button type="button" onClick={()=>insertOfficialSolutionImage(idx)} disabled={upload.loading}>
                            Insert image after this block
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:10}}>
                <button
                  type="button"
                  onClick={()=>setUpload(u=>({ ...u, solutionBlocks: [...(Array.isArray(u.solutionBlocks) ? u.solutionBlocks : []), { type:'text', text:'' }].slice(0, 12) }))}
                  disabled={upload.loading || (Array.isArray(upload.solutionBlocks) ? upload.solutionBlocks.length >= 12 : false)}
                >
                  Add text block
                </button>
              </div>
            </div>

            <input
              value={upload.answer}
              onChange={e=>setUpload(u=>({ ...u, answer: e.target.value }))}
              placeholder="Correct answer (hidden)"
              style={{padding:10, borderRadius:8, border:'1px solid #ddd'}}
              disabled={upload.loading}
            />
            <button
              onClick={onPublish}
              disabled={upload.loading || !upload.questionLatex.trim() || !upload.answer.trim()}
              style={{padding:'10px 14px', borderRadius:8, border:'1px solid #111', background:'#111', color:'#fff', width:'fit-content'}}
            >
              {upload.loading ? 'Publishing…' : 'Publish'}
            </button>
            {!!upload.error && <div style={{color:'#a00'}}>{upload.error}</div>}
            {!!upload.ok && <div style={{color:'#0a0'}}>{upload.ok}</div>}
            <div style={{color:'#666', fontSize:'.9rem'}}>
              Schedule: posts at <b>8:00pm ET</b>, deadline <b>7:00pm ET next day</b>.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


