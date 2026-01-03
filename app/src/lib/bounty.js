import { getCallable } from './callable.js'

export async function bountySet(postId, amount){
  const fn = getCallable('bountySet')
  const res = await fn({ postId: String(postId || ''), amount: Number(amount || 0) })
  return res?.data || null
}

export async function bountyAward(postId, allocations){
  const fn = getCallable('bountyAward')
  const res = await fn({ postId: String(postId || ''), allocations: Array.isArray(allocations) ? allocations : [] })
  return res?.data || null
}


