const repo = require('./repo')

const MINE_TAB_INDEX = 2
const empty = { unreadLikes: 0, unreadComments: 0, unreadMessages: 0 }

let cache = { ...empty, at: 0 }
let inflight = null

function totalOf(badges) {
  return (Number(badges.unreadLikes) || 0)
    + (Number(badges.unreadComments) || 0)
    + (Number(badges.unreadMessages) || 0)
}

function applyTab(badges) {
  const total = totalOf(badges)
  try {
    if (total > 0) {
      wx.showTabBarRedDot({ index: MINE_TAB_INDEX })
      wx.removeTabBarBadge({ index: MINE_TAB_INDEX }).catch(() => {})
    } else {
      wx.hideTabBarRedDot({ index: MINE_TAB_INDEX })
      wx.removeTabBarBadge({ index: MINE_TAB_INDEX })
    }
  } catch (err) {
    // 非 tab 页调用会失败，忽略
  }
}

function remember(badges) {
  cache = { ...empty, ...badges, at: Date.now() }
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
  const now = Date.now()
  if (!force && cache.at && now - cache.at < 180000) {
    applyTab(cache)
    return cache
  }
  if (inflight && !force) return inflight
  inflight = (async () => {
    await (getApp().globalData.ready || Promise.resolve())
    const result = await repo.getInboxBadges()
    const badges = pickBadges(result)
    inflight = null
    if (!badges) {
      applyTab(cache)
      return cache
    }
    return remember(badges)
  })().catch(() => {
    inflight = null
    applyTab(cache)
    return cache
  })
  return inflight
}

function current() {
  return cache
}

module.exports = {
  refresh,
  current,
  applyTab,
  totalOf
}
