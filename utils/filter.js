function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff0-9a-z]/g, '')
}

function matchKeywords(text, keywords) {
  const source = normalizeForMatch(text)
  if (!source) return []
  const seen = new Set()
  return (keywords || []).filter((word) => {
    const key = normalizeForMatch(word)
    if (!key || seen.has(key) || !source.includes(key)) return false
    seen.add(key)
    return true
  })
}

module.exports = {
  normalizeForMatch,
  matchKeywords
}
