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

export async function renderLatex(container){
  // Ensure MathJax runs first so inline math is converted, then invoke TikzJax
  if (window.MathJax){
    // In MathJax v3, `window.MathJax` is first a config object, then the library replaces/augments it.
    // If we call typesetPromise too early, it will crash with "typesetPromise is not a function".
    try{
      if (window.MathJax?.startup?.promise) {
        await window.MathJax.startup.promise
      }
      if (typeof window.MathJax?.typesetPromise === 'function') {
        await window.MathJax.typesetPromise([container])
      } else if (typeof window.MathJax?.typeset === 'function') {
        window.MathJax.typeset([container])
      }
    }catch(_e){
      // If MathJax isn't ready yet, skip; next render will try again.
    }
  }

  async function ensureTikzRuntime(){
    // If the CDN (tikzjax.com) is blocked (common with adblock/privacy/CSP),
    // TikZ blocks will exist but window.TikzJax won't. In that case, load our
    // vendored bundle from /public/vendor/tikz/tikzjax.js as a fallback.
    if (window.TikzJax || typeof window.tikzLoad === 'function' || typeof window.process_tikz === 'function'){
      return
    }
    if (window.__ensureTikzRuntimePromise) return window.__ensureTikzRuntimePromise
    window.__ensureTikzRuntimePromise = new Promise((resolve)=>{
      try{
        const existing = document.querySelector('script[data-quantara-tikz="vendor"]')
        if (existing) { resolve(); return }
        const s = document.createElement('script')
        // Self-hosted TikZJax v1 bundle (and its wasm/data assets) live under /public.
        s.src = '/vendor/tikz/tikzjax.v1.js'
        s.async = true
        s.defer = true
        s.dataset.quantaraTikz = 'vendor'
        s.onload = ()=>{
          // TikZJax v1's upstream bundle hides its renderer behind `window.onload = async function(){...}`
          // (it doesn't export `window.TikzJax`). Capture it so our SPA can re-run it for newly
          // inserted <script type="text/tikz"> blocks.
          try{
            const fn = window.onload
            if (!window.__tikzjaxProcessAll && typeof fn === 'function'){
              const src = String(fn)
              if (src.includes('text/tikz') && (src.includes('getElementsByTagName') || src.includes('script'))){
                window.__tikzjaxProcessAll = fn
              }
            }
          }catch(_e){}
          resolve()
        }
        s.onerror = ()=>resolve()
        document.head.appendChild(s)
      }catch(_e){
        resolve()
      }
    })
    return window.__ensureTikzRuntimePromise
  }

  await ensureTikzRuntime()

  const TJ = window.TikzJax
  // TikZJax: ensure it's initialized (some builds expose tikzLoad()) and then process new scripts.
  try{
    if (typeof window.tikzLoad === 'function'){
      // Initialize once; concurrent calls share the same promise.
      if (!window.__tikzLoadPromise){
        window.__tikzLoadPromise = window.tikzLoad().catch(()=>null)
      }
      await window.__tikzLoadPromise
    }
  }catch(_e){}

  // Preferred path for our vendored legacy TikZJax build: it exposes window.process_tikz(element)
  // which converts a <script type="text/tikz">...</script> into an SVG container.
  try{
    if (typeof window.process_tikz === 'function' && container){
      const scripts = Array.from(container.querySelectorAll?.('script[type="text/tikz"]') || [])
      // Process sequentially (renderer is wasm-heavy and the legacy code expects a chain).
      for (const s of scripts){
        try{ await window.process_tikz(s) }catch(_e){}
      }
      return
    }
  }catch(_e){}

  // Fallback for official TikZJax v1: it doesn't expose a public API, but its internal pipeline
  // is attached to window.onload and scans the whole document for <script type="text/tikz"> nodes.
  try{
    // Prefer our patched v1 bundle which exposes a stable API:
    if (window.TikzJax && typeof window.TikzJax.processAll === 'function'){
      const hasTikz = !!container?.querySelector?.('script[type="text/tikz"]')
      if (hasTikz){
        const r = window.TikzJax.processAll(container)
        if (r && typeof r.then === 'function') await r
        return
      }
    }

    const runAll = window.__tikzjaxProcessAll
    const hasTikz = !!container?.querySelector?.('script[type="text/tikz"]')
    if (hasTikz && typeof runAll === 'function'){
      const r = runAll()
      if (r && typeof r.then === 'function') await r
      return
    }
  }catch(_e){}

  if (TJ){
    // TikZJax API differs across builds; support common entrypoints.
    try{
      if (typeof TJ.render === 'function'){
        const r = TJ.render(container)
        if (r && typeof r.then === 'function') await r
        return
      }
      if (typeof TJ.process === 'function'){
        // Some versions accept an element; others process the whole document.
        try{
          const r = TJ.process(container)
          if (r && typeof r.then === 'function') await r
        }catch(_e){
          const r2 = TJ.process()
          if (r2 && typeof r2.then === 'function') await r2
        }
        return
      }
      if (typeof TJ.typeset === 'function'){
        const r = TJ.typeset(container)
        if (r && typeof r.then === 'function') await r
      }
    }catch(_e){
      // Best-effort: ignore TikZ errors so they don't break MathJax rendering.
    }
  }
}
