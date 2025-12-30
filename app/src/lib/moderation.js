import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase.js'

export async function adminDeletePost(postId, reason = ''){
  const fn = httpsCallable(functions, 'adminDeletePost')
  return await fn({ postId, reason })
}

export async function adminDeleteComment(commentId, reason = ''){
  const fn = httpsCallable(functions, 'adminDeleteComment')
  return await fn({ commentId, reason })
}

export async function adminBanUser(uid, durationMs, reason = ''){
  const fn = httpsCallable(functions, 'adminBanUser')
  return await fn({ uid, durationMs, reason })
}


