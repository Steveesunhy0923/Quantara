(function(){
  async function fetchManifest(){
    try{
      const res = await fetch('avatars/manifest.json', { cache:'no-cache' });
      if(!res.ok) throw new Error('manifest fetch failed');
      return (await res.json()).items||[];
    }catch(e){ return []; }
  }

  function solidSvgDataUrl(hex, size){
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><rect width='100%' height='100%' rx='${size/2}' ry='${size/2}' fill='${hex}'/></svg>`;
    return 'data:image/svg+xml;utf8,'+encodeURIComponent(svg);
  }

  function customSvgDataUrl(opts){
    const size = opts.size || 160;
    const r = size/2;
    const bg1 = opts.color1 || '#1e88e5';
    const bg2 = opts.color2 || '#43a047';
    const split = opts.split || 'none'; // none|h|v
    const symbol = opts.symbol || 'none'; // none|=|Δ|π|Σ|∞|∫
    const symbolColor = opts.symbolColor || '#ffffff';

    // background
    let bg = '';
    if (split === 'h') {
      bg = `<clipPath id='clip'><rect x='0' y='0' width='${size}' height='${size}' rx='${r}' ry='${r}'/></clipPath>
            <rect width='${size}' height='${size}' fill='${bg1}' clip-path='url(#clip)'/>
            <rect y='${r}' width='${size}' height='${r}' fill='${bg2}' clip-path='url(#clip)'/>`;
    } else if (split === 'v') {
      bg = `<clipPath id='clip'><rect x='0' y='0' width='${size}' height='${size}' rx='${r}' ry='${r}'/></clipPath>
            <rect width='${size}' height='${size}' fill='${bg1}' clip-path='url(#clip)'/>
            <rect x='${r}' width='${r}' height='${size}' fill='${bg2}' clip-path='url(#clip)'/>`;
    } else {
      bg = `<rect width='100%' height='100%' rx='${r}' ry='${r}' fill='${bg1}'/>`;
    }

    // symbol layer
    let sym = '';
    if (symbol && symbol !== 'none') {
      const fontSize = Math.round(size*0.55);
      sym = `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='${fontSize}' font-family='Segoe UI Symbol, Noto Sans Symbols, DejaVu Sans, Arial' fill='${symbolColor}'>${symbol}</text>`;
    }

    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${bg}${sym}</svg>`;
    return 'data:image/svg+xml;utf8,'+encodeURIComponent(svg);
  }

  async function createAvatarPicker(container, options){
    const { initialUrl, onChange } = options||{};

    container.classList.add('avatar-section');

    const row = document.createElement('div');
    row.className = 'avatar-row';
    container.appendChild(row);

    const preview = document.createElement('div');
    preview.className = 'avatar-preview';
    if (initialUrl) preview.style.backgroundImage = `url(${initialUrl})`;
    row.appendChild(preview);

    const controls = document.createElement('div');
    controls.className = 'avatar-controls';
    row.appendChild(controls);

    const h3 = document.createElement('h3');
    h3.textContent = 'Customize your avatar';
    controls.appendChild(h3);

    // State
    const state = {
      mode: 'custom',       // custom | gallery
      split: 'none',        // none|h|v
      color1: '#1e88e5',
      color2: '#43a047',
      symbol: 'none',
      symbolColor: '#ffffff',
    };

    function renderPreview(){
      let url;
      if (state.mode === 'gallery' && state.gallerySrc){
        url = state.gallerySrc;
      } else {
        url = customSvgDataUrl({ split: state.split, color1: state.color1, color2: state.color2, symbol: state.symbol, symbolColor: state.symbolColor, size:160 });
      }
      preview.style.backgroundImage = `url(${url})`;
      onChange && onChange(url, { kind: state.mode, split: state.split, color1: state.color1, color2: state.color2, symbol: state.symbol });
    }

    // Split controls
    const splitRow = document.createElement('div'); splitRow.className='control-row'; controls.appendChild(splitRow);
    const splitLabel = document.createElement('label'); splitLabel.textContent='Split style'; splitRow.appendChild(splitLabel);
    const splitSel = document.createElement('select');
    [['none','Solid'],['h','Horizontal half'],['v','Vertical half']].forEach(([val,txt])=>{
      const o=document.createElement('option'); o.value=val; o.textContent=txt; splitSel.appendChild(o);
    });
    splitSel.value = state.split;
    splitSel.onchange = ()=>{ state.split = splitSel.value; state.mode='custom'; renderPreview(); };
    splitRow.appendChild(splitSel);

    // Colors
    const c1Row=document.createElement('div'); c1Row.className='control-row'; controls.appendChild(c1Row);
    c1Row.appendChild(Object.assign(document.createElement('label'),{textContent:'Primary color'}));
    const c1 = document.createElement('input'); c1.type='color'; c1.value=state.color1; c1.className='color-input';
    const c1hex = document.createElement('input'); c1hex.type='text'; c1hex.value=state.color1; c1hex.size=8; c1hex.className='color-hex';
    c1.oninput = ()=>{ c1hex.value=c1.value; state.color1=c1.value; state.mode='custom'; renderPreview(); };
    c1hex.onchange= ()=>{ let v=c1hex.value.trim(); if(v[0]!=='#') v='#'+v; c1.value=v; state.color1=v; state.mode='custom'; renderPreview(); };
    c1Row.appendChild(c1); c1Row.appendChild(c1hex);

    const c2Row=document.createElement('div'); c2Row.className='control-row'; controls.appendChild(c2Row);
    c2Row.appendChild(Object.assign(document.createElement('label'),{textContent:'Secondary color'}));
    const c2 = document.createElement('input'); c2.type='color'; c2.value=state.color2; c2.className='color-input';
    const c2hex = document.createElement('input'); c2hex.type='text'; c2hex.value=state.color2; c2hex.size=8; c2hex.className='color-hex';
    c2.oninput = ()=>{ c2hex.value=c2.value; state.color2=c2.value; state.mode='custom'; renderPreview(); };
    c2hex.onchange= ()=>{ let v=c2hex.value.trim(); if(v[0]!=='#') v='#'+v; c2.value=v; state.color2=v; state.mode='custom'; renderPreview(); };
    c2Row.appendChild(c2); c2Row.appendChild(c2hex);

    const tip=document.createElement('div'); tip.className='small'; tip.textContent='Secondary color is used only for split styles.'; controls.appendChild(tip);

    // Symbol controls
    const symRow=document.createElement('div'); symRow.className='control-row'; controls.appendChild(symRow);
    symRow.appendChild(Object.assign(document.createElement('label'),{textContent:'Symbol'}));
    const symSel=document.createElement('select');
    ['none','=','Δ','π','Σ','∞','∫'].forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; symSel.appendChild(o); });
    symSel.value=state.symbol; symSel.onchange=()=>{ state.symbol=symSel.value; state.mode='custom'; renderPreview(); };
    const symColor=document.createElement('input'); symColor.type='color'; symColor.value=state.symbolColor; symColor.className='color-input';
    symColor.oninput=()=>{ state.symbolColor=symColor.value; state.mode='custom'; renderPreview(); };
    symRow.appendChild(symSel); symRow.appendChild(symColor);

    // Gallery section
    const gTitle = document.createElement('h3'); gTitle.textContent = 'Or pick from gallery'; controls.appendChild(gTitle);
    const gallery = document.createElement('div'); gallery.className = 'avatar-gallery'; controls.appendChild(gallery);

    const items = await fetchManifest();
    items.forEach(it=>{
      const tile = document.createElement('div');
      tile.className='avatar-tile';
      tile.style.backgroundImage = `url(${it.src})`;
      tile.title = it.name || it.id;
      tile.onclick = ()=>{
        state.mode='gallery'; state.gallerySrc = it.src;
        gallery.querySelectorAll('.avatar-tile').forEach(n=>n.classList.remove('selected'));
        tile.classList.add('selected');
        renderPreview();
      };
      if (initialUrl && initialUrl === it.src) tile.classList.add('selected');
      gallery.appendChild(tile);
    });

    // initial render
    if (initialUrl) {
      // If initial URL looks like our gallery item, default to gallery mode
      const match = items.find(i=>i.src===initialUrl);
      if (match) { state.mode='gallery'; state.gallerySrc = initialUrl; }
    }
    renderPreview();

    const hint = document.createElement('div');
    hint.className = 'avatar-hint';
    hint.textContent = 'Your selection is saved immediately.';
    controls.appendChild(hint);
  }

  window.AvatarPicker = { create: createAvatarPicker };
})();
