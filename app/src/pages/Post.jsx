import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { usePanels } from '../components/panels/PanelsContext.jsx'
import PostPanel from '../components/panels/tools/PostPanel.jsx'

export default function PostPage(){
  const { postId } = useParams()
  const { isNarrow, closeAll } = usePanels()

  // If user navigates to the dedicated post page, close any open side panels.
  useEffect(()=>{ closeAll() },[closeAll])

  if (isNarrow){
    return (
      <div style={{padding:16, maxWidth:700}}>
        <h2>Post view unavailable on small screens</h2>
        <p>This post detail view is designed for larger displays.</p>
      </div>
    )
  }

  return (
    <div style={{maxWidth:980, margin:'0 auto', padding:'16px 16px 80px'}}>
      <PostPanel postId={postId} />
    </div>
  )
}


