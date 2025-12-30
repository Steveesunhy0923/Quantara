export function slugify(str){
  return encodeURIComponent(str.trim().toLowerCase().replace(/\s+/g,'-'))
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

  // Convert display TikZ blocks like \[ ... \begin{tikzpicture} ... \end{tikzpicture} ... \]
  src = src.replace(/\\\\\[\s*([\s\S]*?\\begin{tikzpicture}[\s\S]*?\\end{tikzpicture})\s*\\\\\]/g, (_m, tikz) => {
    return '<script type="text/tikz">\n' + tikz + '\n</script>'
  })

  // Also wrap bare tikzpicture environments that are not already inside a <script type="text/tikz">
  src = src.replace(/(?<!<script type="text\/tikz">)[\s\S]*?(\\begin{tikzpicture}[\s\S]*?\\end{tikzpicture})/g, (m) => {
    // if there is already a script tag inside this match, skip
    if (m.includes('<script type="text/tikz">')) return m
    const tikz = m.match(/(\\begin{tikzpicture}[\s\S]*?\\end{tikzpicture})/)
    if (!tikz) return m
    return m.replace(tikz[1], '<script type="text/tikz">\n'+tikz[1]+'\n</script>')
  })

  // Internal wiki links [[Target|Label]]
  src = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => {
    const slug = slugify(target)
    const text = label || target
    return '<a class="wiki-link" href="#'+slug+'">'+text+'</a>'
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

  // simple transforms
  src = src.replace(/\\textbf{([^}]+)}/g,'<strong>$1</strong>')
  src = src.replace(/\\begin{itemize}([\s\S]*?)\\end{itemize}/g, (_m, inner) => {
    const items = inner.split(/\\item/).filter(s=>s.trim())
    return '<ul>'+items.map(s=>'\n<li>'+s.trim()+'</li>').join('')+'\n</ul>'
  })

  return src
    .replace(/\\section\*?{([^}]+)}/g,'<h2>$1</h2>')
    .replace(/\\subsection\*?{([^}]+)}/g,'<h3>$1</h3>')
    .replace(/\\subsubsection\*?{([^}]+)}/g,'<h4>$1</h4>')
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
  if (window.TikzJax){
    window.TikzJax.render(container)
  }
}
