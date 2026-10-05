function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function formatTime(ts) {
  const date = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  if (date.getFullYear() === now.getFullYear()) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function postDocId(item) {
  if (!item) return ''
  return String(item.id || item._id || '').trim()
}

function dedupePostsById(list) {
  const seen = new Set()
  const out = []
  ;(Array.isArray(list) ? list : []).forEach((item) => {
    const key = postDocId(item)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(item.id ? item : { ...item, id: key })
  })
  return out
}

function formatDateTime(ts) {
  const date = new Date(ts)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

module.exports = {
  formatTime,
  formatDateTime,
  uid,
  postDocId,
  dedupePostsById
}
