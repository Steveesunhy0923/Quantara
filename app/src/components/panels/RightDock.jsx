import { useEffect, useMemo, useRef, useState } from 'react'
import { usePanels } from './PanelsContext.jsx'
import CommentsPanel from './tools/CommentsPanel.jsx'
import PostPanel from './tools/PostPanel.jsx'
import StarsPanel from './tools/StarsPanel.jsx'
import ChatPanel from './tools/ChatPanel.jsx'
import SharePanel from './tools/SharePanel.jsx'
import GroupCreatePanel from './tools/GroupCreatePanel.jsx'
import GroupInvitePanel from './tools/GroupInvitePanel.jsx'
import GroupMembersPanel from './tools/GroupMembersPanel.jsx'

function PanelFrame({ title, onClose, canGoBack, onBack, children }){
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 10px',borderBottom:'1px solid #eee',background:'#fff'}}>
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          title={canGoBack ? 'Return' : 'No previous panel'}
          style={{opacity: canGoBack ? 1 : 0.35}}
        >
          ← Return
        </button>
        <div style={{fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{title}</div>
        <span style={{marginLeft:'auto'}} />
        <button type="button" onClick={onClose} aria-label="Close panel">✕</button>
      </div>
      <div style={{flex:1,overflow:'auto',minHeight:0,background:'#fff'}}>
        {children}
      </div>
    </div>
  )
}

function renderPanel(panel){
  if (panel.type === 'comments'){
    return <CommentsPanel {...panel.props} />
  }
  if (panel.type === 'post'){
    return <PostPanel {...panel.props} />
  }
  if (panel.type === 'stars'){
    return <StarsPanel {...panel.props} />
  }
  if (panel.type === 'chat'){
    return <ChatPanel {...panel.props} />
  }
  if (panel.type === 'share'){
    return <SharePanel {...panel.props} />
  }
  if (panel.type === 'groupCreate'){
    return <GroupCreatePanel {...panel.props} />
  }
  if (panel.type === 'groupInvite'){
    return <GroupInvitePanel {...panel.props} />
  }
  if (panel.type === 'groupMembers'){
    return <GroupMembersPanel {...panel.props} />
  }
  return <div style={{padding:12}}>Unknown panel: {panel.type}</div>
}

export default function RightDock(){
  const { panels, closePanel, isNarrow, canGoBack, goBack } = usePanels()
  const [dockWidthPct, setDockWidthPct] = useState(34) // percent of viewport width
  const [splitPct, setSplitPct] = useState(58) // when 2 panels (top panel height %)
  const dragRef = useRef({ mode:null, startX:0, startY:0, startDock:0, startSplit:0 })

  const hasDock = panels.length > 0 && !isNarrow

  useEffect(()=>{
    function onMove(e){
      if (!dragRef.current.mode) return
      const vw = Math.max(window.innerWidth, 1)
      if (dragRef.current.mode === 'dock'){
        const dx = e.clientX - dragRef.current.startX
        const next = dragRef.current.startDock - (dx / vw) * 100
        setDockWidthPct(Math.min(55, Math.max(22, next)))
      } else if (dragRef.current.mode === 'split'){
        // Vertical split: drag affects height of top panel.
        const dy = e.clientY - dragRef.current.startY
        const dockH = Math.max(window.innerHeight - 1, 1)
        const next = dragRef.current.startSplit + (dy / dockH) * 100
        setSplitPct(Math.min(78, Math.max(22, next)))
      }
    }
    function onUp(){
      dragRef.current.mode = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return ()=>{
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  },[dockWidthPct])

  const dockStyle = useMemo(()=>({
    width: hasDock ? `${dockWidthPct}vw` : 0,
    maxWidth: '55vw',
    minWidth: hasDock ? '320px' : 0,
    borderLeft: hasDock ? '1px solid #e5e5e5' : 'none',
    background:'#fff',
    display: hasDock ? 'flex' : 'none',
    position:'sticky',
    top: 'var(--topbar-h, 0px)',
    minHeight:0,
    height:'calc(100vh - var(--topbar-h, 0px))',
    maxHeight:'calc(100vh - var(--topbar-h, 0px))',
    alignSelf:'flex-start',
  }),[hasDock, dockWidthPct])

  if (!hasDock) return null

  if (panels.length === 1){
    const p = panels[0]
    return (
      <div style={dockStyle}>
        <div
          onMouseDown={(e)=>{
            dragRef.current = { mode:'dock', startX:e.clientX, startY:e.clientY, startDock:dockWidthPct, startSplit:splitPct }
          }}
          style={{position:'absolute',left:-5,top:0,bottom:0,width:10,cursor:'col-resize'}}
          title="Drag to resize"
        />
        <div style={{flex:1,minWidth:0}}>
          <PanelFrame title={p.title} onClose={()=>closePanel(p.id)} canGoBack={canGoBack} onBack={goBack}>
            {renderPanel(p)}
          </PanelFrame>
        </div>
      </div>
    )
  }

  const p0 = panels[0]
  const p1 = panels[1]
  return (
    <div style={dockStyle}>
      <div
        onMouseDown={(e)=>{
          dragRef.current = { mode:'dock', startX:e.clientX, startY:e.clientY, startDock:dockWidthPct, startSplit:splitPct }
        }}
        style={{position:'absolute',left:-5,top:0,bottom:0,width:10,cursor:'col-resize'}}
        title="Drag to resize"
      />
      <div style={{display:'flex', flexDirection:'column', flex:1, minWidth:0, minHeight:0}}>
        <div style={{flexBasis:`${splitPct}%`, minHeight:0}}>
          <PanelFrame title={p0.title} onClose={()=>closePanel(p0.id)} canGoBack={canGoBack} onBack={goBack}>
            {renderPanel(p0)}
          </PanelFrame>
        </div>
        <div
          onMouseDown={(e)=>{
            dragRef.current = { mode:'split', startX:e.clientX, startY:e.clientY, startDock:dockWidthPct, startSplit:splitPct }
          }}
          style={{height:8,cursor:'row-resize',background:'#f3f3f3',borderTop:'1px solid #e5e5e5',borderBottom:'1px solid #e5e5e5'}}
          title="Drag to resize (top/bottom)"
        />
        <div style={{flexBasis:`${100-splitPct}%`, minHeight:0}}>
          <PanelFrame title={p1.title} onClose={()=>closePanel(p1.id)} canGoBack={canGoBack} onBack={goBack}>
            {renderPanel(p1)}
          </PanelFrame>
        </div>
      </div>
    </div>
  )
}


