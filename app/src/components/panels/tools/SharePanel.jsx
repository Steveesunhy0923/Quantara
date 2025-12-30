import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../../../lib/firebase.js'
import { usePanels } from '../PanelsContext.jsx'
import { ensureDmChatWith, sendPostMessage, sendWikiMessage } from '../../../lib/chat.js'
import GroupAvatar from '../../chat/GroupAvatar.jsx'
import { formatFirebaseError } from '../../../lib/errors.js'
import { DEFAULT_AVATAR_URL } from '../../../lib/placeholders.js'

async function getUserBrief(uid){
  const s = await getDoc(doc(db, 'users', uid))
  const d = s.data() || {}
  return {
    uid,
    username: d.username || 'anon',
    photoURL: d.photoURL || null,
  }
}

export default function SharePanel({ kind, postId, postTitle, wikiSlug, wikiTitle }){
  const { openPanel } = usePanels()
  const [user, setUser] = useState(auth.currentUser)
  const [search, setSearch] = useState('')
  const [friendships, setFriendships] = useState([])
  const [groupChats, setGroupChats] = useState([])
  const [profiles, setProfiles] = useState({}) // uid -> { username, photoURL }
  const [err, setErr] = useState('')
  const [sendingUid, setSendingUid] = useState(null)
  const [sendingChatId, setSendingChatId] = useState(null)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, setUser)
    return ()=>unsub()
  },[])

  useEffect(()=>{
    setErr('')
    setFriendships([])
    if (!user) return
    const q = query(collection(db, 'friendships'), where('users', 'array-contains', user.uid), limit(250))
    const unsub = onSnapshot(q, (qs)=>{
      setFriendships(qs.docs.map(d=>({ id: d.id, ...d.data() })))
    }, (e)=>setErr(formatFirebaseError(e)))
    return ()=>unsub()
  },[user])

  useEffect(()=>{
    setErr('')
    setGroupChats([])
    if (!user) return
    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(80)
    )
    const unsub = onSnapshot(q, (qs)=>{
      const rows = qs.docs.map(d=>({ id:d.id, ...d.data() }))
        .filter(c=>String(c.kind || '') === 'group')
      setGroupChats(rows)
    }, (_e)=>{})
    return ()=>unsub()
  },[user])

  const friendUids = useMemo(()=>{
    if (!user) return []
    return friendships
      .filter(f=>f.status === 'accepted')
      .map(f=>{
        const other = (Array.isArray(f.users) ? f.users : []).find(u=>u && u !== user.uid)
        return other || null
      })
      .filter(Boolean)
  },[friendships, user])

  useEffect(()=>{
    if (!user) { setProfiles({}); return }
    const missing = friendUids.filter(uid=>uid && !profiles[uid])
    if (!missing.length) return
    ;(async()=>{
      const updates = {}
      await Promise.all(missing.map(async (uid)=>{
        try{
          const p = await getUserBrief(uid)
          updates[uid] = { username: p.username, photoURL: p.photoURL }
        }catch(_e){
          updates[uid] = { username:'anon', photoURL:null }
        }
      }))
      setProfiles(prev=>({ ...prev, ...updates }))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[friendUids, user])

  const friends = useMemo(()=>{
    const s = String(search || '').trim().toLowerCase()
    const rows = friendUids.map(uid=>({ uid, ...(profiles[uid] || {}) }))
      .sort((a,b)=>String(a.username||'').localeCompare(String(b.username||'')))
    if (!s) return rows
    return rows.filter(r=>String(r.username||'').toLowerCase().includes(s))
  },[friendUids, profiles, search])

  const groups = useMemo(()=>{
    const s = String(search || '').trim().toLowerCase()
    const rows = groupChats.map(c=>({
      ...c,
      title: String(c.title || 'Group chat'),
    }))
    if (!s) return rows
    return rows.filter(g=>String(g.title||'').toLowerCase().includes(s))
  },[groupChats, search])

  async function sendTo(uid){
    if (!user) return
    setErr('')
    setSendingUid(uid)
    try{
      const cid = await ensureDmChatWith(uid)
      if (kind === 'post'){
        await sendPostMessage(cid, { postId, postTitle: postTitle || 'Untitled' })
      } else if (kind === 'wiki'){
        await sendWikiMessage(cid, { wikiSlug, wikiTitle: wikiTitle || wikiSlug })
      } else {
        throw new Error('Unknown share kind')
      }

      const title = `Chat: ${profiles[uid]?.username || 'anon'}`
      openPanel('chat', { title, props:{ mode:'thread', chatId: cid, otherUid: uid }, replaceAll:true, pushHistory:true })
    }catch(e){
      setErr(formatFirebaseError(e))
    }finally{
      setSendingUid(null)
    }
  }

  async function sendToGroup(chatId){
    if (!user) return
    setErr('')
    setSendingChatId(chatId)
    try{
      if (kind === 'post'){
        await sendPostMessage(chatId, { postId, postTitle: postTitle || 'Untitled' })
      } else if (kind === 'wiki'){
        await sendWikiMessage(chatId, { wikiSlug, wikiTitle: wikiTitle || wikiSlug })
      } else {
        throw new Error('Unknown share kind')
      }
      const chat = groups.find(g=>g.id === chatId)
      openPanel('chat', { title: chat?.title || 'Group chat', props:{ mode:'thread', chatId }, replaceAll:true, pushHistory:true })
    }catch(e){
      setErr(formatFirebaseError(e))
    }finally{
      setSendingChatId(null)
    }
  }

  if (!user){
    return <div style={{padding:12}}>Login to send.</div>
  }

  const header =
    kind === 'post' ? `Send post: ${postTitle || postId || ''}`
    : kind === 'wiki' ? `Send wiki: ${wikiTitle || wikiSlug || ''}`
    : 'Send'

  return (
    <div style={{padding:12}}>
      <div style={{fontWeight:900, marginBottom:8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{header}</div>
      {!!err && <div style={{marginBottom:8, color:'#b00020'}}>{err}</div>}

      <input
        value={search}
        onChange={(e)=>setSearch(e.target.value)}
        placeholder="Search friends / groups…"
        style={{width:'100%', marginBottom:10}}
      />

      <div style={{fontWeight:900, margin:'10px 0 6px'}}>Friends</div>
      {friends.length === 0 && <div style={{color:'#777'}}>No friends found.</div>}
      <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:12}}>
        {friends.map(f=>(
          <div key={f.uid} style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff'}}>
            <img src={f.photoURL || DEFAULT_AVATAR_URL} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
            <div style={{minWidth:0}}>
              <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{f.username || 'anon'}</div>
              <div style={{color:'#666', fontSize:'.85rem'}}>Friend</div>
            </div>
            <span style={{marginLeft:'auto'}} />
            <button type="button" onClick={()=>sendTo(f.uid)} disabled={sendingUid === f.uid}>
              {sendingUid === f.uid ? 'Sending…' : 'Send'}
            </button>
          </div>
        ))}
      </div>

      <div style={{fontWeight:900, margin:'10px 0 6px'}}>Group chats</div>
      {groups.length === 0 && <div style={{color:'#777'}}>No group chats found.</div>}
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {groups.map(g=>(
          <div key={g.id} style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff'}}>
            {g.photoURL ? (
              <img src={g.photoURL} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
            ) : (
              <GroupAvatar
                size={32}
                urls={(Array.isArray(g.participants) ? g.participants : []).filter(Boolean).slice(0,4).map(uid=>profiles[uid]?.photoURL || DEFAULT_AVATAR_URL)}
              />
            )}
            <div style={{minWidth:0}}>
              <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{g.title}</div>
              <div style={{color:'#666', fontSize:'.85rem'}}>{Array.isArray(g.participants) ? g.participants.length : 0} members</div>
            </div>
            <span style={{marginLeft:'auto'}} />
            <button type="button" onClick={()=>sendToGroup(g.id)} disabled={sendingChatId === g.id}>
              {sendingChatId === g.id ? 'Sending…' : 'Send'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}


