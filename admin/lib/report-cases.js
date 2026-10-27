// 举报工单：按被举报对象合并，带举报者账号与历史；举报者处置与内容作者处置分开
const moderation = require('../../utils/moderation')
const reportRules = require('../../utils/report-rules')
const db = require('./db')
const cache = require('./cache')
const content = require('./content-admin')

const PAGE_SIZE = 20
const ACTION_LABEL = {
  dismiss: '举报不成立',
  delete: '已下架',
  takedown: '已下架',
  hide: '已隐藏进审',
  mute: '已禁言作者',
  ban: '已封号作者',
  mute_author: '已禁言作者',
  ban_author: '已封号作者'
}

function service() {
  // 延迟加载，避免与 service.js 互相 require
  return require('./service')
}

function caseKey(item) {
  return `${item.targetType || ''}:${item.targetId || ''}`
}

/** 每个举报者的历史：举报总数、成立数、不成立数、待处理数 */
function reporterStats(rows) {
  const map = {}
  rows.forEach((item) => {
    const id = item.reporterId
    if (!id) return
    const stat = map[id] || (map[id] = { total: 0, pending: 0, upheld: 0, dismissed: 0 })
    stat.total += 1
    if (item.status === 'pending') stat.pending += 1
    else if (item.status === 'dismissed' || item.resolveAction === 'dismiss') stat.dismissed += 1
    else stat.upheld += 1
  })
  return map
}

function matchesKeyword(reports, q) {
  if (!q) return true
  const text = q.toLowerCase()
  return reports.some((item) => [
    item.reporterName, item.reporterId, item.targetId, item.targetAuthorId,
    item.targetTitle, item.reasonLabel, item.note
  ].some((value) => String(value || '').toLowerCase().includes(text)))
}

async function loadTarget(type, id) {
  if (type === 'user') return db.getDoc('users', id)
  const name = content.collectionOf(type)
  return name ? db.getDoc(name, id) : null
}

async function shapeCase(reports, stats) {
  const sample = reports[0]
  const type = sample.targetType
  const target = await loadTarget(type, sample.targetId).catch(() => null)
  let parent = null
  if (type === 'comment' && target && target.targetId) {
    const parentType = target.targetType === 'wall' ? 'wall' : 'forum'
    const doc = await db.getDoc(content.collectionOf(parentType), target.targetId).catch(() => null)
    if (doc) parent = { type: parentType, id: doc.id || doc._id, title: content.headlineOf(parentType, doc) }
  }
  const authorId = type === 'user' ? sample.targetId : ((target && target.authorId) || sample.targetAuthorId || '')
  const author = authorId ? await db.getDoc('users', authorId).catch(() => null) : null
  const reporterIds = Array.from(new Set(reports.map((item) => item.reporterId).filter(Boolean)))
  const reporterDocs = await Promise.all(reporterIds.map((id) => db.getDoc('users', id).catch(() => null)))
  const reporters = {}
  reporterIds.forEach((id, index) => {
    const doc = reporterDocs[index]
    reporters[id] = {
      id,
      nickname: (doc && doc.nickname) || '',
      schoolName: (doc && doc.schoolName) || '',
      status: (doc && doc.status) || 'active',
      reportBlocked: !!(doc && doc.reportBlocked),
      stats: stats[id] || { total: 0, pending: 0, upheld: 0, dismissed: 0 }
    }
  })
  const images = target && Array.isArray(target.images) ? target.images.filter(Boolean) : []
  const urlMap = images.length ? await db.resolveCloudUrls(images) : {}
  const pending = reports.filter((item) => item.status === 'pending')
  const active = reportRules.activeReporterIds(reports, target || {})
  return {
    key: caseKey(sample),
    targetType: type,
    targetId: sample.targetId,
    status: pending.length ? 'pending' : 'resolved',
    pendingCount: pending.length,
    activeReporterCount: active.size,
    threshold: reportRules.REPORT_THRESHOLD,
    latestAt: Math.max(...reports.map((item) => item.createdAt || 0)),
    exists: !!target,
    title: target
      ? (type === 'user' ? (target.nickname || target.id) : content.headlineOf(type, target))
      : (sample.targetTitle || '原内容已删除'),
    content: target ? String(target.content || target.bio || '') : '',
    images: db.applyCloudUrls(images, urlMap),
    parent,
    anonymous: !!(target && target.anonymous),
    author: author ? { id: authorId, nickname: author.nickname || '', status: author.status || 'active' } : (authorId ? { id: authorId, nickname: '', status: '' } : null),
    authorName: target ? (target.authorName || target.nickname || '') : '',
    reviewStatus: target ? (target.reviewStatus || (type === 'user' ? '' : 'approved')) : '',
    reviewStatusLabel: target && type !== 'user' ? moderation.reviewStatusLabel(target.reviewStatus || 'approved') : '',
    reportHidden: !!(target && target.reportHidden),
    reports: reports
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((item) => ({
        id: item.id || item._id,
        reasonLabel: item.reasonLabel || item.reason || '',
        note: item.note || '',
        reporterId: item.reporterId,
        reporterName: item.reporterName || '',
        reporter: reporters[item.reporterId] || null,
        status: item.status || 'pending',
        createdAt: item.createdAt || 0,
        counted: active.has(item.reporterId) && item.status === 'pending',
        resolveAction: item.resolveAction || '',
        resolveLabel: item.status === 'pending' ? '待处理' : (ACTION_LABEL[item.resolveAction] || '已处理'),
        resolveNote: item.resolveNote || '',
        resolvedBy: item.resolvedBy || '',
        resolvedAt: item.resolvedAt || 0
      }))
  }
}

async function listReportCases({ status = 'pending', keyword = '', page = 0 } = {}) {
  const pageNo = Math.max(0, Number(page) || 0)
  const q = String(keyword || '').trim()
  return cache.wrap(`report_cases:${status}:${q}:${pageNo}`, 10000, async () => {
    const rows = await db.allDocs('reports')
    const stats = reporterStats(rows)
    const groups = new Map()
    rows.forEach((item) => {
      const key = caseKey(item)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    })
    const all = Array.from(groups.values())
      .map((reports) => ({
        reports,
        pending: reports.some((item) => item.status === 'pending'),
        latestAt: Math.max(...reports.map((item) => item.createdAt || 0))
      }))
    const counts = {
      pending: all.filter((item) => item.pending).length,
      resolved: all.filter((item) => !item.pending).length,
      all: all.length
    }
    const filtered = all
      .filter((item) => status === '全部' || (status === 'pending' ? item.pending : !item.pending))
      .filter((item) => matchesKeyword(item.reports, q))
      .sort((a, b) => b.latestAt - a.latestAt)
    const pageRows = filtered.slice(pageNo * PAGE_SIZE, pageNo * PAGE_SIZE + PAGE_SIZE)
    const cases = []
    for (const item of pageRows) cases.push(await shapeCase(item.reports, stats))
    return { ok: true, counts, total: filtered.length, page: pageNo, size: PAGE_SIZE, cases }
  })
}

/** 举报者档案：账号信息 + 历史举报（分页）及每条的处理结果 */
async function getReporter(reporterId, { page = 0 } = {}) {
  const id = String(reporterId || '').trim()
  if (!id) return { ok: false, message: '缺少账号' }
  const pageNo = Math.max(0, Number(page) || 0)
  const [user, rows] = await Promise.all([
    db.getDoc('users', id),
    db.allDocs('reports', { reporterId: id })
  ])
  const sorted = rows.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const stats = reporterStats(rows)[id] || { total: 0, pending: 0, upheld: 0, dismissed: 0 }
  return {
    ok: true,
    account: user ? {
      id,
      nickname: user.nickname || '',
      schoolName: user.schoolName || '',
      status: user.status || 'active',
      muteUntil: user.muteUntil || 0,
      reportBlocked: !!user.reportBlocked,
      reportBlockedReason: user.reportBlockedReason || '',
      reportBlockedBy: user.reportBlockedBy || '',
      reportBlockedAt: user.reportBlockedAt || 0
    } : { id, nickname: '', status: 'unknown' },
    stats,
    total: sorted.length,
    page: pageNo,
    size: PAGE_SIZE,
    history: sorted.slice(pageNo * PAGE_SIZE, pageNo * PAGE_SIZE + PAGE_SIZE).map((item) => ({
      id: item.id || item._id,
      targetType: item.targetType,
      targetId: item.targetId,
      targetTitle: item.targetTitle || '',
      reasonLabel: item.reasonLabel || item.reason || '',
      note: item.note || '',
      status: item.status || 'pending',
      resolveLabel: item.status === 'pending' ? '待处理' : (ACTION_LABEL[item.resolveAction] || '已处理'),
      resolveNote: item.resolveNote || '',
      createdAt: item.createdAt || 0,
      resolvedAt: item.resolvedAt || 0
    }))
  }
}

/**
 * 处置恶意举报者（只针对举报者，不碰被举报内容的作者）。
 * block_report：禁止再举报，且他手上待处理的举报不再计入自动隐藏人数。
 */
async function restrictReporter({ reporterId, action, reason, muteHours } = {}, operator = '') {
  const id = String(reporterId || '').trim()
  const user = id ? await db.getDoc('users', id) : null
  if (!user) return { ok: false, message: '账号不存在' }
  const note = String(reason || '').trim().slice(0, 200)
  const now = Date.now()
  if (action === 'block_report' || action === 'unblock_report') {
    const blocked = action === 'block_report'
    if (blocked && !note) return { ok: false, message: '请填写限制原因' }
    await db.updateDoc('users', id, {
      reportBlocked: blocked,
      reportBlockedReason: blocked ? note : '',
      reportBlockedBy: blocked ? operator : '',
      reportBlockedAt: blocked ? now : 0
    })
    if (blocked) {
      const pending = (await db.allDocs('reports', { reporterId: id })).filter((item) => item.status === 'pending')
      await Promise.all(pending.map((item) => db.updateDoc('reports', item.id || item._id, { reporterEligible: false })))
    }
  } else if (action === 'mute' || action === 'ban' || action === 'restore') {
    if (action !== 'restore' && !note) return { ok: false, message: '请填写处置原因' }
    const result = await service().setAccountStatus(id, {
      status: action === 'ban' ? 'banned' : (action === 'mute' ? 'muted' : 'active'),
      reason: note || (action === 'restore' ? '' : '恶意举报'),
      muteHours: muteHours || 24
    })
    if (!result.ok) return result
  } else {
    return { ok: false, message: '未知操作' }
  }
  const labels = { block_report: '限制举报', unblock_report: '恢复举报权限', mute: '禁言', ban: '封号', restore: '解除账号限制' }
  await content.writeActionLog({
    level: action === 'unblock_report' || action === 'restore' ? 'info' : 'warn',
    type: 'reporter_restrict',
    action,
    targetType: 'reporter',
    targetId: id,
    reason: note,
    operator,
    userId: id,
    userNickname: user.nickname || '',
    detail: `举报者 ${user.nickname || id}（${id}）· ${labels[action]}${note ? ` · ${note}` : ''}`
  })
  cache.clear()
  return { ok: true }
}

/** 恢复因举报自动隐藏的内容，并结束这一轮举报 */
async function dismissCase(type, id, note, operator) {
  const target = await loadTarget(type, id)
  const now = Date.now()
  if (type === 'user') {
    if (target) await db.updateDoc('users', id, { reportStatus: '', reportClearedAt: now, reportCount: 0 })
  } else if (target) {
    const patch = { reportClearedAt: now, reportHidden: false, reportCount: 0 }
    if (target.reportHidden && target.reviewStatus === 'manual_review') {
      Object.assign(patch, {
        reviewStatus: 'approved',
        reviewOutcome: 'approved',
        reviewNote: note || '举报不成立，恢复公开',
        restoredBy: operator,
        restoredAt: now
      })
    }
    await db.updateDoc(content.collectionOf(type), id, patch)
  }
  return content.closePendingReports(type, id, {
    status: 'dismissed', action: 'dismiss', note: note || '举报不成立', operator
  })
}

/**
 * 处理一整个工单（同一被举报对象的全部待处理举报）：
 * dismiss 举报不成立并恢复；takedown 下架内容；mute_author / ban_author 处置内容作者。
 */
async function resolveCase({ targetType, targetId, action, note, muteHours } = {}, operator = '') {
  const type = String(targetType || '')
  const id = String(targetId || '')
  if (!type || !id) return { ok: false, message: '参数不完整' }
  const reason = String(note || '').trim().slice(0, 200)
  let closed = 0
  if (action === 'dismiss') {
    closed = await dismissCase(type, id, reason, operator)
  } else if (action === 'takedown') {
    if (type === 'user') return { ok: false, message: '用户举报请用禁言或封号' }
    const result = await content.setContentVisibility({ type, id, action: 'takedown', reason: reason || '举报核实后下架' }, operator)
    if (!result.ok) return result
    closed = result.closedReports
  } else if (action === 'mute_author' || action === 'ban_author') {
    const target = await loadTarget(type, id)
    const authorId = type === 'user' ? id : ((target && target.authorId) || '')
    if (!authorId) return { ok: false, message: '找不到内容作者' }
    const result = await service().setAccountStatus(authorId, {
      status: action === 'ban_author' ? 'banned' : 'muted',
      reason: reason || (action === 'ban_author' ? '举报核实后封号' : '举报核实后禁言'),
      muteHours: muteHours || 24
    })
    if (!result.ok) return result
    if (target && type !== 'user') await db.updateDoc(content.collectionOf(type), id, { reportClearedAt: Date.now() })
    closed = await content.closePendingReports(type, id, {
      status: 'resolved', action: action === 'ban_author' ? 'ban' : 'mute', note: reason, operator
    })
  } else {
    return { ok: false, message: '未知操作' }
  }
  await content.writeActionLog({
    level: action === 'dismiss' ? 'info' : 'warn',
    type: 'report_case',
    action,
    targetType: type,
    targetId: id,
    reason,
    operator,
    detail: `举报工单 ${type}:${id} → ${ACTION_LABEL[action] || action}${reason ? ` · ${reason}` : ''} · 结束 ${closed} 条举报`
  })
  cache.clear()
  return { ok: true, closedReports: closed }
}

module.exports = {
  PAGE_SIZE,
  listReportCases,
  getReporter,
  restrictReporter,
  resolveCase
}
