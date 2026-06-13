export function slugify(str){
  // Generate a URL-safe slug WITHOUT percent-encoding.
  // react-router params are decoded; storing encoded slugs (with %xx) breaks lookups.
  let s = String(str || '').trim().toLowerCase()
  try{
    // Remove diacritics (NFKD) if supported.
    s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  }catch(_e){}
  s = s
    .replace(/['’]/g, '')        // drop apostrophes
    .replace(/&/g, ' and ')      // keep meaning
    .replace(/[^a-z0-9]+/g, '-') // collapse non-url chars to '-'
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s || 'article'
}

export function latexMarkupToHTML(src){
  function escapeHtml(s){
    return String(s || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;')
  }

  function normalizeImageUrl(url){
    url = String(url || '').trim()
    // allow https/http or site-relative URLs; block javascript: and other schemes
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith('/')) return url
    return ''
  }

  // TikZ: wrap any \begin{tikzpicture}...\end{tikzpicture} blocks so TikZJax can render them.
  // Important: avoid regex lookbehind / overly-greedy patterns that can break the whole transform.
  function protectExistingTikzScripts(input){
    const scripts = []
    let out = String(input || '')
    out = out.replace(/<script\s+type="text\/tikz">[\s\S]*?<\/script>/gi, (m)=>{
      scripts.push(m)
      return `__TIKZ_SCRIPT_${scripts.length - 1}__`
    })
    return { out, scripts }
  }
  function restoreTikzScripts(input, scripts){
    let out = String(input || '')
    for (let i = 0; i < scripts.length; i++){
      out = out.replaceAll(`__TIKZ_SCRIPT_${i}__`, scripts[i])
    }
    return out
  }
  const protectedTikz = protectExistingTikzScripts(src)
  protectedTikz.out = protectedTikz.out.replace(
    // Allow optional options: \begin{tikzpicture}[...]
    /\\begin\{tikzpicture\}(?:\[[^\]]*\])?[\s\S]*?\\end\{tikzpicture\}/g,
    (tikz)=>`<script type="text/tikz">\n${tikz}\n</script>`
  )
  src = restoreTikzScripts(protectedTikz.out, protectedTikz.scripts)

  // LaTeX center environment (commonly used around TikZ).
  // We can't rely on MathJax to handle this (it's not inside math delimiters),
  // so convert it to HTML centering.
  src = src
    // Use a flex column so block children (like TikZJax's fixed-width div) are truly centered.
    .replace(
      /\\begin\{center\}/g,
      '<div class="latex-center" style="display:flex;flex-direction:column;align-items:center;text-align:center;">'
    )
    .replace(/\\end\{center\}/g, '</div>')

  // Internal wiki links [[Target|Label]]
  src = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => {
    const slug = slugify(target)
    const text = label || target
    // Use real SPA route; other pages can still navigate via normal link if needed.
    return '<a class="wiki-link" href="/wiki/'+encodeURIComponent(slug)+'">'+text+'</a>'
  })

  // Image macro: \imgcap{URL}{Caption text}
  // - URL must be https://, http://, or /relative/path
  // - Caption should not contain unmatched braces
  src = src.replace(/\\imgcap\{([^}]+)\}\{([^}]+)\}/g, (_m, rawUrl, rawCaption) => {
    const url = normalizeImageUrl(rawUrl)
    if (!url) return '<!-- invalid image url -->'
    const cap = escapeHtml(rawCaption)
    const safeUrl = escapeHtml(url)
    return (
      '<figure class="wiki-figure" style="margin:1rem 0;text-align:center;">' +
        '<img src="' + safeUrl + '" alt="' + cap + '" loading="lazy" decoding="async" ' +
             'style="max-width:100%;height:auto;border:1px solid #ddd;background:#fff;border-radius:6px;">' +
        '<figcaption style="margin-top:.5rem;color:#444;">' + cap + '</figcaption>' +
      '</figure>'
    )
  })

  // -----------------------------
  // Balanced-brace transforms
  // (Avoid naive `[^}]` regexes; they break on content like \mathbb{N} inside headings/text.)
  // -----------------------------
  function replaceMacroBalanced(input, macro, renderInner){
    const s = String(input || '')
    const needle = `\\${macro}{`
    let out = ''
    let i = 0
    let guard = 0
    while (i < s.length && guard++ < 20000){
      const j = s.indexOf(needle, i)
      if (j === -1){
        out += s.slice(i)
        break
      }
      out += s.slice(i, j)
      let k = j + needle.length
      let depth = 1
      while (k < s.length && depth > 0){
        const ch = s[k]
        if (ch === '{') depth++
        else if (ch === '}') depth--
        k++
      }
      if (depth !== 0){
        // Unbalanced braces; give up and append the rest unchanged.
        out += s.slice(j)
        break
      }
      const inner = s.slice(j + needle.length, k - 1)
      out += renderInner(inner)
      i = k
    }
    return out
  }

  function replaceSectionLike(input, cmd, tag){
    // Handles \section{...} and \section*{...}
    const s = String(input || '')
    const variants = [`\\${cmd}{`, `\\${cmd}*{`]
    let out = ''
    let i = 0
    let guard = 0
    while (i < s.length && guard++ < 20000){
      let j = -1
      let needle = ''
      for (const v of variants){
        const idx = s.indexOf(v, i)
        if (idx !== -1 && (j === -1 || idx < j)){
          j = idx
          needle = v
        }
      }
      if (j === -1){
        out += s.slice(i)
        break
      }
      out += s.slice(i, j)
      let k = j + needle.length
      let depth = 1
      while (k < s.length && depth > 0){
        const ch = s[k]
        if (ch === '{') depth++
        else if (ch === '}') depth--
        k++
      }
      if (depth !== 0){
        out += s.slice(j)
        break
      }
      const inner = s.slice(j + needle.length, k - 1)
      out += `<${tag}>${inner}</${tag}>`
      i = k
    }
    return out
  }

  // simple transforms (balanced)
  src = replaceMacroBalanced(src, 'textbf', (inner)=>`<strong>${inner}</strong>`)
  src = replaceMacroBalanced(src, 'emph', (inner)=>`<em>${inner}</em>`)
  src = replaceMacroBalanced(src, 'textit', (inner)=>`<em>${inner}</em>`)
  src = src.replace(/\\begin{itemize}([\s\S]*?)\\end{itemize}/g, (_m, inner) => {
    const items = inner.split(/\\item/).filter(s=>s.trim())
    return '<ul>'+items.map(s=>'\n<li>'+s.trim()+'</li>').join('')+'\n</ul>'
  })

  src = replaceSectionLike(src, 'section', 'h2')
  src = replaceSectionLike(src, 'subsection', 'h3')
  src = replaceSectionLike(src, 'subsubsection', 'h4')

  return src
    .replace(/\\break/g,'<br>')
    .replace(/\\\\(?=\s|$)/g,'<br>')
}

function _looksLikeLatexOrTikz(container){
  try{
    if (!container) return false
    // TikZ scripts are explicit and cheap to detect.
    if (container.querySelector?.('script[type="text/tikz"]')) return true

    // Heuristic for MathJax: avoid loading MathJax for plain text posts.
    // We intentionally keep this cheap and permissive; false positives are OK.
    const html = String(container.innerHTML || '')
    if (html.includes('\\(') || html.includes('\\[') || html.includes('\\)') || html.includes('\\]')) return true
    if (html.includes('$$')) return true
    if (/\$[^$]+\$/.test(html)) return true
    // Common LaTeX commands.
    if (/\\(frac|sqrt|sum|prod|int|lim|cdot|times|pi|alpha|beta|gamma|theta|mathbb|mathbf|mathrm|begin|end)\b/.test(html)) return true
  }catch(_e){}
  return false
}

async function _ensureMathJaxRuntime(){
  if (typeof window === 'undefined') return

  // If MathJax is already fully loaded, we're done.
  if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') return
  if (window.__ensureMathJaxRuntimePromise) return window.__ensureMathJaxRuntimePromise

  window.__ensureMathJaxRuntimePromise = new Promise((resolve)=>{
    try{
      // Provide config BEFORE loading the script. Also: avoid auto-typesetting the whole document.
      const existing = window.MathJax
      const baseCfg = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {}
      window.MathJax = {
        ...baseCfg,
        tex: {
          inlineMath: [['$','$'],['\\(','\\)']],
          displayMath: [['$$','$$'],['\\[','\\]']],
          // Common MathJax v3 package (AMS).
          packages: { '[+]': ['ams'] },
          ...(baseCfg.tex || {}),
        },
        options: {
          skipHtmlTags: ['script','noscript','style','textarea','pre','code'],
          ...(baseCfg.options || {}),
        },
        startup: {
          typeset: false,
          ...(baseCfg.startup || {}),
        },
      }

      const existingScript = document.querySelector('script[data-quantara-mathjax="1"]')
      if (existingScript){
        // If another call inserted the script already, just wait a bit for startup to finish.
        resolve()
        return
      }

      const s = document.createElement('script')
      s.async = true
      s.dataset.quantaraMathjax = '1'
      s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js'
      s.onload = ()=>resolve()
      s.onerror = ()=>resolve()
      document.head.appendChild(s)
    }catch(_e){
      resolve()
    }
  })

  return window.__ensureMathJaxRuntimePromise
}

async function _ensureTikzFonts(){
  if (typeof document === 'undefined') return
  try{
    if (document.querySelector('link[data-quantara-tikz-fonts="1"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.type = 'text/css'
    link.href = '/vendor/tikz/fonts.css'
    link.dataset.quantaraTikzFonts = '1'
    document.head.appendChild(link)
  }catch(_e){}
}

export function renderLatexSoon(container, { timeout = 1200 } = {}){
  if (typeof window === 'undefined') return ()=>{}
  if (!container) return ()=>{}
  let cancelled = false
  const run = ()=>{
    if (cancelled) return
    try{ void renderLatex(container) }catch(_e){}
  }

  // Prefer idle time so first paint / interaction aren't blocked by typesetting.
  if (typeof window.requestIdleCallback === 'function'){
    const id = window.requestIdleCallback(run, { timeout })
    return ()=>{ cancelled = true; try{ window.cancelIdleCallback?.(id) }catch(_e){} }
  }
  const t = window.setTimeout(run, 0)
  return ()=>{ cancelled = true; window.clearTimeout(t) }
}

export function renderLatexWhenVisible(container, { rootMargin = '600px 0px', timeout = 1200 } = {}){
  if (typeof window === 'undefined') return ()=>{}
  if (!container) return ()=>{}

  // No IntersectionObserver support: fall back to soon/idle.
  if (typeof window.IntersectionObserver !== 'function'){
    return renderLatexSoon(container, { timeout })
  }

  let cancelSoon = ()=>{}
  let done = false
  const obs = new window.IntersectionObserver((entries)=>{
    if (done) return
    for (const e of entries || []){
      if (e && (e.isIntersecting || (e.intersectionRatio && e.intersectionRatio > 0))){
        done = true
        try{ obs.disconnect() }catch(_e){}
        cancelSoon = renderLatexSoon(container, { timeout })
        return
      }
    }
  }, { root: null, rootMargin, threshold: 0.01 })

  try{ obs.observe(container) }catch(_e){
    // If observation fails, just run soon.
    cancelSoon = renderLatexSoon(container, { timeout })
  }

  return ()=>{
    try{ obs.disconnect() }catch(_e){}
    try{ cancelSoon() }catch(_e){}
  }
}

export async function renderLatex(container){
  // Only load expensive runtimes if the container appears to contain LaTeX/TikZ.
  if (!_looksLikeLatexOrTikz(container)) return

  // Ensure MathJax runs first so inline math is converted, then invoke TikzJax.
  try{
    await _ensureMathJaxRuntime()
    // In MathJax v3, `window.MathJax` is first a config object, then the library replaces/augments it.
    // If we call typesetPromise too early, it will crash with "typesetPromise is not a function".
    if (window.MathJax?.startup?.promise) {
      await window.MathJax.startup.promise
    }
    if (typeof window.MathJax?.typesetPromise === 'function') {
      await window.MathJax.typesetPromise([container])
    } else if (typeof window.MathJax?.typeset === 'function') {
      window.MathJax.typeset([container])
    }
  }catch(_e){
    // Best-effort: ignore MathJax errors so they don't break the page.
  }

  async function ensureTikzRuntime(){
    // Load our vendored TikZJax v1 bundle on demand. It runs as an IIFE on script execution and
    // exposes window.TikzJax.processAll(container) / window.TikzJax.process(script). Its TeX format
    // (.gz) and engine (.wasm) are fetched from the site root, and the hashes the bundle requests
    // (3f69….wasm / b565….gz) match the files vendored under app/public/. (The older
    // /vendor/tikz/tikzjax.js bundle requested different hashes that were never vendored, which is
    // why TikZ failed to render everywhere.)
    if (typeof window.TikzJax?.processAll === 'function' || typeof window.TikzJax?.process === 'function'){
      return
    }
    if (window.__ensureTikzRuntimePromise) return window.__ensureTikzRuntimePromise
    window.__ensureTikzRuntimePromise = new Promise((resolve)=>{
      try{
        const existing = document.querySelector('script[data-quantara-tikz="vendor"]')
        if (existing) { resolve(); return }
        const s = document.createElement('script')
        s.src = '/vendor/tikz/tikzjax.v1.js'
        s.async = true
        s.dataset.quantaraTikz = 'vendor'
        s.onload = ()=>resolve()
        s.onerror = ()=>resolve()
        document.head.appendChild(s)
      }catch(_e){
        resolve()
      }
    })
    return window.__ensureTikzRuntimePromise
  }

  // Only load the TikZ runtime + fonts if there are TikZ blocks present.
  const hasTikz = !!container?.querySelector?.('script[type="text/tikz"]')
  if (!hasTikz) return

  await _ensureTikzFonts()
  await ensureTikzRuntime()

  // The vendored renderer keeps a single in-memory TeX instance (shared module state), so two
  // renders running at once would clobber each other's memory. Serialize every render through one
  // global queue. Within a container, processAll already renders its scripts sequentially.
  const processTikz = async ()=>{
    const scripts = Array.from(container.querySelectorAll?.('script[type="text/tikz"]') || [])
    if (!scripts.length) return
    try{
      if (typeof window.TikzJax?.processAll === 'function'){
        await window.TikzJax.processAll(container)
      } else if (typeof window.TikzJax?.process === 'function'){
        for (const s of scripts){
          try{ await window.TikzJax.process(s) }catch(_e){}
        }
      }
    }catch(_e){
      // Best-effort: never let a TikZ failure break the rest of the page.
    }
  }

  // .then(fn, fn) keeps the chain alive even if a prior render rejected.
  const queue = (window.__tikzRenderQueue || Promise.resolve()).then(processTikz, processTikz)
  window.__tikzRenderQueue = queue
  await queue
}
