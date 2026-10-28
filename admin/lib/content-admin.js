// 内容管理：帖子 / 评论分页列表、详情、主动下架与恢复，以及处置留痕
const moderation = require('../../utils/moderation')
const { uid } = require('../../utils/util')
const db = require('./db')
const cache = require('./cache')

const COLLECTIONS = { forum: 'forum_posts', wall: 'wall_posts', comment: 'comments' }
const STATUS_GROUPS = {
  public: ['approved'],
  queue: ['pending', 'manual_review', 'edit_required', 'emergency_block'],
  removed: ['rejected']
}
const SEARCH_FIELDS = {
  forum: ['title', 'content', 'authorName', 'authorId'],
  wall: ['title', 'content', 'extra', 'authorName', 'authorId'],
  comment: ['content', 'authorName', 'authorId']
}
const PAGE_SIZE = 20
// 这些日志类型构成「处置记录」，内容管理和举报工单共用
const ACTION_LOG_TYPES = ['content_takedown', 'content_restore', 'report_case', 'reporter_restrict', 'manual_review']

function collectionOf(type) {
  return COLLECTIONS[type] || ''
}

function statusGroupOf(status) {
  const value = status || 'approved'
  if (moderation.isPublicStatus(value)) return 'public'
  if (STATUS_GROUPS.removed.includes(value)) return 'removed'
  return 'queue'
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function headlineOf(type, item) {
  if (type === 'comment') return String(item.content || '').slice(0, 40) || '（图片评论）'
  if (item.title) return item.title
  if (type === 'wall' && (item.routeFrom || item.routeTo)) return `${item.routeFrom || '出发地'} → ${item.routeTo || '目的地'}`
  return String(item.content || '').slice(0, 40) || item.tag || '未命名'
}

function matchesLocal(item, type, statusGroup, q) {
  if (statusGroup && statusGroup !== '全部' && statusGroupOf(item.reviewStatus) !== statusGroup) return false
  if (!q) return true
  const hay = SEARCH_FIELDS[type].map((key) => item[key] || '').join(' ').toLowerCase()
  return hay.includes(q.toLowerCase())
}

async function queryPage(type, { status, keyword, page, size }) {
  const name = collectionOf(type)
  const q = String(keyword || '').trim()
  if (db.useLocal()) {
    const rows = (await db.allDocs(name))
      .filter((item) => matchesLocal(item, type, status, q))
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    return { total: rows.length, rows: rows.slice(page * size, page * size + size) }
  }
  const database = db.getDb()
  const _ = database.command
  const conds = []
  if (status && status !== '全部') {
    const list = STATUS_GROUPS[status] || STATUS_GROUPS.public
    // 老数据没有 reviewStatus 字段，按已公开处理
    conds.push(status === 'public'
      ? _.or([{ reviewStatus: _.in(list) }, { reviewStatus: _.exists(false) }])
      : { reviewStatus: _.in(list) })
  }
  if (q) {
    const reg = database.RegExp({ regexp: escapeRegExp(q), options: 'i' })
    conds.push(_.or(SEARCH_FIELDS[type].map((field) => ({ [field]: reg }))))
  }
  let ref = database.collection(name)
  if (conds.length) ref = ref.where(conds.length === 1 ? conds[0] : _.and(conds))
  const [countRes, res] = await Promise.all([
    ref.count().catch(() => ({ total: 0 })),
    ref.orderBy('createdAt', 'desc').skip(page * size).limit(size).get()
  ])
  return {
    total: countRes.total || 0,
    rows: (res.data || []).map((row) => ({ ...row, id: row.id || row._id }))
  }
}

async function authorsOf(rows) {
  const ids = Array.from(new Set(rows.map((item) => item.authorId).filter(Boolean)))
  const users = await Promise.all(ids.map((id) => db.getDoc('users', id).catch(() => null)))
  const map = {}
  ids.forEach((id, index) => {
    const user = users[index]
    map[id] = { id, nickname: (user && user.nickname) || '', phone: (user && user.phone) || '', status: (user && user.status) || 'active' }
  })
  return map
}

async function parentsOf(rows) {
  const keys = Array.from(new Set(rows.map((item) => `${item.targetType === 'wall' ? 'wall' : 'forum'}:${item.targetId || ''}`)))
  const docs = await Promise.all(keys.map((key) => {
    const [type, id] = key.split(':')
    return id ? db.getDoc(collectionOf(type), id).catch(() => null) : null
  }))
  const map = {}
  keys.forEach((key, index) => {
    const doc = docs[index]
    const type = key.split(':')[0]
    map[key] = doc
      ? { type, id: doc.id || doc._id, title: headlineOf(type, doc), reviewStatus: doc.reviewStatus || 'approved', statusGroup: statusGroupOf(doc.reviewStatus) }
      : null
  })
  return map
}

function shapeItem(type, item, authors, urlMap, parents) {
  const author = authors[item.authorId] || null
  const shaped = {
    id: item.id || item._id,
    type,
    headline: headlineOf(type, item),
    title: item.title || '',
    content: item.content || '',
    extra: item.extra || '',
    tag: type === 'forum' ? (item.category || item.tag || '') : (item.tag || ''),
    images: db.applyCloudUrls((item.images || []).filter(Boolean), urlMap),
    authorId: item.authorId || '',
    authorName: item.authorName || '',
    anonymous: !!item.anonymous,
    realAuthor: author,
    createdAt: item.createdAt || 0,
    viewCount: Number(item.viewCount) || 0,
    likeCount: Number(item.likeCount) || 0,
    commentCount: Number(item.commentCount) || 0,
    reviewStatus: item.reviewStatus || 'approved',
    reviewStatusLabel: moderation.reviewStatusLabel(item.reviewStatus || 'approved'),
    statusGroup: statusGroupOf(item.reviewStatus),
    reviewNote: item.reviewNote || '',
    reportHidden: !!item.reportHidden,
    takedownReason: item.takedownReason || '',
    takedownBy: item.takedownBy || '',
    takedownAt: item.takedownAt || 0,
    restoredBy: item.restoredBy || '',
    restoredAt: item.restoredAt || 0
  }
  if (type === 'comment') {
    const key = `${item.targetType === 'wall' ? 'wall' : 'forum'}:${item.targetId || ''}`
    shaped.parent = (parents && parents[key]) || null
    shaped.replyToName = item.replyToName || ''
  }
  return shaped
}

async function shapeRows(type, rows) {
  const images = [].concat(...rows.map((item) => (item.images || []).filter(Boolean)))
  const [authors, urlMap, parents] = await Promise.all([
    authorsOf(rows),
    images.length ? db.resolveCloudUrls(images) : {},
    type === 'comment' ? parentsOf(rows) : null
  ])
  return rows.map((item) => shapeItem(type, item, authors, urlMap, parents))
}

async function listContent({ type = 'forum', status = 'public', keyword = '', page = 0 } = {}) {
  if (!collectionOf(type)) return { ok: false, message: '未知内容类型' }
  const pageNo = Math.max(0, Number(page) || 0)
  const key = `content:${type}:${status}:${keyword}:${pageNo}`
  return cache.wrap(key, 10000, async () => {
    const { total, rows } = await queryPage(type, { status, keyword, page: pageNo, size: PAGE_SIZE })
    return { ok: true, total, page: pageNo, size: PAGE_SIZE, items: await shapeRows(type, rows) }
  })
}

async function commentsUnder(postType, postId, limit = 50) {
  const where = { targetId: postId }
  const rows = await db.allDocs('comments', where)
  return rows
    .filter((item) => (item.targetType === 'wall' ? 'wall' : 'forum') === postType)
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
    .slice(-limit)
}

/** 完整内容 + 上下文：帖子带它下面的评论；评论带所属帖子和同帖其他评论 */
async function getContentDetail(type, id) {
  const name = collectionOf(type)
  if (!name || !id) return { ok: false, message: '参数不完整' }
  const doc = await db.getDoc(name, id)
  if (!doc) return { ok: false, message: '内容不存在' }
  const [item] = await shapeRows(type, [{ ...doc, id }])
  let post = null
  let thread = []
  if (type === 'comment') {
    const postType = doc.targetType === 'wall' ? 'wall' : 'forum'
    const parent = doc.targetId ? await db.getDoc(collectionOf(postType), doc.targetId) : null
    if (parent) [post] = await shapeRows(postType, [{ ...parent, id: parent.id || parent._id }])
    thread = parent ? await shapeRows('comment', await commentsUnder(postType, doc.targetId)) : []
  } else {
    post = item
    thread = await shapeRows('comment', await commentsUnder(type, id))
  }
  const logs = await listActionLogs({ targetType: type, targetId: id, page: 0 })
  return { ok: true, item, post, thread, logs: logs.items }
}

async function writeActionLog(entry) {
  const row = {
    id: uid('sl_'),
    level: entry.level || 'info',
    createdAt: Date.now(),
    userId: entry.userId || '',
    userNickname: entry.userNickname || '',
    ...entry
  }
  await db.setDoc('security_logs', row.id, row)
  return row
}

/** 关闭某对象上待处理的举报；fromResolve=false 时用于下架/恢复联动 */
async function closePendingReports(targetType, targetId, { status, action, note, operator }) {
  const rows = (await db.allDocs('reports', { targetType, targetId })).filter((item) => item.status === 'pending')
  const now = Date.now()
  await Promise.all(rows.map((item) => db.setDoc('reports', item.id || item._id, {
    ...item,
    status,
    resolvedAt: now,
    resolveAction: action,
    resolveNote: note || '',
    resolvedBy: operator || ''
  })))
  return rows.length
}

/**
 * 管理员主动下架 / 恢复公开。下架必须填原因；两种操作都会结束该内容当前这一轮举报，
 * 之后的旧举报不再参与计数（reportClearedAt），新举报从零开始算。
 */
async function setContentVisibility({ type, id, action, reason } = {}, operator = '') {
  const name = collectionOf(type)
  if (!name || !id) return { ok: false, message: '参数不完整' }
  const doc = await db.getDoc(name, id)
  if (!doc) return { ok: false, message: '内容不存在' }
  const note = String(reason || '').trim().slice(0, 200)
  const now = Date.now()
  let patch
  if (action === 'takedown') {
    if (!note) return { ok: false, message: '请填写下架原因' }
    patch = {
      reviewStatus: 'rejected',
      reviewOutcome: 'rejected',
      reviewNote: note,
      takedownReason: note,
      takedownBy: operator,
      takedownAt: now,
      reportHidden: false,
      reportClearedAt: now,
      reviewedAt: now
    }
  } else if (action === 'restore') {
    patch = {
      reviewStatus: 'approved',
      reviewOutcome: 'approved',
      reviewNote: note || '管理员恢复公开',
      restoredBy: operator,
      restoredAt: now,
      reportHidden: false,
      reportClearedAt: now,
      reportCount: 0,
      reviewedAt: now
    }
  } else {
    return { ok: false, message: '未知操作' }
  }
  await db.updateDoc(name, id, patch)
  const closed = await closePendingReports(type, id, action === 'takedown'
    ? { status: 'resolved', action: 'delete', note: note || '管理员下架', operator }
    : { status: 'dismissed', action: 'dismiss', note: note || '管理员恢复公开，举报不成立', operator })
  await writeActionLog({
    level: action === 'takedown' ? 'warn' : 'info',
    type: action === 'takedown' ? 'content_takedown' : 'content_restore',
    action,
    targetType: type,
    targetId: id,
    reason: note,
    operator,
    userId: doc.authorId || '',
    userNickname: doc.authorName || '',
    detail: `${action === 'takedown' ? '下架' : '恢复公开'} ${type}:${id}${note ? ` · ${note}` : ''}${closed ? ` · 结束 ${closed} 条待处理举报` : ''}`
  })
  cache.clear()
  return { ok: true, closedReports: closed }
}

async function listActionLogs({ targetType = '', targetId = '', keyword = '', page = 0 } = {}) {
  const pageNo = Math.max(0, Number(page) || 0)
  const q = String(keyword || '').trim().toLowerCase()
  const rows = (await db.recentDocs('security_logs', 200))
    .filter((item) => ACTION_LOG_TYPES.includes(item.type))
    .filter((item) => !targetId || (item.targetId === targetId && (!targetType || item.targetType === targetType)))
    .filter((item) => !q || [item.operator, item.detail, item.reason, item.targetId, item.userId]
      .some((value) => String(value || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return {
    ok: true,
    total: rows.length,
    page: pageNo,
    size: PAGE_SIZE,
    items: rows.slice(pageNo * PAGE_SIZE, pageNo * PAGE_SIZE + PAGE_SIZE).map((item) => ({
      id: item.id,
      type: item.type,
      action: item.action || '',
      targetType: item.targetType || '',
      targetId: item.targetId || '',
      reason: item.reason || '',
      operator: item.operator || '',
      detail: item.detail || '',
      createdAt: item.createdAt || 0
    }))
  }
}

module.exports = {
  PAGE_SIZE,
  collectionOf,
  statusGroupOf,
  headlineOf,
  listContent,
  getContentDetail,
  setContentVisibility,
  closePendingReports,
  writeActionLog,
  listActionLogs
}
