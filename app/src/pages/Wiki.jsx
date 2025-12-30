import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
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
  const [search, setSearch] = useState('')
  const { level } = useGamification(user?.uid || '')
  const canEdit = !!user && Number(level || 0) >= 10

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return () => unsub()
  },[])

  useEffect(()=>{
    (async()=>{
      const qs = await getDocs(query(collection(db,'articles'), orderBy('title')))
      const arr = []
      for (const d of qs.docs){
        const data = d.data()
        let { title, content, slug, keywords } = data
        if (!slug) slug = slugify(title||'')
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

  function parseKeywords(s){
    const raw = String(s || '')
    return raw
      .split(',')
      .map(x=>x.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map(x=>x.slice(0, 32))
  }

  async function createArticle(){
    if (!auth.currentUser){ window.alert('Login first'); return }
    if (!canEdit){ window.alert('Wiki editing is unlocked at level 10.'); return }
    const title = window.prompt('Article title?')
    if (!title) return
    const slug = slugify(title)
    if (articles.some(a=>a.slug===slug)) { window.alert('Article exists'); return }
    const art = { title, slug, content: `\\section*{${title}}\n`, keywords: [] }
    const ref = await addDoc(collection(db,'articles'), art)
    const newArt = { ...art, id: ref.id }
    const list = [...articles, newArt]
    setArticles(list)
    navigate(`/wiki/${slug}`)
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
    if (list.length){ navigate(`/wiki/${list[0].slug}`) } else { navigate('/wiki') }
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
    const next = { ...current, title, slug, keywords, content }
    await setDoc(doc(db, 'articles', current.id), next, { merge: true })
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

        <button
          id="new-btn"
          onClick={createArticle}
          disabled={!canEdit}
          title={!canEdit ? 'Unlock at level 10' : ''}
        >
          ＋ New article
        </button>
        {!canEdit && (
          <div style={{marginTop:8, fontSize:'.9rem', color:'#777'}}>
            Wiki editing unlocks at <b>level 10</b>.
          </div>
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

      </aside>
      <section id="content" style={{flex:1}}>
        {!current && <div>No articles yet.</div>}
        {current && !editing && (
          <div ref={containerRef} />
        )}
        {current && editing && (
          <div>
            <div style={{display:'grid', gap:8, marginBottom:8}}>
              <input id="wiki-title" defaultValue={current.title||''} placeholder="Title" />
              <input id="wiki-keywords" defaultValue={(current.keywords||[]).join(', ')} placeholder="Keywords (comma-separated)" />
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
    </div>
  )
}
