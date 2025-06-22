/*  latex-render.js  */
/* -------------------------------------------------- */
/* 1. helper ---------------------------------------- */
function slugify(str){
    return encodeURIComponent(str.trim().toLowerCase().replace(/\s+/g,'-'));
}

/* 2. transform raw article → safe HTML ------------- */
function latexMarkupToHTML(src){
    /* — convert display-math TikZ to <script type="text/tikz"> — */
    src = src.replace(
        /\\\\\[\s*([\s\S]*?\\begin{tikzpicture}[\s\S]*?\\end{tikzpicture})\s*\\\\\]/g,
        function (_match, tikz){
            return '<script type="text/tikz">\\n' + tikz + '\\n</script>';
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
        .replace(/\\\\(?=\\s|$)/g,'<br>');
}

/* 3. ask MathJax + TikZJax to typeset a container ---- */
function renderLatex(container){
    if (window.MathJax){
        MathJax.typesetPromise([container]).then(function(){
            if (window.TikzJax){ TikzJax.render(container); }
        });
    }
}

/* 4. expose helpers on the global object ------------- */
window.slugify          = slugify;
window.latexMarkupToHTML = latexMarkupToHTML;
window.renderLatex       = renderLatex;
/* -------------------------------------------------- */

