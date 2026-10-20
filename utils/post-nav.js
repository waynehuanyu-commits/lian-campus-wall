function normalizePostId(value) {
  let id = String(value == null ? '' : value).trim()
  if (!id) return ''
  try {
    id = decodeURIComponent(id)
  } catch (err) {
    // keep raw
  }
  id = String(id || '').trim()
  if (!id || id === 'undefined' || id === 'null') return ''
  return id
}

function parseClipboardPost(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const wall = raw.match(/wall-detail(?:\/wall-detail)?\?[^#\s]*\bid=([^&\s#]+)/i)
  const forum = raw.match(/forum-detail(?:\/forum-detail)?\?[^#\s]*\bid=([^&\s#]+)/i)
  let type = ''
  let id = ''
  if (wall) {
    type = 'wall'
    id = wall[1]
  } else if (forum) {
    type = 'forum'
    id = forum[1]
  } else {
    const queryId = raw.match(/(?:^|[?&\s])id=([^&\s#]+)/i)
    if (queryId) id = queryId[1]
  }
  id = normalizePostId(id)
  if (!id && /^[fw]_[0-9a-z]{6,32}$/i.test(raw)) id = raw
  if (!id || /^\d{3,4}$/.test(id)) return null
  if (!type) type = /^w_/i.test(id) ? 'wall' : 'forum'
  return { type, id }
}

function readClipboardText() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getClipboardData !== 'function') {
      reject(new Error('clipboard unavailable'))
      return
    }
    wx.getClipboardData({
      success: (res) => resolve(String((res && res.data) || '')),
      fail: (err) => reject(err || new Error('clipboard fail'))
    })
  })
}

function openPostDetail(type, id) {
  const postId = normalizePostId(id)
  if (!postId) {
    wx.showToast({ title: '缺少帖子 id', icon: 'none' })
    return false
  }
  const q = encodeURIComponent(postId)
  const contentType = type === 'wall' ? 'wall' : 'forum'
  const url = contentType === 'wall'
    ? `/pages/wall-detail/wall-detail?id=${q}`
    : `/pages/forum-detail/forum-detail?id=${q}`
  wx.navigateTo({ url })
  return true
}

module.exports = {
  normalizePostId,
  openPostDetail,
  parseClipboardPost,
  readClipboardText
}
