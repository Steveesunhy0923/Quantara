import { getCallable } from './callable.js'

export async function adminDeletePost(postId, reason = ''){
  const fn = getCallable('adminDeletePost')
  return await fn({ postId, reason })
}

export async function adminDeleteComment(commentId, reason = ''){
  const fn = getCallable('adminDeleteComment')
  return await fn({ commentId, reason })
}

export async function adminBanUser(uid, durationMs, reason = ''){
  const fn = getCallable('adminBanUser')
  return await fn({ uid, durationMs, reason })
}


