import { useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { callCallable } from '../../../lib/callable.js'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../../../lib/firebase.js'
import { resolveUidByUsername } from '../../../lib/usernames.js'
import { usePanels } from '../PanelsContext.jsx'
import { useNavigate } from 'react-router-dom'
import { sendImageMessage, sendPostMessage, sendTextMessage, sendWikiMessage, uploadChatImage, uploadGroupPhoto } from '../../../lib/chat.js'
import { callCallable } from '../../../lib/callable.js'
import GroupAvatar from '../../chat/GroupAvatar.jsx'

function dmChatId(a, b){
  const [x, y] = [String(a), String(b)].sort()
  return `dm_${x}_${y}`
}

function badgeText(n){
  const v = Number(n || 0)
  if (v <= 0) return ''
  return v > 9 ? '9+' : String(v)
}

async function getUserBrief(uid){
  const s = await getDoc(doc(db, 'users', uid))
  const d = s.data() || {}
  return {
    uid,
    username: d.username || 'anon',
    photoURL: d.photoURL || null,
  }
}

export default function ChatPanel({ mode = 'home', chatId = null, otherUid = null }){
  const { openPanel } = usePanels()
  const navigate = useNavigate()
  const [user, setUser] = useState(auth.currentUser)

  // Home state
  const [search, setSearch] = useState('')
  const [addUsername, setAddUsername] = useState('')
  const [actionErr, setActionErr] = useState('')
  const [userPreview, setUserPreview] = useState([]) // [{ uid, username, photoURL }]
  const [previewErr, setPreviewErr] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [searchPreview, setSearchPreview] = useState([]) // [{ uid, username, photoURL }]
  const [searchPreviewErr, setSearchPreviewErr] = useState('')
  const [searchPreviewLoading, setSearchPreviewLoading] = useState(false)

  const [friendships, setFriendships] = useState([]) // raw friendship docs
  const [chats, setChats] = useState([])
  const [profiles, setProfiles] = useState({}) // uid -> { username, photoURL }

  // Thread state
  const [threadChat, setThreadChat] = useState(null)
  const [messages, setMessages] = useState([])
  const [msgText, setMsgText] = useState('')
  const endRef = useRef(null)
  const fileInputRef = useRef(null)
  const [replyTo, setReplyTo] = useState(null) // { messageId, senderUid, kind, preview }
  const [pendingImage, setPendingImage] = useState(null) // { file, url, name }
  const [friendMenuUid, setFriendMenuUid] = useState(null)
  const friendMenuRef = useRef(null)
  const groupPhotoInputRef = useRef(null)
  const [groupPhotoBusy, setGroupPhotoBusy] = useState(false)

  // Collapsible sections + view-all toggles
  const [showFriends, setShowFriends] = useState(true)
  const [showGroups, setShowGroups] = useState(true)
  const [showRecent, setShowRecent] = useState(true)
  const [allFriends, setAllFriends] = useState(false)
  const [allGroups, setAllGroups] = useState(false)
  const [allRecent, setAllRecent] = useState(false)

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, (u)=>setUser(u))
    return ()=>unsub()
  },[])

  // Close friend menu on outside click / Escape
  useEffect(()=>{
    if (!friendMenuUid) return
    function onDown(e){
      const el = friendMenuRef.current
      if (!el) return
      if (!el.contains(e.target)) setFriendMenuUid(null)
    }
    function onKey(e){
      if (e.key === 'Escape') setFriendMenuUid(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return ()=>{
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  },[friendMenuUid])

  // Global search typeahead (for finding users fast from the top search bar)
  useEffect(()=>{
    setSearchPreviewErr('')
    if (!user){
      setSearchPreview([])
      setSearchPreviewLoading(false)
      return
    }
    const prefix = String(search || '').trim().toLowerCase()
    if (prefix.length < 2){
      setSearchPreview([])
      setSearchPreviewLoading(false)
      return
    }
    if (!/^[a-z0-9._-]+$/.test(prefix)){
      setSearchPreview([])
      setSearchPreviewLoading(false)
      return
    }

    let cancelled = false
    setSearchPreviewLoading(true)
    const t = setTimeout(async ()=>{
      try{
        const unameQ = query(
          collection(db, 'usernames'),
          orderBy(documentId()),
          where(documentId(), '>=', prefix),
          where(documentId(), '<=', prefix + '\uf8ff'),
          limit(8)
        )
        const qs = await getDocs(unameQ)
        const hits = qs.docs.map(d=>({ username: d.id, uid: d.data()?.uid || null })).filter(x=>!!x.uid)

        const profs = await Promise.all(hits.map(async (h)=>{
          try{
            const s = await getDoc(doc(db, 'users', h.uid))
            const data = s.data() || {}
            return {
              uid: h.uid,
              username: data.username || h.username,
              photoURL: data.photoURL || null,
            }
          }catch(_e){
            return { uid: h.uid, username: h.username, photoURL: null }
          }
        }))

        const filtered = profs
          .filter(p=>p.uid && p.uid !== user.uid)
          .slice(0, 8)

        if (!cancelled) setSearchPreview(filtered)
      }catch(e){
        if (!cancelled) setSearchPreviewErr(e?.message || String(e))
      }finally{
        if (!cancelled) setSearchPreviewLoading(false)
      }
    }, 160)

    return ()=>{
      cancelled = true
      clearTimeout(t)
    }
  },[search, user])

  // Username typeahead (uses usernames/{usernameLower} docs + fetches /users/{uid} for avatars)
  useEffect(()=>{
    setPreviewErr('')
    if (!user){
      setUserPreview([])
      setPreviewLoading(false)
      return
    }
    const prefix = String(addUsername || '').trim().toLowerCase()
    if (prefix.length < 2){
      setUserPreview([])
      setPreviewLoading(false)
      return
    }
    // Basic input filter to avoid weird queries
    if (!/^[a-z0-9_]+$/.test(prefix)){
      setUserPreview([])
      setPreviewLoading(false)
      return
    }

    let cancelled = false
    setPreviewLoading(true)
    const t = setTimeout(async ()=>{
      try{
        const unameQ = query(
          collection(db, 'usernames'),
          orderBy(documentId()),
          where(documentId(), '>=', prefix),
          where(documentId(), '<=', prefix + '\uf8ff'),
          limit(8)
        )
        const qs = await getDocs(unameQ)
        const hits = qs.docs.map(d=>({ username: d.id, uid: d.data()?.uid || null })).filter(x=>!!x.uid)

        const profs = await Promise.all(hits.map(async (h)=>{
          try{
            const s = await getDoc(doc(db, 'users', h.uid))
            const data = s.data() || {}
            return {
              uid: h.uid,
              username: data.username || h.username,
              photoURL: data.photoURL || null,
            }
          }catch(_e){
            return { uid: h.uid, username: h.username, photoURL: null }
          }
        }))

        const filtered = profs
          .filter(p=>p.uid && p.uid !== user.uid)
          .slice(0, 8)

        if (!cancelled) setUserPreview(filtered)
      }catch(e){
        if (!cancelled) setPreviewErr(e?.message || String(e))
      }finally{
        if (!cancelled) setPreviewLoading(false)
      }
    }, 180)

    return ()=>{
      cancelled = true
      clearTimeout(t)
    }
  },[addUsername, user])

  // Friendships (accepted + pending) for the current user
  useEffect(()=>{
    setFriendships([])
    setActionErr('')
    if (!user) return

    const q = query(
      collection(db, 'friendships'),
      where('users', 'array-contains', user.uid),
      limit(250)
    )
    const unsub = onSnapshot(q, (qs)=>{
      setFriendships(qs.docs.map(d=>({ id: d.id, ...d.data() })))
    }, (e)=>setActionErr(e?.message || String(e)))
    return ()=>unsub()
  },[user])

  // Chats list for the current user
  useEffect(()=>{
    setChats([])
    setActionErr('')
    if (!user) return

    // Prefer ordering by lastMessageAt; fall back if an index is missing.
    const ordered = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(80)
    )
    const fallback = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid),
      limit(80)
    )

    let unsub = onSnapshot(
      ordered,
      (qs)=>setChats(qs.docs.map(d=>({ id: d.id, ...d.data() }))),
      (err)=>{
        const msg = err?.message || String(err)
        setActionErr(msg)
        unsub()
        unsub = onSnapshot(
          fallback,
          (qs)=>setChats(qs.docs.map(d=>({ id: d.id, ...d.data() }))),
          (err2)=>setActionErr(err2?.message || String(err2))
        )
      }
    )
    return ()=>unsub()
  },[user])

  // Load profiles we need (friends + chat counterparts)
  useEffect(()=>{
    if (!user) { setProfiles({}); return }
    const need = new Set()

    for (const f of friendships){
      const users = Array.isArray(f.users) ? f.users : []
      const other = users.find(u=>u && u !== user.uid)
      if (other) need.add(other)
    }
    for (const c of chats){
      const ps = Array.isArray(c.participants) ? c.participants : []
      for (const p of ps){
        if (p && p !== user.uid) need.add(p)
      }
    }
    if (otherUid && otherUid !== user.uid) need.add(otherUid)

    const missing = Array.from(need).filter(uid=>!profiles[uid])
    if (!missing.length) return

    ;(async()=>{
      const updates = {}
      await Promise.all(missing.map(async (uid)=>{
        try{
          const d = await getUserBrief(uid)
          updates[uid] = { username: d.username, photoURL: d.photoURL }
        }catch(_e){
          updates[uid] = { username:'anon', photoURL:null }
        }
      }))
      setProfiles(prev=>({ ...prev, ...updates }))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[friendships, chats, user, otherUid])

  const friends = useMemo(()=>{
    if (!user) return []
    return friendships
      .filter(f=>f.status === 'accepted')
      .map(f=>{
        const other = (Array.isArray(f.users) ? f.users : []).find(u=>u && u !== user.uid)
        return { friendshipId: f.id, uid: other }
      })
      .filter(x=>!!x.uid)
      .map(x=>({ ...x, ...(profiles[x.uid] || {}) }))
      .sort((a,b)=>String(a.username||'').localeCompare(String(b.username||'')))
  },[friendships, profiles, user])

  const incomingRequests = useMemo(()=>{
    if (!user) return []
    return friendships
      .filter(f=>f.status === 'pending' && f.requestedBy && f.requestedBy !== user.uid)
      .map(f=>{
        const other = (Array.isArray(f.users) ? f.users : []).find(u=>u && u !== user.uid)
        return { id: f.id, uid: other, requestedAt: f.requestedAt || null }
      })
      .filter(x=>!!x.uid)
      .map(x=>({ ...x, ...(profiles[x.uid] || {}) }))
  },[friendships, profiles, user])

  const outgoingRequests = useMemo(()=>{
    if (!user) return []
    return friendships
      .filter(f=>f.status === 'pending' && f.requestedBy === user.uid)
      .map(f=>{
        const other = (Array.isArray(f.users) ? f.users : []).find(u=>u && u !== user.uid)
        return { id: f.id, uid: other, requestedAt: f.requestedAt || null }
      })
      .filter(x=>!!x.uid)
      .map(x=>({ ...x, ...(profiles[x.uid] || {}) }))
  },[friendships, profiles, user])

  const filteredFriends = useMemo(()=>{
    const s = String(search || '').trim().toLowerCase()
    if (!s) return friends
    return friends.filter(f=>String(f.username||'').toLowerCase().includes(s))
  },[friends, search])

  const filteredChats = useMemo(()=>{
    if (!user) return []
    const s = String(search || '').trim().toLowerCase()
    const rows = chats.map(c=>{
      const others = (Array.isArray(c.participants) ? c.participants : []).filter(u=>u && u !== user.uid)
      const other = others[0] || null
      const kind = String(c.lastMessageKind || '')
      const last =
        String(c.lastMessage || '').trim()
        || (kind === 'image' ? '📷 Photo' : '')
        || (kind === 'post' ? '📌 Post' : '')
        || (kind === 'wiki' ? '📚 Wiki' : '')
        || 'No messages yet'
      return {
        ...c,
        otherUid: other,
        otherUsername: other ? (profiles[other]?.username || 'anon') : 'group',
        otherPhotoURL: other ? (profiles[other]?.photoURL || null) : null,
        unread: Number(c.unreadCounts?.[user.uid] || 0),
        _lastMessageText: last,
      }
    })
    // Always sort client-side by lastMessageAt desc so the list matches "last message sent".
    rows.sort((a,b)=>{
      const am = a.lastMessageAt?.toMillis ? a.lastMessageAt.toMillis() : 0
      const bm = b.lastMessageAt?.toMillis ? b.lastMessageAt.toMillis() : 0
      return bm - am
    })
    if (!s) return rows
    return rows.filter(r=>{
      if (String(r.otherUsername || '').toLowerCase().includes(s)) return true
      if (String(r._lastMessageText || '').toLowerCase().includes(s)) return true
      return false
    })
  },[chats, profiles, search, user])

  const groupChats = useMemo(()=>{
    // Group chats: chats where kind=='group'
    const rows = filteredChats
      .filter(c=>String(c.kind || '') === 'group')
      .map(c=>({
        ...c,
        groupTitle: String(c.title || c.name || 'Group chat'),
      }))
    rows.sort((a,b)=>{
      const am = a.lastMessageAt?.toMillis ? a.lastMessageAt.toMillis() : 0
      const bm = b.lastMessageAt?.toMillis ? b.lastMessageAt.toMillis() : 0
      return bm - am
    })
    return rows
  },[filteredChats])

  const dmChats = useMemo(()=>filteredChats.filter(c=>String(c.kind || 'dm') !== 'group'), [filteredChats])

  async function ensureDmChatWith(targetUid){
    if (!user) throw new Error('Login required')
    const cid = dmChatId(user.uid, targetUid)
    const ref = doc(db, 'chats', cid)
    const snap = await getDoc(ref)
    if (!snap.exists()){
      await setDoc(ref, {
        kind: 'dm',
        participants: [user.uid, targetUid],
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        unreadCounts: {},
      }, { merge: false })
    }
    return cid
  }

  async function openThread(targetUid){
    setActionErr('')
    try{
      const cid = await ensureDmChatWith(targetUid)
      const title = `Chat: ${profiles[targetUid]?.username || 'anon'}`
      openPanel('chat', {
        title,
        props: { mode:'thread', chatId: cid, otherUid: targetUid },
        replaceAll: false,
        pushHistory: true,
      })
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function onAddFriend(){
    setActionErr('')
    if (!user) { setActionErr('Login required'); return }
    const name = addUsername.trim()
    if (!name) return
    try{
      const uid2 = await resolveUidByUsername(name)
      if (!uid2) throw new Error('Username not found')
      if (uid2 === user.uid) throw new Error("You can't friend yourself")

      const [a,b] = [user.uid, uid2].sort()
      const fid = `${a}_${b}`
      const ref = doc(db, 'friendships', fid)
      const snap = await getDoc(ref)
      if (snap.exists()){
        const d = snap.data() || {}
        if (d.status === 'accepted') throw new Error('You are already friends')
        if (d.status === 'pending'){
          if (d.requestedBy === user.uid) throw new Error('Friend request already sent')
          throw new Error('They already sent you a request — accept it below')
        }
        throw new Error('Friendship already exists')
      }
      await setDoc(ref, {
        users: [user.uid, uid2],
        status: 'pending',
        requestedBy: user.uid,
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setAddUsername('')
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function onMessageUsername(){
    setActionErr('')
    if (!user) { setActionErr('Login required'); return }
    const name = addUsername.trim()
    if (!name) return
    try{
      const uid2 = await resolveUidByUsername(name)
      if (!uid2) throw new Error('Username not found')
      if (uid2 === user.uid) throw new Error("You can't message yourself")
      setAddUsername('')
      await openThread(uid2)
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function acceptRequest(friendshipId){
    setActionErr('')
    if (!user) return
    try{
      await updateDoc(doc(db, 'friendships', friendshipId), {
        status: 'accepted',
        acceptedBy: user.uid,
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function declineRequest(friendshipId){
    setActionErr('')
    if (!user) return
    try{
      await deleteDoc(doc(db, 'friendships', friendshipId))
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function cancelRequest(friendshipId){
    // same as decline (delete the pending doc)
    return await declineRequest(friendshipId)
  }

  // Thread: subscribe to chat + messages
  useEffect(()=>{
    setThreadChat(null)
    setMessages([])
    if (!user || mode !== 'thread' || !chatId) return

    const chatRef = doc(db, 'chats', chatId)
    const unsubChat = onSnapshot(chatRef, (s)=>{
      setThreadChat(s.exists() ? ({ id: s.id, ...s.data() }) : null)
    }, (_e)=>{})

    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(200))
    const unsubMsg = onSnapshot(q, (qs)=>{
      setMessages(qs.docs.map(d=>({ id: d.id, ...d.data() })))
    }, (_e)=>{})

    // Mark as read (best-effort via callable function)
    try{
      callCallable('chatMarkRead', { chatId }).catch(()=>{})
    }catch(_e){}

    return ()=>{
      unsubChat()
      unsubMsg()
    }
  },[chatId, mode, user])

  useEffect(()=>{
    if (mode !== 'thread') return
    // Scroll to bottom as new messages arrive.
    endRef.current?.scrollIntoView({ block:'end' })
  },[messages, mode])

  async function sendMessage(){
    setActionErr('')
    if (!user) { setActionErr('Login required'); return }
    if (!chatId) return
    const text = msgText.trim()
    if (!text) return
    try{
      // Slash commands for references:
      // - /wiki <slug>
      // - /post <postId>
      if (/^\/wiki\s+/i.test(text)){
        const slug = text.replace(/^\/wiki\s+/i, '').trim()
        if (!slug) throw new Error('Usage: /wiki <slug>')
        await sendWikiMessage(chatId, { wikiSlug: slug, wikiTitle: slug }, { replyTo })
      } else if (/^\/post\s+/i.test(text)){
        const postId = text.replace(/^\/post\s+/i, '').trim()
        if (!postId) throw new Error('Usage: /post <postId>')
        await sendPostMessage(chatId, { postId, postTitle: postId }, { replyTo })
      } else {
        await sendTextMessage(chatId, text, { replyTo })
      }
      setMsgText('')
      setReplyTo(null)
      try{
        callCallable('chatMarkRead', { chatId }).catch(()=>{})
      }catch(_e){}
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  async function onPickImage(e){
    setActionErr('')
    if (!user) { setActionErr('Login required'); return }
    if (!chatId) return
    const f = e.target.files?.[0]
    if (!f) return
    try{
      // Show a local preview first; upload only when user confirms send.
      if (pendingImage?.url){
        try{ URL.revokeObjectURL(pendingImage.url) }catch(_e){}
      }
      const localUrl = URL.createObjectURL(f)
      setPendingImage({ file: f, url: localUrl, name: f.name || 'image' })
    }catch(err){
      setActionErr(err?.message || String(err))
    }finally{
      // allow re-picking same file
      e.target.value = ''
    }
  }

  async function sendPendingImage(){
    setActionErr('')
    if (!user) { setActionErr('Login required'); return }
    if (!chatId) return
    if (!pendingImage?.file) return
    try{
      const url = await uploadChatImage(chatId, pendingImage.file)
      await sendImageMessage(chatId, { imageURL: url }, { replyTo })
      setReplyTo(null)
      try{
        callCallable('chatMarkRead', { chatId }).catch(()=>{})
      }catch(_e){}
      try{ URL.revokeObjectURL(pendingImage.url) }catch(_e){}
      setPendingImage(null)
    }catch(err){
      setActionErr(err?.message || String(err))
    }
  }

  function cancelPendingImage(){
    if (pendingImage?.url){
      try{ URL.revokeObjectURL(pendingImage.url) }catch(_e){}
    }
    setPendingImage(null)
  }

  async function forwardMessage(m){
    setActionErr('')
    if (!user) { setActionErr('Login required'); return }
    const uname = window.prompt('Forward to username (letters/numbers/_):')
    if (!uname) return
    try{
      const uid2 = await resolveUidByUsername(uname)
      if (!uid2) throw new Error('Username not found')
      if (uid2 === user.uid) throw new Error("Can't forward to yourself")
      const cid = await ensureDmChatWith(uid2)
      const kind = m?.kind || 'text'
      const base = {
        kind,
        senderUid: user.uid,
        createdAt: serverTimestamp(),
        forwardedFrom: {
          chatId,
          messageId: m?.id || null,
          senderUid: m?.senderUid || null,
        },
      }
      if (kind === 'image'){
        await addDoc(collection(db, 'chats', cid, 'messages'), { ...base, imageURL: String(m?.imageURL || '') })
      } else if (kind === 'post'){
        await addDoc(collection(db, 'chats', cid, 'messages'), { ...base, postId: String(m?.postId || ''), postTitle: String(m?.postTitle || '') })
      } else if (kind === 'wiki'){
        await addDoc(collection(db, 'chats', cid, 'messages'), { ...base, wikiSlug: String(m?.wikiSlug || ''), wikiTitle: String(m?.wikiTitle || '') })
      } else {
        await addDoc(collection(db, 'chats', cid, 'messages'), { ...base, text: String(m?.text || '') })
      }
    }catch(e){
      setActionErr(e?.message || String(e))
    }
  }

  if (!user){
    return <div style={{padding:12}}>Login to use chat.</div>
  }

  if (mode === 'thread' && chatId){
    const isGroup = String(threadChat?.kind || '') === 'group'
    const other = (!isGroup) ? (otherUid || (Array.isArray(threadChat?.participants) ? threadChat.participants.find(u=>u && u !== user.uid) : null)) : null
    const otherName = isGroup ? (threadChat?.title || 'Group chat') : (other ? (profiles[other]?.username || 'anon') : 'chat')
    const lastMine = [...messages].reverse().find(m=>m.senderUid === user.uid) || null
    const otherLastRead = other ? threadChat?.lastReadAt?.[other] : null
    const otherLastReadMs = otherLastRead?.toMillis ? otherLastRead.toMillis() : null
    const canSetGroupPhoto = isGroup && !!user && (threadChat?.createdBy === user.uid || !!threadChat?.admins?.[user.uid])
    const collageUrls = isGroup
      ? (Array.isArray(threadChat?.participants) ? threadChat.participants : [])
        .filter(Boolean)
        .slice(0, 4)
        .map(uid=>profiles[uid]?.photoURL || 'https://via.placeholder.com/36')
      : []

    async function onPickGroupPhoto(e){
      const f = e.target.files?.[0]
      if (!f) return
      setActionErr('')
      setGroupPhotoBusy(true)
      try{
        const url = await uploadGroupPhoto(chatId, f)
        await callCallable('groupSetPhoto', { chatId, photoURL: url })
      }catch(err){
        setActionErr(err?.message || String(err))
      }finally{
        setGroupPhotoBusy(false)
        e.target.value = ''
      }
    }

    return (
      <div style={{padding:12, height:'100%', minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden'}}>
        {!!actionErr && <div style={{marginBottom:8, color:'#b00020'}}>{actionErr}</div>}

        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}>
          {isGroup ? (
            threadChat?.photoURL ? (
              <img src={threadChat.photoURL} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
            ) : (
              <GroupAvatar urls={collageUrls} size={32} />
            )
          ) : (
            <img src={other ? (profiles[other]?.photoURL || 'https://via.placeholder.com/32') : 'https://via.placeholder.com/32'} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
          )}
          <div style={{fontWeight:900}}>{otherName}</div>
          {isGroup && (
            <span style={{color:'#666', fontSize:'.9rem'}}>
              {(Array.isArray(threadChat?.participants) ? threadChat.participants.length : 0)} members
            </span>
          )}
          <span style={{marginLeft:'auto', color:'#666', fontSize:'.9rem'}}>
            Unread: {Number(threadChat?.unreadCounts?.[user.uid] || 0)}
          </span>
          {isGroup && (
            <>
              <input
                ref={groupPhotoInputRef}
                type="file"
                accept="image/*"
                style={{display:'none'}}
                onChange={onPickGroupPhoto}
              />
              {canSetGroupPhoto && (
                <button type="button" onClick={()=>groupPhotoInputRef.current?.click()} disabled={groupPhotoBusy} title="Set group photo">
                  {groupPhotoBusy ? 'Setting…' : 'Set photo'}
                </button>
              )}
              <button type="button" onClick={()=>openPanel('groupInvite', { title:'Invite', props:{ chatId }, replaceAll:true, pushHistory:true })}>Invite</button>
              <button type="button" onClick={()=>openPanel('groupMembers', { title:'Members', props:{ chatId }, replaceAll:true, pushHistory:true })}>Members</button>
            </>
          )}
        </div>

        <div style={{flex:1, minHeight:0, overflow:'auto', border:'1px solid #eee', borderRadius:10, padding:10, background:'#fafafa'}}>
          {messages.length === 0 && <div style={{color:'#777'}}>No messages yet.</div>}
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {messages.map(m=>{
              const mine = m.senderUid === user.uid
              const kind = m.kind || 'text'
              const isLastMine = lastMine && m.id === lastMine.id
              const createdMs = m.createdAt?.toMillis ? m.createdAt.toMillis() : null
              const read = !!(mine && isLastMine && other && otherLastReadMs != null && createdMs != null && otherLastReadMs >= createdMs)
              return (
                <div key={m.id} style={{display:'flex', justifyContent: mine ? 'flex-end' : 'flex-start'}}>
                  <div style={{
                    maxWidth:'85%',
                    background: mine ? '#111827' : '#fff',
                    color: mine ? '#fff' : '#111',
                    border:'1px solid #e5e7eb',
                    borderRadius:12,
                    padding:'8px 10px',
                    position:'relative',
                    whiteSpace:'pre-wrap',
                    wordBreak:'break-word',
                  }}>
                    {!!m.replyTo?.messageId && (
                      <div style={{
                        marginBottom:6,
                        padding:'6px 8px',
                        borderRadius:10,
                        background: mine ? 'rgba(255,255,255,.10)' : '#f3f4f6',
                        border: mine ? '1px solid rgba(255,255,255,.18)' : '1px solid #e5e7eb',
                        fontSize:'.85rem',
                        opacity: .95,
                      }}>
                        Replying to: {m.replyTo.preview || m.replyTo.kind || 'message'}
                      </div>
                    )}

                    {kind === 'text' && (
                      <div style={{fontSize:'.95rem'}}>{m.text}</div>
                    )}
                    {kind === 'image' && (
                      <a href={m.imageURL} target="_blank" rel="noreferrer" style={{display:'block', textDecoration:'none'}}>
                        <img src={m.imageURL} alt="" style={{maxWidth:'100%', borderRadius:10, border: mine ? '1px solid rgba(255,255,255,.15)' : '1px solid #e5e7eb'}} />
                      </a>
                    )}
                    {kind === 'post' && (
                      <div style={{display:'flex', flexDirection:'column', gap:6}}>
                        <div style={{fontWeight:900}}>📌 Community post</div>
                        <div style={{opacity:.9}}>{m.postTitle || m.postId}</div>
                        <button
                          type="button"
                          onClick={()=>{
                            // Open the post alongside chat (2-panel dock) instead of replacing chat.
                            openPanel('post', { title: m.postTitle || 'Post', props: { postId: m.postId } })
                          }}
                          style={{alignSelf:'flex-start'}}
                        >
                          Open post
                        </button>
                      </div>
                    )}
                    {kind === 'wiki' && (
                      <div style={{display:'flex', flexDirection:'column', gap:6}}>
                        <div style={{fontWeight:900}}>📚 Wiki page</div>
                        <div style={{opacity:.9}}>{m.wikiTitle || m.wikiSlug}</div>
                        <button
                          type="button"
                          onClick={()=>{
                            navigate(`/wiki/${m.wikiSlug}`)
                          }}
                          style={{alignSelf:'flex-start'}}
                        >
                          Open wiki
                        </button>
                      </div>
                    )}

                    <div style={{marginTop:6, display:'flex', gap:8, alignItems:'center', fontSize:'.8rem', opacity:.8}}>
                      <span>{m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString() : ''}</span>
                      {mine && isLastMine && !isGroup && (
                        <span style={{opacity:.9}}>{read ? 'Read' : 'Sent'}</span>
                      )}
                      <span style={{marginLeft:'auto'}} />
                      <button
                        type="button"
                        onClick={()=>{
                          setReplyTo({
                            messageId: m.id,
                            senderUid: m.senderUid || null,
                            kind,
                            preview:
                              kind === 'text' ? String(m.text || '').slice(0, 80)
                              : kind === 'image' ? 'Photo'
                              : kind === 'post' ? `Post: ${String(m.postTitle || m.postId || '').slice(0, 80)}`
                              : kind === 'wiki' ? `Wiki: ${String(m.wikiTitle || m.wikiSlug || '').slice(0, 80)}`
                              : 'Message'
                          })
                        }}
                        title="Reply"
                        style={{border:'none',background:'transparent',cursor:'pointer',color: mine ? '#fff' : '#111'}}
                      >
                        ↩
                      </button>
                      <button type="button" onClick={()=>forwardMessage(m)} title="Forward" style={{border:'none',background:'transparent',cursor:'pointer',color: mine ? '#fff' : '#111'}}>
                        ↪
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
        </div>

        {!!replyTo && (
          <div style={{marginTop:10, padding:'8px 10px', border:'1px solid #eee', borderRadius:10, background:'#fff', display:'flex', alignItems:'center', gap:10}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:900, fontSize:'.9rem'}}>Replying</div>
              <div style={{color:'#666', fontSize:'.85rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {replyTo.preview || 'Message'}
              </div>
            </div>
            <span style={{marginLeft:'auto'}} />
            <button type="button" onClick={()=>setReplyTo(null)} title="Cancel reply">✕</button>
          </div>
        )}

        {!!pendingImage && (
          <div style={{marginTop:10, padding:'8px 10px', border:'1px solid #eee', borderRadius:10, background:'#fff', display:'flex', alignItems:'center', gap:10}}>
            <img
              src={pendingImage.url}
              alt=""
              style={{width:44, height:44, borderRadius:10, objectFit:'cover', border:'1px solid #ddd'}}
            />
            <div style={{minWidth:0}}>
              <div style={{fontWeight:900, fontSize:'.9rem'}}>Photo ready</div>
              <div style={{color:'#666', fontSize:'.85rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {pendingImage.name}
              </div>
            </div>
            <span style={{marginLeft:'auto'}} />
            <button type="button" onClick={cancelPendingImage} title="Discard">Discard</button>
            <button type="button" onClick={sendPendingImage} title="Send photo">Send</button>
          </div>
        )}

        <div style={{display:'flex', gap:8, marginTop:10, paddingTop:2}}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{display:'none'}}
            onChange={onPickImage}
          />
          <button type="button" onClick={()=>fileInputRef.current?.click()} title="Pick a photo">📷</button>
          <input
            value={msgText}
            onChange={e=>setMsgText(e.target.value)}
            placeholder="Type a message…"
            style={{flex:1}}
            onKeyDown={(e)=>{ if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMessage() } }}
          />
          <button type="button" onClick={sendMessage}>Send</button>
        </div>
      </div>
    )
  }

  // Home view
  return (
    <div style={{padding:12}}>
      {!!actionErr && <div style={{marginBottom:8, color:'#b00020'}}>{actionErr}</div>}

      <div style={{display:'flex', gap:8, marginBottom:10}}>
        <div style={{flex:1, position:'relative'}}>
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="Search friends/chats/users…"
            style={{width:'100%'}}
          />
          {(searchPreviewLoading || searchPreviewErr || searchPreview.length > 0) && (
            <div style={{
              position:'absolute',
              top:'calc(100% + 6px)',
              left:0,
              right:0,
              border:'1px solid #e5e5e5',
              borderRadius:10,
              background:'#fff',
              boxShadow:'0 14px 28px rgba(0,0,0,.10)',
              padding:8,
              zIndex: 6,
            }}>
              <div style={{fontWeight:900, marginBottom:6}}>Users</div>
              {searchPreviewLoading && <div style={{color:'#666', fontSize:'.9rem'}}>Searching…</div>}
              {!!searchPreviewErr && <div style={{color:'#b00020', fontSize:'.9rem'}}>{searchPreviewErr}</div>}
              {!searchPreviewLoading && !searchPreviewErr && searchPreview.length === 0 && (
                <div style={{color:'#666', fontSize:'.9rem'}}>No users found.</div>
              )}
              {searchPreview.length > 0 && (
                <div style={{display:'flex', flexDirection:'column', gap:6}}>
                  {searchPreview.map(p=>(
                    <div key={p.uid} style={{display:'flex', alignItems:'center', gap:10, padding:'6px 6px', borderRadius:8}}>
                      <img
                        src={p.photoURL || 'https://via.placeholder.com/28'}
                        alt=""
                        style={{width:28,height:28,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}}
                      />
                      <div style={{fontWeight:900}}>{p.username || 'anon'}</div>
                      <span style={{marginLeft:'auto'}} />
                      <button type="button" onClick={async ()=>{
                        await openThread(p.uid)
                      }}>
                        Message
                      </button>
                      <button type="button" onClick={async ()=>{
                        setAddUsername(p.username || '')
                        await onAddFriend()
                      }}>
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{display:'flex', gap:8, marginBottom:12}}>
        <div style={{flex:1, position:'relative'}}>
          <input
            value={addUsername}
            onChange={e=>setAddUsername(e.target.value)}
            placeholder="Username…"
            style={{width:'100%'}}
          />
          {(previewLoading || previewErr || userPreview.length > 0) && (
            <div style={{
              position:'absolute',
              top:'calc(100% + 6px)',
              left:0,
              right:0,
              border:'1px solid #e5e5e5',
              borderRadius:10,
              background:'#fff',
              boxShadow:'0 14px 28px rgba(0,0,0,.10)',
              padding:8,
              zIndex: 5,
            }}>
              {previewLoading && <div style={{color:'#666', fontSize:'.9rem'}}>Searching…</div>}
              {!!previewErr && <div style={{color:'#b00020', fontSize:'.9rem'}}>{previewErr}</div>}
              {!previewLoading && !previewErr && userPreview.length === 0 && (
                <div style={{color:'#666', fontSize:'.9rem'}}>No users found.</div>
              )}
              {userPreview.length > 0 && (
                <div style={{display:'flex', flexDirection:'column', gap:6}}>
                  {userPreview.map(p=>(
                    <div key={p.uid} style={{display:'flex', alignItems:'center', gap:10, padding:'6px 6px', borderRadius:8}}>
                      <img
                        src={p.photoURL || 'https://via.placeholder.com/28'}
                        alt=""
                        style={{width:28,height:28,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}}
                      />
                      <div style={{fontWeight:900}}>{p.username || 'anon'}</div>
                      <span style={{marginLeft:'auto'}} />
                      <button type="button" onClick={async ()=>{
                        setAddUsername(p.username || '')
                        await openThread(p.uid)
                      }}>
                        Message
                      </button>
                      <button type="button" onClick={async ()=>{
                        setAddUsername(p.username || '')
                        await onAddFriend()
                      }}>
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button type="button" onClick={onAddFriend} title="Send friend request">Add</button>
        <button type="button" onClick={onMessageUsername} title="Message by username">Message</button>
      </div>

      {(incomingRequests.length > 0 || outgoingRequests.length > 0) && (
        <div style={{marginBottom:14}}>
          <div style={{fontWeight:900, marginBottom:6}}>Friend requests</div>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {incomingRequests.map(r=>(
              <div key={r.id} style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff'}}>
                <img src={r.photoURL || 'https://via.placeholder.com/28'} alt="" style={{width:28,height:28,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{r.username || 'anon'}</div>
                  <div style={{color:'#666', fontSize:'.85rem'}}>Friend request</div>
                </div>
                <span style={{marginLeft:'auto'}} />
                <button type="button" onClick={()=>acceptRequest(r.id)}>Accept</button>
                <button type="button" onClick={()=>declineRequest(r.id)}>Decline</button>
              </div>
            ))}
            {outgoingRequests.map(r=>(
              <div key={r.id} style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff'}}>
                <img src={r.photoURL || 'https://via.placeholder.com/28'} alt="" style={{width:28,height:28,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{r.username || 'anon'}</div>
                  <div style={{color:'#666', fontSize:'.85rem'}}>Friend request sent</div>
                </div>
                <span style={{marginLeft:'auto'}} />
                <button type="button" onClick={()=>cancelRequest(r.id)} title="Cancel request">Cancel</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
        <button type="button" onClick={()=>setShowFriends(v=>!v)} style={{border:'none',background:'transparent',cursor:'pointer',fontWeight:900}}>
          {showFriends ? '▾' : '▸'} Friends
        </button>
        <span style={{marginLeft:'auto'}} />
        {/* Create group chat icon under Friends heading */}
        <button type="button" onClick={()=>openPanel('groupCreate', { title:'Create group', props:{}, replaceAll:true, pushHistory:true })} title="Create group chat">
          👥＋
        </button>
      </div>
      {showFriends && filteredFriends.length === 0 && <div style={{color:'#777', marginBottom:12}}>No friends yet.</div>}
      {showFriends && (
      <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:10}}>
        {(allFriends ? filteredFriends : filteredFriends.slice(0,10)).map(f=>(
          <div
            key={f.uid}
            style={{display:'flex', alignItems:'stretch', border:'1px solid #eee', borderRadius:10, background:'#fff'}}
          >
            <button
              type="button"
              onClick={()=>openThread(f.uid)}
              style={{
                flex:1,
                display:'flex',
                alignItems:'center',
                gap:10,
                padding:'8px 10px',
                border:'none',
                background:'transparent',
                cursor:'pointer',
                textAlign:'left',
                minWidth:0,
              }}
            >
              <div style={{position:'relative'}}>
                <img src={f.photoURL || 'https://via.placeholder.com/36'} alt="" style={{width:36,height:36,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
                {/* Unread badge shown once the DM chat exists */}
                {(() => {
                  const cid = dmChatId(user.uid, f.uid)
                  const c = chats.find(x=>x.id === cid)
                  const t = badgeText(c?.unreadCounts?.[user.uid] || 0)
                  return t ? (
                    <span style={{
                      position:'absolute',
                      right:-4,
                      top:-4,
                      minWidth:18,
                      height:18,
                      padding:'0 5px',
                      borderRadius:999,
                      background:'#e11d48',
                      color:'#fff',
                      fontSize:12,
                      fontWeight:900,
                      display:'inline-flex',
                      alignItems:'center',
                      justifyContent:'center',
                      border:'2px solid #fff',
                      lineHeight:1
                    }}>{t}</span>
                  ) : null
                })()}
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{f.username || 'anon'}</div>
                <div style={{color:'#666', fontSize:'.85rem'}}>Click to chat</div>
              </div>
            </button>

            <div style={{position:'relative', padding:'8px 8px', display:'flex', alignItems:'center'}}>
              <button
                type="button"
                aria-label="Friend actions"
                aria-haspopup="menu"
                aria-expanded={friendMenuUid === f.uid}
                onClick={()=>{
                  setFriendMenuUid(prev => (prev === f.uid ? null : f.uid))
                }}
                style={{
                  width:32,
                  height:32,
                  borderRadius:8,
                  border:'1px solid #e5e5e5',
                  background:'#fff',
                  cursor:'pointer',
                  fontWeight:900,
                }}
                title="More"
              >
                ⋯
              </button>

              {friendMenuUid === f.uid && (
                <div
                  ref={(el)=>{ friendMenuRef.current = el }}
                  role="menu"
                  style={{
                    position:'absolute',
                    right:8,
                    top:'calc(100% - 2px)',
                    minWidth:180,
                    border:'1px solid #e5e5e5',
                    borderRadius:10,
                    background:'#fff',
                    boxShadow:'0 14px 28px rgba(0,0,0,.10)',
                    padding:6,
                    zIndex: 8,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={()=>{
                      setFriendMenuUid(null)
                      openThread(f.uid)
                    }}
                    style={{width:'100%', textAlign:'left', padding:'8px 10px', border:'none', background:'transparent', cursor:'pointer', borderRadius:8}}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={()=>{
                      setFriendMenuUid(null)
                      navigate(`/profile/${f.uid}`)
                    }}
                    style={{width:'100%', textAlign:'left', padding:'8px 10px', border:'none', background:'transparent', cursor:'pointer', borderRadius:8}}
                  >
                    View profile
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
      {showFriends && filteredFriends.length > 10 && (
        <button type="button" onClick={()=>setAllFriends(v=>!v)} style={{marginBottom:14}}>
          {allFriends ? 'View less' : 'View all'}
        </button>
      )}

      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
        <button type="button" onClick={()=>setShowGroups(v=>!v)} style={{border:'none',background:'transparent',cursor:'pointer',fontWeight:900}}>
          {showGroups ? '▾' : '▸'} Group chats
        </button>
        <span style={{marginLeft:'auto', color:'#666', fontSize:'.9rem'}}>{groupChats.length}</span>
      </div>
      {showGroups && groupChats.length === 0 && <div style={{color:'#777', marginBottom:12}}>No group chats yet.</div>}
      {showGroups && (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:10}}>
          {(allGroups ? groupChats : groupChats.slice(0,10)).map(c=>(
            <button
              key={c.id}
              type="button"
              onClick={()=>openPanel('chat', { title: c.groupTitle || 'Group chat', props:{ mode:'thread', chatId: c.id }, replaceAll:false, pushHistory:true })}
              style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff', cursor:'pointer', textAlign:'left'}}
            >
              {c.photoURL ? (
                <img src={c.photoURL} alt="" style={{width:36,height:36,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
              ) : (
                <GroupAvatar
                  size={36}
                  urls={(Array.isArray(c.participants) ? c.participants : [])
                    .filter(Boolean)
                    .slice(0,4)
                    .map(uid=>profiles[uid]?.photoURL || 'https://via.placeholder.com/36')}
                />
              )}
              <div style={{minWidth:0, flex:1}}>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.groupTitle}</div>
                  <span style={{marginLeft:'auto', color:'#666', fontSize:'.85rem'}}>{c.lastMessageAt?.toDate ? c.lastMessageAt.toDate().toLocaleDateString() : ''}</span>
                </div>
                <div style={{color:'#666', fontSize:'.85rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {c._lastMessageText}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {showGroups && groupChats.length > 10 && (
        <button type="button" onClick={()=>setAllGroups(v=>!v)} style={{marginBottom:14}}>
          {allGroups ? 'View less' : 'View all'}
        </button>
      )}

      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
        <button type="button" onClick={()=>setShowRecent(v=>!v)} style={{border:'none',background:'transparent',cursor:'pointer',fontWeight:900}}>
          {showRecent ? '▾' : '▸'} Recent chats
        </button>
        <span style={{marginLeft:'auto', color:'#666', fontSize:'.9rem'}}>{dmChats.length}</span>
      </div>
      {showRecent && dmChats.length === 0 && <div style={{color:'#777'}}>No chats yet.</div>}
      {showRecent && (
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {(allRecent ? dmChats : dmChats.slice(0,10)).map(c=>(
          <button
            key={c.id}
            type="button"
            onClick={()=>c.otherUid ? openThread(c.otherUid) : openPanel('chat', { title:'Chat', props:{ mode:'thread', chatId: c.id }, pushHistory:true })}
            style={{display:'flex', alignItems:'center', gap:10, border:'1px solid #eee', borderRadius:10, padding:'8px 10px', background:'#fff', cursor:'pointer', textAlign:'left'}}
          >
            <div style={{position:'relative'}}>
              <img src={c.otherPhotoURL || 'https://via.placeholder.com/36'} alt="" style={{width:36,height:36,borderRadius:'50%',objectFit:'cover',border:'1px solid #ddd'}} />
              {!!badgeText(c.unread) && (
                <span style={{
                  position:'absolute',
                  right:-4,
                  top:-4,
                  minWidth:18,
                  height:18,
                  padding:'0 5px',
                  borderRadius:999,
                  background:'#e11d48',
                  color:'#fff',
                  fontSize:12,
                  fontWeight:900,
                  display:'inline-flex',
                  alignItems:'center',
                  justifyContent:'center',
                  border:'2px solid #fff',
                  lineHeight:1
                }}>{badgeText(c.unread)}</span>
              )}
            </div>
            <div style={{minWidth:0, flex:1}}>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div style={{fontWeight:900, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.otherUsername}</div>
                <span style={{marginLeft:'auto', color:'#666', fontSize:'.85rem'}}>{c.lastMessageAt?.toDate ? c.lastMessageAt.toDate().toLocaleDateString() : ''}</span>
              </div>
              <div style={{color:'#666', fontSize:'.85rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {c._lastMessageText}
              </div>
            </div>
          </button>
        ))}
      </div>
      )}
      {showRecent && dmChats.length > 10 && (
        <button type="button" onClick={()=>setAllRecent(v=>!v)} style={{marginTop:10}}>
          {allRecent ? 'View less' : 'View all'}
        </button>
      )}
    </div>
  )
}


