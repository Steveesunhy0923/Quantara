import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from './firebase.js'

export function dmChatId(a, b){
  const [x, y] = [String(a), String(b)].sort()
  return `dm_${x}_${y}`
}

export async function ensureDmChatWith(targetUid){
  const me = auth.currentUser?.uid
  if (!me) throw new Error('Login required')
  const cid = dmChatId(me, targetUid)
  const ref = doc(db, 'chats', cid)
  const snap = await getDoc(ref)
  if (!snap.exists()){
    await setDoc(ref, {
      kind: 'dm',
      participants: [me, targetUid],
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
      unreadCounts: {},
    }, { merge: false })
  }
  return cid
}

export async function sendTextMessage(chatId, text, { replyTo = null } = {}){
  const me = auth.currentUser?.uid
  if (!me) throw new Error('Login required')
  const t = String(text || '').trim()
  if (!t) return
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    kind: 'text',
    senderUid: me,
    text: t,
    ...(replyTo ? { replyTo } : {}),
    createdAt: serverTimestamp(),
  })
}

export async function sendPostMessage(chatId, { postId, postTitle }, { replyTo = null } = {}){
  const me = auth.currentUser?.uid
  if (!me) throw new Error('Login required')
  if (!postId) throw new Error('Missing postId')
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    kind: 'post',
    senderUid: me,
    postId: String(postId),
    postTitle: String(postTitle || '').slice(0, 120),
    ...(replyTo ? { replyTo } : {}),
    createdAt: serverTimestamp(),
  })
}

export async function sendWikiMessage(chatId, { wikiSlug, wikiTitle }, { replyTo = null } = {}){
  const me = auth.currentUser?.uid
  if (!me) throw new Error('Login required')
  if (!wikiSlug) throw new Error('Missing wikiSlug')
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    kind: 'wiki',
    senderUid: me,
    wikiSlug: String(wikiSlug),
    wikiTitle: String(wikiTitle || '').slice(0, 120),
    ...(replyTo ? { replyTo } : {}),
    createdAt: serverTimestamp(),
  })
}

export async function sendImageMessage(chatId, { imageURL }, { replyTo = null } = {}){
  const me = auth.currentUser?.uid
  if (!me) throw new Error('Login required')
  if (!imageURL) throw new Error('Missing imageURL')
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    kind: 'image',
    senderUid: me,
    imageURL: String(imageURL),
    ...(replyTo ? { replyTo } : {}),
    createdAt: serverTimestamp(),
  })
}

export async function uploadChatImage(chatId, file){
  const me = auth.currentUser?.uid
  if (!me) throw new Error('Login required')
  if (!chatId) throw new Error('Missing chatId')
  if (!file) throw new Error('Missing file')
  const name = String(file.name || 'image')
  const ext = (name.includes('.') ? name.split('.').pop() : 'png').toLowerCase().slice(0, 8)
  const id = (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()))
  const path = `chatMedia/${me}/${chatId}/${id}.${ext}`
  const r = storageRef(storage, path)
  await uploadBytes(r, file, { contentType: file.type || undefined })
  return await getDownloadURL(r)
}

export async function uploadGroupPhoto(chatId, file){
  const me = auth.currentUser?.uid
  if (!me) throw new Error('Login required')
  if (!chatId) throw new Error('Missing chatId')
  if (!file) throw new Error('Missing file')
  const name = String(file.name || 'image')
  const ext = (name.includes('.') ? name.split('.').pop() : 'png').toLowerCase().slice(0, 8)
  const path = `chatMedia/${me}/${chatId}/groupPhoto.${ext}`
  const r = storageRef(storage, path)
  await uploadBytes(r, file, { contentType: file.type || undefined })
  return await getDownloadURL(r)
}


