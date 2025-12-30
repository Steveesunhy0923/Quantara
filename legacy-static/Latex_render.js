/*  latex-render.js  */
/* -------------------------------------------------- */
/* 1. helper ---------------------------------------- */
function slugify(str){
    return encodeURIComponent(str.trim().toLowerCase().replace(/\s+/g,'-'));
}

/* 2. transform raw article → safe HTML ------------- */
function latexMarkupToHTML(src){
    /* TikZ blocks are no longer handled client-side. Authors should embed exported SVGs directly. */

    /* helpers */
    function escapeHtml(s){
        return String(s)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;')
            .replace(/'/g,'&#39;');
    }
    function normalizeImageUrl(url){
        url = String(url || '').trim();
        // allow https/http or site-relative URLs; block javascript: and other schemes
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith('/')) return url;
        return '';
    }

    /* Image macro: \imgcap{URL}{Caption text}
       - URL must be https://, http://, or /relative/path
       - Caption should not contain unmatched braces
    */
    src = src.replace(/\\imgcap\{([^}]+)\}\{([^}]+)\}/g, function(_m, rawUrl, rawCaption){
        var url = normalizeImageUrl(rawUrl);
        if(!url){
            // leave a visible placeholder rather than injecting a broken/unsafe tag
            return '<!-- invalid image url -->';
        }
        var cap = escapeHtml(rawCaption);
        url = escapeHtml(url);
        return (
            '<figure class="wiki-figure" style="margin:1rem 0;text-align:center;">' +
              '<img src="' + url + '" alt="' + cap + '" loading="lazy" decoding="async" ' +
                   'style="max-width:100%;height:auto;border:1px solid #ddd;background:#fff;border-radius:6px;">' +
              '<figcaption style="margin-top:.5rem;color:#444;">' + cap + '</figcaption>' +
            '</figure>'
        );
    });

    /* internal wiki links */
    src = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function(_m, target, label){
        var slug = slugify(target);
        var text = label || target;
        return '<a class="wiki-link" href="#'+slug+'">'+text+'</a>';
    });

    /* bold */
    src = src.replace(/\\textbf{([^}]+)}/g,'<strong>$1</strong>');

    /* itemize */
    src = src.replace(/\\begin{itemize}([\s\S]*?)\\end{itemize}/g, function(_m, inner){
        var items = inner.split(/\\item/).filter(function(s){return s.trim();});
        return '<ul>'+items.map(function(s){return '<li>'+s.trim()+'</li>';}).join('')+'</ul>';
    });

    /* headings, line-breaks */
    return src
        .replace(/\\section\*?{([^}]+)}/g,'<h2>$1</h2>')
        .replace(/\\subsection\*?{([^}]+)}/g,'<h3>$1</h3>')
        .replace(/\\subsubsection\*?{([^}]+)}/g,'<h4>$1</h4>')
        .replace(/\\break/g,'<br>')
        .replace(/\\\\(?=\s|$)/g,'<br>');
}

/* 3. ask MathJax + TikZJax to typeset a container ---- */
function renderLatex(container){
    if (window.MathJax){
        MathJax.typesetPromise([container]);
    }
}

/* 4. expose helpers on the global object ------------- */
window.slugify           = slugify;
window.latexMarkupToHTML = latexMarkupToHTML;
window.renderLatex       = renderLatex;
/* -------------------------------------------------- */

