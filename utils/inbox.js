const repo = require('./repo')

// 底部 tab：首页 0、黎安攻略 1、消息 2、我的 3
const MESSAGE_TAB_INDEX = 2
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

// 私信已下线：红点只算收到的赞和评论，不再计入私信未读
function totalOf(badges) {
  return (Number(badges.unreadLikes) || 0)
    + (Number(badges.unreadComments) || 0)
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
    const session = repo.currentSession()
    const result = await repo.getInboxBadges()
    const badges = pickBadges(result)
    inflight = null
    // 请求期间切换或退出了账号：这是上一个账号的未读数，丢掉
    if (session !== repo.currentSession() || uid !== currentUserId() || (result && result.staleSession)) {
      applyTab(cache)
      return cache
    }
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

// 已读推到「列表拉取时刻」：列表里看不到的（帖子已下架、评论待审、超出条数）也算看过，否则红点永远消不掉
function seenCursor(rows, snapshotAt) {
  const times = (Array.isArray(rows) ? rows : [])
    .map((item) => Number(item && item.createdAt) || 0)
    .filter((item) => item > 0)
  const at = Number(snapshotAt) || 0
  const newest = times.length ? Math.max.apply(null, times) : 0
  return Math.max(newest, at > 0 ? at : 0)
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
