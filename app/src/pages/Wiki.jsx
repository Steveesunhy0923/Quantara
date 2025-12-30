import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, Timestamp, updateDoc, where, addDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db, functions } from '../lib/firebase'
import { latexMarkupToHTML, renderLatex, slugify } from '../lib/latex'
import { usePanels } from '../components/panels/PanelsContext.jsx'
import { ensureDmChatWith, sendTextMessage } from '../lib/chat.js'

export default function Wiki(){
  const params = useParams()
  const navigate = useNavigate()
  const { openPanel } = usePanels()
  const [articles, setArticles] = useState([])
  const [current, setCurrent] = useState(null)
  const [editing, setEditing] = useState(false)
  const containerRef = useRef(null)
  const [user, setUser] = useState(null)
  const [isSteveAdmin, setIsSteveAdmin] = useState(false)
  const [search, setSearch] = useState('')
  const [contribOpen, setContribOpen] = useState(false)
  const [contribKind, setContribKind] = useState('new') // 'new' | 'edit'
  const [contribTitle, setContribTitle] = useState('')
  const [contribKeywords, setContribKeywords] = useState('')
  const [contribContent, setContribContent] = useState('')
  const [contribErr, setContribErr] = useState('')
  const [pendingContribs, setPendingContribs] = useState([])
  const [reviewing, setReviewing] = useState(null) // contribution doc
  const [adminUid, setAdminUid] = useState('')

  const wikiCreate = useMemo(()=>httpsCallable(functions, 'wikiCreate'), [])
  const wikiUpdate = useMemo(()=>httpsCallable(functions, 'wikiUpdate'), [])
  const wikiDelete = useMemo(()=>httpsCallable(functions, 'wikiDelete'), [])
  const awardWikiContribution = useMemo(()=>httpsCallable(functions, 'gamificationAwardWikiContribution'), [])

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return () => unsub()
  },[])

  useEffect(()=>{
    ;(async()=>{
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

  useEffect(()=>{
    (async()=>{
      const qs = await getDocs(query(collection(db,'articles'), orderBy('title')))
      const arr = []
      for (const d of qs.docs){
        const data = d.data()
        let { title, content, slug, keywords } = data
        if (!slug){
          slug = slugify(title||'')
          // Only admin can backfill missing slugs.
          if (isSteveAdmin){
            try{
              await wikiUpdate({ id: d.id, data: { ...data, slug } })
            }catch(_e){
              // ignore; still render
            }
          }
        }
        arr.push({
          id:d.id,
          title,
          content: content||'',
          slug,
          keywords: Array.isArray(keywords) ? keywords : [],
        })
      }
      setArticles(arr)
    })()
  },[isSteveAdmin])

  // Load pending contributions for admin review
  useEffect(()=>{
    if (!isSteveAdmin) { setPendingContribs([]); return }
    const q = query(collection(db, 'wikiContributions'), where('status','==','pending'), orderBy('createdAt','desc'), limit(100))
    const unsub = onSnapshot(q, (qs)=>{
      setPendingContribs(qs.docs.map(d=>({ id:d.id, ...d.data() })))
    }, (_e)=>{})
    return ()=>unsub()
  },[isSteveAdmin])

  // Best-effort: lookup admin UID once (for DM notifications)
  useEffect(()=>{
    ;(async()=>{
      try{
        const q = query(collection(db, 'users'), where('username','==','stevesunhy'), limit(1))
        const qs = await getDocs(q)
        const d = qs.docs[0]
        setAdminUid(d?.id || '')
      }catch(_e){
        setAdminUid('')
      }
    })()
  },[])

  useEffect(()=>{
    if (!articles.length) return
    const slug = params.slug
    let art = null
    if (slug){ art = articles.find(a=>a.slug===slug) }
    if (!art){ art = articles[0] }
    setCurrent(art)
    setEditing(false)
  },[articles, params.slug])

  useEffect(()=>{
    if (!current || editing) return
    const el = containerRef.current
    if (!el) return
    el.innerHTML = `\n      <article>\n        <h1>${current.title||''}</h1>\n        <div id="article-body">${latexMarkupToHTML(current.content||'')}</div>\n      </article>\n    `
    renderLatex(el)
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

  function openContribute(kind){
    if (!auth.currentUser){ window.alert('Login first'); return }
    setContribErr('')
    setContribKind(kind)
    if (kind === 'edit' && current){
      setContribTitle(current.title || '')
      setContribKeywords(Array.isArray(current.keywords) ? current.keywords.join(', ') : '')
      setContribContent(current.content || '')
    } else {
      setContribTitle('')
      setContribKeywords('')
      setContribContent('')
    }
    setContribOpen(true)
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

  async function submitContribution(){
    if (!auth.currentUser){ window.alert('Login first'); return }
    const title = String(contribTitle || '').trim().slice(0, 120)
    const content = String(contribContent || '').trim()
    const keywords = parseKeywords(contribKeywords)
    if (!title){ setContribErr('Missing title'); return }
    if (!content){ setContribErr('Missing content'); return }
    setContribErr('')

    let fromUsername = auth.currentUser.displayName || 'anon'
    try{
      const prof = await getDoc(doc(db, 'users', auth.currentUser.uid))
      fromUsername = prof.data()?.username || fromUsername
    }catch(_e){}

    const payload = {
      kind: contribKind,
      title,
      content,
      keywords,
      fromUid: auth.currentUser.uid,
      fromUsername,
      toUsername: 'stevesunhy',
      status: 'pending',
      createdAt: Timestamp.now(),
      ...(contribKind === 'edit' && current ? { articleId: current.id, articleSlug: current.slug || '' } : {}),
      ...(adminUid ? { toUid: adminUid } : {}),
    }

    const ref = await addDoc(collection(db, 'wikiContributions'), payload)

    // Best-effort DM to admin (if we can resolve adminUid)
    if (adminUid){
      try{
        const chatId = await ensureDmChatWith(adminUid)
        const link = contribKind === 'edit' && current?.slug ? ` /wiki/${current.slug}` : ' /wiki'
        await sendTextMessage(chatId, `New wiki contribution from @${fromUsername}: "${title}" (${contribKind}) — see:${link} — id:${ref.id}`)
      }catch(_e){}
    }

    window.alert('Submitted! An admin will review your contribution.')
    setContribOpen(false)
  }

  async function createArticle(){
    if (!isSteveAdmin){ openContribute('new'); return }
    const title = window.prompt('Article title?')
    if (!title) return
    const slug = slugify(title)
    if (articles.some(a=>a.slug===slug)) { window.alert('Article exists'); return }
    const art = { title, slug, content: `\\section*{${title}}\n`, keywords: [] }
    const res = await wikiCreate({ data: art })
    const id = res?.data?.id
    const newArt = { ...art, id }
    const list = [...articles, newArt]
    setArticles(list)
    navigate(`/wiki/${slug}`)
    setCurrent(newArt)
    setEditing(true)
  }

  async function deleteArticle(){
    if (!current) return
    if (!isSteveAdmin) return
    if (!window.confirm('Delete this article?')) return
    await wikiDelete({ id: current.id })
    const list = articles.filter(a=>a.id!==current.id)
    setArticles(list)
    if (list.length){ navigate(`/wiki/${list[0].slug}`) } else { navigate('/wiki') }
  }

  async function saveEdits(){
    if (!isSteveAdmin || !current) return
    const title = String(document.getElementById('wiki-title')?.value || '').trim().slice(0, 120)
    const keywords = parseKeywords(document.getElementById('wiki-keywords')?.value || '')
    const content = String(document.getElementById('editor')?.value || '').trim()
    if (!title || !content){ window.alert('Title and content are required'); return }
    const slug = slugify(title)
    const next = { ...current, title, slug, keywords, content }
    await wikiUpdate({ id: current.id, data: next })
    setArticles(prev => prev.map(a => a.id === current.id ? next : a))
    setCurrent(next)
    navigate(`/wiki/${slug}`)
    setEditing(false)
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

  async function adminRejectContribution(c){
    if (!isSteveAdmin) return
    const note = window.prompt('Reject note? (optional)', '') || ''
    await updateDoc(doc(db, 'wikiContributions', c.id), {
      status: 'rejected',
      reviewedAt: Timestamp.now(),
      reviewedBy: auth.currentUser?.uid || '',
      adminNote: note.slice(0, 400),
    })
    setReviewing(null)
  }

  async function adminApplyContribution(c){
    if (!isSteveAdmin) return
    const kind = String(c.kind || 'new')
    const title = String(c.title || '').trim().slice(0, 120)
    const content = String(c.content || '').trim()
    const keywords = Array.isArray(c.keywords) ? c.keywords : []
    let articleId = ''

    if (kind === 'edit' && c.articleId){
      articleId = String(c.articleId)
      const existing = articles.find(a=>a.id===articleId)
      const slug = slugify(title || existing?.title || '')
      const next = { ...(existing||{}), id: articleId, title, slug, content, keywords }
      await wikiUpdate({ id: articleId, data: next })
      setArticles(prev => prev.map(a => a.id === articleId ? next : a))
      setCurrent(next)
      navigate(`/wiki/${slug}`)
    } else {
      const slug = slugify(title)
      if (articles.some(a=>a.slug===slug)) { window.alert('Article exists already; reject or change title.'); return }
      const art = { title, slug, content, keywords }
      const res = await wikiCreate({ data: art })
      articleId = res?.data?.id || ''
      const newArt = { ...art, id: articleId }
      setArticles(prev => [...prev, newArt])
      setCurrent(newArt)
      navigate(`/wiki/${slug}`)
    }

    await updateDoc(doc(db, 'wikiContributions', c.id), {
      status: 'applied',
      reviewedAt: Timestamp.now(),
      reviewedBy: auth.currentUser?.uid || '',
      appliedArticleId: articleId,
    })

    // Best-effort XP award
    try{
      if (c.fromUid && articleId){
        await awardWikiContribution({ uid: String(c.fromUid), articleId })
      }
    }catch(_e){}

    setReviewing(null)
  }

  return (
    <div style={{display:'flex',flex:1,overflow:'hidden',width:'100%'}}>
      <aside id="sidebar">
        <h2>Articles</h2>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Search titles, keywords, content…"
          style={{width:'100%', margin:'6px 0 10px'}}
        />

        {isSteveAdmin ? (
          <button id="new-btn" onClick={createArticle}>＋ Add article</button>
        ) : (
          <button id="new-btn" onClick={()=>openContribute('new')}>Contribute</button>
        )}

        <ul id="article-list">
          {filteredArticles.map(a=> (
            <li key={a.id}>
              <button
                onClick={()=>navigate(`/wiki/${a.slug}`)}
                style={{fontWeight: current?.id === a.id ? 700 : 400}}
              >
                {highlightTextReact(a.title||'Untitled', search)}
              </button>
            </li>
          ))}
        </ul>

        {isSteveAdmin && (
          <div style={{borderTop:'1px solid #eee', marginTop:12, paddingTop:10}}>
            <div style={{fontSize:'.9rem', color:'#666', marginBottom:6}}>
              Contributions ({pendingContribs.length})
            </div>
            {pendingContribs.length === 0 && <div style={{fontSize:'.9rem', color:'#777'}}>No pending contributions.</div>}
            {pendingContribs.length > 0 && (
              <div style={{display:'flex', flexDirection:'column', gap:6}}>
                {pendingContribs.slice(0, 20).map(c=>(
                  <button
                    key={c.id}
                    type="button"
                    onClick={()=>setReviewing(c)}
                    style={{textAlign:'left'}}
                    title="Review contribution"
                  >
                    {String(c.title||'Untitled').slice(0, 42)}{String(c.title||'').length>42?'…':''}
                    <span style={{color:'#777'}}> · @{c.fromUsername||'anon'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
      <section id="content" style={{flex:1}}>
        {!current && <div>No articles yet.</div>}
        {current && !editing && (
          <div ref={containerRef} />
        )}
        {current && editing && isSteveAdmin && (
          <div>
            <div style={{display:'grid', gap:8, marginBottom:8}}>
              <input id="wiki-title" defaultValue={current.title||''} placeholder="Title" />
              <input id="wiki-keywords" defaultValue={(current.keywords||[]).join(', ')} placeholder="Keywords (comma-separated)" />
            </div>
            <textarea id="editor" defaultValue={current.content||''} />
            <div className="controls">
              <button className="edit" onClick={saveEdits}>Save</button>
              <button className="delete" onClick={()=>setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {current && !editing && (
          <div className="controls">
            {isSteveAdmin ? (
              <>
                <button className="edit" onClick={()=>setEditing(true)}>Edit</button>
                <button className="delete" onClick={deleteArticle}>Delete</button>
              </>
            ) : (
              <button className="edit" onClick={()=>openContribute('edit')}>Contribute</button>
            )}
            <button className="edit" onClick={sendCurrentToChat}>Send</button>
          </div>
        )}

        {contribOpen && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={()=>setContribOpen(false)}
            style={{position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex: 2000, display:'flex', alignItems:'center', justifyContent:'center', padding:16}}
          >
            <div onClick={e=>e.stopPropagation()} style={{maxWidth:900, width:'100%', background:'#fff', borderRadius:12, padding:14, boxShadow:'0 12px 32px rgba(0,0,0,.25)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                <div style={{fontWeight:700}}>Contribute to the Wiki</div>
                <button type="button" onClick={()=>setContribOpen(false)}>Close</button>
              </div>
              <div style={{display:'grid', gap:8}}>
                <label style={{display:'grid', gap:4}}>
                  <span style={{fontSize:'.9rem', color:'#555'}}>Type</span>
                  <select value={contribKind} onChange={e=>setContribKind(e.target.value)} disabled={contribKind==='edit'}>
                    <option value="new">New article</option>
                    <option value="edit">Edit current article</option>
                  </select>
                </label>
                <input value={contribTitle} onChange={e=>setContribTitle(e.target.value)} placeholder="Title" />
                <input value={contribKeywords} onChange={e=>setContribKeywords(e.target.value)} placeholder="Keywords (comma-separated)" />
                <textarea value={contribContent} onChange={e=>setContribContent(e.target.value)} placeholder="Write your article / edits here…" style={{minHeight:260}} />
                {!!contribErr && <div style={{color:'#b00020'}}>{contribErr}</div>}
                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                  <button type="button" onClick={()=>setContribOpen(false)}>Cancel</button>
                  <button type="button" onClick={submitContribution}>Submit to admin</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {reviewing && isSteveAdmin && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={()=>setReviewing(null)}
            style={{position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex: 2100, display:'flex', alignItems:'center', justifyContent:'center', padding:16}}
          >
            <div onClick={e=>e.stopPropagation()} style={{maxWidth:980, width:'100%', background:'#fff', borderRadius:12, padding:14, boxShadow:'0 12px 32px rgba(0,0,0,.25)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                <div style={{fontWeight:700}}>Review contribution</div>
                <button type="button" onClick={()=>setReviewing(null)}>Close</button>
              </div>
              <div style={{display:'grid', gap:8}}>
                <div style={{color:'#666', fontSize:'.95rem'}}>
                  <div><b>From</b>: @{reviewing.fromUsername||'anon'} · <b>Type</b>: {reviewing.kind}</div>
                  <div><b>Title</b>: {reviewing.title}</div>
                  {!!(reviewing.keywords && reviewing.keywords.length) && <div><b>Keywords</b>: {reviewing.keywords.join(', ')}</div>}
                  {!!reviewing.articleSlug && <div><b>Target</b>: /wiki/{reviewing.articleSlug}</div>}
                </div>
                <textarea readOnly value={String(reviewing.content||'')} style={{minHeight:320}} />
                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                  <button type="button" onClick={()=>adminRejectContribution(reviewing)}>Reject</button>
                  <button type="button" onClick={()=>adminApplyContribution(reviewing)}>Apply</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
