const repo = require('./repo')

// 「我的」页、个人主页顶部照片：优先用运营后台配置（meta/mine_cover），这里是包内兜底
const DEFAULT_COVER = {
  src: '/images/mine-cover.jpg',
  credit: '摄影：j07'
}
const COVER_KEY = 'cw_mine_cover_v1'

function cachedCover() {
  try {
    const cached = wx.getStorageSync(COVER_KEY)
    return cached && cached.src ? cached : DEFAULT_COVER
  } catch (e) {
    return DEFAULT_COVER
  }
}

async function fetchCover() {
  const remote = await repo.getMineCover().catch(() => null)
  const next = remote ? { src: remote.src, credit: remote.credit } : DEFAULT_COVER
  try {
    if (remote) wx.setStorageSync(COVER_KEY, next)
    else wx.removeStorageSync(COVER_KEY)
  } catch (e) { /* 缓存失败不影响展示 */ }
  return next
}

// 远端图加载失败时清缓存并回退到包内图
function fallbackCover() {
  try { wx.removeStorageSync(COVER_KEY) } catch (e) { /* ignore */ }
  return DEFAULT_COVER
}

function sameCover(a, b) {
  return !!a && !!b && a.src === b.src && a.credit === b.credit
}

module.exports = { DEFAULT_COVER, cachedCover, fetchCover, fallbackCover, sameCover }
