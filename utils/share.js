/**
 * 分享适配：群聊卡片 vs 朋友圈卡片
 *
 * - 转发好友/群：onShareAppMessage → title + path + imageUrl
 * - 分享朋友圈：onShareTimeline → title + query + imageUrl（建议 1:1）
 */

const BRAND = '黎安话事'
const SLOGAN = '同在一片园区，共享每一种校园生活'
/** 朋友圈推荐方图 */
const COVER_SQUARE = '/images/brand.jpg'
/** 群聊卡片兜底图 */
const COVER_CARD = '/images/brand.jpg'

function clip(text, max = 36) {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function firstImage(images) {
  if (!Array.isArray(images) || !images.length) return ''
  const url = String(images[0] || '').trim()
  return url
}

/** 打开右上角「转发 / 分享到朋友圈」 */
function enableMenus() {
  const run = () => {
    try {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    } catch (e) {
      try {
        wx.showShareMenu({ withShareTicket: true })
      } catch (err) {
        // ignore
      }
    }
  }
  run()
  setTimeout(run, 300)
}

function buildQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&')
}

/** 朋友圈标题：品牌 + 标签钩子 + 正文，利于识别与点击 */
function timelineTitle({ title, tag, section }) {
  const main = clip(title, 22)
  const chip = clip(tag || section || '', 8)
  if (chip && main) return `${BRAND}｜${chip}｜${main}`
  if (main) return `${BRAND}｜${main}`
  if (chip) return `${BRAND}｜${chip}`
  return `${BRAND}｜${SLOGAN}`
}

function appMessageTitle({ title, tag, section }) {
  const main = clip(title, 28)
  const chip = clip(tag || section || '', 8)
  if (chip && main) return `${chip}｜${main}`
  return main || `${BRAND}｜${SLOGAN}`
}

function forumPost(post = {}, id) {
  const contentId = id || post.id || ''
  const titleText = post.title || '学习分享新鲜事'
  const images = post.images || []
  return {
    appMessage: {
      title: appMessageTitle({ title: titleText, tag: post.category, section: '学习分享' }),
      path: `/pages/forum-detail/forum-detail?${buildQuery({ id: contentId, from: 'share' })}`,
      imageUrl: firstImage(images) || COVER_CARD
    },
    timeline: {
      title: timelineTitle({ title: titleText, tag: post.category, section: '学习分享' }),
      query: buildQuery({ id: contentId, from: 'timeline' }),
      imageUrl: firstImage(images) || COVER_SQUARE
    }
  }
}

function wallPost(post = {}, id) {
  const contentId = id || post.id || ''
  const titleText = post.headline || post.title || post.content || '互助广场有人在喊'
  const images = post.images || []
  return {
    appMessage: {
      title: appMessageTitle({ title: titleText, tag: post.tag, section: '互助广场' }),
      path: `/pages/wall-detail/wall-detail?${buildQuery({ id: contentId, from: 'share' })}`,
      imageUrl: firstImage(images) || COVER_CARD
    },
    timeline: {
      title: timelineTitle({ title: titleText, tag: post.tag, section: '互助广场' }),
      query: buildQuery({ id: contentId, from: 'timeline' }),
      imageUrl: firstImage(images) || COVER_SQUARE
    }
  }
}

function digestCard(digest = {}) {
  const id = digest.id || ''
  const titleText = digest.title || '本周精选'
  return {
    appMessage: {
      title: appMessageTitle({ title: titleText, section: '精选' }),
      path: `/pages/digest/digest?${buildQuery({ id, from: 'share' })}`,
      imageUrl: COVER_CARD
    },
    timeline: {
      title: timelineTitle({ title: titleText, section: '本周精选' }),
      query: buildQuery({ id, from: 'timeline' }),
      imageUrl: COVER_SQUARE
    }
  }
}

function weeklyHotCard(board = {}) {
  const titleText = (board && board.title) || '本周热榜'
  return {
    appMessage: {
      title: appMessageTitle({ title: titleText, section: '热榜' }),
      path: `/pages/weekly-hot/weekly-hot?${buildQuery({ from: 'share' })}`,
      imageUrl: COVER_CARD
    },
    timeline: {
      title: timelineTitle({ title: titleText, section: '本周热榜' }),
      query: buildQuery({ from: 'timeline' }),
      imageUrl: COVER_SQUARE
    }
  }
}

function homeCard(surface = 'forum') {
  const isWall = surface === 'wall'
  const path = isWall ? '/pages/wall/wall' : '/pages/forum/forum'
  const section = isWall ? '互助广场' : '学习分享'
  const hook = isWall ? '拼车闲置拼单，同学互助' : '校园新鲜事，都在这儿聊'
  return {
    appMessage: {
      title: `${BRAND}｜${section}｜${hook}`,
      path: `${path}?${buildQuery({ from: 'share' })}`,
      imageUrl: COVER_CARD
    },
    timeline: {
      title: timelineTitle({ title: hook, section }),
      query: buildQuery({ from: 'timeline', tab: surface }),
      imageUrl: COVER_SQUARE
    }
  }
}

module.exports = {
  BRAND,
  COVER_SQUARE,
  enableMenus,
  buildQuery,
  forumPost,
  wallPost,
  digestCard,
  weeklyHotCard,
  homeCard
}
