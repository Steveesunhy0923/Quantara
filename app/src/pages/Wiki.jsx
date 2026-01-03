import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { getIdTokenResult, onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../lib/firebase'
import { latexMarkupToHTML, renderLatex, slugify } from '../lib/latex'
import { usePanels } from '../components/panels/PanelsContext.jsx'
import { useGamification } from '../hooks/useGamification.js'

export default function Wiki(){
  const params = useParams()
  const navigate = useNavigate()
  const { openPanel } = usePanels()
  const [articles, setArticles] = useState([])
  const [current, setCurrent] = useState(null)
  const [editing, setEditing] = useState(false)
  const containerRef = useRef(null)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [search, setSearch] = useState('')
  const [topTags, setTopTags] = useState([]) // [{tag, count}]
  const [myTags, setMyTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [tagsLoading, setTagsLoading] = useState(false)
  const [myRating, setMyRating] = useState(null) // number | null
  const [ratingInput, setRatingInput] = useState(50)
  const [ratingSaving, setRatingSaving] = useState(false)
  const [icebergSrc, setIcebergSrc] = useState('/iceberg.png')
  const [icebergFullOpen, setIcebergFullOpen] = useState(false)
  const [showIceberg, setShowIceberg] = useState(()=>{
    try{
      const v = window.localStorage?.getItem('wikiIcebergOpen')
      if (v === '0') return false
      if (v === '1') return true
    }catch(_e){}
    return true
  })
  const { level } = useGamification(user?.uid || '')
  const canEdit = !!user && Number(level || 0) >= 10

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return () => unsub()
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
      const qs = await getDocs(query(collection(db,'articles'), orderBy('title')))
      const arr = []
      const used = new Set()
      for (const d of qs.docs){
        const data = d.data()
        let { title, content, slug: rawSlug, keywords, difficulty, ratingAvg, ratingCount } = data
        // Normalize slugs so routing is stable even if historical docs stored percent-encoded slugs.
        // react-router params are decoded; encoded slugs (with %xx) won't match unless we normalize.
        let baseSlug = rawSlug || title || ''
        try{
          // best-effort decode if it looks encoded
          if (typeof baseSlug === 'string' && baseSlug.includes('%')){
            baseSlug = decodeURIComponent(baseSlug)
          }
        }catch(_e){}
        let slug = slugify(baseSlug || title || '')
        if (!slug) slug = slugify(title||'')
        if (used.has(slug)){
          // Avoid collisions in UI routing by suffixing with a stable token.
          slug = `${slug}-${String(d.id || '').slice(0,6) || 'x'}`
        }
        used.add(slug)
        const diffNum = Number(difficulty)
        const safeDifficulty =
          Number.isFinite(diffNum) ? Math.min(100, Math.max(0, diffNum)) : 0
        const avgNum = Number(ratingAvg)
        const safeRatingAvg =
          Number.isFinite(avgNum) ? Math.min(100, Math.max(0, avgNum)) : 0
        const cntNum = Number(ratingCount)
        const safeRatingCount =
          Number.isFinite(cntNum) ? Math.max(0, Math.trunc(cntNum)) : 0
        arr.push({
          id:d.id,
          title,
          content: content||'',
          slug,
          keywords: Array.isArray(keywords) ? keywords : [],
          difficulty: safeDifficulty,
          ratingAvg: safeRatingAvg,
          ratingCount: safeRatingCount,
        })
      }
      setArticles(arr)
    })()
  },[])

  useEffect(()=>{
    if (!articles.length) return
    const routeSlugRaw = params.slug ? String(params.slug) : ''
    const routeSlugNorm = routeSlugRaw ? slugify(routeSlugRaw) : ''
    let art = null
    if (routeSlugRaw){
      art = articles.find(a=>a.slug === routeSlugRaw) || null
      if (!art && routeSlugNorm){
        art = articles.find(a=>a.slug === routeSlugNorm) || null
      }
    }
    if (!art){ art = articles[0] }
    setCurrent(art)
    setEditing(false)
  },[articles, params.slug])

  // Intercept wiki links inside rendered HTML (from latexMarkupToHTML) so they SPA-navigate.
  useEffect(()=>{
    function onClick(e){
      if (!e || e.defaultPrevented) return
      if (e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target?.closest?.('a.wiki-link')
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (!href.startsWith('/wiki/')) return
      e.preventDefault()
      navigate(href)
    }
    document.addEventListener('click', onClick)
    return ()=> document.removeEventListener('click', onClick)
  },[navigate])

  useLayoutEffect(()=>{
    if (!current || editing) return
    const el = containerRef.current
    if (!el) return
    el.innerHTML = `\n      <article>\n        <h1>${current.title||''}</h1>\n        <div id="article-body">${latexMarkupToHTML(current.content||'')}</div>\n      </article>\n    `
    renderLatex(el)
    // Best-effort retries: MathJax/TikzJax can load after this render, especially on first navigation.
    // Without retries, the page can look "unstyled" until a refresh.
    const t1 = window.setTimeout(()=>{ try{ renderLatex(el) }catch(_e){} }, 350)
    const t2 = window.setTimeout(()=>{ try{ renderLatex(el) }catch(_e){} }, 1200)
    return ()=>{ window.clearTimeout(t1); window.clearTimeout(t2) }
  },[current, editing])

  // Highlight search matches (best-effort; avoid KaTeX nodes).
  // Separate effect so it re-runs as the user types, without re-rendering the whole article HTML.
  useEffect(()=>{
    if (!current || editing) return
    const el = containerRef.current
    if (!el) return
    const q = String(search || '').trim()
    clearHighlights(el)
    if (q) highlightInElement(el, q)
  },[search, current, editing])

  function escapeRegExp(str){
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function clearHighlights(root){
    if (!root) return
    const marks = root.querySelectorAll('mark[data-wiki-highlight="1"]')
    marks.forEach(m=>{
      const parent = m.parentNode
      if (!parent) return
      while (m.firstChild) parent.insertBefore(m.firstChild, m)
      parent.removeChild(m)
      parent.normalize()
    })
  }

  function shouldSkipNode(node){
    if (!node) return true
    const el = node.nodeType === 1 ? node : node.parentElement
    if (!el) return false
    if (el.closest('.katex, .katex-display')) return true
    const tag = el.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return true
    return false
  }

  function highlightInElement(root, queryText){
    if (!root) return
    const q = String(queryText || '').trim()
    if (!q) return
    // Important: don't use a global regex with `.test()` across different strings without
    // resetting `lastIndex`. TreeWalker will call `acceptNode()` many times; a `/g` regex
    // would otherwise carry state between nodes and incorrectly reject matches.
    const reTest = new RegExp(escapeRegExp(q), 'i')
    const reExec = new RegExp(escapeRegExp(q), 'gi')

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        if (!node?.nodeValue) return NodeFilter.FILTER_REJECT
        if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT
        if (!reTest.test(node.nodeValue)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })

    const nodes = []
    let n = walker.nextNode()
    while (n){ nodes.push(n); n = walker.nextNode() }

    for (const textNode of nodes){
      const text = textNode.nodeValue
      if (!text) continue
      reExec.lastIndex = 0
      const frag = document.createDocumentFragment()
      let last = 0
      let m
      while ((m = reExec.exec(text)) !== null){
        const start = m.index
        const end = start + m[0].length
        if (start > last){
          frag.appendChild(document.createTextNode(text.slice(last, start)))
        }
        const mark = document.createElement('mark')
        mark.setAttribute('data-wiki-highlight', '1')
        mark.style.background = '#fff59d'
        mark.style.padding = '0 .08em'
        mark.style.borderRadius = '3px'
        mark.appendChild(document.createTextNode(text.slice(start, end)))
        frag.appendChild(mark)
        last = end
      }
      if (last < text.length){
        frag.appendChild(document.createTextNode(text.slice(last)))
      }
      const parent = textNode.parentNode
      if (parent) parent.replaceChild(frag, textNode)
    }
  }

  function parseKeywords(s){
    const raw = String(s || '')
    return raw
      .split(',')
      .map(x=>x.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map(x=>x.slice(0, 32))
  }

  function clampDifficulty(v){
    const n = Number(v)
    if (!Number.isFinite(n)) return 0
    return Math.round(Math.min(100, Math.max(0, n)))
  }

  // Live article metadata (difficulty + rating aggregates), and the signed-in user's own rating.
  useEffect(()=>{
    if (!current?.id){
      setMyRating(null)
      return
    }

    // Reasonable default for the slider when switching articles.
    const fallback = clampDifficulty(current.ratingAvg ?? current.difficulty ?? 50)
    setRatingInput(fallback)

    const artRef = doc(db, 'articles', current.id)
    const unsubArticle = onSnapshot(artRef, (snap)=>{
      if (!snap.exists()) return
      const data = snap.data() || {}
      setCurrent(prev=>{
        if (!prev || prev.id !== current.id) return prev
        const nextDifficulty = clampDifficulty(data.difficulty ?? prev.difficulty ?? 0)
        const nextAvg = clampDifficulty(data.ratingAvg ?? prev.ratingAvg ?? 0)
        const nextCountRaw = Number(data.ratingCount ?? prev.ratingCount ?? 0)
        const nextCount = Number.isFinite(nextCountRaw) ? Math.max(0, Math.trunc(nextCountRaw)) : 0
        return { ...prev, difficulty: nextDifficulty, ratingAvg: nextAvg, ratingCount: nextCount }
      })
    }, (_e)=>{})

    let unsubMine = ()=>{}
    if (auth.currentUser?.uid){
      const mineRef = doc(db, 'articles', current.id, 'difficultyRatings', auth.currentUser.uid)
      unsubMine = onSnapshot(mineRef, (snap)=>{
        if (!snap.exists()){
          setMyRating(null)
          return
        }
        const r = clampDifficulty(snap.data()?.rating ?? 0)
        setMyRating(r)
        setRatingInput(r)
      }, (_e)=>{})
    } else {
      setMyRating(null)
    }

    return ()=>{
      unsubArticle()
      unsubMine()
    }
    // Only rebind listeners when switching article or auth state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[current?.id, user?.uid])

  async function saveMyRating(){
    if (!current?.id) return
    if (!auth.currentUser){ window.alert('Login first'); return }
    setRatingSaving(true)
    try{
      const rating = clampDifficulty(ratingInput)
      await setDoc(doc(db, 'articles', current.id, 'difficultyRatings', auth.currentUser.uid), {
        rating,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setMyRating(rating)
    }catch(e){
      const msg = e?.message || String(e)
      window.alert(`Could not save rating: ${msg}`)
    }finally{
      setRatingSaving(false)
    }
  }

  function normalizeTag(s){
    // Keep in sync with rules regex: /^[A-Za-z0-9][A-Za-z0-9 \-]*$/
    const t = String(s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 24)
    if (!t) return ''
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-]*$/.test(t)) return ''
    return t
  }

  function parseTagsInput(s){
    const raw = String(s || '')
    const parts = raw.split(',').map(x=>normalizeTag(x)).filter(Boolean)
    // Dedup, keep order
    const seen = new Set()
    const out = []
    for (const p of parts){
      const key = p.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
      if (out.length >= 12) break
    }
    return out
  }

  function hash01(str){
    // Deterministic [0,1) hash for stable jitter positions.
    // Simple FNV-1a-ish variant (good enough for UI jitter).
    let h = 2166136261
    const s = String(str || '')
    for (let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    // >>> 0 => uint32
    return ((h >>> 0) % 1000000) / 1000000
  }

  useEffect(()=>{
    let cancelled = false
    ;(async()=>{
      if (!current?.id){
        setTopTags([])
        setMyTags([])
        setTagInput('')
        setTagsLoading(false)
        return
      }
      setTagsLoading(true)
      try{
        // Aggregate all votes for "top tags".
        const qs = await getDocs(collection(db, 'articles', current.id, 'tagVotes'))
        if (cancelled) return
        const counts = new Map() // lower -> { tag, count }
        for (const d of qs.docs){
          const tags = Array.isArray(d.data()?.tags) ? d.data().tags : []
          for (const t of tags){
            const nt = normalizeTag(t)
            if (!nt) continue
            const key = nt.toLowerCase()
            const prev = counts.get(key)
            if (prev){
              prev.count += 1
            } else {
              counts.set(key, { tag: nt, count: 1 })
            }
          }
        }
        const sorted = Array.from(counts.values())
          .sort((a,b)=> (b.count - a.count) || a.tag.localeCompare(b.tag))
          .slice(0, 5)
        setTopTags(sorted)

        // Load current user's tags (separate read so we can prefill input).
        if (auth.currentUser?.uid){
          const snap = await getDoc(doc(db, 'articles', current.id, 'tagVotes', auth.currentUser.uid))
          if (cancelled) return
          const mine = snap.exists() ? (Array.isArray(snap.data()?.tags) ? snap.data().tags : []) : []
          const normMine = mine.map(normalizeTag).filter(Boolean).slice(0, 12)
          setMyTags(normMine)
          setTagInput(normMine.join(', '))
        } else {
          setMyTags([])
          setTagInput('')
        }
      }catch{
        if (!cancelled){
          setTopTags([])
          setMyTags([])
        }
      }finally{
        if (!cancelled) setTagsLoading(false)
      }
    })()
    return ()=>{ cancelled = true }
  },[current?.id, user?.uid])

  async function saveMyTags(){
    if (!current?.id) return
    if (!auth.currentUser){ window.alert('Login first'); return }
    setTagsLoading(true)
    try{
      const tags = parseTagsInput(tagInput)
      await setDoc(doc(db, 'articles', current.id, 'tagVotes', auth.currentUser.uid), {
        tags,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setMyTags(tags)

      // Recompute top tags quickly by reloading votes.
      // (In the future we can optimistically update counts; this keeps it simple.)
      const qs = await getDocs(collection(db, 'articles', current.id, 'tagVotes'))
      const counts = new Map()
      for (const d of qs.docs){
        const ts = Array.isArray(d.data()?.tags) ? d.data().tags : []
        for (const t of ts){
          const nt = normalizeTag(t)
          if (!nt) continue
          const key = nt.toLowerCase()
          const prev = counts.get(key)
          if (prev) prev.count += 1
          else counts.set(key, { tag: nt, count: 1 })
        }
      }
      const sorted = Array.from(counts.values())
        .sort((a,b)=> (b.count - a.count) || a.tag.localeCompare(b.tag))
        .slice(0, 5)
      setTopTags(sorted)
    }catch(e){
      const msg = e?.message || String(e)
      window.alert(`Could not save tags: ${msg}`)
    }finally{
      setTagsLoading(false)
    }
  }

  async function createArticle(){
    if (!auth.currentUser){ window.alert('Login first'); return }
    if (!canEdit){ window.alert('Wiki editing is unlocked at level 10.'); return }
    const title = window.prompt('Article title?')
    if (!title) return
    const slug = slugify(title)
    if (articles.some(a=>a.slug===slug)) { window.alert('Article exists'); return }
    let difficulty = 0
    if (isAdmin){
      const d = window.prompt('Difficulty (0–100)?', '0')
      if (d === null) return
      difficulty = clampDifficulty(d)
    }
    const art = { title, slug, content: `\\section*{${title}}\n`, keywords: [], difficulty }
    const ref = await addDoc(collection(db,'articles'), art)
    const newArt = { ...art, id: ref.id }
    const list = [...articles, newArt]
    setArticles(list)
    navigate(`/wiki/${encodeURIComponent(slug)}`)
    setCurrent(newArt)
    setEditing(true)
  }

  async function deleteArticle(){
    if (!current) return
    if (!auth.currentUser){ window.alert('Login first'); return }
    if (!canEdit){ window.alert('Wiki editing is unlocked at level 10.'); return }
    if (!window.confirm('Delete this article?')) return
    await deleteDoc(doc(db,'articles',current.id))
    const list = articles.filter(a=>a.id!==current.id)
    setArticles(list)
    if (list.length){ navigate(`/wiki/${encodeURIComponent(list[0].slug)}`) } else { navigate('/wiki') }
  }

  async function saveEdits(){
    if (!current) return
    if (!auth.currentUser){ window.alert('Login first'); return }
    if (!canEdit){ window.alert('Wiki editing is unlocked at level 10.'); return }
    const title = String(document.getElementById('wiki-title')?.value || '').trim().slice(0, 120)
    const keywords = parseKeywords(document.getElementById('wiki-keywords')?.value || '')
    const content = String(document.getElementById('editor')?.value || '').trim()
    if (!title || !content){ window.alert('Title and content are required'); return }
    const slug = slugify(title)
    let difficulty = current.difficulty ?? 0
    if (isAdmin){
      difficulty = clampDifficulty(document.getElementById('wiki-difficulty')?.value ?? difficulty)
    }
    const next = { ...current, title, slug, keywords, content, difficulty }
    await setDoc(doc(db, 'articles', current.id), next, { merge: true })
    setArticles(prev => prev.map(a => a.id === current.id ? next : a))
    setCurrent(next)
    navigate(`/wiki/${encodeURIComponent(slug)}`)
    setEditing(false)
  }

  async function adminSetDifficulty(){
    if (!current) return
    if (!auth.currentUser){ window.alert('Login first'); return }
    if (!isAdmin){ window.alert('Admin only'); return }
    const d = window.prompt('Difficulty (0–100)?', String(current.difficulty ?? 0))
    if (d === null) return
    const difficulty = clampDifficulty(d)
    const next = { ...current, difficulty }
    await setDoc(doc(db, 'articles', current.id), { difficulty }, { merge: true })
    setArticles(prev => prev.map(a => a.id === current.id ? next : a))
    setCurrent(next)
  }

  async function sendCurrentToChat(){
    if (!current) return
    openPanel('share', {
      title: 'Send to…',
      props: { kind:'wiki', wikiSlug: current.slug, wikiTitle: current.title || current.slug },
      replaceAll: true,
      pushHistory: true,
    })
  }

  const filteredArticles = useMemo(()=>{
    const q = String(search || '').trim().toLowerCase()
    const base = Array.isArray(articles) ? articles : []
    const filtered = !q ? base : base.filter(a=>{
      const title = String(a.title || '').toLowerCase()
      const content = String(a.content || '').toLowerCase()
      const kws = Array.isArray(a.keywords) ? a.keywords.join(' ').toLowerCase() : ''
      return title.includes(q) || kws.includes(q) || content.includes(q)
    })
    return filtered
      .slice()
      .sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''), undefined, { sensitivity:'base' }))
  },[articles, search])

  function highlightTextReact(text, queryText){
    const t = String(text || '')
    const q = String(queryText || '').trim()
    if (!q) return t
    const re = new RegExp(escapeRegExp(q), 'ig')
    const parts = t.split(re)
    if (parts.length === 1) return t
    const matches = t.match(re) || []
    const out = []
    for (let i = 0; i < parts.length; i++){
      out.push(<span key={`p-${i}`}>{parts[i]}</span>)
      if (i < matches.length){
        out.push(
          <mark
            key={`m-${i}`}
            style={{background:'#fff59d', padding:'0 .08em', borderRadius:3}}
          >
            {matches[i]}
          </mark>
        )
      }
    }
    return out
  }

  function TrenchOfMathematics(){
    const list = Array.isArray(filteredArticles) ? filteredArticles : []
    const selectedId = current?.id || null

    function FullIcebergModal(){
      if (!icebergFullOpen) return null
      return (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e)=>{
            // click backdrop to close
            if (e.target === e.currentTarget) setIcebergFullOpen(false)
          }}
          style={{
            position:'fixed',
            inset:0,
            zIndex: 1000,
            background:'rgba(0,0,0,0.55)',
            display:'flex',
            alignItems:'center',
            justifyContent:'center',
            padding:12,
          }}
        >
          <div
            style={{
              width:'min(1200px, 96vw)',
              height:'min(88vh, 900px)',
              background:'#fff',
              borderRadius:14,
              overflow:'hidden',
              boxShadow:'0 24px 80px rgba(0,0,0,0.35)',
              display:'flex',
              flexDirection:'column',
            }}
          >
            <div style={{display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderBottom:'1px solid #eee'}}>
              <div style={{fontWeight:900}}>Full iceberg</div>
              <div style={{color:'#666', fontSize:12}}>Current article is red.</div>
              <span style={{marginLeft:'auto'}} />
              <button
                type="button"
                onClick={()=>setIcebergFullOpen(false)}
                style={{padding:'6px 10px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111'}}
              >
                Close
              </button>
            </div>

            <FullIcebergFigure />
          </div>
        </div>
      )
    }

    function FullIcebergFigure(){
      const boxRef = useRef(null)
      const [box, setBox] = useState({ w: 0, h: 0 })
      const [img, setImg] = useState({ w: 0, h: 0 })

      useLayoutEffect(()=>{
        const el = boxRef.current
        if (!el) return
        function measure(){
          setBox({ w: el.clientWidth || 0, h: el.clientHeight || 0 })
        }
        measure()
        let ro = null
        try{
          if (typeof ResizeObserver !== 'undefined'){
            ro = new ResizeObserver(()=>measure())
            ro.observe(el)
          }
        }catch(_e){ ro = null }
        window.addEventListener('resize', measure)
        return ()=>{
          try{ ro?.disconnect?.() }catch(_e){}
          window.removeEventListener('resize', measure)
        }
      },[])

      const iw = img.w || 1
      const ih = img.h || 1
      const cw = box.w || 1
      const ch = box.h || 1
      const scale = Math.min(cw / iw, ch / ih)
      const rw = iw * scale
      const rh = ih * scale
      const ox = (cw - rw) / 2
      const oy = (ch - rh) / 2

      return (
        <div ref={boxRef} style={{position:'relative', flex:1, minHeight:0, background:'#fafafa'}}>
          <img
            src={icebergSrc}
            onError={()=>setIcebergSrc('/iceberg-placeholder.svg')}
            onLoad={(e)=>{
              const nw = e.currentTarget?.naturalWidth || 0
              const nh = e.currentTarget?.naturalHeight || 0
              if (nw && nh) setImg({ w: nw, h: nh })
            }}
            alt="Iceberg"
            style={{position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain'}}
          />

          {list.map(a=>{
            const diff = clampDifficulty(a.difficulty ?? 0)
            const r = hash01(a.slug || a.id)
            const xPct = 12 + r * 76
            const yPct = diff
            const isCurrent = selectedId && a.id === selectedId
            const x = ox + (xPct / 100) * rw
            const y = oy + (yPct / 100) * rh
            return (
              <button
                key={a.id}
                type="button"
                onClick={()=>navigate(`/wiki/${encodeURIComponent(a.slug)}`)}
                title={`${a.title || 'Untitled'} • true ${diff} • community ${clampDifficulty(a.ratingAvg ?? 0)} (${Number(a.ratingCount || 0)})`}
                style={{
                  position:'absolute',
                  left:x,
                  top:y,
                  transform:'translate(-50%, -50%)',
                  width: isCurrent ? 14 : 8,
                  height: isCurrent ? 14 : 8,
                  borderRadius:999,
                  border: isCurrent ? '2px solid rgba(229,57,53,0.35)' : '1px solid rgba(0,0,0,0.18)',
                  background: isCurrent ? '#e53935' : '#2d2d2d',
                  opacity: isCurrent ? 1 : 0.75,
                  padding:0,
                  cursor:'pointer',
                  boxShadow: isCurrent ? '0 0 0 6px rgba(229,57,53,0.10)' : 'none',
                }}
              />
            )
          })}
        </div>
      )
    }

    // NOTE: container uses percentage-based layout so it stays responsive.
    return (
      <div id="wiki-trench">
        <div style={{padding:'12px 12px 8px', borderBottom:'1px solid #eee'}}>
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{fontWeight:800, letterSpacing:'.2px'}}>Iceberg</div>
            <span style={{marginLeft:'auto'}} />
            <button
              type="button"
              onClick={()=>setIcebergFullOpen(true)}
              style={{padding:'6px 10px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111'}}
              title="View the full iceberg"
            >
              Full view
            </button>
            <button
              type="button"
              onClick={()=>{
                const next = false
                setShowIceberg(next)
                try{ window.localStorage?.setItem('wikiIcebergOpen', next ? '1' : '0') }catch(_e){}
              }}
              style={{padding:'6px 10px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111'}}
              title="Hide Iceberg"
            >
              Hide
            </button>
          </div>
          <div style={{fontSize:12, color:'#666', marginTop:2}}>
            Depth = difficulty (0–100). Current article is highlighted.
          </div>
        </div>
        <div style={{position:'relative', flex:1, minHeight:0}}>
          <div style={{position:'absolute', inset:12, borderRadius:12, border:'1px solid #eee', overflow:'hidden', background:'#f5f5f5'}}>
            {current && (
              <>
                {(() => {
                  const r = hash01(current.slug || current.id)
                  const xPct = 12 + r * 76
                  const yPct = clampDifficulty(current.difficulty ?? 0)
                  return (
                    <>
                      <img
                        src={icebergSrc}
                        onError={()=>setIcebergSrc('/iceberg-placeholder.svg')}
                        alt="Iceberg"
                        style={{
                          position:'absolute',
                          inset:0,
                          width:'100%',
                          height:'100%',
                          objectFit:'cover',
                          objectPosition:`${xPct}% ${yPct}%`,
                          filter:'saturate(1.02) contrast(1.02)',
                        }}
                      />
                      {/* Current article marker (we only render the current marker in zoom view) */}
                      <div
                        style={{
                          position:'absolute',
                          left:`${xPct}%`,
                          top:`${yPct}%`,
                          transform:'translate(-50%, -50%)',
                          width:14,
                          height:14,
                          borderRadius:999,
                          border:'2px solid rgba(229,57,53,0.35)',
                          background:'#e53935',
                          boxShadow:'0 0 0 8px rgba(229,57,53,0.12)',
                          pointerEvents:'none',
                        }}
                      />
                      <div
                        style={{
                          position:'absolute',
                          left:`${xPct}%`,
                          top:`${yPct}%`,
                          transform:'translate(14px, -50%)',
                          pointerEvents:'none',
                          background:'rgba(255,255,255,0.94)',
                          border:'1px solid #eee',
                          borderRadius:10,
                          padding:'6px 8px',
                          maxWidth:220,
                          boxShadow:'0 8px 24px rgba(0,0,0,0.10)',
                        }}
                      >
                        <div style={{fontWeight:800, fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                          {current.title || 'Untitled'}
                        </div>
                        <div style={{fontSize:12, color:'#444'}}>
                          true: <b>{clampDifficulty(current.difficulty ?? 0)}</b>
                          <span style={{marginLeft:10, color:'#666'}}>
                            community: <b>{clampDifficulty(current.ratingAvg ?? 0)}</b>
                            {Number(current.ratingCount || 0) > 0 ? <span style={{marginLeft:6}}>({Number(current.ratingCount)})</span> : null}
                          </span>
                        </div>
                      </div>
                    </>
                  )
                })()}
              </>
            )}
            {!current && (
              <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#666'}}>
                Pick an article to view the iceberg.
              </div>
            )}
          </div>
        </div>
        {isAdmin && current && (
          <div style={{padding:12, borderTop:'1px solid #eee', display:'flex', gap:8}}>
            <button type="button" onClick={adminSetDifficulty} style={{background:'#111', color:'#fff', border:'1px solid #111'}}>
              Set difficulty
            </button>
          </div>
        )}
        <FullIcebergModal />
      </div>
    )
  }

  return (
    <div id="wiki-page" style={{display:'flex',flex:1,width:'100%'}}>
      <aside id="sidebar">
        <h2>Articles</h2>
        <div style={{fontSize:'.85rem', color:'#555', lineHeight:1.35}}>
          <div style={{marginBottom:6}}>
            All the wiki articles are generated by AI. Please feel free to suggest improvements, especially if there is an error.
          </div>
          <div style={{marginBottom:10}}>
            The wiki section is not complete yet due to the huge amount of contents. Estimated completion is by March.
          </div>
        </div>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Search titles, keywords, content…"
          style={{width:'100%', margin:'6px 0 10px'}}
        />

        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <button
            id="new-btn"
            onClick={createArticle}
            disabled={!canEdit}
            title={!canEdit ? 'Unlock at level 10' : ''}
            style={{flex:1}}
          >
            ＋ New article
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={adminSetDifficulty}
              disabled={!canEdit || !current}
              title={!current ? 'Pick an article first' : 'Admin-only'}
              style={{padding:'0.4rem 0.55rem', border:'1px solid #111', background:'#111', color:'#fff', borderRadius:6}}
            >
              𝑑
            </button>
          )}
        </div>
        {!canEdit && (
          <div style={{marginTop:8, fontSize:'.9rem', color:'#777'}}>
            Wiki editing unlocks at <b>level 10</b>.
          </div>
        )}

        <ul id="article-list">
          {filteredArticles.map(a=> (
            <li key={a.id}>
              <button
                onClick={()=>navigate(`/wiki/${encodeURIComponent(a.slug)}`)}
                style={{fontWeight: current?.id === a.id ? 700 : 400}}
              >
                {highlightTextReact(a.title||'Untitled', search)}
              </button>
            </li>
          ))}
        </ul>

      </aside>
      <section id="content" style={{flex:1}}>
        {!current && <div>No articles yet.</div>}
        {!showIceberg && (
          <div style={{display:'flex', justifyContent:'flex-end', margin:'0 0 10px'}}>
            <button
              type="button"
              onClick={()=>{
                const next = true
                setShowIceberg(next)
                try{ window.localStorage?.setItem('wikiIcebergOpen', next ? '1' : '0') }catch(_e){}
              }}
              style={{padding:'8px 12px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111'}}
            >
              Show Iceberg
            </button>
          </div>
        )}
        {current && !editing && (
          <div style={{margin:'0 0 12px'}}>
            <div style={{margin:'0 0 10px', padding:'10px 12px', border:'1px solid #eee', borderRadius:12, background:'#fff'}}>
              <div style={{display:'flex', alignItems:'baseline', gap:12, flexWrap:'wrap'}}>
                <div style={{fontWeight:900, color:'#111'}}>Difficulty</div>
                <div style={{color:'#555', fontSize:13}}>
                  True: <b style={{fontVariantNumeric:'tabular-nums'}}>{clampDifficulty(current.difficulty ?? 0)}</b>/100
                </div>
                <div style={{color:'#555', fontSize:13}}>
                  Community: <b style={{fontVariantNumeric:'tabular-nums'}}>{clampDifficulty(current.ratingAvg ?? 0)}</b>/100
                  <span style={{color:'#777', marginLeft:6}}>
                    ({Number(current.ratingCount || 0)} ratings)
                  </span>
                </div>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:10, marginTop:8, flexWrap:'wrap'}}>
                <div style={{fontWeight:800, color:'#111'}}>Your rating:</div>
                {!auth.currentUser && <div style={{color:'#777'}}>Login to rate.</div>}
                {!!auth.currentUser && (
                  <>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={ratingInput}
                      onChange={e=>setRatingInput(clampDifficulty(e.target.value))}
                      style={{flex:'1 1 220px'}}
                      aria-label="Your difficulty rating (0–100)"
                    />
                    <div style={{minWidth:44, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                      <b>{clampDifficulty(ratingInput)}</b>
                    </div>
                    <button
                      type="button"
                      onClick={saveMyRating}
                      disabled={ratingSaving}
                      style={{padding:'10px 14px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff'}}
                    >
                      {myRating === null ? 'Submit' : 'Update'}
                    </button>
                    {myRating !== null && (
                      <div style={{color:'#777', fontSize:12}}>
                        Saved: <b>{myRating}</b>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
              <div style={{fontWeight:800, color:'#111'}}>Top tags:</div>
              {topTags.length === 0 && (
                <div style={{color:'#777'}}>
                  {tagsLoading ? 'Loading…' : 'No tags yet'}
                </div>
              )}
              {topTags.map(t=>(
                <span key={t.tag} style={{display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', border:'1px solid #e6e6e6', borderRadius:999, background:'#fafafa'}}>
                  <span style={{fontWeight:700}}>{t.tag}</span>
                  <span style={{fontSize:12, color:'#666'}}>{t.count}</span>
                </span>
              ))}
            </div>

            <div style={{marginTop:10, padding:'10px 12px', border:'1px solid #eee', borderRadius:12, background:'#fff'}}>
              <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                <div style={{fontWeight:800, color:'#111'}}>Your tags:</div>
                {!auth.currentUser && <div style={{color:'#777'}}>Login to add tags.</div>}
                {!!auth.currentUser && (
                  <div style={{color:'#777', fontSize:12}}>
                    Pick tags you think this article belongs to (comma-separated). Top 5 are shown.
                  </div>
                )}
              </div>
              <div style={{display:'flex', gap:8, marginTop:8}}>
                <input
                  value={tagInput}
                  onChange={e=>setTagInput(e.target.value)}
                  placeholder="algebra, geometry, number theory…"
                  disabled={!auth.currentUser}
                  style={{flex:1, padding:'10px 12px', borderRadius:10, border:'1px solid #ddd'}}
                />
                <button
                  type="button"
                  onClick={saveMyTags}
                  disabled={!auth.currentUser || tagsLoading}
                  style={{padding:'10px 14px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff'}}
                >
                  Save
                </button>
              </div>
              {auth.currentUser && myTags.length > 0 && (
                <div style={{marginTop:8, color:'#555', fontSize:12}}>
                  Saved: {myTags.join(', ')}
                </div>
              )}
            </div>
          </div>
        )}
        {current && !editing && (
          <div key={current.id} ref={containerRef} />
        )}
        {current && editing && (
          <div>
            <div style={{display:'grid', gap:8, marginBottom:8}}>
              <input id="wiki-title" defaultValue={current.title||''} placeholder="Title" />
              <input id="wiki-keywords" defaultValue={(current.keywords||[]).join(', ')} placeholder="Keywords (comma-separated)" />
              {isAdmin && (
                <input
                  id="wiki-difficulty"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  defaultValue={clampDifficulty(current.difficulty ?? 0)}
                  placeholder="Difficulty (0–100)"
                />
              )}
            </div>
            <textarea id="editor" defaultValue={current.content||''} />
            <div className="controls">
              <button className="edit" onClick={saveEdits} disabled={!canEdit} title={!canEdit ? 'Unlock at level 10' : ''}>Save</button>
              <button className="delete" onClick={()=>setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {current && !editing && (
          <div className="controls">
            <button
              className="edit"
              onClick={()=>{
                if (!canEdit) { window.alert('Wiki editing is unlocked at level 10.'); return }
                setEditing(true)
              }}
              disabled={!canEdit}
              title={!canEdit ? 'Unlock at level 10' : ''}
            >
              Edit
            </button>
            <button className="delete" onClick={deleteArticle} disabled={!canEdit} title={!canEdit ? 'Unlock at level 10' : ''}>Delete</button>
            <button className="edit" onClick={sendCurrentToChat}>Send</button>
          </div>
        )}
      </section>
      {showIceberg && <TrenchOfMathematics />}
    </div>
  )
}
