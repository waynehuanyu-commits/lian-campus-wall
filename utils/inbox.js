const repo = require('./repo')

const MESSAGE_TAB_INDEX = 1
const empty = { unreadLikes: 0, unreadComments: 0, unreadMessages: 0 }

let cache = { ...empty, at: 0, userId: '' }
let inflight = null

function currentUserId() {
  try {
    const app = getApp()
    return (app && app.globalData && app.globalData.user && app.globalData.user.id) || ''
  } catch (err) {
    return ''
  }
}

function totalOf(badges) {
  return (Number(badges.unreadLikes) || 0)
    + (Number(badges.unreadComments) || 0)
    + (Number(badges.unreadMessages) || 0)
}

function applyTab(badges) {
  const total = totalOf(badges)
  try {
    if (total > 0) {
      wx.showTabBarRedDot({ index: MESSAGE_TAB_INDEX })
      wx.removeTabBarBadge({ index: MESSAGE_TAB_INDEX }).catch(() => {})
    } else {
      wx.hideTabBarRedDot({ index: MESSAGE_TAB_INDEX })
      wx.removeTabBarBadge({ index: MESSAGE_TAB_INDEX })
    }
  } catch (err) {
    // 非 tab 页调用会失败，忽略
  }
}

function reset(userId = '') {
  cache = { ...empty, at: 0, userId: userId || '' }
  inflight = null
  applyTab(cache)
  const app = getApp()
  if (app && app.globalData) app.globalData.inboxBadges = cache
  return cache
}

function remember(badges, userId) {
  cache = { ...empty, ...badges, at: Date.now(), userId: userId || currentUserId() }
  const app = getApp()
  if (app && app.globalData) app.globalData.inboxBadges = cache
  applyTab(cache)
  return cache
}

function pickBadges(result) {
  if (result && result.ok && result.badges) return result.badges
  if (result && result.badges) return result.badges
  return null
}

async function refresh(force = false) {
  const userId = currentUserId()
  if (cache.userId && userId && cache.userId !== userId) {
    reset(userId)
  }
  const now = Date.now()
  if (!force && cache.at && now - cache.at < 180000 && (!userId || cache.userId === userId)) {
    applyTab(cache)
    return cache
  }
  if (inflight && !force) return inflight
  inflight = (async () => {
    await (getApp().globalData.ready || Promise.resolve())
    const uid = currentUserId()
    if (cache.userId && uid && cache.userId !== uid) reset(uid)
    const result = await repo.getInboxBadges()
    const badges = pickBadges(result)
    inflight = null
    if (!badges) {
      applyTab(cache)
      return cache
    }
    return remember(badges, uid)
  })().catch(() => {
    inflight = null
    applyTab(cache)
    return cache
  })
  return inflight
}

function seenCursor(rows, snapshotAt) {
  const times = (Array.isArray(rows) ? rows : [])
    .map((item) => Number(item && item.createdAt) || 0)
    .filter((item) => item > 0)
  if (times.length) return Math.max.apply(null, times)
  const at = Number(snapshotAt) || 0
  return at > 0 ? at : 0
}

function current() {
  return cache
}

module.exports = {
  refresh,
  current,
  applyTab,
  totalOf,
  reset,
  seenCursor
}
