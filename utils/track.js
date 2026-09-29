/**
 * 产品埋点：为用户画像 / 兴趣标签 / 转化漏斗预留。
 *
 * 事件约定（snake_case）：
 * - page_view            进入表面（forum/wall/weekly_hot/mine/detail/publish）
 * - tag_filter           点击小标签（校园墙板块 / 论坛分类 / 成交状态）
 * - sort_change          最热 / 最新
 * - search               搜索确认
 * - post_click           列表点进详情
 * - weekly_hot_open      热榜入口（banner）
 * - weekly_hot_click     热榜条目（预览或榜单）
 * - weekly_hot_tab       热榜 Tab（全部/学习分享/互助广场）
 * - publish_click        点发布按钮
 * - publish_tag_select   发布页选标签
 * - publish_success      发布成功
 * - publish_fail         发布失败（含拦截原因码）
 * - post_view            详情曝光（含内容标签）
 * - like                 点赞
 * - comment_success      评论成功
 * - contact_reveal       查看/复制微信号
 * - contact_feedback     互助广场联系反馈
 * - deal_status_change   主人改成交状态
 * - auth_submit          提交学校/学生认证
 * - school_tag_toggle    是否展示学校标签
 * - share                转发好友/群 或 分享朋友圈
 *
 * 每条自动附带：userId / school* / speakCode / sessionId / ts
 * 本地缓冲 cw_track_events；云开发开启后批量写入 analytics_events。
 */

const config = require('./config')

const STORAGE_EVENTS = 'cw_track_events'
const STORAGE_SESSION = 'cw_track_session'
const MAX_LOCAL = 500
const FLUSH_BATCH = 40
const FLUSH_INTERVAL_MS = 8000
// 埋点只留在手机本地。上报会每次点击都写云数据库，用量涨得很快。

let flushing = false
let flushTimer = null
let lastPageKey = ''
let lastPageAt = 0

function uid(prefix = 't_') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function getSessionId() {
  try {
    let id = wx.getStorageSync(STORAGE_SESSION)
    if (!id) {
      id = uid('s_')
      wx.setStorageSync(STORAGE_SESSION, id)
    }
    return id
  } catch (e) {
    return uid('s_')
  }
}

function readQueue() {
  try {
    const list = wx.getStorageSync(STORAGE_EVENTS)
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function writeQueue(list) {
  try {
    wx.setStorageSync(STORAGE_EVENTS, (list || []).slice(-MAX_LOCAL))
  } catch (e) {
    // ignore quota errors
  }
}

function identity() {
  const app = typeof getApp === 'function' ? getApp() : null
  const gd = (app && app.globalData) || {}
  const user = gd.user || {}
  const gate = gd.speakGate || {}
  return {
    userId: user.id || '',
    schoolName: user.schoolName || '',
    schoolCampus: user.schoolCampus || '',
    schoolLocked: !!user.schoolLocked,
    studentAuthStatus: user.studentAuthStatus || 'none',
    showSchoolTag: !!user.showSchoolTag,
    speakCode: gate.code || (gate.ok ? 'OK' : ''),
    sessionId: getSessionId()
  }
}

function sanitizeProps(props = {}) {
  const next = {}
  Object.keys(props || {}).forEach((key) => {
    const value = props[key]
    if (value === undefined || value === null) return
    if (typeof value === 'string') {
      next[key] = value.slice(0, 200)
      return
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value
      return
    }
    try {
      next[key] = JSON.stringify(value).slice(0, 200)
    } catch (e) {
      // skip
    }
  })
  return next
}

function enqueue(event, props = {}) {
  if (!event) return null
  const row = {
    id: uid('e_'),
    event: String(event),
    ts: Date.now(),
    ...identity(),
    ...sanitizeProps(props)
  }
  const queue = readQueue()
  queue.push(row)
  writeQueue(queue)
  return row
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush().catch(() => {})
  }, FLUSH_INTERVAL_MS)
}

async function flush() {
  if (flushing) return { ok: true, flushed: 0 }
  const queue = readQueue()
  if (!queue.length) return { ok: true, flushed: 0 }

  // 不上云，避免 analytics_events 把数据库写调用打满
  return { ok: true, flushed: 0, localOnly: true }

  flushing = true
  try {
    const batch = queue.slice(0, FLUSH_BATCH)
    const repo = require('./repo')
    const result = await repo.trackEvents(batch)
    if (result && result.ok) {
      writeQueue(queue.slice(batch.length))
      if (readQueue().length) scheduleFlush()
      return { ok: true, flushed: batch.length }
    }
    return { ok: false, flushed: 0, message: (result && result.message) || '上报失败' }
  } catch (e) {
    return { ok: false, flushed: 0, message: (e && e.message) || '上报异常' }
  } finally {
    flushing = false
  }
}

/** 主入口：fire-and-forget */
function track(event, props = {}) {
  try {
    return enqueue(event, props)
  } catch (e) {
    return null
  }
}

function pageView(surface, props = {}) {
  const key = `${surface}:${props.contentId || props.tag || props.category || ''}`
  const now = Date.now()
  if (key === lastPageKey && now - lastPageAt < 1500) return null
  lastPageKey = key
  lastPageAt = now
  return track('page_view', { surface, ...props })
}

function tagFilter(props) {
  return track('tag_filter', props)
}

function sortChange(props) {
  return track('sort_change', props)
}

function search(props) {
  const keyword = props.keyword
  const next = { ...props }
  delete next.keyword
  return track('search', {
    ...next,
    keywordLen: keyword ? String(keyword).length : 0,
    hasKeyword: !!(keyword && String(keyword).trim())
  })
}

function postClick(props) {
  return track('post_click', props)
}

function weeklyHotOpen(props) {
  return track('weekly_hot_open', props)
}

function weeklyHotClick(props) {
  return track('weekly_hot_click', props)
}

function weeklyHotTab(props) {
  return track('weekly_hot_tab', props)
}

function publishClick(props) {
  return track('publish_click', props)
}

function publishTagSelect(props) {
  return track('publish_tag_select', props)
}

function publishSuccess(props) {
  return track('publish_success', props)
}

function publishFail(props) {
  return track('publish_fail', props)
}

function postView(props) {
  return track('post_view', props)
}

function like(props) {
  return track('like', props)
}

function commentSuccess(props) {
  return track('comment_success', props)
}

function contactReveal(props) {
  return track('contact_reveal', props)
}

function contactFeedback(props) {
  return track('contact_feedback', props)
}

function dealStatusChange(props) {
  return track('deal_status_change', props)
}

function authSubmit(props) {
  return track('auth_submit', props)
}

function schoolTagToggle(props) {
  return track('school_tag_toggle', props)
}

function share(props) {
  return track('share', props)
}

/** 调试 / 本地画像导出 */
function dumpLocal(limit = 100) {
  return readQueue().slice(-limit)
}

function clearLocal() {
  writeQueue([])
}

module.exports = {
  track,
  flush,
  pageView,
  tagFilter,
  sortChange,
  search,
  postClick,
  weeklyHotOpen,
  weeklyHotClick,
  weeklyHotTab,
  publishClick,
  publishTagSelect,
  publishSuccess,
  publishFail,
  postView,
  like,
  commentSuccess,
  contactReveal,
  contactFeedback,
  dealStatusChange,
  authSubmit,
  schoolTagToggle,
  share,
  dumpLocal,
  clearLocal,
  getSessionId
}
