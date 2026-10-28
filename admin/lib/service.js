const path = require('path')
const https = require('https')
const security = require('../../utils/security')
const distribute = require('../../utils/distribute')
const moderation = require('../../utils/moderation')
const { uid } = require('../../utils/util')
const homeFeed = require('../../utils/home-feed')
const db = require('./db')
const cache = require('./cache')

const DIGEST_SIZE = 10

function bustReadCache() {
  cache.clear()
}

function wallHeadline(item) {
  if (item.title) return item.title
  if (item.tag === '出行拼车' && (item.routeFrom || item.routeTo)) {
    return `${item.routeFrom || '出发地'} → ${item.routeTo || '目的地'}`
  }
  return item.tag || '互助广场'
}

async function overview() {
  return cache.wrap('overview', 60000, async () => {
    if (db.useLocal()) return overviewByScan()
    const _ = db.getDb().command
    const pending = ['pending', 'manual_review', 'edit_required']
    const blocked = ['rejected', 'emergency_block']
    const count = (name, where) => db.countDocs(name, where)
    // 新加坡跨海：少打 count，核心数字优先
    const [
      forumCount, wallCount, commentCount,
      pendingForum, pendingWall, pendingComment,
      emergencyForum, emergencyWall,
      blockedForum, blockedWall,
      pendingSchool, digestCount, designatedGroups, bannedCount
    ] = await Promise.all([
      count('forum_posts'),
      count('wall_posts'),
      count('comments'),
      count('forum_posts', { reviewStatus: _.in(pending) }),
      count('wall_posts', { reviewStatus: _.in(pending) }),
      count('comments', { reviewStatus: _.in(pending) }),
      count('forum_posts', { reviewStatus: 'emergency_block' }),
      count('wall_posts', { reviewStatus: 'emergency_block' }),
      count('forum_posts', { reviewStatus: _.in(blocked) }),
      count('wall_posts', { reviewStatus: _.in(blocked) }),
      count('school_requests', { status: 'pending' }),
      count('digest_queue'),
      count('distribute_targets', { enabled: true, receiveDigest: true }),
      count('users', { status: 'banned' })
    ])
    return {
      forumCount,
      wallCount,
      commentCount,
      postCount: forumCount + wallCount,
      interceptCount: blockedForum + blockedWall,
      pendingReview: pendingForum + pendingWall + pendingComment,
      emergencyCount: emergencyForum + emergencyWall,
      pendingSchool,
      digestCount,
      digestSize: DIGEST_SIZE,
      digestRemain: Math.max(0, DIGEST_SIZE - digestCount),
      designatedGroups,
      groupCount: designatedGroups,
      logCount: 0,
      bannedCount,
      mutedCount: 0,
      riskLogCount: 0,
      contactViewCount: 0,
      contactFeedbackCount: 0,
      mode: 'cloud'
    }
  })
}

async function overviewByScan() {
  const [forum, wall, comments, school, groups, logs, accounts, securityLogs, contacts, feedbacks, queued] = await Promise.all([
    db.allDocs('forum_posts'),
    db.allDocs('wall_posts'),
    db.allDocs('comments'),
    db.allDocs('school_requests'),
    db.allDocs('distribute_targets'),
    db.allDocs('distribute_logs'),
    db.allDocs('users'),
    db.allDocs('security_logs'),
    db.allDocs('contact_views'),
    db.allDocs('contact_feedbacks'),
    db.allDocs('digest_queue')
  ])
  const allContent = [...forum, ...wall, ...comments]
  const rejected = allContent.filter((item) => item.reviewStatus === 'rejected' || item.reviewStatus === 'emergency_block')
  const pendingReview = allContent.filter((item) => ['pending', 'manual_review', 'edit_required'].includes(item.reviewStatus))
  const emergencyCount = allContent.filter((item) => item.reviewStatus === 'emergency_block').length
  return {
    forumCount: forum.length,
    wallCount: wall.length,
    commentCount: comments.length,
    postCount: forum.length + wall.length,
    interceptCount: rejected.length,
    pendingReview: pendingReview.length,
    emergencyCount,
    pendingSchool: school.filter((item) => item.status === 'pending').length,
    digestCount: queued.length,
    digestSize: DIGEST_SIZE,
    digestRemain: Math.max(0, DIGEST_SIZE - queued.length),
    designatedGroups: groups.filter((item) => item.receiveDigest && item.enabled).length,
    groupCount: groups.length,
    logCount: logs.length,
    bannedCount: accounts.filter((item) => item.status === 'banned').length,
    mutedCount: accounts.filter((item) => item.status === 'muted' && item.muteUntil > Date.now()).length,
    riskLogCount: securityLogs.length,
    contactViewCount: contacts.length,
    contactFeedbackCount: feedbacks.length,
    mode: db.useLocal() ? 'local' : 'cloud'
  }
}

async function listKeywords() {
  const rows = await db.allDocs('keywords')
  const words = Array.from(new Set(security.DEFAULT_KEYWORDS.concat(rows.map((item) => item.word).filter(Boolean))))
  if (!rows.length) {
    await Promise.all(words.map((word) => db.setDoc('keywords', word, {
      word,
      locked: security.isLockedKeyword(word),
      createdAt: Date.now()
    })))
  }
  return words.map((word) => ({ word, locked: security.isLockedKeyword(word) }))
}

async function addKeyword(word) {
  const text = String(word || '').trim()
  if (!text) return { ok: false, message: '请填写关键词' }
  await db.setDoc('keywords', text, { word: text, locked: security.isLockedKeyword(text), createdAt: Date.now() })
  bustReadCache()
  return { ok: true }
}

async function removeKeyword(word) {
  if (security.isLockedKeyword(word)) return { ok: false, message: '必拦词不能删除' }
  await db.removeDoc('keywords', word)
  bustReadCache()
  return { ok: true }
}

async function listAccounts() {
  return cache.wrap('accounts', 30000, async () => {
    if (db.useLocal()) {
      const users = await db.allDocs('users')
      return users
        .map((item) => {
          const { openid, ...rest } = item
          return rest
        })
        .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0) || (b.createdAt || 0) - (a.createdAt || 0))
    }
    const database = db.getDb()
    const _ = database.command
    const take = async (primary, fallback) => {
      try {
        const res = await primary
        return (res.data || []).map((item) => ({ ...item, id: item.id || item._id }))
      } catch (err) {
        if (!fallback) return []
        try {
          const res = await fallback
          return (res.data || []).map((item) => ({ ...item, id: item.id || item._id }))
        } catch (err2) {
          return []
        }
      }
    }
    const users = database.collection('users')
    const [recent, banned, muted, risky] = await Promise.all([
      take(users.orderBy('createdAt', 'desc').limit(120).get(), users.limit(120).get()),
      take(users.where({ status: 'banned' }).limit(80).get()),
      take(users.where({ status: 'muted' }).limit(80).get()),
      take(
        users.where({ riskScore: _.gt(0) }).orderBy('riskScore', 'desc').limit(80).get(),
        users.where({ riskScore: _.gt(0) }).limit(80).get()
      )
    ])
    const map = new Map()
    ;[...risky, ...banned, ...muted, ...recent].forEach((item) => {
      if (!item || !item.id) return
      const { openid, ...rest } = item
      map.set(item.id, rest)
    })
    return [...map.values()]
      .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0) || (b.createdAt || 0) - (a.createdAt || 0))
  })
}

async function setAppAdmin(userId, enabled) {
  const user = await db.getDoc('users', userId)
  if (!user) return { ok: false, message: '账号不存在' }
  const on = !!enabled
  const patch = { appAdmin: on }
  if (on) {
    patch.postWhitelist = true
    patch.wechatId = 'ding1gggyd'
  } else if (String(user.wechatId || '').toLowerCase() === 'ding1gggyd') {
    patch.wechatId = ''
  }
  await db.updateDoc('users', userId, patch)
  bustReadCache()
  return {
    ok: true,
    appAdmin: on,
    message: on
      ? '已设为小程序管理员。这个微信可以置顶、删除帖子，发帖不受条数限制。'
      : '已取消小程序管理员'
  }
}

async function setPostWhitelist(userId, enabled) {
  const user = await db.getDoc('users', userId)
  if (!user) return { ok: false, message: '账号不存在' }
  const on = !!enabled
  await db.updateDoc('users', userId, { postWhitelist: on })
  bustReadCache()
  return {
    ok: true,
    postWhitelist: on,
    message: on ? '已加入发帖白名单，短时间连续发帖不再受限' : '已移出发帖白名单'
  }
}

async function setOfficialLogin(userId, enabled) {
  const id = String(userId || '').trim()
  if (!/^u_[A-Za-z0-9_]+$/.test(id)) return { ok: false, message: '请填写 u_ 开头的账号编号' }
  const user = await db.getDoc('users', id)
  if (!user) return { ok: false, message: '账号不存在' }
  const on = !!enabled
  const patch = { officialLoginAllowed: on }
  if (!on) patch.actingOfficial = false
  await db.updateDoc('users', id, patch)
  bustReadCache()
  return {
    ok: true,
    officialLoginAllowed: on,
    message: on ? '已允许这个账号登录黎安校园墙' : '已取消官方登录权限'
  }
}

function publicAccount(item) {
  if (!item) return null
  const {
    openid,
    unionid,
    passwordHash,
    passwordSalt,
    bindCode,
    bindCodeExpireAt,
    webWechatOpenid,
    ...rest
  } = item
  return rest
}

// 「发言前必须绑定手机号」开关：云函数读 meta/phone_policy，约 1 分钟内生效
async function getPhonePolicy() {
  const doc = await db.getDoc('meta', 'phone_policy')
  return { ok: true, required: !!(doc && doc.required), updatedAt: (doc && doc.updatedAt) || 0, updatedBy: (doc && doc.updatedBy) || '' }
}

async function setPhonePolicy(required, operator = '') {
  await db.setDoc('meta', 'phone_policy', { id: 'phone_policy', required: !!required, updatedAt: Date.now(), updatedBy: operator })
  const logId = uid('sl_')
  await db.setDoc('security_logs', logId, {
    id: logId,
    level: 'warn',
    type: 'phone_policy',
    operator,
    detail: required ? '打开「发言前必须绑定手机号」' : '关闭「发言前必须绑定手机号」',
    createdAt: Date.now()
  })
  return getPhonePolicy()
}

async function listPostWhitelist() {
  const users = db.useLocal()
    ? (await db.allDocs('users')).filter((item) => item.postWhitelist)
    : (await db.getDb().collection('users').where({ postWhitelist: true }).limit(100).get()).data || []
  return users
    .map(publicAccount)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

async function listOfficialLogin() {
  const users = db.useLocal()
    ? (await db.allDocs('users')).filter((item) => item.officialLoginAllowed)
    : (await db.getDb().collection('users').where({ officialLoginAllowed: true }).limit(100).get()).data || []
  return users
    .map((item) => publicAccount({ ...item, id: item.id || item._id }))
    .filter((item) => item && /^u_/.test(item.id || ''))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

async function searchAccounts(query) {
  const q = String(query || '').trim().slice(0, 40)
  if (!q) return []
  if (db.useLocal()) {
    const users = await db.allDocs('users')
    return users
      .filter((item) => [item.nickname, item.schoolName, item.schoolCampus, item.id, item.phone].join(' ').includes(q))
      .slice(0, 20)
      .map(publicAccount)
  }
  const database = db.getDb()
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regexp = database.RegExp({ regexp: safe, options: 'i' })
  const byId = /^u_[A-Za-z0-9_]+$/.test(q)
    ? await db.getDoc('users', q).then((row) => (row ? [row] : [])).catch(() => [])
    : (/^\d{11}$/.test(q)
      // 11 位数字按手机号精确查
      ? ((await database.collection('users').where({ phone: q }).limit(5).get().catch(() => ({ data: [] }))).data || [])
      : [])
  const [byName, bySchool, exact] = await Promise.all([
    database.collection('users').where({ nickname: regexp }).limit(20).get().catch(() => ({ data: [] })),
    database.collection('users').where({ schoolName: regexp }).limit(20).get().catch(() => ({ data: [] })),
    database.collection('users').where({ nickname: q }).limit(20).get().catch(() => ({ data: [] }))
  ])
  const seen = new Set()
  const rows = []
  for (const item of [].concat(byId, exact.data || [], byName.data || [], bySchool.data || [])) {
    const id = item.id || item._id
    if (!id || seen.has(id)) continue
    seen.add(id)
    rows.push(publicAccount({ ...item, id }))
    if (rows.length >= 20) break
  }
  return rows
}

async function setAccountStatus(userId, { status, reason, muteHours } = {}) {
  const user = await db.getDoc('users', userId)
  if (!user) return { ok: false, message: '账号不存在' }
  const nextStatus = status === 'muted' || status === 'banned' ? status : 'active'
  const patch = {
    status: nextStatus,
    banReason: reason || (nextStatus === 'active' ? '' : user.banReason || ''),
    muteUntil: nextStatus === 'muted' ? Date.now() + (Number(muteHours) > 0 ? Number(muteHours) : 24) * security.HOUR : 0,
    bannedAt: nextStatus === 'banned' ? Date.now() : 0
  }
  await db.updateDoc('users', userId, patch)
  const log = {
    id: uid('sl_'),
    level: nextStatus === 'active' ? 'info' : 'critical',
    type: nextStatus === 'active' ? 'unban' : nextStatus === 'banned' ? 'manual_ban' : 'manual_mute',
    userId,
    userNickname: user.nickname,
    detail: patch.banReason || (nextStatus === 'active' ? '已解除限制' : '管理员处置'),
    createdAt: Date.now()
  }
  await db.setDoc('security_logs', log.id, log)
  bustReadCache()
  return { ok: true }
}

async function listSecurityLogs() {
  return cache.wrap('security_logs', 30000, async () => (
    (await db.recentDocs('security_logs', 80)).sort((a, b) => b.createdAt - a.createdAt)
  ))
}

async function listContactViews() {
  return cache.wrap('contact_views', 30000, async () => (
    (await db.recentDocs('contact_views', 80)).sort((a, b) => b.createdAt - a.createdAt)
  ))
}

async function listContactFeedbacks() {
  return cache.wrap('contact_feedbacks', 30000, async () => (
    (await db.recentDocs('contact_feedbacks', 80))
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
  ))
}

async function listIntercepts() {
  return listContentReviews('rejected')
}

const REVIEW_QUEUE = ['pending', 'manual_review', 'edit_required', 'emergency_block']
const REVIEW_ALL = REVIEW_QUEUE.concat(['rejected', 'approved'])

async function listContentReviews(status = 'manual_review', limit = 40) {
  return cache.wrap(`reviews:${status}:${limit}`, 15000, async () => {
    const statuses = status === 'queue'
      ? REVIEW_QUEUE
      : (status === '全部' ? REVIEW_ALL : [status])
    const [forum, wall, comments] = await Promise.all([
      db.findByField('forum_posts', 'reviewStatus', statuses, limit),
      db.findByField('wall_posts', 'reviewStatus', statuses, limit),
      db.findByField('comments', 'reviewStatus', statuses, limit)
    ])
    const forumItems = forum.map((item) => ({
      ...item,
      contentType: 'forum',
      headline: item.title,
      channel: item.category,
      reviewStatusLabel: moderation.reviewStatusLabel(item.reviewStatus)
    }))
    const wallItems = wall.map((item) => {
      const next = {
        ...item,
        contentType: 'wall',
        headline: wallHeadline(item),
        channel: item.tag,
        hasContact: !!(item.contactType && item.contactValue),
        reviewStatusLabel: moderation.reviewStatusLabel(item.reviewStatus)
      }
      delete next.contactValue
      return next
    })
    const commentItems = comments
      .map((item) => ({
        ...item,
        contentType: 'comment',
        headline: String(item.content || '').slice(0, 40) || '评论',
        channel: `${item.targetType || ''} / ${item.targetId || ''}`,
        reviewStatusLabel: moderation.reviewStatusLabel(item.reviewStatus)
      }))
    return [...forumItems, ...wallItems, ...commentItems]
      .sort((a, b) => (
        (b.reviewPriority === 'high' ? 1 : 0) - (a.reviewPriority === 'high' ? 1 : 0)
        || (b.reviewStatus === 'emergency_block' ? 1 : 0) - (a.reviewStatus === 'emergency_block' ? 1 : 0)
        || b.createdAt - a.createdAt
      ))
  })
}

async function getReviewDetail(type, id) {
  const collection = type === 'comment' ? 'comments' : (type === 'forum' ? 'forum_posts' : 'wall_posts')
  const item = await db.getDoc(collection, id)
  if (!item) return { ok: false, message: '内容不存在' }
  const author = item.authorId ? await db.getDoc('users', item.authorId) : null
  const map = await db.resolveCloudUrls(item.images || [])
  return {
    ok: true,
    item: {
      ...item,
      images: db.applyCloudUrls(item.images, map),
      contentType: type,
      headline: type === 'wall' ? wallHeadline(item) : (item.title || String(item.content || '').slice(0, 40)),
      channel: type === 'wall' ? item.tag : (type === 'forum' ? item.category : `${item.targetType}/${item.targetId}`),
      reviewStatusLabel: moderation.reviewStatusLabel(item.reviewStatus),
      anonymous: !!item.anonymous,
      authorRisk: author ? {
        id: author.id,
        nickname: author.nickname,
        status: author.status,
        riskScore: author.riskScore || 0,
        violateCount: author.violateCount || 0,
        schoolName: author.schoolName || '',
        muteUntil: author.muteUntil || 0
      } : null
    }
  }
}

async function reviewContent(type, id, { outcome, note } = {}, operator = '') {
  const collection = type === 'comment' ? 'comments' : (type === 'forum' ? 'forum_posts' : 'wall_posts')
  const post = await db.getDoc(collection, id)
  if (!post) return { ok: false, message: '内容不存在' }
  const nextStatus = outcome || 'rejected'
  const allowed = ['approved', 'rejected', 'edit_required', 'manual_review', 'emergency_block', 'pending']
  if (!allowed.includes(nextStatus)) return { ok: false, message: '未知审核结果' }
  const next = {
    ...post,
    reviewStatus: nextStatus,
    reviewOutcome: nextStatus,
    reviewNote: nextStatus === 'approved' ? (String(note || '').trim() || '人工审核通过') : (String(note || '').trim() || post.reviewNote || ''),
    reviewedAt: Date.now()
  }
  await db.setDoc(collection, id, next)
  const logId = uid('sl_')
  await db.setDoc('security_logs', logId, {
    id: logId,
    level: nextStatus === 'emergency_block' ? 'critical' : 'info',
    type: 'manual_review',
    userId: post.authorId || '',
    userNickname: post.authorName || '',
    operator,
    action: nextStatus,
    targetType: type,
    targetId: id,
    reason: String(note || '').trim(),
    detail: `人工审${type === 'comment' ? '评论' : '帖'} ${type}:${id} → ${nextStatus}`,
    ruleIds: post.reviewRuleIds || [],
    createdAt: Date.now()
  })
  let distribution = null
  if (nextStatus === 'approved' && type === 'wall') {
    distribution = await enqueueApprovedWall(next)
  }
  bustReadCache()
  return { ok: true, post: next, distribution }
}

async function enqueueApprovedWall(post) {
  if (!moderation.isPublicStatus(post.reviewStatus)) return null
  const queue = await db.recentDocs('digest_queue', 50)
  if (queue.some((item) => item.contentId === post.id)) {
    return { queued: true, count: queue.length }
  }
  const item = {
    id: uid('dq_'),
    contentType: 'wall',
    contentId: post.id,
    title: wallHeadline(post),
    summary: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    channel: post.tag || '',
    pagepath: `pages/wall-detail/wall-detail?id=${post.id}`,
    queuedAt: Date.now()
  }
  await db.setDoc('digest_queue', item.id, item)
  bustReadCache()
  return { queued: true, count: queue.length + 1 }
}

async function getLexiconMeta() {
  const meta = await db.getDoc('meta', 'lexicon')
  return meta || { id: 'lexicon', version: 1, updatedAt: 0 }
}

async function ensureLexicons() {
  const rows = await db.allDocs('lexicon_terms')
  const seed = moderation.seedLexiconRows()
  const existing = new Set(rows.map((row) => row.id))
  // 只补新增的内置词：内置词不可删除，因此不会复活管理员移除的词，也不会覆盖停用状态
  const missing = seed.filter((row) => !existing.has(row.id))
  if (!missing.length) return rows
  await Promise.all(missing.map((row) => db.setDoc('lexicon_terms', row.id, row)))
  const meta = await getLexiconMeta()
  await db.setDoc('meta', 'lexicon', {
    id: 'lexicon',
    version: (meta.version || 0) + 1,
    updatedAt: Date.now()
  })
  return rows.concat(missing)
}

async function listLexicons() {
  const rows = (await ensureLexicons()).slice().sort((a, b) => String(a.signal).localeCompare(b.signal) || String(a.word).localeCompare(b.word))
  return { rows, types: moderation.SIGNAL_TYPES, meta: await getLexiconMeta() }
}

async function addLexiconTerm(signal, word) {
  if (!moderation.SIGNAL_TYPES.some((item) => item.id === signal)) return { ok: false, message: '未知词库类型' }
  const text = String(word || '').trim()
  if (!text) return { ok: false, message: '请填写词语' }
  const rows = await ensureLexicons()
  if (rows.some((item) => item.signal === signal && item.word === text)) return { ok: false, message: '这个词已经在词库里' }
  const meta = await getLexiconMeta()
  const now = Date.now()
  const row = {
    id: `${signal}::${text}`,
    signal,
    word: text,
    enabled: true,
    locked: false,
    version: (meta.version || 1) + 1,
    createdAt: now,
    updatedAt: now
  }
  await db.setDoc('lexicon_terms', row.id, row)
  const nextMeta = { id: 'lexicon', version: (meta.version || 1) + 1, updatedAt: now }
  await db.setDoc('meta', 'lexicon', nextMeta)
  return { ok: true, row, ...(await listLexicons()) }
}

async function toggleLexiconTerm(id, enabled) {
  const row = await db.getDoc('lexicon_terms', id)
  if (!row) return { ok: false, message: '词条不存在' }
  const next = { ...row, enabled: enabled == null ? !row.enabled : !!enabled, updatedAt: Date.now() }
  await db.setDoc('lexicon_terms', id, next)
  const meta = await getLexiconMeta()
  await db.setDoc('meta', 'lexicon', { id: 'lexicon', version: (meta.version || 1) + 1, updatedAt: Date.now() })
  return { ok: true, row: next, ...(await listLexicons()) }
}

async function removeLexiconTerm(id) {
  const row = await db.getDoc('lexicon_terms', id)
  if (!row) return { ok: false, message: '词条不存在' }
  if (row.locked) return { ok: false, message: '首批示例词不能删除，可以停用' }
  await db.removeDoc('lexicon_terms', id)
  const meta = await getLexiconMeta()
  await db.setDoc('meta', 'lexicon', { id: 'lexicon', version: (meta.version || 1) + 1, updatedAt: Date.now() })
  return { ok: true, ...(await listLexicons()) }
}

async function listSchoolRequests(status = 'pending') {
  return cache.wrap(`school_requests:${status}`, 20000, async () => {
    let list = (await db.recentDocs('school_requests', 120))
      .filter((item) => item.type !== 'student_auth')
      .sort((a, b) => b.createdAt - a.createdAt)
    if (status && status !== '全部') list = list.filter((item) => item.status === status)
    return list
  })
}

async function listStudentAuthRequests(status = 'pending') {
  return cache.wrap(`student_auth:${status}`, 20000, async () => {
    let list = (await db.recentDocs('school_requests', 120))
      .filter((item) => item.type === 'student_auth')
      .sort((a, b) => b.createdAt - a.createdAt)
    if (status && status !== '全部') list = list.filter((item) => item.status === status)
    const map = await db.resolveCloudUrls(list.flatMap((item) => item.images || []))
    return list.map((item) => ({
      ...item,
      images: db.applyCloudUrls(item.images, map)
    }))
  })
}

async function setUserSchool(userId, { schoolName, schoolCampus } = {}) {
  const id = String(userId || '').trim()
  if (!/^u_[A-Za-z0-9_]+$/.test(id)) return { ok: false, message: '请填写 u_ 开头的账号编号' }
  const user = await db.getDoc('users', id)
  if (!user) return { ok: false, message: '账号不存在' }
  const name = String(schoolName || '').trim()
  if (!name) return { ok: false, message: '请填写学校名称' }
  if (name.length < 2) return { ok: false, message: '学校名称过短，请填写全称' }
  if (name.length > 40) return { ok: false, message: '学校名称过长' }
  const campus = String(schoolCampus || '').trim().slice(0, 20)
  await db.updateDoc('users', id, {
    schoolName: name,
    schoolCampus: campus,
    schoolLocked: true,
    schoolSubmittedAt: user.schoolSubmittedAt || Date.now()
  })
  const school = user.showSchoolTag ? [name, campus].filter(Boolean).join(' · ') : ''
  const [forum, wall] = await Promise.all([
    db.findByField('forum_posts', 'authorId', id, 100),
    db.findByField('wall_posts', 'authorId', id, 100)
  ])
  await Promise.all([
    ...forum.filter((item) => !item.anonymous).map((item) => db.updateDoc('forum_posts', item.id || item._id, { authorSchool: school })),
    ...wall.filter((item) => !item.anonymous).map((item) => db.updateDoc('wall_posts', item.id || item._id, { authorSchool: school }))
  ])
  return {
    ok: true,
    schoolName: name,
    schoolCampus: campus,
    message: `已把学校改为${[name, campus].filter(Boolean).join(' · ')}`
  }
}

async function reviewSchoolChange(requestId, { approved, note } = {}) {
  const req = await db.getDoc('school_requests', requestId)
  if (!req || req.status !== 'pending' || req.type === 'student_auth') return { ok: false, message: '申请不存在或已处理' }
  const updated = {
    ...req,
    status: approved ? 'approved' : 'rejected',
    reviewedAt: Date.now(),
    reviewNote: note || (approved ? '审核通过' : '审核未通过')
  }
  await db.setDoc('school_requests', requestId, updated)
  bustReadCache()
  const user = await db.getDoc('users', req.userId)
  if (user) {
    const patch = { schoolChangeRequest: updated }
    if (approved) {
      patch.schoolName = req.newSchoolName
      patch.schoolCampus = req.newSchoolCampus
      patch.schoolLocked = true
    }
    await db.updateDoc('users', req.userId, patch)
  }
  return { ok: true }
}

async function reviewStudentAuth(requestId, { approved, note } = {}) {
  const req = await db.getDoc('school_requests', requestId)
  if (!req || req.status !== 'pending' || req.type !== 'student_auth') {
    return { ok: false, message: '申请不存在或已处理' }
  }
  const updated = {
    ...req,
    status: approved ? 'approved' : 'rejected',
    reviewedAt: Date.now(),
    reviewNote: note || (approved ? '学生身份核验通过' : '材料不清或不符，请重新提交')
  }
  await db.setDoc('school_requests', requestId, updated)
  const user = await db.getDoc('users', req.userId)
  if (user) {
    await db.updateDoc('users', req.userId, {
      studentAuthStatus: updated.status,
      studentAuthReviewedAt: updated.reviewedAt,
      studentAuthReviewNote: updated.reviewNote
    })
  }
  return { ok: true }
}

async function digestState() {
  return cache.wrap('digest_state', 20000, async () => {
    await Promise.all([
      db.ensureCollection('digest_queue'),
      db.ensureCollection('digests')
    ])
    const [queuedRaw, groupsRaw, digestsRaw, logsRaw, candidates] = await Promise.all([
      db.recentDocs('digest_queue', 50).catch((err) => {
        console.warn('[digestState] digest_queue', err && err.message)
        return []
      }),
      db.recentDocs('distribute_targets', 50).catch(() => []),
      db.recentDocs('digests', 30).catch((err) => {
        console.warn('[digestState] digests', err && err.message)
        return []
      }),
      db.recentDocs('distribute_logs', 40).catch(() => []),
      listDigestCandidates(30).catch(() => [])
    ])
    const queued = queuedRaw.sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0))
    const groups = groupsRaw.filter((item) => item.enabled && item.receiveDigest)
    const digests = digestsRaw.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const logs = logsRaw.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return {
      progress: {
        size: DIGEST_SIZE,
        count: queued.length,
        remain: Math.max(0, DIGEST_SIZE - queued.length),
        queued,
        digestGroups: groups,
        digestGroupText: groups.length ? groups.map((item) => item.name).join('、') : '尚未指定'
      },
      candidates,
      digests,
      logs
    }
  })
}

function getWecom() {
  return require(path.join(__dirname, '../../server/wecom-distribute'))
}

function wecomStatus() {
  return getWecom().envStatus()
}

function wecomHumanMessage(wecom) {
  if (!wecom) return '还没调用企微。先把企业ID、Secret、群主账号配进 server/.env。'
  if (wecom.error) return `企微失败：${wecom.error}`
  const results = wecom.results || []
  if (!results.length) return '没有可发送的客户群。先到「企微群发」点拉取并绑定。'
  const failed = results.filter((item) => item.result && item.result.errcode)
  const okItems = results.filter((item) => item.result && !item.result.errcode)
  if (failed.length) {
    return `企微失败：${failed.map((item) => item.result.errmsg || '未知错误').join('；')}`
  }
  if (okItems.length) return '已创建企微群发。请让群主打开企业微信点「确认发送」。'
  return '企微无有效结果'
}

async function resolveTargets(targets) {
  const status = wecomStatus()
  if (!status.ready) return targets
  const wecom = getWecom()
  const token = await wecom.getWecomToken()
  const next = []
  for (const group of targets) {
    let chatId = String(group.chatId || '').trim() || process.env.WECOM_CHAT_ID || ''
    if (!chatId) {
      chatId = await wecom.findChatIdByName(token, group.name || status.groupName)
    }
    const sender = String(group.sender || '').trim() || process.env.WECOM_SENDER || ''
    if (chatId && (chatId !== group.chatId || sender !== group.sender) && group.id) {
      await db.setDoc('distribute_targets', group.id, { ...group, chatId, sender })
    }
    next.push({ ...group, chatId, sender })
  }
  return next
}

async function pullWecomGroups() {
  const status = wecomStatus()
  if (!status.ready) {
    return { ok: false, message: `还没配齐：${status.missing.join('、')}`, status }
  }
  try {
    const token = await getWecom().getWecomToken()
    const groups = await getWecom().listCustomerGroupsDetailed(token)
    return { ok: true, groups, status }
  } catch (err) {
    return { ok: false, message: err.message || '拉取客户群失败', status }
  }
}

async function syncTestGroup() {
  const pulled = await pullWecomGroups()
  if (!pulled.ok) return pulled
  const targetName = process.env.WECOM_GROUP_NAME || '群聊推送测试'
  const match = (pulled.groups || []).find((item) => item.name.includes(targetName))
  if (!match) {
    return { ok: false, message: `企微里没找到「${targetName}」`, groups: pulled.groups }
  }
  const groups = await listGroups()
  const current = groups.find((item) => String(item.name || '').includes(targetName)) || groups[0]
  const next = {
    ...current,
    name: match.name || current.name,
    chatId: match.chatId,
    sender: current.sender || process.env.WECOM_SENDER || '',
    enabled: true,
    receiveDigest: true
  }
  await db.setDoc('distribute_targets', next.id, next)
  return { ok: true, group: next, groups: pulled.groups }
}

function wxGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (err) { reject(err) }
      })
    }).on('error', reject)
  })
}

function wxPost(url, body) {
  const payload = JSON.stringify(body || {})
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (err) { reject(err) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

let miniTokenCache = { token: '', expireAt: 0 }

async function getMiniAccessToken() {
  if (miniTokenCache.token && miniTokenCache.expireAt > Date.now() + 60000) return miniTokenCache.token
  const appid = process.env.MINI_APPID || ''
  const secret = process.env.MINI_SECRET || ''
  if (!appid || !secret) throw new Error('服务器还没配置小程序 AppSecret，暂时不能生成文字链')
  const data = await wxGet(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`)
  if (!data.access_token) throw new Error(data.errmsg || '获取小程序凭证失败')
  miniTokenCache = { token: data.access_token, expireAt: Date.now() + (Number(data.expires_in) || 7200) * 1000 }
  return miniTokenCache.token
}

async function miniShortLink(pageUrl, title) {
  const token = await getMiniAccessToken()
  const page = String(pageUrl || '').replace(/^\//, '')
  const pageTitle = String(title || '查看').replace(/\s+/g, '').slice(0, 12) || '查看'
  const data = await wxPost(`https://api.weixin.qq.com/wxa/genwxashortlink?access_token=${encodeURIComponent(token)}`, {
    page_url: page,
    page_title: pageTitle,
    is_permanent: false
  })
  if (!data.link) throw new Error(data.errmsg || '短链生成失败')
  return data.link
}

function itemPage(item) {
  if (item.pagepath) return String(item.pagepath).replace(/^\//, '')
  if (item.contentType === 'forum') return `pages/forum-detail/forum-detail?id=${item.contentId || item.id}`
  return `pages/wall-detail/wall-detail?id=${item.contentId || item.id}`
}

async function buildDigestPaste(digest) {
  const lines = [digest.title || '黎安话事精选', '']
  const linked = []
  for (let i = 0; i < (digest.items || []).length; i += 1) {
    const item = digest.items[i]
    let link = ''
    try {
      link = await miniShortLink(itemPage(item), '查看')
    } catch (err) {
      link = `（这条文字链没生成：${err.message || '失败'}）`
    }
    linked.push({ ...item, shortLink: link })
    lines.push(`${i + 1}. ${item.title || '未命名'}`)
    if (item.summary) lines.push(item.summary)
    lines.push(link)
    lines.push('')
  }
  try {
    const all = await miniShortLink(`pages/digest/digest?id=${digest.id}`, '本期')
    lines.push('查看本期全部')
    lines.push(all)
  } catch (err) {
    lines.push(`（汇总页文字链没生成：${err.message || '失败'}）`)
  }
  return { pasteText: lines.join('\n').trim(), items: linked }
}

async function attachDigestPaste(digest) {
  const built = await buildDigestPaste(digest)
  const next = { ...digest, pasteText: built.pasteText, items: built.items, pasteAt: Date.now() }
  await db.setDoc('digests', digest.id, next)
  return next
}

async function flushDigest(force = true) {
  const queued = (await db.allDocs('digest_queue')).sort((a, b) => a.queuedAt - b.queuedAt)
  if (!queued.length) return { ok: false, message: '队列是空的' }
  if (!force && queued.length < DIGEST_SIZE) return { ok: false, message: '未满 10 条' }
  const items = queued.slice(0, DIGEST_SIZE).map(({ _id, ...rest }) => rest)
  return publishDigest(items)
}

async function refillDigestPaste(id) {
  const digest = await db.getDoc('digests', id)
  if (!digest) return { ok: false, message: '这份汇总不存在' }
  try {
    const saved = await attachDigestPaste(digest)
    return { ok: true, digest: saved, message: '文字链已更新' }
  } catch (err) {
    return { ok: false, message: err.message || '文字链生成失败' }
  }
}

async function recentApproved(name, limit) {
  if (!db.useLocal()) {
    try {
      const res = await db.getDb().collection(name)
        .where({ reviewStatus: 'approved' })
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()
      const rows = (res.data || []).map((item) => ({ ...item, id: item.id || item._id }))
      if (rows.length) return rows
    } catch (err) {
      console.warn('[recentApproved]', name, err && err.message)
    }
  }
  const rows = await db.recentDocs(name, Math.max(limit * 2, 40))
  return rows
    .filter((item) => !item.reviewStatus || item.reviewStatus === 'approved')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit)
}

function toDigestItem(post, type) {
  const id = post.id || post._id
  if (type === 'forum') {
    return {
      contentType: 'forum',
      contentId: id,
      title: String(post.title || '学习分享').trim() || '学习分享',
      summary: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      channel: `学习分享 · ${post.category || '全部'}`,
      pagepath: `pages/forum-detail/forum-detail?id=${id}`,
      createdAt: post.createdAt || 0
    }
  }
  return {
    contentType: 'wall',
    contentId: id,
    title: wallHeadline(post),
    summary: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    channel: `互助广场 · ${post.tag || ''}`,
    pagepath: `pages/wall-detail/wall-detail?id=${id}`,
    createdAt: post.createdAt || 0
  }
}

async function listDigestCandidates(limit = 30) {
  const take = Math.min(40, Math.max(limit, 10))
  const [walls, forums] = await Promise.all([
    recentApproved('wall_posts', take),
    recentApproved('forum_posts', take)
  ])
  const rows = walls.map((post) => ({ post, item: toDigestItem(post, 'wall') }))
    .concat(forums.map((post) => ({ post, item: toDigestItem(post, 'forum') })))
    .sort((a, b) => (b.item.createdAt || 0) - (a.item.createdAt || 0))
    .slice(0, limit)
  // 挑帖页逐行列出：话题按小程序首页的口径显示，附正文预览和互动数，方便运营判断
  return rows.map(({ post, item }) => ({
    ...item,
    topic: homeFeed.isOfficialPost(post)
      ? homeFeed.OFFICIAL_TOPIC
      : homeFeed.normalizeTopic(homeFeed.primaryTag(post, item.contentType)),
    imageCount: Array.isArray(post.images) ? post.images.length : 0,
    excerpt: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    authorName: post.anonymous ? '匿名' : (post.authorName || ''),
    likeCount: Number(post.likeCount) || 0,
    commentCount: Number(post.commentCount) || 0
  }))
}

async function publishDigest(items) {
  const picked = (items || [])
    .filter((item) => item && item.contentId)
    .slice(0, DIGEST_SIZE)
    .map((item) => ({
      contentType: item.contentType === 'forum' ? 'forum' : 'wall',
      contentId: String(item.contentId),
      title: String(item.title || '未命名').slice(0, 80),
      summary: String(item.summary || '').slice(0, 120),
      channel: String(item.channel || '').slice(0, 40),
      pagepath: String(item.pagepath || itemPage(item)).replace(/^\//, ''),
      createdAt: Number(item.createdAt) || 0
    }))
  if (!picked.length) return { ok: false, message: '没有可汇总的帖子' }
  await Promise.all([
    db.ensureCollection('digest_queue'),
    db.ensureCollection('digests')
  ])
  try {
    const queue = await db.allDocs('digest_queue')
    const ids = new Set(picked.map((item) => item.contentId))
    await Promise.all(queue
      .filter((item) => ids.has(item.contentId) && (item.id || item._id))
      .map((item) => db.removeDoc('digest_queue', item.id || item._id).catch(() => {})))
  } catch (err) {
    console.warn('[publishDigest] clear queue', err && err.message)
  }
  const digest = {
    id: uid('dg_'),
    items: picked,
    title: `黎安话事精选 · ${picked.length}条汇总`,
    summary: picked.map((item, index) => `${index + 1}.${item.title}`).join(' ').slice(0, 120),
    createdAt: Date.now()
  }
  digest.pagepath = `pages/digest/digest?id=${digest.id}`
  digest.sharePath = `/pages/digest/digest?id=${digest.id}`
  try {
    await db.setDoc('digests', digest.id, digest)
  } catch (err) {
    console.error('[publishDigest] setDoc', err && err.message)
    return { ok: false, message: `写入推文失败：${err.message || '云数据库错误'}` }
  }
  let saved = digest
  try {
    saved = await attachDigestPaste(digest)
  } catch (err) {
    saved = { ...digest, pasteText: `文字链生成失败：${err.message || '失败'}` }
    try {
      await db.setDoc('digests', digest.id, saved)
    } catch (err2) {
      // 正文已落库，文字链失败不挡返回
    }
  }
  // 文字链写完再清缓存，否则推文列表要等 20 秒才出现新稿
  bustReadCache()
  return {
    ok: true,
    digest: saved,
    message: '汇总文案已生成。到「公众号推文」页复制，贴进公众号即可。'
  }
}

async function buildDigestByTime(range) {
  try {
    const candidates = await listDigestCandidates(40)
    const now = Date.now()
    let list = candidates
    let label = '最近 10 条'
    let limit = DIGEST_SIZE
    if (range === 'latest5') {
      limit = 5
      label = '最近 5 条'
    } else if (range === '24h') {
      list = candidates.filter((item) => now - (item.createdAt || 0) < 24 * 60 * 60 * 1000)
      label = '最近 24 小时'
    } else if (range === '7d') {
      list = candidates.filter((item) => now - (item.createdAt || 0) < 7 * 24 * 60 * 60 * 1000)
      label = '最近 7 天'
    }
    const picked = list.slice(0, limit)
    if (!picked.length) return { ok: false, message: `${label}里没有已通过的帖子` }
    const result = await publishDigest(picked)
    if (result.ok) {
      const byTime = range === '24h' || range === '7d'
      const extra = byTime && list.length > picked.length ? `。这个范围共 ${list.length} 条，已取最新 ${picked.length} 条` : ''
      result.message = `已按时间生成${label}的推文${extra}。复制后贴进公众号即可。`
    }
    return result
  } catch (err) {
    console.error('[buildDigestByTime]', err && err.message)
    return { ok: false, message: err.message || '按时间出成稿失败' }
  }
}

async function buildDigestFromSelection(picks) {
  try {
    const wanted = []
    const seen = new Set()
    ;(Array.isArray(picks) ? picks : []).forEach((pick) => {
      const contentId = String((pick && (pick.contentId || pick.id)) || '').trim()
      const contentType = pick && pick.contentType === 'forum' ? 'forum' : 'wall'
      if (!contentId || seen.has(contentId) || wanted.length >= DIGEST_SIZE) return
      seen.add(contentId)
      wanted.push({ contentType, contentId })
    })
    if (!wanted.length) return { ok: false, message: '先勾选要放进推文的帖子' }
    const items = []
    for (const pick of wanted) {
      const post = await db.getDoc(pick.contentType === 'forum' ? 'forum_posts' : 'wall_posts', pick.contentId)
      if (!post) continue
      if (post.reviewStatus && post.reviewStatus !== 'approved') continue
      items.push(toDigestItem(post, pick.contentType))
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    if (!items.length) return { ok: false, message: '勾选的帖子不存在，或还没通过审核' }
    const result = await publishDigest(items)
    if (result.ok) result.message = `已用勾选的 ${items.length} 条生成推文，按时间从新到旧排列。`
    return result
  } catch (err) {
    console.error('[buildDigestFromSelection]', err && err.message)
    return { ok: false, message: err.message || '生成推文失败' }
  }
}

async function listGroups() {
  return cache.wrap('groups', 60000, async () => {
    const groups = await db.recentDocs('distribute_targets', 50)
    if (groups.length) return groups
    const seed = {
      id: 'g_customer',
      name: '群聊推送测试',
      type: 'external',
      enabled: true,
      webhook: '',
      chatId: '',
      sender: '',
      scopes: ['wall'],
      categories: [],
      boards: ['*'],
      desc: '群主企微 + 同学微信',
      receiveDigest: true
    }
    await db.setDoc('distribute_targets', seed.id, seed)
    return [seed]
  })
}

async function addGroup(payload) {
  const name = String(payload.name || '').trim()
  if (!name) return { ok: false, message: '请填写群名称' }
  const group = {
    id: uid('g_'),
    name,
    type: 'external',
    enabled: true,
    webhook: '',
    chatId: String(payload.chatId || '').trim(),
    sender: String(payload.sender || '').trim(),
    scopes: ['wall'],
    categories: [],
    boards: ['*'],
    desc: '群主企微 + 同学普通微信的客户群',
    receiveDigest: payload.receiveDigest !== false
  }
  await db.setDoc('distribute_targets', group.id, group)
  return { ok: true, group }
}

async function updateGroup(id, payload) {
  const group = await db.getDoc('distribute_targets', id)
  if (!group) return { ok: false, message: '群不存在' }
  const next = {
    ...group,
    name: payload.name == null ? group.name : String(payload.name).trim(),
    chatId: payload.chatId == null ? group.chatId : String(payload.chatId).trim(),
    sender: payload.sender == null ? group.sender : String(payload.sender).trim()
  }
  if (!next.name) return { ok: false, message: '请填写群名称' }
  await db.setDoc('distribute_targets', id, next)
  return { ok: true, group: next }
}

async function toggleGroup(id, field) {
  const group = await db.getDoc('distribute_targets', id)
  if (!group) return { ok: false, message: '群不存在' }
  if (field === 'receiveDigest') {
    group.receiveDigest = !group.receiveDigest
    group.enabled = true
  } else {
    group.enabled = !group.enabled
  }
  await db.setDoc('distribute_targets', id, group)
  return { ok: true, group }
}

const WEEKLY_HOT_MAX = 20

function defaultWeeklyHot() {
  return {
    id: 'current',
    title: '园区热议',
    subtitle: '管理员精选热榜',
    enabled: true,
    items: [],
    updatedAt: 0
  }
}

function buildWeeklyItem(type, post, rank = 1) {
  const contentType = type === 'forum' ? 'forum' : 'wall'
  const title = String(
    contentType === 'forum' ? (post.title || '') : wallHeadline(post)
  ).trim()
  const summary = String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return {
    contentType,
    contentId: post.id,
    title: title || summary.slice(0, 36),
    summary,
    oneLiner: title || summary.slice(0, 36),
    channel: contentType === 'forum' ? `学习分享 · ${post.category || ''}` : `互助广场 · ${post.tag || ''}`,
    tag: contentType === 'forum' ? (post.category || '') : (post.tag || ''),
    pagepath: contentType === 'forum'
      ? `pages/forum-detail/forum-detail?id=${post.id}`
      : `pages/wall-detail/wall-detail?id=${post.id}`,
    likeCount: post.likeCount || 0,
    commentCount: post.commentCount || 0,
    rank,
    pinnedAt: Date.now()
  }
}

async function getWeeklyHotBoard() {
  const board = (await db.getDoc('weekly_hot', 'current')) || defaultWeeklyHot()
  const rawItems = board.items || []
  const posts = await Promise.all(rawItems.map(async (item) => {
    const type = item.contentType === 'forum' ? 'forum' : 'wall'
    const collection = type === 'forum' ? 'forum_posts' : 'wall_posts'
    const post = await db.getDoc(collection, item.contentId).catch(() => null)
    return { item, type, post }
  }))
  const items = posts.map(({ item, type, post }, index) => {
    if (!post || post.reviewStatus === 'rejected') return null
    return { ...buildWeeklyItem(type, post, index + 1), pinnedAt: item.pinnedAt || Date.now() }
  }).filter(Boolean)
  return {
    ...defaultWeeklyHot(),
    ...board,
    id: 'current',
    items,
    count: items.length,
    forumCount: items.filter((item) => item.contentType === 'forum').length,
    wallCount: items.filter((item) => item.contentType !== 'forum').length,
    preview: items.slice(0, 8)
  }
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function weeklyCandidateFromPost(post, contentType) {
  const id = post.id || post._id
  return {
    id,
    contentType,
    title: contentType === 'forum' ? post.title : wallHeadline(post),
    summary: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    tag: contentType === 'forum' ? (post.category || '') : (post.tag || ''),
    // 计数直接取原帖字段：缺字段说明从未累加过，按真实 0 处理；字段损坏返回 null，页面显示「—」不冒充 0
    viewCount: postStat(post.viewCount),
    likeCount: postStat(post.likeCount),
    commentCount: postStat(post.commentCount),
    createdAt: post.createdAt
  }
}

function postStat(value) {
  if (value == null) return 0
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : null
}

function matchesWeeklyKeyword(post, contentType, q) {
  if (!q) return true
  const hay = contentType === 'forum'
    ? `${post.title || ''} ${post.content || ''} ${post.category || ''}`
    : `${post.title || ''} ${post.content || ''} ${post.tag || ''}`
  return hay.toLowerCase().includes(q)
}

/** 有关键词时用云库正则直查，避免只扫到前几百条漏帖 */
async function searchWeeklyCollection(collection, contentType, keyword, picked) {
  const q = String(keyword || '').trim()
  if (!q) {
    return (await db.recentDocs(collection, 120))
      .filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
      .filter((item) => !picked.has(`${contentType}:${item.id || item._id}`))
      .map((post) => weeklyCandidateFromPost(post, contentType))
  }
  if (db.useLocal()) {
    return (await db.recentDocs(collection, 200))
      .filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
      .filter((item) => !picked.has(`${contentType}:${item.id || item._id}`))
      .filter((item) => matchesWeeklyKeyword(item, contentType, q.toLowerCase()))
      .map((post) => weeklyCandidateFromPost(post, contentType))
  }
  const database = db.getDb()
  const _ = database.command
  const reg = database.RegExp({ regexp: escapeRegExp(q), options: 'i' })
  const orFields = contentType === 'forum'
    ? [{ title: reg }, { content: reg }, { category: reg }]
    : [{ title: reg }, { content: reg }, { tag: reg }]
  const res = await database.collection(collection).where(_.or(orFields)).limit(100).get()
  return (res.data || [])
    .map((row) => ({ ...row, id: row.id || row._id }))
    .filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
    .filter((item) => !picked.has(`${contentType}:${item.id}`))
    .filter((item) => matchesWeeklyKeyword(item, contentType, q.toLowerCase()))
    .map((post) => weeklyCandidateFromPost(post, contentType))
}

async function listWeeklyHotCandidates(keyword = '') {
  const board = await getWeeklyHotBoard()
  const picked = new Set((board.items || []).map((item) => `${item.contentType || 'wall'}:${item.contentId}`))
  const [walls, forums] = await Promise.all([
    searchWeeklyCollection('wall_posts', 'wall', keyword, picked),
    searchWeeklyCollection('forum_posts', 'forum', keyword, picked)
  ])
  return walls.concat(forums).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 40)
}

async function saveWeeklyHotBoard(board) {
  const items = (board.items || []).map((item, index) => ({ ...item, rank: index + 1 }))
  const next = {
    ...defaultWeeklyHot(),
    ...board,
    id: 'current',
    items,
    updatedAt: Date.now()
  }
  await db.setDoc('weekly_hot', 'current', next)
  return getWeeklyHotBoard()
}

async function updateWeeklyHotMeta(payload = {}) {
  const board = await getWeeklyHotBoard()
  const next = await saveWeeklyHotBoard({
    ...board,
    title: payload.title != null ? String(payload.title).trim() || board.title : board.title,
    subtitle: payload.subtitle != null ? String(payload.subtitle).trim() : board.subtitle,
    enabled: payload.enabled == null ? board.enabled : !!payload.enabled
  })
  return { ok: true, board: next }
}

async function addWeeklyHotItem(contentId, contentType = 'wall') {
  const type = contentType === 'forum' ? 'forum' : 'wall'
  const collection = type === 'forum' ? 'forum_posts' : 'wall_posts'
  const post = await db.getDoc(collection, contentId)
  if (!post || !moderation.isPublicStatus(post.reviewStatus || 'approved')) {
    return { ok: false, message: type === 'forum' ? '只能添加已通过的学习分享内容' : '只能添加已通过的互助广场内容' }
  }
  const board = await getWeeklyHotBoard()
  if ((board.items || []).some((item) => item.contentId === contentId && (item.contentType || 'wall') === type)) {
    return { ok: false, message: '已在热榜中' }
  }
  if ((board.items || []).length >= WEEKLY_HOT_MAX) {
    return { ok: false, message: `热榜最多 ${WEEKLY_HOT_MAX} 条` }
  }
  const next = await saveWeeklyHotBoard({
    ...board,
    items: [buildWeeklyItem(type, post, 1), ...(board.items || [])]
  })
  return { ok: true, board: next }
}

async function removeWeeklyHotItem(contentId, contentType) {
  const board = await getWeeklyHotBoard()
  const items = (board.items || []).filter((item) => {
    if (item.contentId !== contentId) return true
    if (contentType && (item.contentType || 'wall') !== contentType) return true
    return false
  })
  if (items.length === (board.items || []).length) {
    return { ok: false, message: '热榜中没有这条' }
  }
  const next = await saveWeeklyHotBoard({ ...board, items })
  return { ok: true, board: next }
}

async function moveWeeklyHotItem(contentId, direction, contentType) {
  const board = await getWeeklyHotBoard()
  const items = [...(board.items || [])]
  const index = items.findIndex((item) => (
    item.contentId === contentId
    && (!contentType || (item.contentType || 'wall') === contentType)
  ))
  if (index < 0) return { ok: false, message: '热榜中没有这条' }
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) return { ok: false, message: '已经到顶/底了' }
  const tmp = items[index]
  items[index] = items[target]
  items[target] = tmp
  const next = await saveWeeklyHotBoard({ ...board, items })
  return { ok: true, board: next }
}

async function weeklyHotState(keyword = '') {
  const key = `weekly_hot:${String(keyword || '').trim()}`
  return cache.wrap(key, 20000, async () => {
    const [board, candidates] = await Promise.all([
      getWeeklyHotBoard(),
      listWeeklyHotCandidates(keyword)
    ])
    return { board, candidates, max: WEEKLY_HOT_MAX }
  })
}

// 举报工单的逻辑在 report-cases.js；这里保留旧接口：按单条举报 id 找到工单再整单处理
const LEGACY_REPORT_ACTIONS = { dismiss: 'dismiss', delete: 'takedown', hide: 'takedown', mute: 'mute_author', ban: 'ban_author' }

async function resolveReport(reportId, { action, note, muteHours, targetType, targetId } = {}, operator = '') {
  let type = targetType
  let id = targetId
  if (reportId && (!type || !id)) {
    const row = await db.getDoc('reports', reportId)
    if (!row) return { ok: false, message: '举报不存在' }
    type = row.targetType
    id = row.targetId
  }
  const act = LEGACY_REPORT_ACTIONS[action] || action
  return require('./report-cases').resolveCase({ targetType: type, targetId: id, action: act, note, muteHours }, operator)
}

async function listReports(options = {}) {
  return require('./report-cases').listReportCases(options)
}

async function dashboard() {
  return cache.wrap('dashboard', 20000, async () => {
    const [ov, reviews] = await Promise.all([
      overview(),
      listContentReviews('queue', 8)
    ])
    return {
      overview: ov,
      reviews: reviews.slice(0, 5)
    }
  })
}

module.exports = {
  dashboard,
  overview,
  listKeywords,
  addKeyword,
  removeKeyword,
  listAccounts,
  setAccountStatus,
  getPhonePolicy,
  setPhonePolicy,
  setAppAdmin,
  setPostWhitelist,
  listPostWhitelist,
  setOfficialLogin,
  listOfficialLogin,
  searchAccounts,
  listSecurityLogs,
  listContactViews,
  listContactFeedbacks,
  listAccounts,
  listReports,
  resolveReport,
  listIntercepts,
  listContentReviews,
  getReviewDetail,
  reviewContent,
  listLexicons,
  addLexiconTerm,
  toggleLexiconTerm,
  removeLexiconTerm,
  listSchoolRequests,
  listStudentAuthRequests,
  setUserSchool,
  reviewSchoolChange,
  reviewStudentAuth,
  digestState,
  flushDigest,
  buildDigestByTime,
  buildDigestFromSelection,
  refillDigestPaste,
  listGroups,
  addGroup,
  updateGroup,
  toggleGroup,
  wecomStatus,
  pullWecomGroups,
  syncTestGroup,
  weeklyHotState,
  updateWeeklyHotMeta,
  addWeeklyHotItem,
  removeWeeklyHotItem,
  moveWeeklyHotItem,
  resetLocalDemo,
  mode: () => (db.useLocal() ? 'local' : 'cloud')
}

async function resetLocalDemo() {
  if (!db.useLocal()) return { ok: false, message: '仅本地演示模式可重置' }
  db.resetLocal()
  return { ok: true, message: '本地演示数据已重置' }
}
