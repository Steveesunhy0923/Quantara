export function extractFirstUrl(text){
  if (!text) return ''
  const m = String(text).match(/https?:\/\/[^\s]+/i)
  return m ? m[0] : ''
}


