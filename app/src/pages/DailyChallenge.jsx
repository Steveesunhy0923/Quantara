import { useEffect, useMemo, useRef, useState } from 'react'
import { getIdTokenResult, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { useParams } from 'react-router-dom'
import { auth, db, storage } from '../lib/firebase'
import { latexMarkupToHTML, renderLatex } from '../lib/latex'
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

  const [upload, setUpload] = useState({
    file:null,
    answer:'',
    questionLatex:'',
    hint:'',
    difficulty:'Apprentice',
    keyConcepts:['','',''],
    loading:false,
    error:null,
    ok:null
  })

  const questionRef = useRef(null)

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
      if (!dateKey){
        setChallenge({ loading:false, exists:false, data:null })
        return
      }
      setChallenge({ loading:true, exists:false, data:null })
      const snap = await getDoc(doc(db,'dailyChallenges',dateKey))
      if (!snap.exists()){
        setChallenge({ loading:false, exists:false, data:null })
        return
      }
      setChallenge({ loading:false, exists:true, data: snap.data() })
    })()
  },[dateKey, submitState.result?.dateKey, upload.ok])

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
    el.innerHTML = latexMarkupToHTML(challenge.data.questionLatex)
    void renderLatex(el)
  },[challenge.exists, challenge.data?.questionLatex])

  // To avoid showing to impostors, require BOTH:
  // - Firestore profile username
  // - server-side admin claim (set via setAdmin callable)
  const canUpload = profile?.username === 'stevesunhy' && isAdmin

  const publishAtMs = challenge.data?.publishAt?.toMillis ? challenge.data.publishAt.toMillis() : null
  const deadlineAtMs = challenge.data?.deadlineAt?.toMillis ? challenge.data.deadlineAt.toMillis() : null
  const nowMs = Date.now()
  const isPublished = !publishAtMs || nowMs >= publishAtMs
  const isAfterDeadline = !!deadlineAtMs && nowMs >= deadlineAtMs
  const canSubmitNow = !!user && challenge.exists && isPublished && !isAfterDeadline && !submitState.result?.alreadySubmitted && !submitState.result?.submitted

  async function onReveal(){
    if (!dateKey) return
    setRevealState({ loading:true, result:null, error:null })
    try{
      const fn = getCallable('challengeRevealDaily')
      const res = await fn({ dateKey })
      setRevealState({ loading:false, result: res.data, error:null })
    }catch(err){
      setRevealState({ loading:false, result:null, error: err?.message || String(err) })
    }
  }

  async function onSubmit(){
    setSubmitState({ loading:true, result:null, error:null })
    try{
      const fn = getCallable('challengeSubmitDaily')
      const res = await fn({
        dateKey,
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
        imageURL,
        answer: upload.answer,
        questionLatex: upload.questionLatex,
        hint: upload.hint,
        difficulty: upload.difficulty,
        keyConcepts: upload.keyConcepts.filter(s=>String(s||'').trim()).slice(0,3)
      })

      setUpload({
        file:null,
        answer:'',
        questionLatex:'',
        hint:'',
        difficulty:'Apprentice',
        keyConcepts:['','',''],
        loading:false,
        error:null,
        ok:'Published'
      })
    }catch(err){
      setUpload(u=>({ ...u, loading:false, error: err?.message || String(err), ok:null }))
    }
  }

  return (
    <div style={{padding:16, width:'100%', maxWidth: 900, margin:'0 auto'}}>
      <h1>Daily Problem</h1>
      <p style={{color:'#666', marginTop:0}}>
        {dateKey ? <>DateKey: <b>{dateKey}</b></> : <>No active problem right now (gap from <b>7–8pm ET</b>). Check the <b>Problem Archive</b>.</>}
      </p>

      {challenge.loading && <div>Loading…</div>}
      {!challenge.loading && !challenge.exists && (
        <div style={{padding:12, border:'1px solid #eee', borderRadius:10, background:'#fff'}}>
          No problem posted for this date.
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
                {submitState.loading ? 'Submitting…' : 'Submit'}
              </button>
            </div>

            {!!submitState.error && <div style={{marginTop:10, color:'#a00'}}>{submitState.error}</div>}
            {!!submitState.result && (
              <div style={{marginTop:10}}>
                {submitState.result.alreadySubmitted && (
                  <div><b>Already submitted.</b> Results will show after the deadline.</div>
                )}
                {submitState.result.submitted && (
                  <div><b>Submitted.</b> Results will show after the deadline.</div>
                )}
              </div>
            )}

            <div style={{marginTop:12}}>
              <button
                type="button"
                onClick={onReveal}
                disabled={!user || revealState.loading || !challenge.exists}
                style={{padding:'8px 12px', borderRadius:8, border:'1px solid #ddd', background:'#fff', color:'#111'}}
              >
                {revealState.loading ? 'Checking…' : 'Check result (after 7pm ET)'}
              </button>
              {!!revealState.error && <div style={{marginTop:8, color:'#a00'}}>{revealState.error}</div>}
              {!!revealState.result && (
                <div style={{marginTop:8}}>
                  {revealState.result.status === 'pending' && (
                    <div style={{color:'#666'}}>Not revealed yet.</div>
                  )}
                  {revealState.result.status === 'no-submission' && (
                    <div style={{color:'#666'}}>No submission found for you.</div>
                  )}
                  {revealState.result.status === 'revealed' && (
                    <div>
                      Result: <b>{revealState.result.isCorrect ? 'Correct' : 'Incorrect'}</b> — Points: <b>{revealState.result.points}</b>
                      {!revealState.result.isCorrect && revealState.result.conceptHit ? <span> (key concept credit)</span> : null}
                      {revealState.result.usedHint ? <span> (hint used)</span> : null}
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
          <h3 style={{marginTop:0}}>Post today’s problem (stevesunhy only)</h3>
          <div style={{display:'grid', gap:8}}>
            <label style={{fontSize:'.95rem', color:'#333'}}>Difficulty</label>
            <select value={upload.difficulty} onChange={e=>setUpload(u=>({ ...u, difficulty: e.target.value }))}>
              {['Apprentice','Journeyman','Scholar','Grandmaster'].map(x=>(
                <option key={x} value={x}>{x}</option>
              ))}
            </select>

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

      {/* Avoid confusion: if user is stevesunhy but not yet admin-claimed, tell them what’s missing */}
      {authReady && user && profile?.username === 'stevesunhy' && !isAdmin && (
        <div style={{marginTop:18, padding:12, border:'1px solid #ffe7a3', borderRadius:10, background:'#fff8db', color:'#6a5200'}}>
          Your account is <b>stevesunhy</b> but not authorized yet (missing <code>admin</code> claim). Run <b>setAdmin</b> once, then refresh.
        </div>
      )}
    </div>
  )
}


