// ⚠ 帖子分两张表：forum_posts（type/contentType/targetType = 'forum'）和 wall_posts（= 'wall'）。
// 这是早期「学习分享 / 互助广场」两个版块留下的存储分法；产品上早已合并成一个首页、一个发帖入口，
// 对用户只显示「帖子」+ 话题（homeFeed.postTopic）。规则：
// 1. 不要合表、不要改 'forum' / 'wall' 取值——评论、点赞、举报、热榜、分享链接、老版本小程序都靠它定位帖子；
// 2. 任何返回给前端或后台显示的文字，不要再出现「学习分享 / 互助广场 / 校园墙」，用话题或「帖子」；
// 3. 新发帖统一进 forum_posts（发帖页只有一个），wall_posts 只读老数据，相关接口仍需同时兼容两张表。
const crypto = require('crypto')
const https = require('https')
const cloud = require('wx-server-sdk')
const security = require('./lib/security')
const reportRules = require('./lib/report-rules')
const wecom = require('./lib/wecom')
const moderation = require('./lib/moderation')
const wxSecurity = require('./lib/wx-security')
const homeFeed = require('./lib/home-feed')
const sharePoster = require('./lib/share-poster')
const defaultProfile = require('./lib/default-profile')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 计量：每次调用累计数据库请求次数，写进云函数日志（[db-meter] 接口名 次数 耗时），用来找最费钱的接口。
// 只计数不改行为；拿到数据、优化完后可以整段删掉。
const { AsyncLocalStorage } = require('async_hooks')
const dbMeter = new AsyncLocalStorage()
const DB_TERMINAL_OPS = new Set(['get', 'set', 'update', 'add', 'remove', 'count'])

function meterQuery(target) {
  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop]
      if (typeof value !== 'function') return value
      return function metered(...args) {
        if (DB_TERMINAL_OPS.has(prop)) {
          const store = dbMeter.getStore()
          if (store) store.count += 1
        }
        const out = value.apply(obj, args)
        return out && typeof out === 'object' && typeof out.then !== 'function' ? meterQuery(out) : out
      }
    }
  })
}

const rawCollection = db.collection.bind(db)
db.collection = (name) => meterQuery(rawCollection(name))

// 环境没开日志服务，计量结果在内存里按接口汇总，每个实例每 10 分钟写一份到 meta/db_meter_<日期>_<实例>（一天几十次写入）
const METER_FLUSH_MS = 10 * 60 * 1000
const meterInstance = crypto.randomBytes(4).toString('hex')
let meterTotals = {}
let meterFlushedAt = Date.now()

function recordMeter(action, count, ms) {
  const key = action || 'unknown'
  const row = meterTotals[key] || (meterTotals[key] = { calls: 0, db: 0, ms: 0, maxDb: 0 })
  row.calls += 1
  row.db += count
  row.ms += ms
  if (count > row.maxDb) row.maxDb = count
}

async function flushMeter(force) {
  const now = Date.now()
  if (!force && now - meterFlushedAt < METER_FLUSH_MS) return
  if (!Object.keys(meterTotals).length) return
  const totals = meterTotals
  meterTotals = {}
  meterFlushedAt = now
  const day = new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const docId = `db_meter_${day}_${meterInstance}`
  try {
    const ref = rawCollection('meta').doc(docId)
    let prev = null
    try {
      prev = (await ref.get()).data
    } catch (err) {
      prev = null
    }
    const merged = { ...((prev && prev.actions) || {}) }
    Object.keys(totals).forEach((key) => {
      const a = merged[key] || { calls: 0, db: 0, ms: 0, maxDb: 0 }
      const b = totals[key]
      merged[key] = { calls: a.calls + b.calls, db: a.db + b.db, ms: a.ms + b.ms, maxDb: Math.max(a.maxDb, b.maxDb) }
    })
    await ref.set({ data: { id: docId, kind: 'db_meter', day, instance: meterInstance, actions: merged, updatedAt: now } })
  } catch (err) {
    // 计量写失败不影响业务
  }
}

const DIGEST_SIZE = 10

/** 云存储 fileID → 临时 HTTPS（云函数有管理端权限，比小程序端更稳） */
function isCloudFileId(value) {
  return /^cloud:\/\//.test(String(value || ''))
}

/** 未签名的 tcb 直链会被渲染层打成 HTTP 451，还原成 fileID 再换管理端临时链 */
function tcbUrlToFileId(value) {
  const raw = String(value || '').trim()
  if (!raw || /[?&]sign=/i.test(raw)) return ''
  const match = raw.match(/^https?:\/\/([a-z0-9-]+)\.tcb\.qcloud\.la\/([^?#]+)/i)
  if (!match) return ''
  const bucket = match[1]
  const path = match[2]
  const envMatch = bucket.match(/^6c69-(.+)-\d+$/)
  const env = envMatch && envMatch[1]
  if (!env || !path) return ''
  return `cloud://${env}.${bucket}/${path}`
}

function mediaFileId(value) {
  const raw = String(value || '').trim()
  if (isCloudFileId(raw)) return raw
  return tcbUrlToFileId(raw)
}

function isMediaFieldKey(key) {
  return key === 'images'
    || key === 'studentAuthImages'
    || /avatar|Avatar|image|Image|cover|photo/i.test(String(key || ''))
}

function collectCloudFileIds(input, bag) {
  if (!input) return
  if (typeof input === 'string') {
    const id = mediaFileId(input)
    if (id) bag.add(id)
    return
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectCloudFileIds(item, bag))
    return
  }
  if (typeof input === 'object') {
    Object.keys(input).forEach((key) => {
      const value = input[key]
      if (isMediaFieldKey(key)) collectCloudFileIds(value, bag)
      else if (value && typeof value === 'object') collectCloudFileIds(value, bag)
    })
  }
}

function applyTempMediaUrls(input, map) {
  if (!input) return input
  if (typeof input === 'string') {
    const id = mediaFileId(input)
    return (id && map[id]) || input
  }
  if (Array.isArray(input)) return input.map((item) => applyTempMediaUrls(item, map))
  if (typeof input === 'object') {
    const next = { ...input }
    Object.keys(next).forEach((key) => {
      const value = next[key]
      if (isMediaFieldKey(key)) next[key] = applyTempMediaUrls(value, map)
      else if (value && typeof value === 'object') next[key] = applyTempMediaUrls(value, map)
    })
    return next
  }
  return input
}

const TEMP_URL_TTL = 30 * 60 * 1000
const tempUrlCache = new Map()

async function resolveTempMediaMap(fileIDs = []) {
  const list = Array.from(new Set((fileIDs || []).map((item) => String(item || '')).filter(isCloudFileId)))
  const map = {}
  const now = Date.now()
  const missing = []
  list.forEach((fileID) => {
    const hit = tempUrlCache.get(fileID)
    if (hit && now - hit.at < TEMP_URL_TTL) map[fileID] = hit.url
    else missing.push(fileID)
  })
  if (!missing.length) return map
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50)
    try {
      const res = await cloud.getTempFileURL({
        fileList: chunk.map((fileID) => ({ fileID, maxAge: 60 * 60 * 6 }))
      })
      const rows = (res && res.fileList) || []
      rows.forEach((row) => {
        const id = row.fileID || row.fileid
        const url = row.tempFileURL || row.download_url || ''
        const status = row.status
        const ok = url && (status === 0 || status === '0' || status === undefined || status === null)
        if (id && ok) {
          map[id] = url
          tempUrlCache.set(id, { url, at: now })
        }
      })
    } catch (err) {
      console.warn('[resolveTempMediaMap]', err && (err.message || err.errMsg || err))
    }
  }
  return map
}

async function withTempMedia(payload) {
  if (!payload) return payload
  const bag = new Set()
  collectCloudFileIds(payload, bag)
  if (!bag.size) return payload
  const map = await resolveTempMediaMap(Array.from(bag))
  if (!Object.keys(map).length) return payload
  return applyTempMediaUrls(payload, map)
}

function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function samePostId(userId, fingerprint) {
  const bucket = Math.floor(Date.now() / 60000)
  const hash = crypto.createHash('sha1').update(`${userId}|${fingerprint}|${bucket}`).digest('hex').slice(0, 20)
  return hash
}

/** 发帖各阶段耗时写进云函数日志，用来判断「发布慢」到底慢在哪一步（先拿证据再优化） */
function logPublishTiming(action, timing, imageCount) {
  const now = Date.now()
  console.log(`[publish-timing] ${action}`, JSON.stringify({
    images: timing.images - timing.start,
    review: timing.review - timing.images,
    save: now - timing.review,
    total: now - timing.start,
    imageCount
  }))
}

function cleanSubmitId(value) {
  const text = String(value || '').trim()
  return /^[A-Za-z0-9_-]{8,64}$/.test(text) ? text : ''
}

/** 新版前端每次发布带稳定的 submitId（超时重试沿用），按它生成帖子 ID；老版本前端没有时退回按分钟分桶 */
function postIdFor(prefix, userId, fingerprint, submitId) {
  if (!submitId) return `${prefix}${samePostId(userId, fingerprint)}`
  const hash = crypto.createHash('sha1').update(`${userId}|submit|${submitId}`).digest('hex').slice(0, 20)
  return `${prefix}${hash}`
}

/** 同一次提交已经落库（例如上次请求超时但服务端已保存）：直接返回那条，不再扣发帖频率、不再判重 */
async function replaySubmittedPost(collection, postId, user) {
  const existing = await readPost(db.collection(collection).doc(postId))
  if (!existing || !existing.id || existing.authorId !== user.id) return null
  const result = publishReviewResult({
    outcome: existing.reviewOutcome,
    reviewStatus: existing.reviewStatus,
    message: existing.reviewNote || ''
  }, existing)
  return { ...result, replayed: true, speakGate: speakGate(user) }
}

function forumFingerprintOf(item) {
  return security.contentFingerprint(item.tag || item.category, item.title, item.content)
}

function wallFingerprintOf(item) {
  return security.contentFingerprint(item.tag, item.title, item.content, item.extra, item.routeFrom, item.routeTo)
}

function recentPostsByAuthor(collection, userId) {
  return db.collection(collection)
    .where({ authorId: userId })
    .orderBy('createdAt', 'desc')
    .limit(30)
    .get()
    .catch(() => ({ data: [] }))
}

function isMissingDoc(err) {
  const text = String((err && (err.errMsg || err.message)) || err || '')
  return /does not exist|不存在|DOCUMENT_NOT_FOUND|-502005/i.test(text)
}

async function newestWhere(name, where, limit) {
  try {
    return await db.collection(name).where(where).orderBy('createdAt', 'desc').limit(limit).get()
  } catch (err) {
    // 缺索引等情况退回不排序的查询，至少不让收件箱空掉
    return db.collection(name).where(where).limit(limit).get().catch(() => ({ data: [] }))
  }
}

async function readPost(ref) {
  try {
    const snap = await ref.get()
    return (snap && snap.data) || null
  } catch (err) {
    if (isMissingDoc(err)) return null
    throw err
  }
}

async function savePostOnce(collection, post) {
  const ref = db.collection(collection).doc(post.id)
  const existing = await readPost(ref)
  if (existing && existing.id) return { post: existing, duplicated: true }
  try {
    await ref.set({ data: post })
  } catch (err) {
    const again = await readPost(ref)
    if (again && again.id) return { post: again, duplicated: true }
    throw err
  }
  return { post, duplicated: false }
}

function formatSchool(user) {
  return [user.schoolName, user.schoolCampus].filter(Boolean).join(' · ')
}

// 分身昵称：同一用户在同一帖子（含帖下评论）里名字固定，换个帖子就换名字，别人无法跨帖关联
// 哈希里带用户 id，前端拿不到 id，也就推不出是谁；后台仍按 authorId 看到真实账号
function aliasNameFor(userId, threadId) {
  const seed = crypto.createHash('sha1').update(`alias|${userId}|${threadId}`).digest('hex').slice(0, 12)
  return defaultProfile.aliasNickname(seed)
}

function authorSchoolForUser(user, anonymous) {
  if (anonymous) return ''
  if (!user || !user.schoolLocked || !user.showSchoolTag) return ''
  return formatSchool(user)
}

const OFFICIAL_AUTHOR_ID = 'official_lian_wall'
const OFFICIAL_AUTHOR_NAME = '黎安校园墙'

async function ensureOfficialAuthor() {
  const row = {
    id: OFFICIAL_AUTHOR_ID,
    openid: OFFICIAL_AUTHOR_ID,
    nickname: OFFICIAL_AUTHOR_NAME,
    avatar: defaultProfile.stableAvatar(OFFICIAL_AUTHOR_ID),
    bio: '校园墙官方发布',
    status: 'active',
    schoolName: '',
    schoolCampus: '',
    schoolLocked: false,
    showSchoolTag: false,
    studentAuthStatus: 'none',
    appAdmin: false,
    postWhitelist: true,
    actingOfficial: false,
    createdAt: Date.now()
  }
  try {
    const res = await db.collection('users').doc(OFFICIAL_AUTHOR_ID).get()
    const existing = res && res.data
    if (existing && (existing.id || existing._id)) {
      if (defaultProfile.isLegacyAvatar(existing.avatar) && !defaultProfile.isCustomAvatar(existing.avatar)) {
        const avatar = defaultProfile.stableAvatar(OFFICIAL_AUTHOR_ID)
        await db.collection('users').doc(OFFICIAL_AUTHOR_ID).update({ data: { avatar } })
        existing = { ...existing, avatar }
        try {
          await syncAuthorProfileOnContent({ ...existing, id: OFFICIAL_AUTHOR_ID }, { syncAvatar: true })
        } catch (err) { /* 官方头像回刷失败不挡住登录 */ }
      }
      if (existing.nickname !== OFFICIAL_AUTHOR_NAME || !existing.postWhitelist) {
        await db.collection('users').doc(OFFICIAL_AUTHOR_ID).update({
          data: { nickname: OFFICIAL_AUTHOR_NAME, postWhitelist: true }
        })
        const next = { ...existing, id: OFFICIAL_AUTHOR_ID, nickname: OFFICIAL_AUTHOR_NAME, postWhitelist: true }
        if (existing.nickname !== OFFICIAL_AUTHOR_NAME) {
          try {
            await syncAuthorProfileOnContent(next, { syncNickname: true })
          } catch (err) { /* 历史帖子改名失败不挡住登录 */ }
        }
        return next
      }
      return existing
    }
  } catch (err) { /* 还没有这个账号 */ }
  await db.collection('users').doc(OFFICIAL_AUTHOR_ID).set({ data: row })
  return row
}

function asOfficialSession(official) {
  return {
    ...official,
    id: OFFICIAL_AUTHOR_ID,
    nickname: OFFICIAL_AUTHOR_NAME,
    postWhitelist: true,
    officialLogin: true,
    status: official.status === 'banned' ? 'active' : (official.status || 'active')
  }
}

function canModerate(user) {
  return !!(user && (user.appAdmin || user.officialLogin || user.id === OFFICIAL_AUTHOR_ID))
}

async function updateDocsByIds(collection, rows, data) {
  if (!rows.length || !data || !Object.keys(data).length) return
  await Promise.all(rows.map((item) => (
    db.collection(collection).doc(item.id || item._id).update({ data })
  )))
}

/** 头像/昵称写在帖子与评论上，资料变更后需回刷历史内容 */
async function syncAuthorProfileOnContent(user, { syncAvatar = false, syncNickname = false, oldNickname = '' } = {}) {
  if (!user || !user.id) return
  if (!syncAvatar && !syncNickname) return

  const postPatch = {}
  if (syncAvatar) postPatch.authorAvatar = defaultProfile.resolveAvatar(user.avatar, user.id)
  if (syncNickname) postPatch.authorName = user.nickname || defaultProfile.stableNickname(user.id)

  const [forum, wall, comments] = await Promise.all([
    allDocs('forum_posts', { authorId: user.id }),
    allDocs('wall_posts', { authorId: user.id }),
    allDocs('comments', { authorId: user.id })
  ])

  await Promise.all([
    updateDocsByIds('forum_posts', forum.filter((item) => !item.anonymous), postPatch),
    updateDocsByIds('wall_posts', wall.filter((item) => !item.anonymous), postPatch),
    updateDocsByIds('comments', comments, postPatch)
  ])

}

function formatDateTime(ts) {
  const date = new Date(ts)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function contactTypeLabel() {
  return '微信号'
}

const WALL_DEAL_STATUSES = [
  { id: 'open', label: '进行中' },
  { id: 'received', label: '已收到' },
  { id: 'done', label: '已成交' },
  { id: 'closed', label: '已关闭' }
]

const CONTACT_FEEDBACK_REASONS = [
  { id: 'reliable', label: '对方靠谱' },
  { id: 'no_reply', label: '加了未回复' },
  { id: 'bad_attitude', label: '态度不好' },
  { id: 'scam_suspected', label: '疑似诈骗' },
  { id: 'other', label: '其他' }
]

const REPORT_REASONS = [
  { id: 'spam', label: '广告引流 / 刷单返利' },
  { id: 'fraud', label: '疑似诈骗 / 借贷博彩' },
  { id: 'abuse', label: '辱骂 / 人身攻击' },
  { id: 'porn', label: '色情低俗' },
  { id: 'privacy', label: '偷拍 / 隐私曝光' },
  { id: 'hate', label: '仇恨 / 暴力极端' },
  { id: 'other', label: '其他违规' }
]

const REPORT_THRESHOLD = reportRules.REPORT_THRESHOLD

function wallDealStatusLabel(status) {
  const hit = WALL_DEAL_STATUSES.find((item) => item.id === status)
  return hit ? hit.label : '进行中'
}

function normalizeWallDealStatus(status) {
  if (WALL_DEAL_STATUSES.some((item) => item.id === status)) return status
  return 'open'
}

function wallHeadline(item) {
  if (item.title) return item.title
  if (item.tag === '出行拼车' && (item.routeFrom || item.routeTo)) {
    return `${item.routeFrom || '出发地'} → ${item.routeTo || '目的地'}`
  }
  return item.tag || '校园话题'
}

function wallSummary(item) {
  if (item.tag === '二手闲置流转') return item.price || ''
  if (item.tag === '出行拼车') return [item.departTime, item.extra].filter(Boolean).join(' · ')
  if (item.tag === '拼单互助' || item.tag === '求物求助' || item.tag === '失物招领') return item.extra || ''
  return ''
}

function isWeChatOpenid(openid) {
  const value = String(openid || '')
  return !!value && !value.startsWith('web_') && value !== 'guest_readonly'
}

function publicUser(user) {
  if (!user) return null
  const next = { ...user, id: user.id || user._id }
  next.username = next.webPhone || next.webEmail || next.webUsername || next.username || ''
  next.wechatBound = isWeChatOpenid(next.openid)
  next.webBound = !!(next.webUsername || next.webEmail || next.webPhone)
  next.wechatLogin = next.wechatBound || !!next.webWechatOpenid
  next.avatar = defaultProfile.resolveAvatar(next.avatar, next.id)
  delete next.openid
  delete next.passwordHash
  delete next.passwordSalt
  delete next.bindCode
  delete next.bindCodeExpireAt
  delete next.mergedInto
  delete next.unionid
  delete next.webWechatOpenid
  delete next.wechatId
  next.appAdmin = !!user.appAdmin
  next.officialLogin = next.id === OFFICIAL_AUTHOR_ID
  next.officialLoginAllowed = !!user.officialLoginAllowed && !next.officialLogin
  return next
}

function normalizeUser(user) {
  if (!user) return user
  const next = { ...user, id: user.id || user._id }
  if (next.status === 'muted' && next.muteUntil && next.muteUntil <= Date.now()) {
    next.status = 'active'
    next.muteUntil = 0
    if (!next.bannedAt) next.banReason = ''
  }
  return next
}

function speakGate(user) {
  const current = normalizeUser(user)
  if (!current || current.id === 'guest_readonly') {
    return {
      ok: false,
      code: 'NEED_LOGIN',
      title: '请先登录',
      message: '浏览开放。发帖、评论和私信请先登录。'
    }
  }
  if (current.status === 'banned') {
    return {
      ok: false,
      code: 'BANNED',
      title: '账号已封禁',
      message: current.banReason || '该账号因违规已被封禁，无法发言、评论或查看联系方式。'
    }
  }
  if (current.postWhitelist || current.appAdmin) {
    return { ok: true, code: 'OK', title: '', message: '' }
  }
  if (current.status === 'muted' && current.muteUntil > Date.now()) {
    return {
      ok: false,
      code: 'MUTED',
      title: '账号禁言中',
      message: `${current.banReason || '账号因异常行为被临时禁言。'}禁言至 ${formatDateTime(current.muteUntil)}。`
    }
  }
  if (!(current.schoolName && current.schoolLocked)) {
    return {
      ok: false,
      code: 'NEED_AUTH',
      title: '需要先认证学校',
      message: '发帖和评论前，请先填写所在学校完成基础认证，提交后立即生效，无需等待审核。'
    }
  }
  return { ok: true, code: 'OK', title: '', message: '' }
}

function validateSchoolName(name) {
  const text = String(name || '').trim()
  if (!text) return { ok: false, message: '请填写学校名称' }
  if (text.length < 2) return { ok: false, message: '学校名称过短，请填写全称' }
  if (text.length > 40) return { ok: false, message: '学校名称过长' }
  return { ok: true, name: text }
}

function validateWallContact(type, value, tag) {
  return moderation.validateWallContact(type, value, tag)
}

async function allDocs(name, where) {
  try {
    const col = where ? db.collection(name).where(where) : db.collection(name)
    const res = await col.limit(200).get()
    return res.data || []
  } catch (err) {
    console.error('[allDocs]', name, err && err.message)
    return []
  }
}

/** 列表热路径：只取已通过的最近帖，容器内短缓存扛并发尖峰 */
const FEED_LIMIT = 24
const FEED_CACHE_TTL = 60000
const WEEKLY_CACHE_TTL = 5 * 60 * 1000
const weeklyBoardCache = { key: '', board: null, at: 0 }
const feedCache = {
  forum_posts: { rows: null, at: 0 },
  wall_posts: { rows: null, at: 0 }
}
const feedOrderOk = {
  forum_posts: true,
  wall_posts: true
}

function invalidateFeedCache(collection) {
  if (collection && feedCache[collection]) {
    feedCache[collection] = { rows: null, at: 0 }
    return
  }
  Object.keys(feedCache).forEach((key) => {
    feedCache[key] = { rows: null, at: 0 }
  })
}

async function queryOfficialFeed(collection, limit = FEED_LIMIT) {
  try {
    const [byFlag, byAuthor] = await Promise.all([
      db.collection(collection).where({ authorOfficial: true }).limit(100).get().catch(() => ({ data: [] })),
      db.collection(collection).where({ authorId: OFFICIAL_AUTHOR_ID }).limit(100).get().catch(() => ({ data: [] }))
    ])
    const map = new Map()
    ;[...(byFlag.data || []), ...(byAuthor.data || [])].forEach((item) => {
      if (!item) return
      const key = item.id || item._id
      if (key) map.set(key, item)
    })
    const rows = [...map.values()]
      .filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
      .filter((item) => homeFeed.isOfficialPost(item))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, limit)
    const missing = rows.filter((item) => item.authorId === OFFICIAL_AUTHOR_ID && !item.authorOfficial && !item.anonymous)
    if (missing.length) {
      updateDocsByIds(collection, missing, { authorOfficial: true }).catch(() => {})
    }
    return rows
  } catch (err) {
    console.error('[queryOfficialFeed]', collection, err && err.message)
    return []
  }
}

async function queryStatusFeed(collection, where, limit) {
  if (feedOrderOk[collection] !== false) {
    try {
      const res = await db.collection(collection).where(where).orderBy('createdAt', 'desc').limit(limit).get()
      feedOrderOk[collection] = true
      return res.data || []
    } catch (err) {
      feedOrderOk[collection] = false
      console.error('[queryStatusFeed]', collection, err && err.message)
    }
  }
  try {
    const res = await db.collection(collection).where(where).limit(limit).get()
    return res.data || []
  } catch (err) {
    return []
  }
}

function mergePublicRows(groups, limit) {
  const map = new Map()
  ;(groups || []).forEach((rows) => {
    ;(rows || []).forEach((item) => {
      if (!item || !moderation.isPublicStatus(item.reviewStatus || 'approved')) return
      const id = item.id || item._id
      if (!id || map.has(id)) return
      map.set(id, item)
    })
  })
  return Array.from(map.values())
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, limit)
}

async function queryHomeSource(collection, before, limit) {
  const size = Math.min(50, Math.max(10, Number(limit) || 40))
  const cursor = Number(before) || 0
  try {
    const query = cursor > 0
      ? db.collection(collection).where({ createdAt: _.lt(cursor) })
      : db.collection(collection)
    const res = await query.orderBy('createdAt', 'desc').limit(size).get()
    const raw = res.data || []
    return {
      raw,
      rows: raw.filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
    }
  } catch (err) {
    console.error('[queryHomeSource]', collection, err && err.message)
    return { raw: [], rows: [] }
  }
}

async function queryApprovedFeed(collection, limit = FEED_LIMIT) {
  const slot = feedCache[collection]
  const now = Date.now()
  if (slot && slot.rows && slot.rows.length >= limit && now - slot.at < FEED_CACHE_TTL) return slot.rows
  const [approved, legacy] = await Promise.all([
    queryStatusFeed(collection, { reviewStatus: 'approved' }, limit),
    queryStatusFeed(collection, { reviewStatus: _.exists(false) }, limit)
  ])
  let rows = mergePublicRows([approved, legacy], limit)
  if (!rows.length) {
    try {
      const res = await db.collection(collection).orderBy('createdAt', 'desc').limit(limit).get()
      rows = mergePublicRows([res.data || []], limit)
    } catch (err) {
      try {
        const res = await db.collection(collection).limit(Math.min(100, limit)).get()
        rows = mergePublicRows([res.data || []], limit)
      } catch (err2) {
        rows = []
      }
    }
  }
  if (slot) {
    slot.rows = rows
    slot.at = now
  }
  return rows
}

async function fetchPostsByIds(collection, ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean))).slice(0, 40)
  if (!unique.length) return {}
  const map = {}
  const remember = (post) => {
    if (!post) return
    map[post.id || post._id] = post
  }
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10)
    try {
      const res = await db.collection(collection).where({ id: _.in(chunk) }).limit(chunk.length).get()
      ;(res.data || []).forEach(remember)
    } catch (err) {
      const rows = await Promise.all(chunk.map(async (id) => {
        try {
          const res = await db.collection(collection).doc(id).get()
          return res.data || null
        } catch (err2) {
          return null
        }
      }))
      rows.forEach(remember)
    }
  }
  return map
}

const USER_CACHE_TTL = 90000
const userByOpenidCache = new Map()

async function getUserByOpenid(openid) {
  if (!openid) return null
  const hit = userByOpenidCache.get(openid)
  if (hit && Date.now() - hit.at < USER_CACHE_TTL) return hit.user
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  if (!user) return null
  const next = normalizeUser(user)
  if (next.status !== user.status || next.muteUntil !== user.muteUntil) {
    await db.collection('users').doc(next.id || next._id).update({
      data: {
        status: next.status,
        muteUntil: next.muteUntil,
        banReason: next.banReason
      }
    })
  }
  userByOpenidCache.set(openid, { user: next, at: Date.now() })
  return next
}

async function saveUser(user) {
  const id = user.id || user._id
  const { _id, ...rest } = user
  await db.collection('users').doc(id).set({
    data: { ...rest, id }
  })
  if (rest.openid) userByOpenidCache.delete(rest.openid)
  return { ...rest, id }
}

function webSecretOk(provided) {
  const bundled = require('./lib/web-internal')
  const expected = String(process.env.WEB_INTERNAL_SECRET || bundled || '')
  const given = String(provided || '')
  if (!expected || !given) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch (err) {
    return false
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, hash) {
  try {
    const next = crypto.scryptSync(String(password), salt, 64).toString('hex')
    const a = Buffer.from(next, 'hex')
    const b = Buffer.from(String(hash), 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch (err) {
    return false
  }
}

function emailAccountKey(email) {
  return `e_${crypto.createHash('sha1').update(String(email)).digest('hex').slice(0, 20)}`
}

function parseWebAccount(payload = {}) {
  const phone = String(payload.phone || '').trim().replace(/[\s-]/g, '')
  const email = String(payload.email || '').trim().toLowerCase()
  const username = String(payload.username || '').trim()
  if (/^1\d{10}$/.test(phone)) {
    return { ok: true, kind: 'phone', phone, username: phone, display: phone }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: true, kind: 'email', email, username: emailAccountKey(email), display: email }
  }
  const asPhone = username.replace(/[\s-]/g, '')
  const asEmail = username.toLowerCase()
  if (/^1\d{10}$/.test(asPhone)) {
    return { ok: true, kind: 'phone', phone: asPhone, username: asPhone, display: asPhone }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(asEmail)) {
    return { ok: true, kind: 'email', email: asEmail, username: emailAccountKey(asEmail), display: asEmail }
  }
  if (/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    return { ok: true, kind: 'username', username: username.toLowerCase(), display: username }
  }
  return { ok: false, message: '请填写正确的手机号或邮箱' }
}

function loginFailMessage(kind) {
  if (kind === 'email') return '邮箱或密码错误'
  if (kind === 'phone') return '手机号或密码错误'
  return '账号或密码错误'
}

async function followMergedUser(user) {
  if (!user) return null
  if (user.mergedInto) {
    const canonical = await getUserById(user.mergedInto)
    if (canonical && canonical.status !== 'merged') return canonical
  }
  if (user.status === 'merged') return null
  return user
}

async function findUserByAccount(account) {
  if (!account || !account.ok) return null
  if (account.phone) {
    const byPhone = await followMergedUser(await getUserByField('webPhone', account.phone))
    if (byPhone) return byPhone
  }
  if (account.email) {
    const byEmail = await followMergedUser(await getUserByField('webEmail', account.email))
    if (byEmail) return byEmail
  }
  if (account.username) {
    return followMergedUser(await getUserByWebUsername(account.username))
  }
  return null
}

function guestUser() {
  return {
    id: 'guest_readonly',
    openid: 'guest_readonly',
    nickname: '访客',
    avatar: defaultProfile.stableAvatar('guest_readonly'),
    bio: '',
    createdAt: 0,
    schoolName: '',
    schoolCampus: '',
    schoolLocked: false,
    showSchoolTag: false,
    studentAuthStatus: 'none',
    status: 'active',
    muteUntil: 0,
    riskScore: 0,
    violateCount: 0,
    lastSeenLikesAt: 0,
    lastSeenCommentsAt: 0
  }
}

function createBlankUser(openid, extras = {}) {
  const now = Date.now()
  const suffix = String(openid || 'web').replace(/[^a-zA-Z0-9]/g, '').slice(-10) || 'web'
  return {
    id: extras.id || `u_${suffix}_${now.toString(36)}`,
    openid,
    nickname: extras.nickname || defaultProfile.randomNickname(),
    avatar: extras.avatar || defaultProfile.randomAvatar(),
    bio: extras.bio || '在这里遇见有趣的灵魂',
    createdAt: now,
    schoolName: '',
    schoolCampus: '',
    schoolLocked: false,
    schoolSubmittedAt: 0,
    schoolChangeRequest: null,
    showSchoolTag: false,
    studentAuthStatus: 'none',
    studentAuthImages: [],
    studentAuthNote: '',
    studentAuthSubmittedAt: 0,
    studentAuthReviewedAt: 0,
    studentAuthReviewNote: '',
    status: 'active',
    muteUntil: 0,
    banReason: '',
    bannedAt: 0,
    riskScore: 0,
    violateCount: 0,
    lastSeenLikesAt: 0,
    lastSeenCommentsAt: 0,
    ...extras
  }
}

async function getUserById(id) {
  const key = String(id || '').trim()
  if (!key) return null
  try {
    const res = await db.collection('users').doc(key).get()
    const data = res && res.data
    if (data) return normalizeUser({ ...data, id: data.id || data._id || key })
  } catch (err) { /* missing doc */ }
  try {
    const rows = await db.collection('users').where({ id: key }).limit(1).get()
    const user = (rows.data || [])[0]
    return user ? normalizeUser(user) : null
  } catch (err) {
    return null
  }
}

async function getUserByWebUsername(username) {
  const key = String(username || '').trim().toLowerCase()
  if (!key) return null
  try {
    const res = await db.collection('users').where({ webUsername: key }).limit(1).get()
    let user = (res.data || [])[0]
    if (!user) return null
    user = normalizeUser(user)
    if (user.mergedInto) {
      const canonical = await getUserById(user.mergedInto)
      if (canonical) return canonical
    }
    return user
  } catch (err) {
    return null
  }
}

async function getUserByField(field, value) {
  const key = String(value || '').trim()
  if (!key) return null
  try {
    const res = await db.collection('users').where({ [field]: key }).limit(1).get()
    const user = (res.data || [])[0]
    return user ? normalizeUser(user) : null
  } catch (err) {
    return null
  }
}

async function resolveWebUser(webUserId) {
  let user = await getUserById(webUserId)
  if (!user) return null
  if (user.mergedInto) user = await getUserById(user.mergedInto)
  if (!user || user.status === 'merged') return null
  return user
}

async function remapOwnership(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return

  async function rewrite(collection, patcher) {
    const rows = await allDocs(collection)
    const hits = rows.filter((item) => patcher(item, true))
    await Promise.all(hits.map((item) => {
      const data = patcher(item, false)
      if (!data || !Object.keys(data).length) return null
      return db.collection(collection).doc(item.id || item._id).update({ data })
    }))
  }

  const swap = (value) => (value === fromId ? toId : value)

  await rewrite('forum_posts', (item, test) => (
    test ? item.authorId === fromId : { authorId: toId }
  ))
  await rewrite('wall_posts', (item, test) => (
    test ? item.authorId === fromId : { authorId: toId }
  ))
  await rewrite('comments', (item, test) => {
    const hit = item.authorId === fromId || item.postAuthorId === fromId || item.replyToUserId === fromId
    if (test) return hit
    const data = {}
    if (item.authorId === fromId) data.authorId = toId
    if (item.postAuthorId === fromId) data.postAuthorId = toId
    if (item.replyToUserId === fromId) data.replyToUserId = toId
    return data
  })
  await rewrite('dm_messages', (item, test) => (
    test ? item.senderId === fromId : { senderId: toId }
  ))
  await rewrite('school_requests', (item, test) => (
    test ? item.userId === fromId : { userId: toId }
  ))
  await rewrite('contact_views', (item, test) => (
    test ? item.userId === fromId : { userId: toId }
  ))
  await rewrite('contact_feedbacks', (item, test) => (
    test ? item.userId === fromId : { userId: toId }
  ))
  await rewrite('conversations', (item, test) => {
    const members = item.memberIds || []
    if (test) return members.includes(fromId)
    const memberIds = members.map(swap)
    const unread = { ...(item.unread || {}) }
    unread[toId] = (Number(unread[toId]) || 0) + (Number(unread[fromId]) || 0)
    delete unread[fromId]
    return {
      memberIds,
      pairKey: [...memberIds].sort().join('__'),
      lastSenderId: swap(item.lastSenderId),
      unread
    }
  })

  const likes = (await allDocs('likes')).filter((item) => item.userId === fromId)
  for (const row of likes) {
    const newId = `${toId}_${row.type}_${row.postId}`
    const { _id, ...rest } = row
    await db.collection('likes').doc(newId).set({
      data: { ...rest, id: newId, userId: toId, postAuthorId: swap(rest.postAuthorId) }
    })
    try {
      await db.collection('likes').doc(row.id || row._id).remove()
    } catch (err) { /* ignore */ }
  }

  await rewrite('analytics_events', (item, test) => (
    test ? item.userId === fromId : { userId: toId }
  ))
}

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

function downloadHttpsBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) {
      reject(new Error('图片下载重定向过多'))
      return
    }
    const lib = String(url).startsWith('http://') ? require('http') : require('https')
    const req = lib.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        downloadHttpsBuffer(res.headers.location, redirects + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`图片下载失败(${res.statusCode})`))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: String(res.headers['content-type'] || '')
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('图片下载超时'))
    })
  })
}

async function persistCloudFile(value, folder = 'web') {
  const raw = String(value || '')
  if (!raw) return ''
  if (raw.startsWith('cloud://') || raw.startsWith('/images/')) return raw
  // 客户端本地临时路径应已在小程序端上传；云函数无法读 wxfile
  if (raw.startsWith('wxfile://') || raw.startsWith('http://tmp')) return raw
  if (raw.startsWith('data:image/svg')) return defaultProfile.DEFAULT_AVATARS[0]

  if (/^https?:\/\//i.test(raw)) {
    try {
      const downloaded = await downloadHttpsBuffer(raw)
      const buf = downloaded.buffer
      if (!buf.length) return raw
      if (buf.length > 2.5 * 1024 * 1024) {
        const err = new Error('图片太大，请压缩到 2MB 以内')
        err.code = 'IMAGE_TOO_LARGE'
        throw err
      }
      const mime = String(downloaded.contentType || '').split(';')[0].trim().toLowerCase()
      const ext = MIME_EXT[mime] || 'jpg'
      const upload = await cloud.uploadFile({
        cloudPath: `${folder}/${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
        fileContent: buf
      })
      return upload.fileID || raw
    } catch (err) {
      console.warn('[persistCloudFile] https', err && err.message)
      return raw
    }
  }

  const match = raw.match(DATA_URL_RE)
  if (!match) return raw
  const mime = String(match[1] || '').toLowerCase()
  const buf = Buffer.from(match[2], 'base64')
  if (!buf.length) return ''
  if (buf.length > 2.5 * 1024 * 1024) {
    const err = new Error('图片太大，请压缩到 2MB 以内')
    err.code = 'IMAGE_TOO_LARGE'
    throw err
  }
  const ext = MIME_EXT[mime] || 'jpg'
  const upload = await cloud.uploadFile({
    cloudPath: `${folder}/${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
    fileContent: buf
  })
  return upload.fileID || raw
}

async function persistCloudFiles(list, folder = 'posts') {
  const items = (Array.isArray(list) ? list : []).filter(Boolean).slice(0, 9)
  return Promise.all(items.map((item) => persistCloudFile(item, folder)))
}

async function mergeAccounts(fromUser, toUser) {
  if (!fromUser || !toUser) return toUser
  if (fromUser.id === toUser.id) return toUser
  if (toUser.webUsername && fromUser.webUsername && toUser.webUsername !== fromUser.webUsername) {
    const err = new Error('该微信账号已绑定其他网页账号')
    err.code = 'BOUND'
    throw err
  }
  if (toUser.webPhone && fromUser.webPhone && toUser.webPhone !== fromUser.webPhone) {
    const err = new Error('该微信账号已绑定其他手机号')
    err.code = 'BOUND'
    throw err
  }
  if (toUser.webEmail && fromUser.webEmail && toUser.webEmail !== fromUser.webEmail) {
    const err = new Error('该微信账号已绑定其他邮箱')
    err.code = 'BOUND'
    throw err
  }

  const merged = { ...toUser }
  if (!merged.webUsername && fromUser.webUsername) {
    merged.webUsername = fromUser.webUsername
    merged.passwordHash = fromUser.passwordHash || ''
    merged.passwordSalt = fromUser.passwordSalt || ''
  }
  if (!merged.passwordHash && fromUser.passwordHash) {
    merged.passwordHash = fromUser.passwordHash
    merged.passwordSalt = fromUser.passwordSalt || ''
  }
  if (!merged.webPhone && fromUser.webPhone) merged.webPhone = fromUser.webPhone
  if (!merged.webEmail && fromUser.webEmail) merged.webEmail = fromUser.webEmail
  merged.bindCode = ''
  merged.bindCodeExpireAt = 0
  merged.boundAt = Date.now()

  if ((!merged.nickname || merged.nickname === '黎安话事') && fromUser.nickname && fromUser.nickname !== '黎安话事') {
    merged.nickname = fromUser.nickname
  }
  if ((!merged.bio || merged.bio === '在这里遇见有趣的灵魂') && fromUser.bio) {
    merged.bio = fromUser.bio
  }
  if (defaultProfile.isLegacyAvatar(merged.avatar) && !defaultProfile.isLegacyAvatar(fromUser.avatar)) {
    merged.avatar = fromUser.avatar
  }
  if (!merged.schoolLocked && fromUser.schoolLocked) {
    merged.schoolName = fromUser.schoolName
    merged.schoolCampus = fromUser.schoolCampus
    merged.schoolLocked = fromUser.schoolLocked
    merged.schoolSubmittedAt = fromUser.schoolSubmittedAt
    merged.showSchoolTag = !!fromUser.showSchoolTag
  }
  if ((merged.studentAuthStatus === 'none' || !merged.studentAuthStatus) && fromUser.studentAuthStatus && fromUser.studentAuthStatus !== 'none') {
    merged.studentAuthStatus = fromUser.studentAuthStatus
    merged.studentAuthImages = fromUser.studentAuthImages || []
    merged.studentAuthNote = fromUser.studentAuthNote || ''
    merged.studentAuthSubmittedAt = fromUser.studentAuthSubmittedAt || 0
    merged.studentAuthReviewedAt = fromUser.studentAuthReviewedAt || 0
    merged.studentAuthReviewNote = fromUser.studentAuthReviewNote || ''
  }

  await remapOwnership(fromUser.id, merged.id)
  invalidateFeedCache()
  await saveUser(merged)
  await saveUser({
    ...fromUser,
    mergedInto: merged.id,
    status: 'merged',
    webUsername: '',
    webPhone: '',
    webEmail: '',
    passwordHash: '',
    passwordSalt: '',
    bindCode: '',
    bindCodeExpireAt: 0
  })
  if (merged.nickname !== toUser.nickname || merged.avatar !== toUser.avatar) {
    await syncAuthorProfileOnContent(merged, {
      syncAvatar: merged.avatar !== toUser.avatar,
      syncNickname: merged.nickname !== toUser.nickname,
      oldNickname: toUser.nickname || ''
    })
  }
  return merged
}

/** 容器保活期内复用词库，避免每次发帖/评论都重查 */
const LEXICON_TTL = 10 * 60 * 1000
let lexiconCache = { rows: null, at: 0 }

async function getLexiconRows() {
  if (lexiconCache.rows && Date.now() - lexiconCache.at < LEXICON_TTL) {
    return lexiconCache.rows
  }
  const rows = await loadLexiconRows()
  lexiconCache = { rows, at: Date.now() }
  return rows
}

async function loadLexiconRows() {
  try {
    const rows = await allDocs('lexicon_terms')
    const seed = moderation.seedLexiconRows()
    const existing = new Set(rows.map((row) => row.id))
    // 只补新增的内置词：内置词不可删除，因此不会复活管理员移除的词，也不会覆盖停用状态
    const missing = seed.filter((row) => !existing.has(row.id))
    if (!missing.length) return rows
    await Promise.all(missing.map((row) => db.collection('lexicon_terms').doc(row.id).set({ data: row })))
    try {
      await db.collection('meta').doc('lexicon').set({ data: { id: 'lexicon', version: Date.now(), updatedAt: Date.now() } })
    } catch (err) {}
    return rows.concat(missing)
  } catch (err) {
    return moderation.seedLexiconRows()
  }
}

async function getLexiconMap() {
  return moderation.lexiconMapFromRows(await getLexiconRows())
}

async function runContentReview(input, user) {
  const wxContext = (cloud.getWXContext && cloud.getWXContext()) || {}
  const openid = (user && user.openid) || wxContext.OPENID || ''
  const [vendor, lexicons] = await Promise.all([
    wxSecurity.checkAll({
      input: input || {},
      openid,
      nickname: (user && user.nickname) || ''
    }),
    getLexiconMap()
  ])
  const imageFlags = { ...(input.imageFlags || {}) }
  const review = moderation.reviewText({ ...input, imageFlags }, {
    lexicons,
    vendor
  })
  review.vendor = {
    source: vendor.source || '',
    suggest: vendor.suggest || '',
    label: vendor.label || 0,
    skipped: !!vendor.skipped,
    degraded: !!vendor.degraded,
    timeout: !!vendor.timeout,
    reason: vendor.reason || '',
    highRisk: !!vendor.highRisk,
    uncertain: !!vendor.uncertain
  }
  return review
}

function reviewPatch(review) {
  return {
    reviewStatus: review.reviewStatus,
    reviewNote: review.note || review.message || '',
    reviewOutcome: review.outcome,
    reviewRuleIds: review.ruleIds || [],
    reviewPriority: review.priority || 'normal',
    originalText: review.originalText || '',
    normalizedText: review.normalizedText || '',
    reviewSignals: review.signals || {},
    reviewTip: review.tip || '',
    matchedKeywords: Object.values(review.signals || {}).flat(),
    vendorSource: (review.vendor && review.vendor.source) || '',
    vendorSuggest: (review.vendor && review.vendor.suggest) || '',
    vendorLabel: (review.vendor && review.vendor.label) || 0
  }
}

function publishReviewResult(review, post) {
  if (review.outcome === moderation.OUTCOMES.PASS) {
    return { ok: true, post, review }
  }
  if (review.outcome === moderation.OUTCOMES.EDIT_REQUIRED) {
    return { ok: false, code: 'EDIT_REQUIRED', post, review, message: review.message }
  }
  if (review.outcome === moderation.OUTCOMES.REJECT || review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK) {
    return {
      ok: false,
      code: review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 'EMERGENCY_BLOCK' : 'REJECTED',
      post,
      review,
      message: review.message
    }
  }
  return {
    ok: true,
    code: review.reviewStatus,
    post,
    review,
    message: review.message || '已提交，审核通过后才会公开'
  }
}

async function getRateBuckets(userId) {
  try {
    const res = await db.collection('rate_buckets').doc(userId).get()
    return res.data || { userId }
  } catch (err) {
    return { userId }
  }
}

async function consumeRateLimit(userId, action, user) {
  if (action === 'post' && user && (user.postWhitelist || user.appAdmin)) return { ok: true }
  const doc = await getRateBuckets(userId)
  const buckets = { ...doc }
  delete buckets._id
  delete buckets.userId
  const checked = security.checkRateLimit(buckets, action)
  if (!checked.ok) return checked
  const next = security.hitRateLimit(buckets, action)
  await db.collection('rate_buckets').doc(userId).set({
    data: { ...next, userId }
  })
  return { ok: true }
}

async function pushSecurityLog(entry) {
  const item = {
    id: uid('sl_'),
    createdAt: Date.now(),
    ...entry
  }
  await db.collection('security_logs').doc(item.id).set({ data: item })
  return item
}

async function handleReviewViolation(user, review, source) {
  if (user && user.id === OFFICIAL_AUTHOR_ID) return user
  const hits = Object.values(review.signals || {}).flat()
  const violateCount = (user.violateCount || 0) + 1
  const riskScore = (user.riskScore || 0) + (review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 40 : 20)
  let status = user.status || 'active'
  let muteUntil = user.muteUntil || 0
  let banReason = user.banReason || ''
  let bannedAt = user.bannedAt || 0
  let level = review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 'critical' : 'warn'
  let type = review.notifyOwner ? 'emergency_block' : 'review_reject'
  let detail = `${source}：${review.message || review.note || '未通过审核'}（${(review.ruleIds || []).join('、') || '规则'}）`

  if (review.restrictAccount && status === 'active') {
    status = 'muted'
    muteUntil = Date.now() + security.DAY
    banReason = review.message || '冒充官方通知，限制发言 24 小时'
    type = 'auto_mute'
    detail = banReason
  } else if (violateCount >= 5 && status !== 'banned') {
    status = 'banned'
    banReason = '多次发布违规内容，系统自动封禁'
    bannedAt = Date.now()
    level = 'critical'
    type = 'auto_ban'
    detail = banReason
  } else if (violateCount >= 3 && status === 'active') {
    status = 'muted'
    muteUntil = Date.now() + security.DAY
    banReason = '短时间多次触发审核拒绝，禁言 24 小时'
    type = 'auto_mute'
    detail = banReason
  }

  const next = {
    ...user,
    violateCount,
    riskScore,
    status,
    muteUntil,
    banReason,
    bannedAt
  }
  await saveUser(next)
  await pushSecurityLog({
    level,
    type,
    userId: user.id,
    userNickname: user.nickname,
    detail,
    hits,
    ruleIds: review.ruleIds || [],
    notifyOwner: !!review.notifyOwner
  })
  return next
}

async function likedIds(userId, type, postIds) {
  if (!userId) return []
  const wanted = Array.isArray(postIds) ? postIds.filter(Boolean) : null
  if (wanted && !wanted.length) return []
  if (wanted) {
    const chunks = []
    for (let i = 0; i < wanted.length; i += 10) chunks.push(wanted.slice(i, i + 10))
    const parts = await Promise.all(chunks.map(async (chunk) => {
      try {
        const res = await db.collection('likes').where({
          userId,
          type,
          postId: _.in(chunk)
        }).limit(chunk.length).get()
        return (res.data || []).map((row) => row.postId).filter(Boolean)
      } catch (err) {
        return null
      }
    }))
    if (parts.some((part) => part == null)) {
      try {
        const res = await db.collection('likes').where({ userId, type }).limit(30).get()
        const want = new Set(wanted)
        return (res.data || []).map((row) => row.postId).filter((id) => want.has(id))
      } catch (err2) {
        return parts.filter(Boolean).reduce((all, part) => all.concat(part), [])
      }
    }
    return parts.reduce((all, part) => all.concat(part), [])
  }
  try {
    const res = await db.collection('likes').where({ userId, type }).limit(30).get()
    return (res.data || []).map((item) => item.postId)
  } catch (err) {
    return []
  }
}

function decorate(list, type, user, liked) {
  return list.map((item) => {
    const id = String((item && (item.id || item._id)) || '').trim()
    const next = {
      ...item,
      id,
      liked: !!(id && liked.includes(id)),
      isOwner: !!(user && item.authorId === user.id),
      pinned: !!item.pinned,
      official: homeFeed.isOfficialPost(item),
      canManage: canModerate(user)
    }
    next.mine = next.isOwner
    next._legacyName = !item.anonymous
      && !defaultProfile.isAnonymousNickname(item.authorName)
      && defaultProfile.isLegacyNickname(item.authorName)
    next.authorName = defaultProfile.resolveAuthorName(item.authorName, item.anonymous ? id : (item.authorId || id), {
      anonymous: !!item.anonymous
    })
    next.authorAvatar = defaultProfile.resolveAuthorAvatar(
      item.authorAvatar,
      item.anonymous || defaultProfile.isAnonymousNickname(item.authorName) ? (id || item.authorId) : item.authorId,
      { anonymous: !!item.anonymous, authorName: item.authorName }
    )
    next._legacyAvatar = !(item.anonymous || defaultProfile.isAnonymousNickname(item.authorName))
      && defaultProfile.isLegacyAvatar(item.authorAvatar)
    if (type === 'wall') {
      next.dealStatus = normalizeWallDealStatus(item.dealStatus)
      next.dealStatusLabel = wallDealStatusLabel(next.dealStatus)
      next.headline = wallHeadline(item)
      next.summary = wallSummary(item)
    }
    next.hasContact = !!(item.contactType && item.contactValue && item.contactType !== 'phone')
      && moderation.isPublicStatus(item.reviewStatus || 'approved')
    next.contactType = item.contactType || ''
    next.contactTypeLabel = contactTypeLabel(item.contactType)
    delete next.contactValue
    // 匿名帖不向客户端下发真实作者 id（是否本人已由 isOwner 给出）
    if (item.anonymous) next.authorId = ''
    next.reviewStatusLabel = moderation.reviewStatusLabel(item.reviewStatus)
    if (!moderation.isPublicStatus(item.reviewStatus) && !next.isOwner) {
      next.content = item.reviewNote || '内容审核中'
      if (next.title) next.title = '内容审核中'
      if (next.headline) next.headline = '内容审核中'
    }
    return next
  })
}

function postHeatScore(post, now = Date.now()) {
  const ageHours = Math.max(0.5, (now - (post.createdAt || now)) / 3600000)
  const heat = (post.likeCount || 0) * 3 + (post.commentCount || 0) * 4 + (post.viewCount || 0) * 0.05
  const freshness = 100 / (1 + ageHours / 24)
  return heat + freshness
}

function sortFeed(list, hot) {
  const now = Date.now()
  return list.slice().sort((a, b) => {
    const ap = a.pinned ? 1 : 0
    const bp = b.pinned ? 1 : 0
    if (ap !== bp) return bp - ap
    if (ap && bp) return (b.pinnedAt || 0) - (a.pinnedAt || 0)
    if (hot) {
      const diff = postHeatScore(b, now) - postHeatScore(a, now)
      if (diff !== 0) return diff
    }
    return (b.createdAt || 0) - (a.createdAt || 0)
  })
}

async function pinnedPosts(collection) {
  try {
    const res = await db.collection(collection).where({ pinned: true }).limit(5).get()
    return (res.data || []).filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
  } catch (err) {
    return []
  }
}

function isRealUser(user) {
  return !!(user && user.id && user.id !== 'guest_readonly')
}

function postDocId(item) {
  if (!item) return ''
  return String(item.id || item._id || '').trim()
}

function mergeFeedPosts(primary, pinned, mine) {
  const list = []
  const seen = new Set()
  const append = (item, { skipRejected = false } = {}) => {
    if (!item) return
    if (skipRejected && (item.reviewStatus === 'rejected' || item.reviewStatus === 'emergency_block')) return
    const key = postDocId(item)
    if (!key || seen.has(key)) return
    seen.add(key)
    list.push(item.id ? item : { ...item, id: key })
  }
  ;(primary || []).forEach((item) => append(item))
  ;(pinned || []).forEach((item) => append(item))
  ;(mine || []).forEach((item) => append(item, { skipRejected: true }))
  return list
}

function compactFeedItem(item) {
  const content = String(item.content || '')
  return {
    ...item,
    content: content.length > 180 ? `${content.slice(0, 180)}…` : content,
    images: Array.isArray(item.images) ? item.images.slice(0, 3) : [],
    reviewHits: undefined,
    reviewRuleIds: undefined,
    contactValue: undefined,
    _legacyAvatar: undefined,
    _legacyName: undefined
  }
}

async function usersByIds(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))]
  const map = {}
  for (let i = 0; i < uniq.length; i += 10) {
    const chunk = uniq.slice(i, i + 10)
    const res = await db.collection('users').where({ id: _.in(chunk) }).limit(10).get().catch(() => ({ data: [] }))
    ;(res.data || []).forEach((row) => {
      if (row && row.id) map[row.id] = row
    })
  }
  return map
}

async function hydrateLegacyAvatars(list, viewer) {
  const rows = Array.isArray(list) ? list : []
  const ids = rows.filter((item) => item && (item._legacyAvatar || item._legacyName)).map((item) => item.authorId)
  const accounts = ids.length ? await usersByIds(ids) : {}
  return rows.map((item) => {
    if (!item) return item
    const next = { ...item }
    const account = accounts[item.authorId]
    delete next._legacyAvatar
    delete next._legacyName
    if (item._legacyName && !item.anonymous) {
      const accountName = account && account.nickname
      const viewerName = viewer && item.authorId === viewer.id ? viewer.nickname : ''
      const picked = [accountName, viewerName].find((name) => (
        name && !defaultProfile.isLegacyNickname(name) && !defaultProfile.isAnonymousNickname(name)
      ))
      if (picked) next.authorName = picked
    }
    if (item.anonymous) {
      next.authorAvatar = defaultProfile.stableAvatar(item.id || item.authorId)
      return next
    }
    if (!item._legacyAvatar) return next
    const fromAccount = account && (
      defaultProfile.isCustomAvatar(account.avatar)
      || defaultProfile.DEFAULT_AVATARS.indexOf(account.avatar) >= 0
    ) ? account.avatar : ''
    const fromViewer = viewer && item.authorId === viewer.id && defaultProfile.isCustomAvatar(viewer.avatar)
      ? viewer.avatar
      : ''
    next.authorAvatar = fromAccount || fromViewer || defaultProfile.stableAvatar(item.authorId)
    return next
  })
}

async function backfillAuthorNames(user) {
  if (!user || user.nicknameBackfillAt || user.id === 'guest_readonly' || user.id === OFFICIAL_AUTHOR_ID) return user
  let next = user
  const nick = defaultProfile.resolveProfileNickname(user.nickname, user.id)
  if (nick !== user.nickname) next = await saveUser({ ...user, nickname: nick })
  next = await saveUser({ ...next, nicknameBackfillAt: Date.now() })
  try {
    const [forum, wall, comments] = await Promise.all([
      allDocs('forum_posts', { authorId: next.id }),
      allDocs('wall_posts', { authorId: next.id }),
      allDocs('comments', { authorId: next.id })
    ])
    const legacyRows = (rows) => rows.filter((item) => (
      !item.anonymous
      && !defaultProfile.isAnonymousNickname(item.authorName)
      && defaultProfile.isLegacyNickname(item.authorName)
    ))
    await Promise.all([
      updateDocsByIds('forum_posts', legacyRows(forum), { authorName: next.nickname }),
      updateDocsByIds('wall_posts', legacyRows(wall), { authorName: next.nickname }),
      updateDocsByIds('comments', comments.filter((item) => defaultProfile.isLegacyNickname(item.authorName)), { authorName: next.nickname })
    ])
  } catch (err) {
    // 历史昵称回刷失败时，读取时仍会按规则替换展示名
  }
  return next
}

async function backfillAuthorAvatars(user) {
  if (!user || user.avatarBackfillAt || user.id === 'guest_readonly' || user.id === 'official_lian_wall') return user
  const avatar = defaultProfile.isLegacyAvatar(user.avatar)
    ? defaultProfile.stableAvatar(user.id)
    : user.avatar
  const next = await saveUser({ ...user, avatar, avatarBackfillAt: Date.now() })
  try {
    await syncAuthorProfileOnContent(next, { syncAvatar: true })
  } catch (err) {
    // 历史帖回刷失败时，读取时仍会按资料补头像
  }
  return next
}

async function listPosts(collection, type, user, filter = {}) {
  const real = isRealUser(user)
  const officialOnly = !!filter.official
  const limit = Math.min(80, Math.max(8, Number(filter.limit) || FEED_LIMIT))
  // 我的帖：不要 orderBy，避免缺复合索引时退化成全表 allDocs（极慢）
  const [rows, mine, pinned] = await Promise.all([
    officialOnly ? queryOfficialFeed(collection, limit) : queryApprovedFeed(collection, limit),
    real
      ? db.collection(collection).where({ authorId: user.id }).limit(8).get()
        .then((res) => (res.data || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)))
        .catch(() => [])
      : Promise.resolve([]),
    pinnedPosts(collection)
  ])
  let list = mergeFeedPosts(rows, pinned, mine)
  if (type === 'forum' && filter.category && filter.category !== '全部') {
    list = list.filter((item) => item.category === filter.category)
  }
  if (type === 'wall' && filter.tag && filter.tag !== '全部') {
    list = list.filter((item) => item.tag === filter.tag)
  }
  if (type === 'wall' && filter.dealStatus && filter.dealStatus !== '全部') {
    list = list.filter((item) => normalizeWallDealStatus(item.dealStatus) === filter.dealStatus)
  }
  if (officialOnly) {
    list = list.filter((item) => homeFeed.isOfficialPost(item))
  }
  if (filter.keyword) {
    const q = filter.keyword.trim().toLowerCase()
    list = list.filter((item) => (
      `${item.title || ''} ${item.content || ''} ${item.price || ''} ${item.routeFrom || ''} ${item.routeTo || ''} ${item.departTime || ''} ${item.extra || ''} ${item.tag || ''}`
        .toLowerCase()
        .includes(q)
    ))
  }
  list = sortFeed(list, filter.sort === 'hot')
  const page = list.slice(0, limit)
  const liked = real ? await likedIds(user.id, type, page.map((item) => item.id)) : []
  const decorated = await hydrateLegacyAvatars(decorate(page, type, user, liked), user)
  return decorated.map(compactFeedItem)
}

async function enqueueWall(post) {
  if (!moderation.isPublicStatus(post && post.reviewStatus)) return digestProgress()
  const exists = await db.collection('digest_queue').where({ contentId: post.id }).limit(1).get()
  if (exists.data.length) {
    return digestProgress()
  }
  const item = {
    id: uid('dq_'),
    contentType: 'wall',
    contentId: post.id,
    title: wallHeadline(post),
    summary: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    channel: homeFeed.postTopic(post, 'wall'),
    pagepath: `pages/wall-detail/wall-detail?id=${post.id}`,
    wecomPage: `pages/wall-detail/wall-detail.html?id=${post.id}`,
    queuedAt: Date.now()
  }
  await db.collection('digest_queue').doc(item.id).set({ data: item })
  const progress = await digestProgress()
  let flushed = null
  if (progress.count >= DIGEST_SIZE) flushed = await flushDigest(false)
  return { ...(await digestProgress()), flushed }
}

async function digestProgress() {
  const queued = (await allDocs('digest_queue')).sort((a, b) => a.queuedAt - b.queuedAt)
  const groups = (await allDocs('distribute_targets')).filter((item) => item.enabled && item.receiveDigest)
  return {
    size: DIGEST_SIZE,
    count: queued.length,
    remain: Math.max(0, DIGEST_SIZE - queued.length),
    queued,
    digestGroups: groups,
    digestGroupText: groups.length ? groups.map((item) => item.name).join('、') : '尚未指定',
    flushed: null
  }
}

async function sortDigestItemsByHeat(items) {
  const walls = await allDocs('wall_posts')
  const byId = {}
  walls.forEach((post) => { byId[post.id || post._id] = post })
  const now = Date.now()
  return items.slice().sort((a, b) => {
    const pa = byId[a.contentId] || { createdAt: a.queuedAt || 0, likeCount: 0, commentCount: 0, viewCount: 0 }
    const pb = byId[b.contentId] || { createdAt: b.queuedAt || 0, likeCount: 0, commentCount: 0, viewCount: 0 }
    const diff = postHeatScore(pb, now) - postHeatScore(pa, now)
    if (diff !== 0) return diff
    return (pb.createdAt || 0) - (pa.createdAt || 0)
  })
}

async function flushDigest(force) {
  const queued = (await allDocs('digest_queue')).sort((a, b) => a.queuedAt - b.queuedAt)
  if (!queued.length) return null
  if (!force && queued.length < DIGEST_SIZE) return null
  const picked = queued.slice(0, DIGEST_SIZE)
  const items = (await sortDigestItemsByHeat(picked)).map(({ _id, ...rest }) => rest)
  await Promise.all(picked.map((item) => db.collection('digest_queue').doc(item.id || item._id).remove()))
  const digest = {
    id: uid('dg_'),
    items,
    title: `本周精选 · ${items.length}条`,
    summary: items.map((item, index) => `${index + 1}.${item.title}`).join(' ').slice(0, 120),
    createdAt: Date.now()
  }
  digest.pagepath = `pages/digest/digest?id=${digest.id}`
  digest.sharePath = `/pages/digest/digest?id=${digest.id}`
  digest.wecomPage = `pages/digest/digest.html?id=${digest.id}`
  await db.collection('digests').doc(digest.id).set({ data: digest })

  const groups = (await allDocs('distribute_targets')).filter((item) => (
    item.enabled !== false && item.receiveDigest && item.chatId
  ))
  let wecomSend = null
  try {
    wecomSend = await wecom.sendDigest(digest, {
      chatIds: groups.map((item) => item.chatId).filter(Boolean),
      sender: (groups.find((item) => item.sender) || {}).sender || process.env.WECOM_SENDER
    })
  } catch (err) {
    wecomSend = { error: err.message || String(err) }
  }
  const ok = wecomSend && wecomSend.result && !wecomSend.result.errcode
  const log = {
    id: uid('dl_'),
    groupId: 'g_customer',
    groupName: process.env.WECOM_GROUP_NAME || '群聊推送测试',
    groupType: 'external',
    contentType: 'digest',
    contentId: digest.id,
    title: digest.title,
    summary: digest.summary,
    pagepath: digest.pagepath,
    wecomPage: digest.wecomPage,
    sharePath: digest.sharePath,
    items: digest.items,
    itemCount: digest.items.length,
    status: ok ? 'confirm' : (wecomSend && wecomSend.skipped ? 'simulated' : 'failed'),
    wecom: wecomSend,
    createdAt: Date.now()
  }
  await db.collection('distribute_logs').doc(log.id).set({ data: log })
  digest.wecom = wecomSend
  return digest
}

/** 确认过有数据就不再重复 count，避免每次列表请求都多两次查询 */
let demoContentReady = false

async function ensureDemoContent() {
  if (demoContentReady) return { seeded: false, reason: 'already has data' }
  let forumCount = 0
  let wallCount = 0
  try {
    const [forumRes, wallRes] = await Promise.all([
      db.collection('forum_posts').count(),
      db.collection('wall_posts').count()
    ])
    forumCount = forumRes.total
    wallCount = wallRes.total
  } catch (err) {
    return { seeded: false, reason: 'posts collection missing' }
  }
  if (forumCount > 0 && wallCount > 0) {
    demoContentReady = true
    return { seeded: false, reason: 'already has data', forumCount, wallCount }
  }
  const now = Date.now()
  const ago = (hours) => now - hours * 3600000
  const demoAuthors = [
    {
      id: 'demo_u1',
      nickname: '晚风同学',
      avatar: defaultProfile.stableAvatar('demo_u1'),
      school: '武汉大学 · 文理学部'
    },
    {
      id: 'demo_u2',
      nickname: '图书馆钉子户',
      avatar: defaultProfile.stableAvatar('demo_u2'),
      school: '武汉大学 · 信息学部'
    },
    {
      id: 'demo_u3',
      nickname: '骑行的猫',
      avatar: defaultProfile.stableAvatar('demo_u3'),
      school: '华中科技大学'
    },
    {
      id: 'demo_u4',
      nickname: '匿名树洞',
      avatar: defaultProfile.stableAvatar('demo_u4'),
      school: ''
    }
  ]

  const forumPosts = [
    {
      id: 'demo_f1',
      category: '校园生活',
      title: '东区新开的奶茶店有人去过吗',
      content: '听说第二杯半价，想问问排队久不久，有没有推荐的口味。',
      images: [],
      authorId: demoAuthors[0].id,
      authorName: demoAuthors[0].nickname,
      authorAvatar: demoAuthors[0].avatar,
      authorSchool: demoAuthors[0].school,
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: ago(6),
      likeCount: 18,
      commentCount: 1,
      viewCount: 126
    },
    {
      id: 'demo_f2',
      category: '学习交流',
      title: '高数期末复习资料互助',
      content: '整理了一份近三年考点清单，想找同学互换错题本，图书馆三楼见。',
      images: [],
      authorId: demoAuthors[1].id,
      authorName: demoAuthors[1].nickname,
      authorAvatar: demoAuthors[1].avatar,
      authorSchool: demoAuthors[1].school,
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: ago(14),
      likeCount: 42,
      commentCount: 1,
      viewCount: 310
    },
    {
      id: 'demo_f3',
      category: '活动组队',
      title: '周末羽毛球场还差两人',
      content: '周六下午 3 点到 5 点，旧体育馆 3 号场。水平一般，图个开心。',
      images: [],
      authorId: demoAuthors[2].id,
      authorName: demoAuthors[2].nickname,
      authorAvatar: demoAuthors[2].avatar,
      authorSchool: demoAuthors[2].school,
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: ago(28),
      likeCount: 9,
      commentCount: 0,
      viewCount: 88
    },
    {
      id: 'demo_f4',
      category: '吐槽树洞',
      title: '选修课点名也太随机了',
      content: '一学期去了两次，两次都被抽中。有没有同学知道是按学号还是纯随机……',
      images: [],
      authorId: demoAuthors[3].id,
      authorName: '匿名同学',
      authorAvatar: demoAuthors[3].avatar,
      authorSchool: '',
      anonymous: true,
      reviewStatus: 'approved',
      createdAt: ago(40),
      likeCount: 31,
      commentCount: 0,
      viewCount: 240
    }
  ]

  const wallPosts = [
    {
      id: 'demo_w1',
      tag: '二手闲置流转',
      title: '出一本几乎全新的《深入理解计算机系统》',
      price: '45 元 / 可小刀',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '',
      content: '大二买的，翻过前面几章，封面完好。可面交东区宿舍楼下。',
      images: [],
      contactType: 'wechat',
      contactValue: 'demo_csapp',
      dealStatus: 'open',
      authorId: demoAuthors[0].id,
      authorName: demoAuthors[0].nickname,
      authorAvatar: demoAuthors[0].avatar,
      authorSchool: demoAuthors[0].school,
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: ago(10),
      likeCount: 12,
      commentCount: 1,
      viewCount: 156
    },
    {
      id: 'demo_w2',
      tag: '出行拼车',
      title: '',
      price: '',
      routeFrom: '信息学部',
      routeTo: '汉口火车站',
      departTime: '周五 16:00',
      extra: '还可坐 2 人',
      content: '自己有车，顺路去汉口站。希望拼两位同学分摊油费，每人大约 20。',
      images: [],
      contactType: 'wechat',
      contactValue: 'demo_ride',
      dealStatus: 'open',
      authorId: demoAuthors[2].id,
      authorName: demoAuthors[2].nickname,
      authorAvatar: demoAuthors[2].avatar,
      authorSchool: demoAuthors[2].school,
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: ago(18),
      likeCount: 9,
      commentCount: 0,
      viewCount: 140
    },
    {
      id: 'demo_w3',
      tag: '拼单互助',
      title: '拼一单水果捞，差 2 人起送',
      price: '',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '满 3 人起送 · 今天下午',
      content: '东区门口那家水果捞满 39 免配送。我点一份芒桶，还差两份。',
      images: [],
      contactType: 'wechat',
      contactValue: 'lib_window3',
      dealStatus: 'open',
      authorId: demoAuthors[1].id,
      authorName: demoAuthors[1].nickname,
      authorAvatar: demoAuthors[1].avatar,
      authorSchool: demoAuthors[1].school,
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: ago(22),
      likeCount: 7,
      commentCount: 0,
      viewCount: 88
    },
    {
      id: 'demo_w4',
      tag: '失物招领',
      title: '在三食堂捡到一张校园卡',
      price: '',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '今晚前',
      content: '粉色卡套，失主看私信核对信息后领取。',
      images: [],
      contactType: 'wechat',
      contactValue: 'demo_found',
      dealStatus: 'open',
      authorId: demoAuthors[0].id,
      authorName: demoAuthors[0].nickname,
      authorAvatar: demoAuthors[0].avatar,
      authorSchool: demoAuthors[0].school,
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: ago(5),
      likeCount: 3,
      commentCount: 0,
      viewCount: 67
    }
  ]

  const comments = [
    {
      id: 'demo_c1',
      targetType: 'forum',
      targetId: 'demo_f1',
      postAuthorId: demoAuthors[0].id,
      parentId: '',
      replyToId: '',
      replyToName: '',
      depth: 0,
      content: '生椰拿铁还可以，工作日中午人少。',
      images: [],
      authorId: demoAuthors[1].id,
      authorName: demoAuthors[1].nickname,
      authorAvatar: demoAuthors[1].avatar,
      createdAt: ago(4)
    },
    {
      id: 'demo_c2',
      targetType: 'forum',
      targetId: 'demo_f2',
      postAuthorId: demoAuthors[1].id,
      parentId: '',
      replyToId: '',
      replyToName: '',
      depth: 0,
      content: '我有错题本，今晚 7 点图书馆见。',
      images: [],
      authorId: demoAuthors[2].id,
      authorName: demoAuthors[2].nickname,
      authorAvatar: demoAuthors[2].avatar,
      createdAt: ago(12)
    },
    {
      id: 'demo_c3',
      targetType: 'wall',
      targetId: 'demo_w1',
      postAuthorId: demoAuthors[0].id,
      parentId: '',
      replyToId: '',
      replyToName: '',
      depth: 0,
      content: '还在吗？今晚可以面交吗？',
      images: [],
      authorId: demoAuthors[2].id,
      authorName: demoAuthors[2].nickname,
      authorAvatar: demoAuthors[2].avatar,
      createdAt: ago(8)
    }
  ]

  const needForum = forumCount === 0
  const needWall = wallCount === 0
  const safeSet = async (collection, id, data) => {
    try {
      await db.collection(collection).doc(id).set({ data })
      return true
    } catch (err) {
      console.error('[ensureDemoContent]', collection, id, err && err.message)
      return false
    }
  }
  if (needForum) {
    for (const item of forumPosts) await safeSet('forum_posts', item.id, item)
    await safeSet('comments', 'demo_c1', comments[0])
    await safeSet('comments', 'demo_c2', comments[1])
  }
  if (needWall) {
    for (const item of wallPosts) await safeSet('wall_posts', item.id, item)
    await safeSet('comments', 'demo_c3', comments[2])
  } else {
    // 修补已写入的演示帖：互助广场全频道必须有微信号
    for (const item of wallPosts) {
      if (!item.contactType || !item.contactValue) continue
      try {
        const snap = await db.collection('wall_posts').doc(item.id).get()
        const row = (snap && snap.data) || null
        if (!row) continue
        const needPatch = !row.contactType || !row.contactValue || row.contactType === 'phone'
        if (!needPatch) continue
        await db.collection('wall_posts').doc(item.id).update({
          data: {
            contactType: item.contactType,
            contactValue: item.contactValue
          }
        })
      } catch (err) {
        console.error('[ensureDemoContent] patch contact', item.id, err && err.message)
      }
    }
  }

  return {
    seeded: true,
    seededForum: needForum,
    seededWall: needWall
  }
}

let weeklyHotReady = false

async function ensureDemoWeeklyHot() {
  if (weeklyHotReady) return { seeded: false, reason: 'already has weekly hot' }
  let board = null
  try {
    board = (await db.collection('weekly_hot').doc('current').get()).data
  } catch (err) {
    board = null
  }
  if (board && board.enabled && Array.isArray(board.items) && board.items.length) {
    weeklyHotReady = true
    return { seeded: false, reason: 'already has weekly hot' }
  }

  await ensureDemoContent().catch(() => null)
  const [walls, forums] = await Promise.all([
    allDocs('wall_posts'),
    allDocs('forum_posts')
  ])
  const candidates = []
  walls
    .filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
    .forEach((post) => {
      candidates.push({
        contentType: 'wall',
        contentId: post.id || post._id,
        score: postHeatScore(post)
      })
    })
  forums
    .filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved'))
    .forEach((post) => {
      candidates.push({
        contentType: 'forum',
        contentId: post.id || post._id,
        score: postHeatScore(post)
      })
    })
  const items = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item, index) => ({
      contentType: item.contentType,
      contentId: item.contentId,
      rank: index + 1,
      pinnedAt: Date.now()
    }))

  if (!items.length) {
    return { seeded: false, reason: 'no posts to rank' }
  }

  const next = {
    id: 'current',
    title: '园区热议',
    subtitle: '本周校园精选',
    enabled: true,
    schemaVersion: 2,
    items,
    updatedAt: Date.now()
  }
  try {
    await db.collection('weekly_hot').doc('current').set({ data: next })
    return { seeded: true, count: items.length }
  } catch (err) {
    console.error('[ensureDemoWeeklyHot]', err && err.message)
    return { seeded: false, reason: (err && err.message) || 'weekly_hot missing' }
  }
}

function wxHttps(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body == null ? '' : JSON.stringify(body)
    const req = https.request({
      hostname: u.hostname,
      path: `${u.pathname}${u.search}`,
      method: body == null ? 'GET' : 'POST',
      headers: body == null ? {} : {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

let wxTokenCache = { token: '', expireAt: 0 }

async function getMiniAccessToken() {
  if (wxTokenCache.token && wxTokenCache.expireAt > Date.now() + 60 * 1000) {
    return wxTokenCache.token
  }
  const appId = process.env.MINI_APPID || 'wx4f76b34a1edf6503'
  const secret = process.env.MINI_SECRET || ''
  if (!secret) throw new Error('缺少小程序 AppSecret')
  const buf = await wxHttps(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`)
  const data = JSON.parse(buf.toString('utf8'))
  if (!data.access_token) throw new Error(data.errmsg || 'access_token 失败')
  wxTokenCache = {
    token: data.access_token,
    expireAt: Date.now() + (Number(data.expires_in) || 7200) * 1000
  }
  return wxTokenCache.token
}

async function makeWxaCode(ticket, envVersion) {
  const token = await getMiniAccessToken()
  const buf = await wxHttps(
    `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`,
    {
      scene: ticket,
      page: 'pages/web-login/web-login',
      check_path: false,
      env_version: envVersion,
      width: 280
    }
  )
  if (!buf.length) throw new Error('empty wxacode')
  if (buf[0] === 0x7b) {
    const err = JSON.parse(buf.toString('utf8'))
    throw new Error(err.errmsg || `wxacode ${err.errcode}`)
  }
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

async function fetchPostDoc(type, id) {
  const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
  try {
    const res = await db.collection(collection).doc(String(id || '')).get()
    return (res && res.data) || null
  } catch (err) {
    return null
  }
}

function assertWxacodeBuffer(raw) {
  if (!raw || !raw.length) throw new Error('empty wxacode')
  if (raw[0] === 0x7b) {
    const err = JSON.parse(raw.toString('utf8'))
    throw new Error(err.errmsg || `wxacode ${err.errcode}`)
  }
  return raw
}

async function createUnlimitedCodeBuffer(page, scene, envVersion) {
  try {
    const res = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page,
      checkPath: false,
      envVersion,
      width: 430
    })
    const buf = res && (res.buffer || res.fileContent)
    if (buf && buf.length) return assertWxacodeBuffer(Buffer.from(buf))
  } catch (err) {
    console.warn('[wxacode.getUnlimited]', err && err.message)
  }
  const token = await getMiniAccessToken()
  const raw = await wxHttps(
    `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`,
    {
      scene,
      page,
      check_path: false,
      env_version: envVersion,
      width: 430
    }
  )
  return assertWxacodeBuffer(raw)
}

async function createPathCodeBuffer(pagePath, envVersion) {
  // 有限码把帖子 id 放在页面 path 上。长按识别走 query.id，
  // 不依赖 scene；scene 在未发布或被分享入口截断时会丢。
  try {
    const res = await cloud.openapi.wxacode.get({
      path: pagePath,
      width: 430,
      envVersion
    })
    const buf = res && (res.buffer || res.fileContent)
    if (buf && buf.length) return assertWxacodeBuffer(Buffer.from(buf))
  } catch (err) {
    console.warn('[wxacode.get]', err && err.message)
  }
  try {
    const token = await getMiniAccessToken()
    const raw = await wxHttps(
      `https://api.weixin.qq.com/wxa/getwxacode?access_token=${encodeURIComponent(token)}`,
      {
        path: pagePath,
        width: 430,
        env_version: envVersion
      }
    )
    return assertWxacodeBuffer(raw)
  } catch (err) {
    console.warn('[wxacode.get https]', err && err.message)
    const cut = pagePath.indexOf('?')
    const page = cut >= 0 ? pagePath.slice(0, cut) : pagePath
    const query = cut >= 0 ? pagePath.slice(cut + 1) : ''
    const scene = (new URLSearchParams(query).get('id') || '').trim()
    if (!scene) throw err
    return createUnlimitedCodeBuffer(page, scene, envVersion)
  }
}

function shareCodeEnv(requested) {
  const raw = String(requested || '').trim()
  if (raw === 'develop' || raw === 'trial' || raw === 'release') return raw
  return process.env.SHARE_CODE_ENV || 'release'
}

async function getOrCreateShareCode(type, id, requestedEnv) {
  const contentType = type === 'wall' ? 'wall' : 'forum'
  const postId = String(id || '').trim()
  if (!postId) return { ok: false, message: '缺少帖子' }
  const post = await fetchPostDoc(contentType, postId)
  if (!post || !sharePoster.isPublicApproved(post)) {
    return { ok: false, code: 'NOT_PUBLIC', message: '内容暂不可生成分享图' }
  }
  const page = sharePoster.detailPageFor(contentType)
  const scene = sharePoster.sceneForPost(contentType, postId)
  const codePath = `${page}?id=${encodeURIComponent(postId)}`
  const envVersion = shareCodeEnv(requestedEnv)
  const cacheId = `scode_path_${contentType}_${postId}_${envVersion}`
  try {
    const cached = (await db.collection('meta').doc(cacheId).get()).data
    if (cached && cached.fileId) {
      return {
        ok: true,
        code: {
          page: cached.page || codePath,
          scene: cached.scene || scene,
          envVersion: cached.envVersion || envVersion,
          fileId: cached.fileId,
          imageUrl: cached.fileId
        }
      }
    }
  } catch (err) {
    // miss
  }
  const buffer = await createPathCodeBuffer(codePath, envVersion)
  const upload = await cloud.uploadFile({
    cloudPath: `share_codes/${contentType}_${postId}_${envVersion}.png`,
    fileContent: buffer
  })
  const fileId = upload.fileID
  if (!fileId) return { ok: false, message: '原帖码上传失败' }
  const row = {
    id: cacheId,
    type: contentType,
    contentId: postId,
    page: codePath,
    scene,
    envVersion,
    fileId,
    imageUrl: fileId,
    createdAt: Date.now()
  }
  await db.collection('meta').doc(cacheId).set({ data: row })
  return {
    ok: true,
    code: {
      page: codePath,
      scene,
      envVersion,
      fileId,
      imageUrl: fileId
    }
  }
}

async function makeUrlScheme(ticket) {
  const token = await getMiniAccessToken()
  const buf = await wxHttps(
    `https://api.weixin.qq.com/wxa/generatescheme?access_token=${encodeURIComponent(token)}`,
    {
      jump_wxa: {
        path: 'pages/web-login/web-login',
        query: `ticket=${ticket}`
      },
      expire_type: 1,
      expire_interval: 1
    }
  )
  const data = JSON.parse(buf.toString('utf8'))
  if (data.errcode && Number(data.errcode) !== 0) {
    throw new Error(data.errmsg || `urlscheme ${data.errcode}`)
  }
  const link = data.openlink || data.openLink || ''
  if (!link) throw new Error('urlscheme empty')
  return link
}

async function readLoginTicket(ticket) {
  try {
    const res = await db.collection('meta').doc(`wlogin_${ticket}`).get()
    return (res && res.data) || null
  } catch (err) {
    return null
  }
}

// 发给客户端前去掉内部账号字段；匿名评论连作者 id 一起抹掉，避免反查身份
function publicCommentFields(item) {
  const { postAuthorId, replyToUserId, ...rest } = item
  return item.anonymous ? { ...rest, authorId: '' } : rest
}

// 当前用户在某帖下点过赞的评论 id；游客或查询失败返回空集合
async function commentLikedIds(user, targetType, targetId) {
  const viewerId = user && user.id !== 'guest_readonly' ? user.id : ''
  if (!viewerId) return new Set()
  try {
    const res = await db.collection('comment_likes').where({ userId: viewerId, targetType, targetId }).limit(200).get()
    return new Set((res.data || []).map((item) => item.commentId))
  } catch (err) {
    return new Set()
  }
}

function shapeComments(rows, user, likedIds) {
  const viewerId = user && user.id !== 'guest_readonly' ? user.id : ''
  const liked = likedIds instanceof Set ? likedIds : new Set()
  return (rows || []).map((item) => publicCommentFields({
    ...item,
    authorName: item.anonymous || defaultProfile.isAnonymousNickname(item.authorName)
      ? defaultProfile.resolveAuthorName(item.authorName, item.id, { anonymous: true })
      : item.authorName,
    parentId: item.parentId || '',
    replyToId: item.replyToId || '',
    replyToName: item.replyToName || '',
    images: Array.isArray(item.images) ? item.images : [],
    authorAvatar: !item.anonymous && defaultProfile.isLegacyAvatar(item.authorAvatar) && user && item.authorId === user.id && defaultProfile.isCustomAvatar(user.avatar)
      ? user.avatar
      : defaultProfile.resolveAvatar(item.authorAvatar, item.anonymous ? item.id : item.authorId),
    depth: Number(item.depth) || 0,
    likeCount: Math.max(0, Number(item.likeCount) || 0),
    liked: liked.has(item.id),
    reviewStatusLabel: moderation.reviewStatusLabel(item.reviewStatus || 'approved'),
    mine: !!(viewerId && item.authorId === viewerId),
    canDelete: !!(viewerId && (item.authorId === viewerId || item.postAuthorId === viewerId || canModerate(user)))
  })).filter((item) => (
    moderation.isPublicStatus(item.reviewStatus || 'approved') || item.mine
  )).sort((a, b) => a.createdAt - b.createdAt)
}

const MINE_COVER_TTL = 5 * 60 * 1000
const mineCoverCache = { at: 0, cover: null }

function shapeMineCover(row) {
  if (!row || row.enabled === false) return null
  const src = String(row.src || '').trim()
  if (!/^(cloud:\/\/|https:\/\/)/.test(src)) return null
  return {
    src,
    credit: String(row.credit || '').trim().slice(0, 30),
    updatedAt: Number(row.updatedAt) || 0
  }
}


// 黎安攻略：公众号推文（运营在后台录入）和用户投稿（人工审核后上线）混在一个信息流里，
// 分类按生活需求分，存在 meta/guide_categories，后台可改
const GUIDE_DEFAULT_CATEGORIES = ['吃喝玩乐', '学习', '生活办事', '出行', '新生必看']
const GUIDE_PAGE_SIZE = 20
const GUIDE_TITLE_MAX = 40
const GUIDE_CONTENT_MAX = 3000
const GUIDE_CATEGORY_TTL = 5 * 60 * 1000
const guideCategoryCache = { at: 0, list: null }

async function getGuideCategories() {
  const now = Date.now()
  if (guideCategoryCache.list && now - guideCategoryCache.at < GUIDE_CATEGORY_TTL) return guideCategoryCache.list
  let list = []
  try {
    const row = (await db.collection('meta').doc('guide_categories').get()).data
    list = ((row && row.list) || []).map((item) => String(item || '').trim()).filter(Boolean)
  } catch (err) {
    list = []
  }
  if (!list.length) list = GUIDE_DEFAULT_CATEGORIES.slice()
  guideCategoryCache.at = now
  guideCategoryCache.list = list
  return list
}

// 圈选的帖子：原帖被删或不再公开时，攻略流里也不展示
async function dropHiddenPicks(rows) {
  const picks = rows.filter((row) => row.kind === 'pick' && row.refId)
  if (!picks.length) return rows
  const visible = new Set()
  await Promise.all(['forum', 'wall'].map(async (type) => {
    const ids = picks.filter((row) => (row.refType === 'wall' ? 'wall' : 'forum') === type).map((row) => row.refId)
    if (!ids.length) return
    try {
      const res = await db.collection(type === 'wall' ? 'wall_posts' : 'forum_posts')
        .where({ id: _.in(ids) })
        .limit(ids.length)
        .get()
      ;(res.data || []).forEach((post) => {
        if (moderation.isPublicStatus(post.reviewStatus || 'approved')) visible.add(`${type}:${post.id || post._id}`)
      })
    } catch (err) {
      console.warn('[dropHiddenPicks]', type, err && err.message)
    }
  }))
  return rows.filter((row) => row.kind !== 'pick'
    || visible.has(`${row.refType === 'wall' ? 'wall' : 'forum'}:${row.refId}`))
}

function guideExcerpt(text, size) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, size)
}

// kind：article 公众号推文 / post 攻略页投稿 / pick 运营从首页帖子圈选（点开进原帖）
function guideKind(row) {
  if (row.kind === 'article' || row.kind === 'pick') return row.kind
  return 'post'
}

function shapeGuide(row, viewer, withBody) {
  if (!row) return null
  const kind = guideKind(row)
  const article = kind === 'article'
  const item = {
    id: row.id || row._id,
    kind,
    refType: kind === 'pick' ? (row.refType === 'wall' ? 'wall' : 'forum') : '',
    refId: kind === 'pick' ? (row.refId || '') : '',
    category: row.category || '',
    title: row.title || '',
    summary: row.summary || guideExcerpt(row.content, 60),
    cover: article ? (row.cover || '') : '',
    articleUrl: article ? (row.articleUrl || '') : '',
    authorName: article ? OFFICIAL_AUTHOR_NAME : (row.authorName || ''),
    authorAvatar: article ? '' : (row.authorAvatar || ''),
    official: article || !!row.authorOfficial,
    imageCount: (row.images || []).length,
    viewCount: Number(row.viewCount) || 0,
    publishedAt: Number(row.publishedAt || row.createdAt) || 0,
    reviewStatus: row.reviewStatus || '',
    mine: !!(viewer && row.authorId && viewer.id === row.authorId)
  }
  if (withBody) {
    item.content = row.content || ''
    item.images = row.images || []
  }
  return item
}

const handlers = {
  async bootstrap(payload, user) {
    const body = { ok: true, user: publicUser(user), speakGate: speakGate(user) }
    const wantForum = !!(payload && payload.includeForum)
    const wantWall = !!(payload && payload.includeWall)
    if (wantForum || wantWall) {
      const [posts, wallPosts] = await Promise.all([
        wantForum
          ? listPosts('forum_posts', 'forum', user, { category: '全部', keyword: '', sort: 'new' })
          : Promise.resolve(null),
        wantWall
          ? listPosts('wall_posts', 'wall', user, { tag: '全部', keyword: '', sort: 'new', dealStatus: '全部' })
          : Promise.resolve(null)
      ])
      if (posts) body.posts = posts
      if (wallPosts) body.wall = { posts: wallPosts, digests: [] }
    }
    return body
  },

  async enterOfficial(_payload, user) {
    if (!user || user.id === 'guest_readonly') return { ok: false, message: '请先用微信打开小程序' }
    if (user.status === 'banned') return { ok: false, message: user.banReason || '账号已封禁' }
    if (!user.officialLoginAllowed) return { ok: false, message: '这个账号没有官方登录权限' }
    await saveUser({ ...user, actingOfficial: true })
    const session = asOfficialSession(await ensureOfficialAuthor())
    return { ok: true, user: publicUser(session), speakGate: speakGate(session) }
  },

  async leaveOfficial(_payload, user) {
    const saved = await saveUser({ ...user, actingOfficial: false })
    return { ok: true, user: publicUser(saved), speakGate: speakGate(saved) }
  },

  async me(_payload, user) {
    return { ok: true, user: publicUser(user), speakGate: speakGate(user) }
  },

  async getSpeakGate(_payload, user) {
    return { ok: true, speakGate: speakGate(user), user: publicUser(user) }
  },

  async webRegister(payload) {
    const account = parseWebAccount(payload)
    const pass = String((payload && payload.password) || '')
    if (!account.ok) return { ok: false, message: account.message }
    if (account.kind === 'username') return { ok: false, message: '请使用手机号或邮箱注册' }
    if (pass.length < 6) return { ok: false, message: '密码至少 6 位' }
    const existing = await findUserByAccount(account)
    const attachId = String((payload && payload.attachUserId) || '').trim()
    const nickname = String((payload && payload.nickname) || '').trim()
    const occupiedMsg = account.kind === 'email' ? '该邮箱已被注册' : '该手机号已被注册'
    if (attachId) {
      const current = await getUserById(attachId)
      if (current && current.status !== 'merged' && isWeChatOpenid(current.openid)) {
        if (existing && existing.id !== current.id) return { ok: false, message: occupiedMsg }
        if (account.phone && current.webPhone && current.webPhone !== account.phone) {
          return { ok: false, message: '当前微信账号已绑定其他手机号' }
        }
        if (account.email && current.webEmail && current.webEmail !== account.email) {
          return { ok: false, message: '当前微信账号已绑定其他邮箱' }
        }
        const { salt, hash } = hashPassword(pass)
        const user = await saveUser({
          ...current,
          webUsername: current.webUsername || account.username,
          webPhone: account.phone || current.webPhone || '',
          webEmail: account.email || current.webEmail || '',
          passwordSalt: salt,
          passwordHash: hash,
          nickname: (current.nickname && current.nickname !== '黎安话事')
            ? current.nickname
            : (nickname || account.display)
        })
        return { ok: true, attached: true, user: publicUser(user), speakGate: speakGate(user) }
      }
    }
    if (existing) return { ok: false, message: occupiedMsg }
    const { salt, hash } = hashPassword(pass)
    const user = createBlankUser(`web_${account.username}`, {
      id: `u_web_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      webUsername: account.username,
      webPhone: account.phone || '',
      webEmail: account.email || '',
      passwordSalt: salt,
      passwordHash: hash,
      nickname: nickname || account.display
    })
    await saveUser(user)
    return { ok: true, user: publicUser(user), speakGate: speakGate(user) }
  },

  async webLogin(payload) {
    const account = parseWebAccount(payload)
    const pass = String((payload && payload.password) || '')
    if (!account.ok) return { ok: false, message: account.message }
    const user = await findUserByAccount(account)
    if (!user || !user.passwordHash || !verifyPassword(pass, user.passwordSalt, user.passwordHash)) {
      return { ok: false, message: loginFailMessage(account.kind) }
    }
    const patch = {}
    if (account.phone && !user.webPhone) patch.webPhone = account.phone
    if (account.email && !user.webEmail) patch.webEmail = account.email
    const saved = Object.keys(patch).length ? await saveUser({ ...user, ...patch }) : user
    return { ok: true, user: publicUser(saved), speakGate: speakGate(saved) }
  },

  async createWebLoginTicket() {
    const ticket = crypto.randomBytes(12).toString('hex')
    const now = Date.now()
    const row = {
      id: ticket,
      type: 'web_login',
      status: 'pending',
      userId: '',
      createdAt: now,
      expireAt: now + 5 * 60 * 1000
    }
    await db.collection('meta').doc(`wlogin_${ticket}`).set({ data: row })
    let qr = ''
    let scheme = ''
    let qrError = ''
    const versions = ['release', 'trial', 'develop']
    for (let i = 0; i < versions.length; i += 1) {
      try {
        qr = await makeWxaCode(ticket, versions[i])
        qrError = ''
        break
      } catch (err) {
        qrError = (err && err.message) || '登录二维码生成失败'
      }
    }
    if (!qr) {
      try {
        scheme = await makeUrlScheme(ticket)
      } catch (err) {
        if (!qrError) qrError = (err && err.message) || '登录码生成失败'
      }
    }
    return { ok: true, ticket, qr, scheme, qrError, expireAt: row.expireAt }
  },

  async pollWebLogin(payload) {
    const ticket = String((payload && payload.ticket) || '').trim()
    if (!ticket) return { ok: false, message: '缺少登录凭证' }
    const row = await readLoginTicket(ticket)
    if (!row) return { ok: false, code: 'EXPIRED', message: '二维码已失效，请刷新' }
    if (Number(row.expireAt) < Date.now()) {
      return { ok: false, code: 'EXPIRED', message: '二维码已过期，请刷新' }
    }
    if ((row.status !== 'ok' && row.status !== 'used') || !row.userId) {
      return { ok: true, pending: true }
    }
    const user = await getUserById(row.userId)
    if (!user) return { ok: false, message: '用户不存在' }
    if (row.status === 'ok') {
      try {
        await db.collection('meta').doc(`wlogin_${ticket}`).update({
          data: { status: 'used', usedAt: Date.now() }
        })
      } catch (err) { /* ignore */ }
    }
    let account = user
    let didMerge = false
    const attachId = String((payload && payload.webUserId) || '').trim()
    if (attachId && attachId !== user.id) {
      const webUser = await getUserById(attachId)
      if (webUser && webUser.status !== 'merged' && !isWeChatOpenid(webUser.openid)) {
        try {
          account = await mergeAccounts(webUser, user)
          didMerge = true
        } catch (err) {
          if (err && err.code !== 'BOUND') throw err
        }
      }
    }
    return { ok: true, pending: false, merged: didMerge, user: publicUser(account), speakGate: speakGate(account) }
  },

  async confirmWebLogin(payload, user) {
    const ticket = String((payload && (payload.ticket || payload.scene)) || '').trim()
    if (!ticket) return { ok: false, message: '缺少登录凭证' }
    const row = await readLoginTicket(ticket)
    if (!row) return { ok: false, message: '二维码已失效' }
    if (Number(row.expireAt) < Date.now()) return { ok: false, message: '二维码已过期，请在网页刷新' }
    if (row.status === 'used' && row.userId && row.userId !== user.id) {
      return { ok: false, message: '这个码已经用过了' }
    }
    if ((row.status === 'ok' || row.status === 'used') && row.userId === user.id) {
      return { ok: true, user: publicUser(user) }
    }
    if (row.status === 'ok' && row.userId && row.userId !== user.id) {
      return { ok: false, message: '这个码正在被使用' }
    }
    await db.collection('meta').doc(`wlogin_${ticket}`).update({
      data: { status: 'ok', userId: user.id, confirmedAt: Date.now() }
    })
    return { ok: true, user: publicUser(user) }
  },

  async updateUser(payload, user) {
    const blocked = [
      'id',
      'openid',
      'schoolName',
      'schoolCampus',
      'schoolLocked',
      'schoolSubmittedAt',
      'schoolChangeRequest',
      'studentAuthStatus',
      'studentAuthImages',
      'studentAuthNote',
      'studentAuthSubmittedAt',
      'studentAuthReviewedAt',
      'studentAuthReviewNote',
      'status',
      'muteUntil',
      'banReason',
      'bannedAt',
      'riskScore',
      'violateCount',
      'lastSeenLikesAt',
      'lastSeenCommentsAt',
      'webUsername',
      'webPhone',
      'webEmail',
      'passwordHash',
      'passwordSalt',
      'bindCode',
      'bindCodeExpireAt',
      'mergedInto',
      'unionid',
      'webWechatOpenid',
      'appAdmin',
      'postWhitelist',
      'officialLoginAllowed',
      'actingOfficial'
    ]
    const safe = { ...payload }
    blocked.forEach((key) => delete safe[key])
    if (Object.prototype.hasOwnProperty.call(safe, 'showSchoolTag')) {
      if (safe.showSchoolTag && !user.schoolLocked) {
        return { ok: false, message: '请先完成学校认证', user: publicUser(user) }
      }
      safe.showSchoolTag = !!safe.showSchoolTag
      const next = await saveUser({ ...user, showSchoolTag: safe.showSchoolTag })
      const school = authorSchoolForUser(next, false)
      const [forum, wall] = await Promise.all([allDocs('forum_posts'), allDocs('wall_posts')])
      await Promise.all(forum
        .filter((item) => item.authorId === next.id && !item.anonymous)
        .map((item) => db.collection('forum_posts').doc(item.id || item._id).update({ data: { authorSchool: school } })))
      await Promise.all(wall
        .filter((item) => item.authorId === next.id && !item.anonymous)
        .map((item) => db.collection('wall_posts').doc(item.id || item._id).update({ data: { authorSchool: school } })))
      return { ok: true, user: publicUser(next), speakGate: speakGate(next) }
    }
    if (user.id === OFFICIAL_AUTHOR_ID && safe.nickname && safe.nickname !== OFFICIAL_AUTHOR_NAME) {
      return { ok: false, message: '公共账号名称固定为黎安校园墙', user: publicUser(user) }
    }
    if (safe.nickname) {
      const review = await runContentReview({ nickname: safe.nickname, contentType: 'nickname' }, user)
      if (!review.passed) return { ok: false, message: review.message || '昵称未通过审核，请修改', user: publicUser(user) }
    }
    if (safe.bio) {
      const review = await runContentReview({ content: safe.bio, contentType: 'nickname' }, user)
      if (!review.passed) return { ok: false, message: review.message || '签名未通过审核，请修改', user: publicUser(user) }
    }
    const syncAvatar = Object.prototype.hasOwnProperty.call(safe, 'avatar')
    const syncNickname = Object.prototype.hasOwnProperty.call(safe, 'nickname')
    if (syncAvatar) {
      const rawAvatar = String(safe.avatar || '').trim()
      if (rawAvatar.startsWith('wxfile://') || rawAvatar.startsWith('http://tmp') || rawAvatar.startsWith('https://tmp')) {
        return { ok: false, message: '头像需要先上传到云存储', user: publicUser(user) }
      }
      try {
        safe.avatar = await persistCloudFile(safe.avatar, 'avatars')
      } catch (err) {
        return { ok: false, message: err.message || '头像上传失败', user: publicUser(user) }
      }
      if (safe.avatar.startsWith('wxfile://') || safe.avatar.startsWith('http://tmp') || safe.avatar.startsWith('https://tmp')) {
        return { ok: false, message: '头像保存失败，请重试', user: publicUser(user) }
      }
    }
    const next = await saveUser({ ...user, ...safe })
    if (syncAvatar || syncNickname) {
      await syncAuthorProfileOnContent(next, {
        syncAvatar,
        syncNickname,
        oldNickname: user.nickname || ''
      })
    }
    return { ok: true, user: publicUser(next), speakGate: speakGate(next) }
  },

  async submitStudentAuth(payload, user) {
    if (user.status === 'banned') return { ok: false, code: 'BANNED', message: user.banReason || '账号已封禁' }
    if (!user.schoolLocked) return { ok: false, message: '请先完成学校认证' }
    if (user.studentAuthStatus === 'pending') return { ok: false, message: '已有审核中的申请' }
    if (user.studentAuthStatus === 'approved') return { ok: false, message: '已通过学生认证' }
    const photos = (payload.images || []).filter(Boolean).slice(0, 3)
    let images = []
    if (photos.length) {
      try {
        images = await persistCloudFiles(photos, 'auth')
      } catch (err) {
        return { ok: false, message: err.message || '证明照片上传失败' }
      }
    }
    const why = String(payload.note || '').trim()
    const request = {
      id: uid('sa_'),
      type: 'student_auth',
      userId: user.id,
      userNickname: user.nickname,
      schoolName: user.schoolName,
      schoolCampus: user.schoolCampus || '',
      images,
      note: why,
      status: 'pending',
      createdAt: Date.now(),
      reviewedAt: 0,
      reviewNote: ''
    }
    await db.collection('school_requests').doc(request.id).set({ data: request })
    const next = await saveUser({
      ...user,
      studentAuthStatus: 'pending',
      studentAuthImages: images,
      studentAuthNote: why,
      studentAuthSubmittedAt: Date.now(),
      studentAuthReviewedAt: 0,
      studentAuthReviewNote: ''
    })
    await pushSecurityLog({
      level: 'info',
      type: 'student_auth_submit',
      userId: next.id,
      userNickname: next.nickname,
      detail: `提交学生认证材料：${formatSchool(next)}`
    })
    return { ok: true, user: publicUser(next), request }
  },

  async submitSchoolInfo(payload, user) {
    if (user.status === 'banned') return { ok: false, code: 'BANNED', message: user.banReason || '账号已封禁' }
    if (user.schoolLocked) return { ok: false, message: '学校认证后不可修改' }
    const checked = validateSchoolName(payload.schoolName)
    if (!checked.ok) return checked
    const limit = await consumeRateLimit(user.id, 'schoolAuth')
    if (!limit.ok) return limit
    const next = await saveUser({
      ...user,
      schoolName: checked.name,
      schoolCampus: String(payload.schoolCampus || '').trim(),
      schoolLocked: true,
      schoolSubmittedAt: Date.now()
    })
    await pushSecurityLog({
      level: 'info',
      type: 'school_auth',
      userId: next.id,
      userNickname: next.nickname,
      detail: `完成学校认证：${formatSchool(next)}`
    })
    return { ok: true, user: publicUser(next), speakGate: speakGate(next) }
  },

  async requestSchoolChange() {
    return { ok: false, message: '学校认证后不可修改' }
  },

  async listForum(payload, user) {
    const posts = await listPosts('forum_posts', 'forum', user, payload || {})
    return { ok: true, posts, speakGate: speakGate(user) }
  },

  async listHome(payload, user) {
    const topicName = homeFeed.normalizeTopic((payload && (payload.topic || payload.category)) || '全部')
    const keyword = String((payload && payload.keyword) || '').trim()
    const hot = payload && payload.sort === 'hot'
    const before = Number(payload && payload.before) || 0
    const pageSize = Math.min(30, Math.max(10, Number(payload && payload.limit) || 24))
    const batchSize = 40
    let cursor = before
    const matched = []
    const seen = new Set()
    let hasMore = false
    const pushMatch = (item, type) => {
      const id = postDocId(item)
      if (!id || seen.has(id)) return
      if (!homeFeed.topicMatches(item, type, topicName)) return
      if (keyword && !homeFeed.textHit(item, type, keyword)) return
      seen.add(id)
      matched.push({ ...item, id, contentType: type })
    }
    for (let round = 0; round < 5 && matched.length < pageSize; round += 1) {
      const [forumSource, wallSource] = await Promise.all([
        queryHomeSource('forum_posts', cursor, batchSize),
        queryHomeSource('wall_posts', cursor, batchSize)
      ])
      const raw = [...(forumSource.raw || []), ...(wallSource.raw || [])]
      if (!raw.length) {
        hasMore = false
        break
      }
      ;(forumSource.rows || []).forEach((item) => pushMatch(item, 'forum'))
      ;(wallSource.rows || []).forEach((item) => pushMatch(item, 'wall'))
      const oldest = raw.reduce((min, item) => {
        const time = Number(item && item.createdAt) || 0
        if (!time) return min
        return min ? Math.min(min, time) : time
      }, 0)
      const full = (forumSource.raw || []).length >= batchSize || (wallSource.raw || []).length >= batchSize
      if (!oldest || oldest === cursor) {
        hasMore = false
        break
      }
      cursor = oldest
      hasMore = full
      if (!full) break
    }
    matched.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    let page = matched
    if (matched.length > pageSize) {
      const boundary = Number(matched[pageSize - 1].createdAt) || 0
      let end = pageSize
      while (end < matched.length && Number(matched[end].createdAt) === boundary) end += 1
      page = matched.slice(0, end)
      hasMore = true
    }
    const nextBefore = page.reduce((min, item) => {
      const time = Number(item && item.createdAt) || 0
      if (!time) return min
      return min ? Math.min(min, time) : time
    }, 0) || (hasMore ? cursor : 0)
    if (!before) {
      const [pinForum, pinWall, mineForum, mineWall] = await Promise.all([
        pinnedPosts('forum_posts'),
        pinnedPosts('wall_posts'),
        isRealUser(user)
          ? db.collection('forum_posts').where({ authorId: user.id }).limit(8).get().then((res) => res.data || []).catch(() => [])
          : Promise.resolve([]),
        isRealUser(user)
          ? db.collection('wall_posts').where({ authorId: user.id }).limit(8).get().then((res) => res.data || []).catch(() => [])
          : Promise.resolve([])
      ])
      pinForum.forEach((item) => pushMatch(item, 'forum'))
      pinWall.forEach((item) => pushMatch(item, 'wall'))
      mineForum.forEach((item) => {
        if (!item || item.authorId !== user.id) return
        if (item.reviewStatus === 'rejected' || item.reviewStatus === 'emergency_block') return
        pushMatch(item, 'forum')
      })
      mineWall.forEach((item) => {
        if (!item || item.authorId !== user.id) return
        if (item.reviewStatus === 'rejected' || item.reviewStatus === 'emergency_block') return
        pushMatch(item, 'wall')
      })
      const extras = matched.filter((item) => !page.some((row) => postDocId(row) === postDocId(item)))
      if (extras.length) page = page.concat(extras)
    }
    const forumPage = page.filter((item) => item.contentType === 'forum')
    const wallPage = page.filter((item) => item.contentType === 'wall')
    const real = isRealUser(user)
    const [forumLiked, wallLiked] = await Promise.all([
      real ? likedIds(user.id, 'forum', forumPage.map((item) => item.id)) : Promise.resolve([]),
      real ? likedIds(user.id, 'wall', wallPage.map((item) => item.id)) : Promise.resolve([])
    ])
    const decorated = [
      ...decorate(forumPage, 'forum', user, forumLiked),
      ...decorate(wallPage, 'wall', user, wallLiked)
    ]
    const hydrated = await hydrateLegacyAvatars(decorated, user)
    const posts = homeFeed.sortHomePosts(hydrated.map(compactFeedItem), hot)
      .map((item) => homeFeed.toHomeCard(item, item.contentType))
      .filter((item) => item && item.id)
    return {
      ok: true,
      paged: true,
      posts,
      hasMore: !!hasMore,
      nextBefore,
      speakGate: speakGate(user)
    }
  },

  async listWall(payload, user) {
    const [posts, digestRes] = await Promise.all([
      listPosts('wall_posts', 'wall', user, payload || {}),
      db.collection('digests').orderBy('createdAt', 'desc').limit(1).get()
        .then((res) => res.data || [])
        .catch(() => [])
    ])
    const row = digestRes[0]
    const digests = row
      ? [{
        id: row.id || row._id,
        title: row.title || '互助汇总',
        count: Array.isArray(row.items) ? row.items.length : 0
      }]
      : []
    return { ok: true, posts, digests, speakGate: speakGate(user) }
  },

  async getPost(payload, user) {
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    const id = String((payload && (payload.id || payload.postId || payload.contentId)) || '').trim()
    if (!id || id === 'undefined' || id === 'null') {
      return { ok: false, code: 'BAD_REQUEST', message: '缺少帖子 id', post: null }
    }
    try {
      const res = await db.collection(collection).doc(id).get()
      const post = res && res.data
      if (!post) return { ok: true, post: null, notFound: true, comments: payload.includeComments ? [] : undefined }
      const [liked, commentRows, commentLiked] = await Promise.all([
        user ? likedIds(user.id, type, [id]) : Promise.resolve([]),
        payload.includeComments
          ? db.collection('comments').where({ targetType: type, targetId: id }).limit(200).get()
            .then((rows) => (rows && rows.data) || [])
            .catch(() => [])
          : Promise.resolve(null),
        payload.includeComments ? commentLikedIds(user, type, id) : Promise.resolve(null)
      ])
      const decorated = (await hydrateLegacyAvatars(decorate([post], type, user, liked), user))[0]
      if (!moderation.isPublicStatus(decorated.reviewStatus) && !decorated.isOwner) {
        return { ok: true, post: null, notFound: true, comments: payload.includeComments ? [] : undefined }
      }
      const body = { ok: true, post: decorated, speakGate: speakGate(user) }
      if (commentRows) body.comments = shapeComments(commentRows, user, commentLiked)
      return body
    } catch (err) {
      const msg = (err && (err.errMsg || err.message)) || '读取帖子失败'
      // 文档不存在时云库常抛错，记为 notFound；其它网络/权限问题要让前端可重试
      if (/does not exist|不存在|DOCUMENT_NOT_FOUND|cannot find document/i.test(msg)) {
        return { ok: true, post: null, notFound: true }
      }
      console.error('[getPost]', id, msg)
      return { ok: false, code: 'DB_ERROR', message: msg, post: null }
    }
  },

  async bumpView(payload) {
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    try {
      await db.collection(collection).doc(payload.id).update({
        data: { viewCount: _.inc(1) }
      })
    } catch (err) {
      // ignore missing docs
    }
    return { ok: true }
  },

  async createForumPost(rawPayload, user) {
    // 分身发布：对外显示随机分身昵称、不能进主页；后台仍记录真实作者
    const payload = { ...(rawPayload || {}), anonymous: !!(rawPayload && rawPayload.anonymous) }
    const gate = speakGate(user)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    const title = String(payload.title || '').trim()
    const content = String(payload.content || '').trim()
    const tag = homeFeed.cleanTag(payload.tag || payload.category) || homeFeed.DEFAULT_HOME_TAG
    const contact = validateWallContact(payload.contactType, payload.contactValue, tag)
    if (!contact.ok) return contact
    if (!title && !content && !(payload.images || []).length) return { ok: false, message: '请填写标题或正文' }
    const fingerprint = security.contentFingerprint(tag, title, content)
    const submitId = cleanSubmitId(payload.submitId)
    const postId = postIdFor('f_', user.id, fingerprint, submitId)
    if (submitId) {
      const replay = await replaySubmittedPost('forum_posts', postId, user)
      if (replay) return replay
    }
    const forumRes = await recentPostsByAuthor('forum_posts', user.id)
    // 新老记录统一按「话题+标题+正文」比对；只拦 1 小时内的相同内容，过后可以再发
    if (!user.postWhitelist && !user.appAdmin && security.hasDuplicateContent(forumRes.data || [], user.id, fingerprint, forumFingerprintOf)) {
      return { ok: false, code: 'DUPLICATE', message: '请勿短时间重复发布相同内容' }
    }
    const timing = { start: Date.now() }
    const limit = await consumeRateLimit(user.id, 'post', user)
    if (!limit.ok) return limit
    let images = []
    try {
      images = await persistCloudFiles(payload.images || [], 'posts')
    } catch (err) {
      return { ok: false, message: err.message || '图片上传失败' }
    }
    timing.images = Date.now()
    const review = await runContentReview({
      title,
      content,
      contentType: 'forum',
      category: tag,
      channel: tag,
      images
    }, user)
    const post = {
      id: postId,
      tag,
      category: tag,
      title,
      content,
      images,
      authorId: user.id,
      authorName: payload.anonymous ? aliasNameFor(user.id, postId) : user.nickname,
      authorAvatar: payload.anonymous ? defaultProfile.stableAvatar(postId) : defaultProfile.resolveAvatar(user.avatar, user.id),
      authorSchool: authorSchoolForUser(user, payload.anonymous),
      authorOfficial: (!!user.appAdmin || user.id === OFFICIAL_AUTHOR_ID) && !payload.anonymous,
      anonymous: !!payload.anonymous,
      contactType: contact.contactType,
      contactValue: contact.contactValue,
      ...reviewPatch(review),
      createdAt: Date.now(),
      likeCount: 0,
      commentCount: 0,
      viewCount: 0
    }
    timing.review = Date.now()
    const savedForum = await savePostOnce('forum_posts', post)
    logPublishTiming('createForumPost', timing, images.length)
    if (savedForum.duplicated) {
      return { ok: true, post: savedForum.post, message: '发布成功', speakGate: speakGate(user) }
    }
    if (moderation.isPublicStatus(post.reviewStatus)) invalidateFeedCache('forum_posts')
    if (moderation.countsAsViolation(review.outcome) || review.restrictAccount) {
      await handleReviewViolation(user, review, '发帖')
    }
    const result = publishReviewResult(review, post)
    return { ...result, speakGate: speakGate(user) }
  },

  async createWallPost(rawPayload, user) {
    // 分身发布：对外显示随机分身昵称、不能进主页；后台仍记录真实作者
    const payload = { ...(rawPayload || {}), anonymous: !!(rawPayload && rawPayload.anonymous) }
    const gate = speakGate(user)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    const contact = validateWallContact(payload.contactType, payload.contactValue, payload.tag)
    if (!contact.ok) return contact
    const title = String(payload.title || payload.headline || '').trim()
    const content = String(payload.content || '').trim()
    const extra = String(payload.extra || '').trim()
    if (!title) return { ok: false, message: '请填写标题' }
    const fingerprint = security.contentFingerprint(payload.tag, title, content, extra, payload.routeFrom, payload.routeTo)
    const submitId = cleanSubmitId(payload.submitId)
    const postId = postIdFor('w_', user.id, fingerprint, submitId)
    if (submitId) {
      const replay = await replaySubmittedPost('wall_posts', postId, user)
      if (replay) return replay
    }
    const wallRes = await recentPostsByAuthor('wall_posts', user.id)
    if (!user.postWhitelist && !user.appAdmin && security.hasDuplicateContent(wallRes.data || [], user.id, fingerprint, wallFingerprintOf)) {
      return { ok: false, code: 'DUPLICATE', message: '请勿短时间重复发布相同内容' }
    }
    const timing = { start: Date.now() }
    const limit = await consumeRateLimit(user.id, 'post', user)
    if (!limit.ok) return limit
    let images = []
    try {
      images = await persistCloudFiles(payload.images || [], 'posts')
    } catch (err) {
      return { ok: false, message: err.message || '图片上传失败' }
    }
    timing.images = Date.now()
    const review = await runContentReview({
      title,
      content,
      extra,
      routeFrom: payload.routeFrom,
      routeTo: payload.routeTo,
      departTime: payload.departTime,
      contentType: 'wall',
      tag: payload.tag,
      channel: payload.tag,
      contactValue: contact.contactValue,
      images
    }, user)
    const post = {
      id: postId,
      tag: payload.tag,
      title,
      price: String(payload.price || '').trim(),
      routeFrom: String(payload.routeFrom || '').trim(),
      routeTo: String(payload.routeTo || '').trim(),
      departTime: String(payload.departTime || '').trim(),
      extra,
      content,
      images,
      contactType: contact.contactType,
      contactValue: contact.contactValue,
      authorId: user.id,
      authorName: payload.anonymous ? aliasNameFor(user.id, postId) : user.nickname,
      authorAvatar: payload.anonymous ? defaultProfile.stableAvatar(postId) : defaultProfile.resolveAvatar(user.avatar, user.id),
      authorSchool: authorSchoolForUser(user, payload.anonymous),
      authorOfficial: (!!user.appAdmin || user.id === OFFICIAL_AUTHOR_ID) && !payload.anonymous,
      anonymous: !!payload.anonymous,
      dealStatus: 'open',
      ...reviewPatch(review),
      createdAt: Date.now(),
      likeCount: 0,
      commentCount: 0,
      viewCount: 0
    }
    timing.review = Date.now()
    const savedWall = await savePostOnce('wall_posts', post)
    logPublishTiming('createWallPost', timing, images.length)
    if (savedWall.duplicated) {
      return { ok: true, post: savedWall.post, message: '发布成功', speakGate: speakGate(user) }
    }
    if (moderation.isPublicStatus(post.reviewStatus)) invalidateFeedCache('wall_posts')
    if (moderation.countsAsViolation(review.outcome) || review.restrictAccount) {
      await handleReviewViolation(user, review, '发帖')
    }
    const result = publishReviewResult(review, post)
    if (!review.passed) return { ...result, speakGate: speakGate(user) }
    const distribution = await enqueueWall(post)
    return { ...result, distribution, speakGate: speakGate(user) }
  },

  async updateWallDealStatus(payload, user) {
    const id = payload.id
    const nextStatus = normalizeWallDealStatus(payload.dealStatus)
    try {
      const res = await db.collection('wall_posts').doc(id).get()
      const post = res.data
      if (!post) return { ok: false, message: '这条信息已不存在' }
      if (post.authorId !== user.id) return { ok: false, message: '只有发布者可以改状态' }
      if (!moderation.isPublicStatus(post.reviewStatus)) return { ok: false, message: '未公开的内容不能改状态' }
      await db.collection('wall_posts').doc(id).update({
        data: { dealStatus: nextStatus, dealStatusUpdatedAt: Date.now() }
      })
      const liked = await likedIds(user.id, 'wall')
      const decorated = decorate([{ ...post, dealStatus: nextStatus }], 'wall', user, liked)[0]
      return { ok: true, post: decorated, speakGate: speakGate(user) }
    } catch (err) {
      return { ok: false, message: err.message || '更新失败' }
    }
  },

  async pinPost(payload, user) {
    if (!canModerate(user)) return { ok: false, message: '没有置顶权限' }
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    const id = String((payload && payload.id) || '').trim()
    if (!id) return { ok: false, message: '缺少帖子' }
    let post = null
    try {
      post = (await db.collection(collection).doc(id).get()).data
    } catch (err) {
      post = null
    }
    if (!post) return { ok: false, message: '帖子不存在' }
    const turnOn = payload.pinned !== false && !post.pinned
    if (turnOn && !moderation.isPublicStatus(post.reviewStatus || 'approved')) {
      return { ok: false, message: '未公开的帖子不能置顶' }
    }
    if (turnOn) {
      let current = []
      try {
        const res = await db.collection(collection).where({ pinned: true }).limit(8).get()
        current = res.data || []
      } catch (err) {
        current = []
      }
      const others = current.filter((item) => (item.id || item._id) !== id)
      if (others.length >= 3) {
        const oldest = others.slice().sort((a, b) => (a.pinnedAt || 0) - (b.pinnedAt || 0))[0]
        await db.collection(collection).doc(oldest.id || oldest._id).update({
          data: { pinned: false, pinnedAt: 0 }
        })
      }
    }
    await db.collection(collection).doc(id).update({
      data: { pinned: turnOn, pinnedAt: turnOn ? Date.now() : 0 }
    })
    invalidateFeedCache(collection)
    return { ok: true, pinned: turnOn, message: turnOn ? '已置顶' : '已取消置顶' }
  },

  async deletePost(payload, user) {
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    try {
      const res = await db.collection(collection).doc(payload.id).get()
      const post = res.data
      if (!post || (post.authorId !== user.id && !canModerate(user))) return { ok: false, message: '不能删除这条帖子' }
      await db.collection(collection).doc(payload.id).remove()
      invalidateFeedCache(collection)
      const comments = await db.collection('comments').where({ targetType: type, targetId: payload.id }).limit(40).get()
      await Promise.all((comments.data || []).map((item) => db.collection('comments').doc(item.id || item._id).remove()))
      return { ok: true }
    } catch (err) {
      return { ok: false }
    }
  },

  async toggleLike(payload, user) {
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    const likeId = `${user.id}_${type}_${payload.id}`
    let liked = false
    try {
      await db.collection('likes').doc(likeId).get()
      liked = true
    } catch (err) {
      liked = false
    }
    if (liked) {
      await Promise.all([
        db.collection('likes').doc(likeId).remove(),
        db.collection(collection).doc(payload.id).update({ data: { likeCount: _.inc(-1) } })
      ])
      return { ok: true, liked: false }
    }
    let postAuthorId = ''
    try {
      const postRes = await db.collection(collection).doc(payload.id).get()
      postAuthorId = (postRes && postRes.data && postRes.data.authorId) || ''
    } catch (e) {
      postAuthorId = ''
    }
    await Promise.all([
      db.collection('likes').doc(likeId).set({
        data: {
          userId: user.id,
          type,
          postId: payload.id,
          postAuthorId,
          createdAt: Date.now()
        }
      }),
      db.collection(collection).doc(payload.id).update({ data: { likeCount: _.inc(1) } })
    ])
    return { ok: true, liked: true }
  },

  async listComments(payload, user) {
    const [rows, likedSet] = await Promise.all([
      db.collection('comments').where({
        targetType: payload.type,
        targetId: payload.id
      }).limit(200).get(),
      commentLikedIds(user, payload.type, payload.id)
    ])
    return { ok: true, comments: shapeComments(rows.data || [], user, likedSet) }
  },

  async toggleCommentLike(payload, user) {
    if (!user || user.id === 'guest_readonly') {
      return { ok: false, code: 'NEED_LOGIN', message: '请先登录' }
    }
    const commentId = String(payload.id || '').trim()
    if (!commentId) return { ok: false, message: '评论不存在' }
    let comment = null
    try {
      const snap = await db.collection('comments').doc(commentId).get()
      comment = snap && snap.data
    } catch (err) {
      comment = null
    }
    if (!comment || !moderation.isPublicStatus(comment.reviewStatus || 'approved')) {
      return { ok: false, message: '评论不存在' }
    }
    const likeId = `${user.id}_${commentId}`
    let liked = false
    try {
      await db.collection('comment_likes').doc(likeId).get()
      liked = true
    } catch (err) {
      liked = false
    }
    const current = Math.max(0, Number(comment.likeCount) || 0)
    if (liked) {
      await Promise.all([
        db.collection('comment_likes').doc(likeId).remove(),
        db.collection('comments').doc(commentId).update({ data: { likeCount: _.inc(-1) } })
      ])
      return { ok: true, liked: false, likeCount: Math.max(0, current - 1) }
    }
    await Promise.all([
      db.collection('comment_likes').doc(likeId).set({
        data: {
          userId: user.id,
          commentId,
          targetType: comment.targetType,
          targetId: comment.targetId,
          createdAt: Date.now()
        }
      }),
      db.collection('comments').doc(commentId).update({ data: { likeCount: _.inc(1) } })
    ])
    return { ok: true, liked: true, likeCount: current + 1 }
  },

  async addComment(payload, user) {
    const gate = speakGate(user)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    const text = String(payload.content || '').trim()
    let images = []
    try {
      images = await persistCloudFiles(
        (Array.isArray(payload.images) ? payload.images : []).filter(Boolean).slice(0, 3),
        'comments'
      )
    } catch (err) {
      return { ok: false, message: err.message || '图片上传失败' }
    }
    if (!text && !images.length) {
      return { ok: false, message: '写点文字或发张图吧' }
    }
    const collection = payload.type === 'wall' ? 'wall_posts' : 'forum_posts'
    const rawParentId = String(payload.parentId || '').trim()
    // 审核要调微信安全接口，最慢的一环，和限流、原帖/父评论查询一起并发
    const [limit, review, parent, postDoc] = await Promise.all([
      consumeRateLimit(user.id, 'comment'),
      runContentReview({
        content: text,
        contentType: 'comment',
        channel: payload.channel || payload.tag || payload.category || '',
        images
      }, user),
      rawParentId
        ? db.collection('comments').doc(rawParentId).get().then((res) => res && res.data).catch(() => null)
        : Promise.resolve(null),
      db.collection(collection).doc(payload.id).get().then((res) => res && res.data).catch(() => null)
    ])
    if (!limit.ok) return limit
    if (text && review.outcome === moderation.OUTCOMES.EDIT_REQUIRED) {
      return { ok: false, code: 'EDIT_REQUIRED', review, message: review.message }
    }
    if (text && (moderation.countsAsViolation(review.outcome) || review.restrictAccount)) {
      await handleReviewViolation(user, review, '评论')
      return {
        ok: false,
        code: review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 'EMERGENCY_BLOCK' : 'REJECTED',
        review,
        message: review.message
      }
    }

    let parentId = rawParentId
    let replyToId = String(payload.replyToId || '').trim()
    let replyToName = String(payload.replyToName || '').trim()
    let replyToUserId = ''
    let depth = 0
    if (parentId) {
      if (!parent || parent.targetType !== payload.type || parent.targetId !== payload.id) {
        return { ok: false, message: '回复的评论不存在' }
      }
      depth = (Number(parent.depth) || 0) + 1
      if (!replyToId) replyToId = parent.id
      if (!replyToName) {
        replyToName = parent.anonymous || defaultProfile.isAnonymousNickname(parent.authorName)
          ? defaultProfile.resolveAuthorName(parent.authorName, parent.id, { anonymous: true })
          : (parent.authorName || '')
      }
      replyToUserId = parent.authorId || ''
    } else {
      replyToId = ''
      replyToName = ''
    }

    const postAuthorId = (postDoc && postDoc.authorId) || ''
    const anonymous = !!payload.anonymous

    const comment = {
      id: uid('c_'),
      targetType: payload.type,
      targetId: payload.id,
      postAuthorId,
      replyToUserId,
      content: text,
      images,
      parentId,
      replyToId,
      replyToName,
      depth,
      authorId: user.id,
      authorName: anonymous ? aliasNameFor(user.id, payload.id) : user.nickname,
      authorAvatar: anonymous
        ? defaultProfile.stableAvatar(`${payload.id}:${user.id}`)
        : defaultProfile.resolveAvatar(user.avatar, user.id),
      anonymous,
      likeCount: 0,
      ...reviewPatch(review),
      createdAt: Date.now()
    }
    if (moderation.isPublicStatus(comment.reviewStatus)) {
      await Promise.all([
        db.collection('comments').doc(comment.id).set({ data: comment }),
        db.collection(collection).doc(payload.id).update({ data: { commentCount: _.inc(1) } })
      ])
      invalidateFeedCache(collection)
      return {
        ok: true,
        comment: shapeComments([comment], user)[0],
        commentCount: (Number(postDoc && postDoc.commentCount) || 0) + 1
      }
    }
    await db.collection('comments').doc(comment.id).set({ data: comment })
    return {
      ok: true,
      code: comment.reviewStatus,
      comment: shapeComments([comment], user)[0],
      message: review.message || '评论已提交，审核通过后可见'
    }
  },

  async deleteComment(payload, user) {
    if (!user || user.id === 'guest_readonly') {
      return { ok: false, code: 'NEED_LOGIN', message: '请先登录' }
    }
    const id = String((payload && payload.id) || '').trim()
    if (!id) return { ok: false, message: '评论不存在' }
    let comment = null
    try {
      const snap = await db.collection('comments').doc(id).get()
      comment = snap && snap.data
    } catch (err) {
      comment = null
    }
    if (!comment) {
      const rows = await db.collection('comments').where({ id }).limit(1).get().catch(() => ({ data: [] }))
      comment = (rows.data || [])[0] || null
    }
    if (!comment) return { ok: false, message: '评论不存在' }
    const isAuthor = comment.authorId === user.id
    const isPostOwner = comment.postAuthorId === user.id
    if (!isAuthor && !isPostOwner && !canModerate(user)) {
      return { ok: false, message: '只能删除自己的评论' }
    }
    const docId = comment._id || comment.id || id
    let childIds = []
    try {
      const children = await db.collection('comments').where({ parentId: id }).limit(100).get()
      childIds = (children.data || []).map((item) => item._id || item.id).filter(Boolean)
    } catch (err) {
      childIds = []
    }
    const toDelete = Array.from(new Set([docId, ...childIds]))
    await Promise.all(toDelete.map((cid) => db.collection('comments').doc(cid).remove().catch(() => {})))
    const targetType = comment.targetType === 'wall' ? 'wall' : 'forum'
    const targetId = comment.targetId
    const collection = targetType === 'wall' ? 'wall_posts' : 'forum_posts'
    if (targetId) {
      try {
        await db.collection(collection).doc(targetId).update({
          data: { commentCount: _.inc(-toDelete.length) }
        })
        invalidateFeedCache(collection)
      } catch (err) { /* 帖子可能已删 */ }
    }
    return { ok: true, deleted: toDelete.length }
  },

  async myPosts(payload, user) {
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    const res = await db.collection(collection).where({ authorId: user.id }).limit(40).get().catch(() => ({ data: [] }))
    const rows = (res.data || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const liked = await likedIds(user.id, type, rows.map((item) => item.id))
    return { ok: true, posts: await hydrateLegacyAvatars(decorate(rows, type, user, liked), user) }
  },

  async myLiked(payload, user) {
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    const ids = await likedIds(user.id, type)
    const map = await fetchPostsByIds(collection, ids)
    const rows = ids.map((id) => map[id]).filter(Boolean)
    return { ok: true, posts: await hydrateLegacyAvatars(decorate(rows, type, user, ids), user) }
  },

  async listConversations(_payload, user) {
    const rows = (await allDocs('conversations', { memberIds: user.id }))
      .filter((item) => (item.memberIds || []).includes(user.id))
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
    const peerIds = Array.from(new Set(rows
      .map((row) => (row.memberIds || []).find((id) => id !== user.id))
      .filter(Boolean)))
    const peers = {}
    await Promise.all(peerIds.map(async (peerId) => {
      try {
        const peerRes = await db.collection('users').doc(peerId).get()
        peers[peerId] = peerRes.data || null
      } catch (e) {
        peers[peerId] = null
      }
    }))
    const conversations = rows.map((row) => {
      const peerId = (row.memberIds || []).find((id) => id !== user.id) || ''
      const peer = peers[peerId] || {}
      return {
        ...row,
        peerId,
        peerName: peer.nickname || '同学',
        peerAvatar: defaultProfile.resolveAvatar(peer.avatar, peer.id || peerId),
        unreadCount: Number((row.unread || {})[user.id]) || 0
      }
    })
    return { ok: true, conversations }
  },

  async openOrCreateConversation(payload, user) {
    const gate = speakGate(user)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    const peerId = String((payload && payload.peerId) || '').trim()
    if (!peerId) return { ok: false, message: '用户不存在' }
    if (peerId === user.id) return { ok: false, message: '不能给自己发私信' }
    let peer = null
    try {
      const peerRes = await db.collection('users').doc(peerId).get()
      peer = peerRes.data
    } catch (e) {
      peer = null
    }
    if (!peer) {
      const rows = await db.collection('users').where({ id: peerId }).limit(1).get()
      peer = (rows.data || [])[0] || null
    }
    if (!peer) return { ok: false, message: '用户不存在' }

    const pairKey = [user.id, peerId].sort().join('__')
    let existing = null
    try {
      const found = await db.collection('conversations').where({ pairKey }).limit(1).get()
      existing = (found.data || [])[0] || null
    } catch (err) {
      existing = null
    }
    let conversation = existing
    if (!conversation) {
      conversation = {
        id: uid('cv_'),
        pairKey,
        memberIds: [user.id, peerId],
        lastMessageAt: 0,
        lastPreview: '',
        lastSenderId: '',
        unread: { [user.id]: 0, [peerId]: 0 },
        createdAt: Date.now()
      }
      await db.collection('conversations').doc(conversation.id).set({ data: conversation })
    }
    return {
      ok: true,
      conversation: {
        ...conversation,
        peerId,
        peerName: peer.nickname || '同学',
        peerAvatar: defaultProfile.resolveAvatar(peer.avatar, peer.id),
        unreadCount: Number((conversation.unread || {})[user.id]) || 0
      }
    }
  },

  async getConversation(payload, user) {
    const conversationId = String((payload && payload.conversationId) || '').trim()
    if (!conversationId) return { ok: false, message: '会话不存在' }
    let conversation = null
    try {
      const res = await db.collection('conversations').doc(conversationId).get()
      conversation = res.data
    } catch (e) {
      conversation = null
    }
    if (!conversation || !(conversation.memberIds || []).includes(user.id)) {
      return { ok: false, message: '会话不存在' }
    }
    const peerId = (conversation.memberIds || []).find((id) => id !== user.id) || ''
    let peer = {}
    try {
      const peerRes = await db.collection('users').doc(peerId).get()
      peer = peerRes.data || {}
    } catch (e) {
      peer = {}
    }
    return {
      ok: true,
      conversation: {
        ...conversation,
        peerId,
        peerName: peer.nickname || '同学',
        peerAvatar: defaultProfile.resolveAvatar(peer.avatar, peer.id),
        unreadCount: Number((conversation.unread || {})[user.id]) || 0
      }
    }
  },

  async listMessages(payload, user) {
    const conversationId = String((payload && payload.conversationId) || '').trim()
    if (!conversationId) return { ok: true, messages: [] }
    let conversation = null
    try {
      const res = await db.collection('conversations').doc(conversationId).get()
      conversation = res.data
    } catch (e) {
      conversation = null
    }
    if (!conversation || !(conversation.memberIds || []).includes(user.id)) {
      return { ok: true, messages: [] }
    }
    let messages = []
    try {
      const res = await db.collection('dm_messages').where({ conversationId }).limit(40).get()
      messages = res.data || []
    } catch (err) {
      messages = []
    }
    messages = messages
      .filter((item) => {
        const status = item.reviewStatus || 'approved'
        return item.senderId === user.id || moderation.isPublicStatus(status)
      })
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map((item) => ({
        ...item,
        images: Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, 3) : [],
        mine: item.senderId === user.id
      }))
    return { ok: true, messages }
  },

  async markConversationRead(payload, user) {
    const conversationId = String((payload && payload.conversationId) || '').trim()
    if (!conversationId) return { ok: false, message: '会话不存在' }
    let conversation = null
    try {
      const res = await db.collection('conversations').doc(conversationId).get()
      conversation = res.data
    } catch (e) {
      conversation = null
    }
    if (!conversation || !(conversation.memberIds || []).includes(user.id)) {
      return { ok: false, message: '会话不存在' }
    }
    const opened = Number(payload && payload.unreadAtOpen)
    if (!Number.isFinite(opened) || opened < 0) return { ok: false, message: '缺少已读位置' }
    const current = Number((conversation.unread || {})[user.id]) || 0
    const unread = { ...(conversation.unread || {}), [user.id]: Math.max(0, current - opened) }
    await db.collection('conversations').doc(conversationId).update({ data: { unread } })
    return { ok: true }
  },

  async sendMessage(payload, user) {
    const gate = speakGate(user)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    const conversationId = String((payload && payload.conversationId) || '').trim()
    const text = String((payload && payload.content) || '').trim()
    let images = []
    try {
      images = await persistCloudFiles(
        (Array.isArray(payload.images) ? payload.images : []).filter(Boolean).slice(0, 3),
        'dm'
      )
    } catch (err) {
      return { ok: false, message: (err && err.message) || '图片上传失败' }
    }
    if (!text && !images.length) return { ok: false, message: '写点文字或发张图吧' }
    if (text.length > 2000) return { ok: false, message: '私信最多 2000 字' }
    const [limit, review, convRes] = await Promise.all([
      consumeRateLimit(user.id, 'dm'),
      runContentReview({ content: text, contentType: 'dm', images }, user),
      conversationId
        ? db.collection('conversations').doc(conversationId).get().then((res) => res && res.data).catch(() => null)
        : Promise.resolve(null)
    ])
    if (!limit.ok) return limit
    if (review.outcome === moderation.OUTCOMES.EDIT_REQUIRED) {
      return { ok: false, code: 'EDIT_REQUIRED', review, message: review.message }
    }
    if (moderation.countsAsViolation(review.outcome) || review.restrictAccount) {
      await handleReviewViolation(user, review, '私信')
      return {
        ok: false,
        code: review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 'EMERGENCY_BLOCK' : 'REJECTED',
        review,
        message: review.message
      }
    }
    const conversation = convRes
    if (!conversation || !(conversation.memberIds || []).includes(user.id)) {
      return { ok: false, message: '会话不存在' }
    }
    const now = Date.now()
    const held = !moderation.isPublicStatus(review.reviewStatus)
    const message = {
      id: uid('dm_'),
      conversationId,
      senderId: user.id,
      content: text,
      images,
      ...reviewPatch(review),
      createdAt: now
    }
    await db.collection('dm_messages').doc(message.id).set({ data: message })
    if (!held) {
      const unread = { ...(conversation.unread || {}) }
      ;(conversation.memberIds || []).forEach((id) => {
        if (id === user.id) unread[id] = 0
        else unread[id] = (Number(unread[id]) || 0) + 1
      })
      const preview = text ? text.slice(0, 40) : '[图片]'
      await db.collection('conversations').doc(conversationId).update({
        data: {
          lastMessageAt: now,
          lastPreview: preview,
          lastSenderId: user.id,
          unread
        }
      })
    }
    return {
      ok: true,
      held,
      notice: held ? (review.message || '审核通过后对方才能看到') : '',
      message: { ...message, mine: true }
    }
  },

  async myReceivedComments(_payload, user) {
    const snapshotAt = Date.now()
    const [byPost, byReply] = await Promise.all([
      // 按时间倒序取最新的，否则超过条数上限时新评论可能不在列表里，已读位置也就推不过去
      newestWhere('comments', { postAuthorId: user.id }, 30),
      newestWhere('comments', { replyToUserId: user.id }, 20)
    ])
    const seen = new Set()
    const rows = []
    ;[...(byPost.data || []), ...(byReply.data || [])].forEach((item) => {
      if (!item || item.authorId === user.id || seen.has(item.id)) return
      seen.add(item.id)
      rows.push(item)
    })
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const forumIds = rows.filter((item) => item.targetType !== 'wall').map((item) => item.targetId)
    const wallIds = rows.filter((item) => item.targetType === 'wall').map((item) => item.targetId)
    const [forumById, wallById] = await Promise.all([
      fetchPostsByIds('forum_posts', forumIds),
      fetchPostsByIds('wall_posts', wallIds)
    ])
    const comments = rows.slice(0, 40).map((item) => {
      const post = item.targetType === 'wall' ? wallById[item.targetId] : forumById[item.targetId]
      const canOpen = !!(post && (homeFeed.isPublicPost(post) || post.authorId === user.id))
      const postImages = post && Array.isArray(post.images) ? post.images.filter(Boolean) : []
      return {
        ...publicCommentFields(item),
        parentId: item.parentId || '',
        images: Array.isArray(item.images) ? item.images : [],
        postExists: canOpen,
        postCover: canOpen ? (postImages[0] || '') : '',
        postTitle: canOpen
          ? (item.targetType === 'wall' ? wallHeadline(post) : post.title)
          : '原帖已不可用',
        postBadge: canOpen ? homeFeed.postTopic(post, item.targetType) : ''
      }
    })
    return { ok: true, comments, snapshotAt }
  },

  async myReceivedLikes(_payload, user) {
    const snapshotAt = Date.now()
    let likeRows = []
    try {
      likeRows = (await newestWhere('likes', { postAuthorId: user.id }, 40)).data
    } catch (err) {
      likeRows = []
    }
    const rows = likeRows
      .filter((item) => item && item.userId && item.userId !== user.id && item.postAuthorId === user.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 40)
    const forumIds = rows.filter((item) => item.type !== 'wall').map((item) => item.postId)
    const wallIds = rows.filter((item) => item.type === 'wall').map((item) => item.postId)
    const likerIds = Array.from(new Set(rows.map((item) => item.userId).filter(Boolean)))
    const [forumById, wallById] = await Promise.all([
      fetchPostsByIds('forum_posts', forumIds),
      fetchPostsByIds('wall_posts', wallIds)
    ])
    const peers = {}
    await Promise.all(likerIds.map(async (peerId) => {
      try {
        const peerRes = await db.collection('users').doc(peerId).get()
        peers[peerId] = peerRes.data || null
      } catch (e) {
        peers[peerId] = null
      }
    }))
    const likes = rows.map((item) => {
      const type = item.type === 'wall' ? 'wall' : 'forum'
      const post = type === 'wall' ? wallById[item.postId] : forumById[item.postId]
      const canOpen = !!(post && (homeFeed.isPublicPost(post) || post.authorId === user.id))
      const peer = peers[item.userId] || {}
      const postImages = post && Array.isArray(post.images) ? post.images.filter(Boolean) : []
      return {
        id: item.id || `${item.userId}_${type}_${item.postId}`,
        userId: item.userId,
        userName: peer.nickname || '同学',
        userAvatar: defaultProfile.resolveAvatar(peer.avatar, peer.id),
        contentType: type,
        postId: item.postId,
        createdAt: item.createdAt || 0,
        postExists: canOpen,
        postCover: canOpen ? (postImages[0] || '') : '',
        postTitle: canOpen
          ? (type === 'wall' ? wallHeadline(post) : post.title)
          : '原帖已不可用',
        postBadge: canOpen ? homeFeed.postTopic(post, type) : ''
      }
    })
    return { ok: true, likes, snapshotAt }
  },

  async myComments(_payload, user) {
    const res = await db.collection('comments').where({ authorId: user.id }).limit(40).get().catch(() => ({ data: [] }))
    const rows = (res.data || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const forumIds = rows.filter((item) => item.targetType !== 'wall').map((item) => item.targetId)
    const wallIds = rows.filter((item) => item.targetType === 'wall').map((item) => item.targetId)
    const [forumById, wallById] = await Promise.all([
      fetchPostsByIds('forum_posts', forumIds),
      fetchPostsByIds('wall_posts', wallIds)
    ])
    const comments = rows.map((item) => {
      const post = item.targetType === 'wall' ? wallById[item.targetId] : forumById[item.targetId]
      return {
        ...publicCommentFields(item),
        parentId: item.parentId || '',
        images: Array.isArray(item.images) ? item.images : [],
        postExists: !!post,
        postTitle: post
          ? (item.targetType === 'wall' ? wallHeadline(post) : post.title)
          : '原帖已删除',
        postBadge: post ? homeFeed.postTopic(post, item.targetType) : ''
      }
    })
    return { ok: true, comments }
  },

  async getInboxBadges(_payload, user) {
    // 已读位置直接读库：user 来自本实例 90 秒缓存，刚在别的实例标过已读时这里还是旧值，红点会冒回来
    const fresh = await readPost(db.collection('users').doc(user.id)).catch(() => null)
    const lastSeenLikesAt = Number((fresh || user).lastSeenLikesAt) || 0
    const lastSeenCommentsAt = Number((fresh || user).lastSeenCommentsAt) || 0
    const userId = user.id

    async function safeWhere(name, where) {
      try {
        const res = await db.collection(name).where(where).limit(30).get()
        return res.data || []
      } catch (err) {
        return []
      }
    }

    const [commentRows, likeRows, convRows] = await Promise.all([
      safeWhere('comments', _.or([
        { postAuthorId: userId },
        { replyToUserId: userId }
      ])),
      safeWhere('likes', { postAuthorId: userId }),
      safeWhere('conversations', { memberIds: userId })
    ])

    const unreadLikes = likeRows.filter((item) => (
      item.userId !== userId
      && (item.createdAt || 1) > lastSeenLikesAt
      && item.postAuthorId === userId
    )).length

    const unreadComments = commentRows.filter((item) => (
      item.authorId !== userId
      && (item.createdAt || 1) > lastSeenCommentsAt
      && (item.postAuthorId === userId || item.replyToUserId === userId)
    )).length

    const unreadMessages = convRows
      .filter((item) => (item.memberIds || []).includes(userId))
      .reduce((sum, item) => {
        const map = item.unread || {}
        return sum + (Number(map[userId]) || 0)
      }, 0)

    return {
      ok: true,
      badges: { unreadLikes, unreadComments, unreadMessages }
    }
  },

  async markInboxSeen(payload, user) {
    const likes = payload && payload.likes === true
    const comments = payload && payload.comments === true
    if (!likes && !comments) return { ok: false, message: '未指定已读类别' }
    // 只改已读字段、以库里的值为基准取大，不用缓存里的整份 user 覆盖（会把别处刚写的字段冲掉）
    const fresh = (await readPost(db.collection('users').doc(user.id)).catch(() => null)) || user
    const patch = {}
    const now = Date.now()
    if (likes) {
      const at = Math.min(Number(payload.likesAt) || 0, now)
      if (!at) return { ok: false, message: '缺少已读位置' }
      patch.lastSeenLikesAt = Math.max(Number(fresh.lastSeenLikesAt) || 0, at)
    }
    if (comments) {
      const at = Math.min(Number(payload.commentsAt) || 0, now)
      if (!at) return { ok: false, message: '缺少已读位置' }
      patch.lastSeenCommentsAt = Math.max(Number(fresh.lastSeenCommentsAt) || 0, at)
    }
    await db.collection('users').doc(user.id).update({ data: patch })
    if (user.openid) userByOpenidCache.delete(user.openid)
    return { ok: true, user: publicUser({ ...fresh, ...patch }) }
  },

  async getShareCode(payload) {
    const type = payload && (payload.type || payload.postSource) === 'wall' ? 'wall' : 'forum'
    const id = String((payload && (payload.id || payload.postId)) || '').trim()
    try {
      return await getOrCreateShareCode(type, id, payload && payload.envVersion)
    } catch (err) {
      return { ok: false, message: (err && err.message) || '原帖码生成失败' }
    }
  },

  async generateSharePoster(payload) {
    const type = payload && (payload.postSource === 'wall' || payload.type === 'wall') ? 'wall' : 'forum'
    const postId = String((payload && (payload.postId || payload.id || payload.contentId)) || '').trim()
    const requestId = String((payload && payload.requestId) || '').trim()
    if (!postId || postId === 'undefined' || postId === 'null') {
      return { ok: false, message: '缺少帖子 id' }
    }
    const post = await fetchPostDoc(type, postId)
    if (!post || !sharePoster.isPublicApproved(post)) {
      return { ok: false, code: 'NOT_PUBLIC', message: '内容暂不可生成分享图' }
    }
    const publicPost = sharePoster.shapePublicPost(post, type)
    if (!publicPost) return { ok: false, code: 'NOT_PUBLIC', message: '内容暂不可生成分享图' }
    // 明确剔除浏览量，避免进入渲染输入
    delete publicPost.viewCount
    const postRevision = sharePoster.buildPostRevision(post, type)
    let codeResult
    try {
      codeResult = await getOrCreateShareCode(type, postId, payload && payload.envVersion)
    } catch (err) {
      return { ok: false, message: (err && err.message) || '原帖码生成失败' }
    }
    if (!codeResult || !codeResult.ok || !codeResult.code || !codeResult.code.fileId) {
      return { ok: false, message: (codeResult && codeResult.message) || '原帖码生成失败' }
    }
    // 复查公开状态与内容版本
    const again = await fetchPostDoc(type, postId)
    if (!again || !sharePoster.isPublicApproved(again)) {
      return { ok: false, code: 'NOT_PUBLIC', message: '内容暂不可生成分享图' }
    }
    const latestRevision = sharePoster.buildPostRevision(again, type)
    if (latestRevision !== postRevision) {
      return { ok: false, code: 'STALE', message: '帖子内容已更新，请重新生成' }
    }
    return {
      ok: true,
      status: 'ready',
      // 小程序端按同一模板渲染 PNG；此处返回渲染输入与原帖码
      imageFileId: '',
      postSource: type,
      postId,
      postRevision,
      templateVersion: sharePoster.TEMPLATE_VERSION,
      requestId,
      width: sharePoster.POSTER_WIDTH,
      height: 0,
      publicPost,
      originalPostCode: {
        page: codeResult.code.page,
        scene: codeResult.code.scene,
        envVersion: codeResult.code.envVersion,
        fileId: codeResult.code.fileId
      }
    }
  },

  async validateSharePoster(payload) {
    const type = payload && payload.postSource === 'wall' ? 'wall' : 'forum'
    const postId = String((payload && payload.postId) || '').trim()
    const postRevision = String((payload && payload.postRevision) || '').trim()
    if (!postId) return { ok: true, canSave: false, reason: '缺少帖子' }
    const post = await fetchPostDoc(type, postId)
    if (!post || !sharePoster.isPublicApproved(post)) {
      return { ok: true, canSave: false, reason: '内容已下架或不可查看' }
    }
    const latest = sharePoster.buildPostRevision(post, type)
    if (postRevision && latest !== postRevision) {
      return { ok: true, canSave: false, reason: '帖子内容已更新，请重新生成' }
    }
    return { ok: true, canSave: true, postRevision: latest }
  },

  async getPublicProfile(payload, user) {
    const userId = String((payload && (payload.userId || payload.id)) || '').trim()
    if (!userId) return { ok: false, message: '用户不存在' }
    const me = user && user.id !== 'guest_readonly' ? user : null
    let target = await getUserById(userId)
    if (target && target.mergedInto) {
      target = await getUserById(target.mergedInto) || target
    }
    if (target && target.status === 'merged') target = null
    if (!target) {
      const [forumHit, wallHit] = await Promise.all([
        db.collection('forum_posts').where({ authorId: userId }).limit(1).get().catch(() => ({ data: [] })),
        db.collection('wall_posts').where({ authorId: userId }).limit(1).get().catch(() => ({ data: [] }))
      ])
      const sample = ((forumHit.data || []).find((item) => !item.anonymous))
        || ((wallHit.data || []).find((item) => !item.anonymous))
      if (!sample) return { ok: false, message: '用户不存在' }
      target = {
        id: userId,
        nickname: sample.authorName,
        avatar: sample.authorAvatar,
        bio: '在这里遇见有趣的灵魂',
        schoolLocked: false,
        showSchoolTag: false,
        studentAuthStatus: 'none'
      }
    }
    const profileId = target.id || target._id || userId
    // 隐私：不再统计和展示他人的发布、获赞、评论数（旧版前端读到 0）
    const schoolText = target.schoolLocked && target.showSchoolTag
      ? formatSchool(target)
      : ''
    return {
      ok: true,
      isSelf: !!(me && (me.id === userId || me.id === profileId || me._id === userId)),
      profile: {
        id: profileId,
        nickname: defaultProfile.resolveProfileNickname(target.nickname, profileId),
        avatar: defaultProfile.resolveAvatar(target.avatar, target.id),
        bio: target.bio || '在这里遇见有趣的灵魂',
        schoolText,
        schoolLocked: !!target.schoolLocked,
        showSchoolTag: !!target.showSchoolTag,
        studentAuthApproved: target.studentAuthStatus === 'approved'
      },
      stats: { postCount: 0, receivedLikes: 0, receivedComments: 0 }
    }
  },

  async listUserPosts(payload, user) {
    const userId = String((payload && payload.userId) || '').trim()
    const type = payload.type === 'wall' ? 'wall' : 'forum'
    if (!userId) return { ok: true, posts: [] }
    const viewerId = user && user.id && user.id !== 'guest_readonly' ? user.id : ''
    // 隐私：只允许看自己的发布记录，别人的主页不再返回帖子
    if (!viewerId || viewerId !== userId) return { ok: true, posts: [] }
    const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
    const [authoredRes, liked] = await Promise.all([
      db.collection(collection).where({ authorId: userId }).limit(50).get().catch(() => ({ data: [] })),
      viewerId ? likedIds(viewerId, type).catch(() => []) : Promise.resolve([])
    ])
    const rows = (authoredRes.data || [])
      .filter((item) => !item.anonymous)
      .sort((a, b) => b.createdAt - a.createdAt)
    return { ok: true, posts: await hydrateLegacyAvatars(decorate(rows, type, user || guestUser(), liked), user) }
  },

  async stats(_payload, user) {
    const [forumRes, wallRes] = await Promise.all([
      db.collection('forum_posts').where({ authorId: user.id }).limit(40).get().catch(() => ({ data: [] })),
      db.collection('wall_posts').where({ authorId: user.id }).limit(40).get().catch(() => ({ data: [] }))
    ])
    const posts = [...(forumRes.data || []), ...(wallRes.data || [])]
    return {
      ok: true,
      stats: {
        postCount: posts.length,
        receivedLikes: posts.reduce((sum, item) => sum + (item.likeCount || 0), 0),
        receivedComments: posts.reduce((sum, item) => sum + (item.commentCount || 0), 0)
      },
      user: publicUser(user),
      speakGate: speakGate(user)
    }
  },

  async getDigest(payload) {
    if (!payload.id) {
      let list = []
      try {
        const res = await db.collection('digests').orderBy('createdAt', 'desc').limit(1).get()
        list = res.data || []
      } catch (err) {
        const res = await db.collection('digests').limit(8).get().catch(() => ({ data: [] }))
        list = (res.data || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      }
      return { ok: true, digest: list[0] || null }
    }
    try {
      const res = await db.collection('digests').doc(payload.id).get()
      return { ok: true, digest: res.data || null }
    } catch (err) {
      return { ok: true, digest: null }
    }
  },

  async getDigests() {
    let digests = []
    try {
      const res = await db.collection('digests').orderBy('createdAt', 'desc').limit(8).get()
      digests = res.data || []
    } catch (err) {
      const res = await db.collection('digests').limit(8).get().catch(() => ({ data: [] }))
      digests = (res.data || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    }
    return { ok: true, digests }
  },

  // 「我的」页顶部照片，运营后台写 meta/mine_cover；没配或格式不对时返回 null，小程序用包内默认图
  async getMineCover() {
    const now = Date.now()
    if (mineCoverCache.at && now - mineCoverCache.at < MINE_COVER_TTL) {
      return { ok: true, cover: mineCoverCache.cover }
    }
    let row = null
    try {
      row = (await db.collection('meta').doc('mine_cover').get()).data
    } catch (err) {
      row = null
    }
    const cover = shapeMineCover(row)
    mineCoverCache.at = now
    mineCoverCache.cover = cover
    return { ok: true, cover }
  },

  async listGuides(payload = {}, user) {
    const categories = await getGuideCategories()
    const category = categories.includes(payload.category) ? payload.category : ''
    const page = Math.max(0, Math.floor(Number(payload.page) || 0))
    const base = category ? { reviewStatus: 'approved', category } : { reviewStatus: 'approved' }
    // 搜索：标题、副标题、正文里包含关键词即可，和分类筛选叠加，排序不变
    const keyword = String(payload.keyword || '').trim().slice(0, 30)
    let where = base
    if (keyword) {
      const reg = db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
      where = _.and([base, _.or([{ title: reg }, { summary: reg }, { content: reg }])])
    }
    let rows = []
    try {
      const res = await db.collection('guides')
        .where(where)
        // 运营在后台可调顺序：按 sortAt 倒序（上线时取当时时间，调序时改写；老数据由后台打开列表时补齐）
        .orderBy('sortAt', 'desc')
        .skip(page * GUIDE_PAGE_SIZE)
        .limit(GUIDE_PAGE_SIZE)
        .get()
      rows = res.data || []
    } catch (err) {
      // 集合还没建时当作空列表
      rows = []
    }
    // 先按原始条数判断还有没有下一页，再滤掉原帖已不公开的圈选
    const hasMore = rows.length === GUIDE_PAGE_SIZE
    rows = await dropHiddenPicks(rows)
    return withTempMedia({
      ok: true,
      categories,
      items: rows.map((row) => shapeGuide(row, user, false)),
      hasMore
    })
  },

  async getGuideCategories() {
    return { ok: true, categories: await getGuideCategories() }
  },

  async getGuide(payload = {}, user) {
    const id = String(payload.id || '').trim()
    if (!id) return { ok: false, message: '攻略不存在' }
    let row = null
    try {
      row = (await db.collection('guides').doc(id).get()).data
    } catch (err) {
      row = null
    }
    const mine = !!(row && user && row.authorId === user.id)
    if (!row || (row.reviewStatus !== 'approved' && !mine)) return { ok: false, message: '攻略不存在或还在审核' }
    if (row.reviewStatus === 'approved') {
      db.collection('guides').doc(id).update({ data: { viewCount: _.inc(1) } }).catch(() => {})
    }
    return withTempMedia({ ok: true, guide: shapeGuide(row, user, true) })
  },

  // 用户投稿：机审拦掉违规内容，其余一律进人工审核，运营在后台通过后才上线
  async submitGuide(payload = {}, user) {
    const gate = speakGate(user)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    const categories = await getGuideCategories()
    const category = String(payload.category || '').trim()
    const title = String(payload.title || '').trim()
    const content = String(payload.content || '').trim()
    if (!categories.includes(category)) return { ok: false, message: '请选择分类' }
    if (!title) return { ok: false, message: '请填写标题' }
    if (title.length > GUIDE_TITLE_MAX) return { ok: false, message: `标题最多 ${GUIDE_TITLE_MAX} 个字` }
    if (content.length < 10) return { ok: false, message: '正文至少写 10 个字' }
    if (content.length > GUIDE_CONTENT_MAX) return { ok: false, message: `正文最多 ${GUIDE_CONTENT_MAX} 个字` }
    const guideFingerprint = (item) => security.contentFingerprint(item.category, item.title, item.content)
    const fingerprint = guideFingerprint({ category, title, content })
    const [mineRes, limit] = await Promise.all([
      db.collection('guides').where({ authorId: user.id }).limit(30).get().catch(() => ({ data: [] })),
      consumeRateLimit(user.id, 'post', user)
    ])
    if (!user.postWhitelist && !user.appAdmin
      && security.hasDuplicateContent(mineRes.data || [], user.id, fingerprint, guideFingerprint)) {
      return { ok: false, code: 'DUPLICATE', message: '请勿短时间重复投稿相同内容' }
    }
    if (!limit.ok) return limit
    let images = []
    try {
      images = await persistCloudFiles(payload.images || [], 'guides')
    } catch (err) {
      return { ok: false, message: err.message || '图片上传失败' }
    }
    const review = await runContentReview({
      title,
      content,
      contentType: 'guide',
      category,
      channel: category,
      images
    }, user)
    const blocked = [moderation.OUTCOMES.REJECT, moderation.OUTCOMES.EMERGENCY_BLOCK, moderation.OUTCOMES.EDIT_REQUIRED]
      .includes(review.outcome)
    const now = Date.now()
    const id = `gd_${crypto.randomBytes(8).toString('hex')}`
    const guide = {
      id,
      kind: 'post',
      category,
      title,
      content,
      summary: guideExcerpt(content, 60),
      images,
      authorId: user.id,
      authorName: user.nickname,
      authorAvatar: defaultProfile.resolveAvatar(user.avatar, user.id),
      authorOfficial: !!user.appAdmin || user.id === OFFICIAL_AUTHOR_ID,
      ...reviewPatch(review),
      // 机审拦下的也留档，统一记为 rejected（具体结论在 reviewOutcome），后台「已下线 / 未通过」里能查到
      reviewStatus: blocked ? 'rejected' : 'pending',
      createdAt: now,
      publishedAt: 0,
      viewCount: 0
    }
    await db.collection('guides').doc(id).set({ data: guide })
    if (blocked) {
      if (moderation.countsAsViolation(review.outcome) || review.restrictAccount) {
        await handleReviewViolation(user, review, '攻略投稿')
      }
      return { ok: false, code: 'REJECTED', message: review.message || '内容不符合规范，无法投稿' }
    }
    return { ok: true, guide: shapeGuide(guide, user, false), message: '已投稿，审核通过后会出现在黎安攻略' }
  },

  async getWeeklyHot(payload = {}) {
    const tab = payload.tab || '全部'
    const cacheKey = `weekly_${tab}`
    const now = Date.now()
    if (weeklyBoardCache.key === cacheKey && weeklyBoardCache.board && now - weeklyBoardCache.at < WEEKLY_CACHE_TTL) {
      return { ok: true, board: weeklyBoardCache.board }
    }
    let board = null
    try {
      board = (await db.collection('weekly_hot').doc('current').get()).data
    } catch (err) {
      board = null
    }
    if (!board) {
      return {
        ok: true,
        board: {
          id: 'current',
          title: '园区热议',
          subtitle: '本周校园精选',
          enabled: false,
          items: [],
          preview: [],
          count: 0,
          totalCount: 0,
          forumCount: 0,
          wallCount: 0
        }
      }
    }
    if (!board.enabled) {
      return {
        ok: true,
        board: {
          ...board,
          id: 'current',
          items: [],
          preview: [],
          count: 0,
          totalCount: 0,
          forumCount: 0,
          wallCount: 0,
          enabled: false
        }
      }
    }
    const wallIds = (board.items || [])
      .filter((item) => item.contentType !== 'forum')
      .map((item) => item.contentId)
    const forumIds = (board.items || [])
      .filter((item) => item.contentType === 'forum')
      .map((item) => item.contentId)
    const [wallById, forumById] = await Promise.all([
      fetchPostsByIds('wall_posts', wallIds),
      fetchPostsByIds('forum_posts', forumIds)
    ])
    const allItems = (board.items || []).map((item, index) => {
      const type = item.contentType === 'forum' ? 'forum' : 'wall'
      const post = type === 'forum' ? forumById[item.contentId] : wallById[item.contentId]
      if (!post || !homeFeed.isPublicPost(post)) return null
      const title = type === 'forum'
        ? String(post.title || '').trim()
        : String(wallHeadline(post) || '').trim()
      const summary = String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      return {
        ...item,
        contentType: type,
        title: title || summary.slice(0, 36),
        summary,
        oneLiner: title || summary.slice(0, 36),
        channel: homeFeed.primaryTag(post, type),
        tag: homeFeed.primaryTag(post, type),
        likeCount: post.likeCount || 0,
        commentCount: post.commentCount || 0,
        pagepath: type === 'forum'
          ? `pages/forum-detail/forum-detail?id=${post.id || post._id || item.contentId}`
          : `pages/wall-detail/wall-detail?id=${post.id || post._id || item.contentId}`,
        rank: index + 1
      }
    }).filter(Boolean)
    const forumCount = allItems.filter((item) => item.contentType === 'forum').length
    const wallCount = allItems.filter((item) => item.contentType !== 'forum').length
    let items = allItems
    // 旧版块名只用来兼容老版本 / 老链接传进来的 tab 参数，界面上不显示
    if (tab === 'forum' || tab === '论坛' || tab === '园区论坛' || tab === '学习分享') {
      items = allItems.filter((item) => item.contentType === 'forum')
    }
    if (tab === 'wall' || tab === '校园墙' || tab === '互助广场') {
      items = allItems.filter((item) => item.contentType !== 'forum')
    }
    items = items.map((item, index) => ({ ...item, rank: index + 1 }))
    const resultBoard = {
      ...board,
      subtitle: homeFeed.publicWeeklySubtitle(board.subtitle),
      id: 'current',
      items,
      preview: allItems.slice(0, 3).map((item, index) => ({
        rank: index + 1,
        contentType: item.contentType,
        contentId: item.contentId,
        title: item.title,
        oneLiner: item.oneLiner,
        tag: item.tag,
        channel: item.channel
      })),
      count: items.length,
      totalCount: allItems.length,
      forumCount,
      wallCount
    }
    weeklyBoardCache.key = cacheKey
    weeklyBoardCache.board = resultBoard
    weeklyBoardCache.at = Date.now()
    return {
      ok: true,
      board: resultBoard
    }
  },

  async revealWallContact(payload, user) {
    const gate = speakGate(user)
    if (!gate.ok) {
      return { ok: false, code: gate.code, message: gate.code === 'NEED_AUTH' ? '认证学校后才能查看联系方式' : gate.message }
    }
    const limit = await consumeRateLimit(user.id, 'contactView')
    if (!limit.ok) return limit
    const preferForum = payload && payload.type === 'forum'
    const collections = preferForum ? ['forum_posts', 'wall_posts'] : ['wall_posts', 'forum_posts']
    let post = null
    for (let i = 0; i < collections.length; i += 1) {
      try {
        const row = (await db.collection(collections[i]).doc(payload.id).get()).data
        if (row) {
          post = row
          break
        }
      } catch (err) {
        // try next
      }
    }
    if (!post) return { ok: false, message: '这条信息已不存在' }
    if (!moderation.isPublicStatus(post.reviewStatus) && post.authorId !== user.id) {
      return { ok: false, message: '这条信息已不存在' }
    }
    if (!post.contactType || !post.contactValue || post.contactType === 'phone') {
      return { ok: false, message: '发布者未留下微信号' }
    }
    const view = {
      id: uid('cv_'),
      viewerId: user.id,
      viewerName: user.nickname,
      postId: post.id,
      authorId: post.authorId,
      createdAt: Date.now()
    }
    await db.collection('contact_views').doc(view.id).set({ data: view })
    await pushSecurityLog({
      level: 'info',
      type: 'contact_view',
      userId: user.id,
      userNickname: user.nickname,
      detail: `查看了帖子 ${post.id} 的联系方式`
    })
    return {
      ok: true,
      contactType: 'wechat',
      contactValue: post.contactValue,
      contactLabel: '微信号',
      canFeedback: post.authorId !== user.id
    }
  },

  async submitContactFeedback(payload, user) {
    const gate = speakGate(user)
    if (!gate.ok) {
      return { ok: false, code: gate.code, message: gate.code === 'NEED_AUTH' ? '认证学校后才能提交联系反馈' : gate.message }
    }
    const limit = await consumeRateLimit(user.id, 'contactFeedback')
    if (!limit.ok) return limit
    const preferForum = payload && payload.type === 'forum'
    const collections = preferForum ? ['forum_posts', 'wall_posts'] : ['wall_posts', 'forum_posts']
    let post = null
    for (let i = 0; i < collections.length; i += 1) {
      try {
        const row = (await db.collection(collections[i]).doc(payload.id).get()).data
        if (row) {
          post = row
          break
        }
      } catch (err) {
        // try next
      }
    }
    if (!post) return { ok: false, message: '这条信息已不存在' }
    if (!moderation.isPublicStatus(post.reviewStatus) && post.authorId !== user.id) {
      return { ok: false, message: '这条信息已不存在' }
    }
    if (post.authorId === user.id) {
      return { ok: false, message: '不能反馈自己的联系方式' }
    }
    if (!post.contactType || !post.contactValue) {
      return { ok: false, message: '该帖未留下可反馈的联系方式' }
    }
    const viewed = await db.collection('contact_views').where({
      viewerId: user.id,
      postId: post.id
    }).limit(1).get()
    if (!(viewed.data && viewed.data.length)) {
      return { ok: false, message: '请先查看微信号后再反馈' }
    }
    const reasonMeta = CONTACT_FEEDBACK_REASONS.find((item) => item.id === payload.reason)
    if (!reasonMeta) {
      return { ok: false, message: '请选择反馈类型' }
    }
    const note = String(payload.note || '').trim().slice(0, 200)
    if (reasonMeta.id === 'other' && !note) {
      return { ok: false, message: '请补充说明' }
    }
    const existingRes = await db.collection('contact_feedbacks').where({
      viewerId: user.id,
      postId: post.id
    }).limit(1).get()
    const existing = existingRes.data && existingRes.data[0]
    const row = {
      id: (existing && (existing.id || existing._id)) || uid('cf_'),
      postId: post.id,
      authorId: post.authorId,
      viewerId: user.id,
      viewerName: user.nickname,
      reason: reasonMeta.id,
      reasonLabel: reasonMeta.label,
      note,
      tag: post.tag || '',
      postHeadline: wallHeadline(post),
      createdAt: (existing && existing.createdAt) || Date.now(),
      updatedAt: Date.now()
    }
    await db.collection('contact_feedbacks').doc(row.id).set({ data: row })

    if (reasonMeta.id === 'scam_suspected') {
      try {
        const author = (await db.collection('users').doc(post.authorId).get()).data
        if (author) {
          await db.collection('users').doc(post.authorId).update({
            data: { riskScore: (author.riskScore || 0) + 12 }
          })
        }
      } catch (err) { /* ignore missing author */ }
      await pushSecurityLog({
        level: 'warn',
        type: 'contact_feedback_scam',
        userId: user.id,
        userNickname: user.nickname,
        detail: `反馈帖子 ${post.id} 联系方式疑似诈骗`
      })
    } else {
      await pushSecurityLog({
        level: 'info',
        type: 'contact_feedback',
        userId: user.id,
        userNickname: user.nickname,
        detail: `联系反馈 ${reasonMeta.label} · 帖子 ${post.id}`
      })
    }
    return { ok: true, feedback: row }
  },

  async submitReport(payload, user) {
    const type = String((payload && payload.targetType) || '').trim()
    const id = String((payload && payload.targetId) || '').trim()
    if (!['forum', 'wall', 'comment', 'user'].includes(type) || !id) {
      return { ok: false, message: '举报对象无效' }
    }
    // 资格按库里最新账号判断：后台刚限制举报或封号时，实例缓存里的 user 可能还是旧的
    const freshUser = user && user.id !== 'guest_readonly'
      ? ((await readPost(db.collection('users').doc(user.id)).catch(() => null)) || user)
      : user
    const eligible = reportRules.reportEligibility(user && user.officialLogin ? user : freshUser)
    if (!eligible.ok) return { ok: false, code: eligible.code, message: eligible.message }
    const reasonMeta = REPORT_REASONS.find((item) => item.id === payload.reason)
      || REPORT_REASONS.find((item) => item.id === 'other')
    if (type === 'user' && user.id === id) return { ok: false, message: '不能举报自己' }

    let targetAuthorId = ''
    let target = null
    // 评论举报额外记下所属帖子，后台据此跳转原帖
    let parentType = ''
    let parentId = ''
    if (type === 'comment') {
      let comment = null
      try {
        comment = (await db.collection('comments').doc(id).get()).data
      } catch (err) {
        comment = null
      }
      if (!comment) return { ok: false, message: '评论不存在' }
      if (comment.authorId === user.id) return { ok: false, message: '不能举报自己的评论' }
      target = comment
      targetAuthorId = comment.authorId || ''
      parentType = comment.targetType || ''
      parentId = comment.targetId || ''
    } else if (type === 'forum' || type === 'wall') {
      const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
      let post = null
      try {
        post = (await db.collection(collection).doc(id).get()).data
      } catch (err) {
        post = null
      }
      if (!post) return { ok: false, message: '内容不存在' }
      if (post.authorId === user.id) return { ok: false, message: '不能举报自己的帖子' }
      target = post
      targetAuthorId = post.authorId || ''
    } else {
      target = await readPost(db.collection('users').doc(id)).catch(() => null)
      if (!target) return { ok: false, message: '用户不存在' }
      targetAuthorId = id
    }

    const exist = await db.collection('reports').where({
      reporterId: user.id,
      targetType: type,
      targetId: id
    }).limit(20).get()
    // 同一账号对同一对象只能举报一次（含已判无效的），不能靠反复举报刷计数
    if ((exist.data || []).length) {
      return { ok: false, message: '你已经举报过了' }
    }

    const row = {
      id: uid('rp_'),
      targetType: type,
      targetId: id,
      targetAuthorId,
      parentType,
      parentId,
      reason: reasonMeta.id,
      reasonLabel: reasonMeta.label,
      note: String((payload && payload.note) || '').trim().slice(0, 200),
      reporterId: user.id,
      reporterName: user.nickname || '黎安话事',
      reporterSchool: user.schoolName || '',
      reporterEligible: true,
      // 记一份标题快照，原内容被删后后台仍能搜索和辨认
      targetTitle: type === 'user'
        ? String(target.nickname || '').slice(0, 40)
        : String(target.title || target.content || '').replace(/\s+/g, ' ').slice(0, 40),
      status: 'pending',
      createdAt: Date.now(),
      resolvedAt: 0,
      resolveAction: '',
      resolveNote: ''
    }
    await db.collection('reports').doc(row.id).set({ data: row })

    const all = await db.collection('reports').where({
      targetType: type,
      targetId: id,
      status: 'pending'
    }).limit(100).get()
    const reportCount = reportRules.activeReporterIds(all.data || [], target).size
    let escalated = false
    const hideable = type === 'user'
      ? target.reportStatus !== 'manual_review'
      : reportRules.shouldAutoHide(reportCount, target, moderation.isPublicStatus)
    if (reportCount >= REPORT_THRESHOLD && hideable) {
      escalated = true
      const note = `用户举报满 ${reportCount} 次，自动进入人工审核`
      if (type === 'forum' || type === 'wall') {
        const collection = type === 'wall' ? 'wall_posts' : 'forum_posts'
        await db.collection(collection).doc(id).update({
          data: {
            reportCount,
            reviewStatus: 'manual_review',
            reviewOutcome: 'manual_review',
            reviewNote: note,
            reviewPriority: 'high',
            reportHidden: true,
            reportEscalatedAt: Date.now()
          }
        })
        invalidateFeedCache(collection)
      } else if (type === 'comment') {
        // 转人工审核后 shapeComments 只对作者本人可见，其他人立即看不到
        await db.collection('comments').doc(id).update({
          data: {
            reportCount,
            reviewStatus: 'manual_review',
            reviewOutcome: 'manual_review',
            reviewNote: note,
            reviewPriority: 'high',
            reportHidden: true,
            reportEscalatedAt: Date.now()
          }
        })
      } else if (type === 'user') {
        try {
          await db.collection('users').doc(id).update({
            data: {
              reportCount,
              reportStatus: 'manual_review',
              reportEscalatedAt: Date.now(),
              riskScore: (target.riskScore || 0) + 8
            }
          })
        } catch (err) { /* ignore */ }
      }
      await pushSecurityLog({
        level: 'warn',
        type: 'report_escalate',
        userId: targetAuthorId,
        userNickname: '',
        detail: `${type}:${id} 被举报 ${reportCount} 次，进入人工审核`
      })
    } else {
      await pushSecurityLog({
        level: 'info',
        type: 'report_submit',
        userId: user.id,
        userNickname: user.nickname,
        detail: `举报 ${type}:${id} · ${reasonMeta.label}`
      })
    }
    return {
      ok: true,
      report: row,
      reportCount,
      escalated,
      threshold: REPORT_THRESHOLD,
      message: escalated ? '已提交，内容进入审核' : '感谢反馈，我们会尽快处理'
    }
  },

  async trackEvents(payload = {}, user) {
    const { OPENID } = cloud.getWXContext()
    const incoming = Array.isArray(payload.events) ? payload.events.slice(0, 50) : []
    if (!incoming.length) return { ok: true, accepted: 0 }

    const now = Date.now()
    const docs = incoming.map((item) => {
      const event = String((item && item.event) || '').slice(0, 64)
      if (!event) return null
      const props = { ...(item || {}) }
      delete props.openid
      return {
        id: props.id || uid('e_'),
        event,
        ts: Number(props.ts) || now,
        userId: user.id,
        openid: OPENID,
        schoolName: user.schoolName || props.schoolName || '',
        schoolCampus: user.schoolCampus || props.schoolCampus || '',
        schoolLocked: !!user.schoolLocked,
        studentAuthStatus: user.studentAuthStatus || 'none',
        sessionId: String(props.sessionId || '').slice(0, 64),
        speakCode: String(props.speakCode || '').slice(0, 32),
        surface: String(props.surface || '').slice(0, 32),
        source: String(props.source || '').slice(0, 32),
        contentType: String(props.contentType || '').slice(0, 16),
        contentId: String(props.contentId || props.postId || '').slice(0, 64),
        tag: String(props.tag || '').slice(0, 32),
        category: String(props.category || '').slice(0, 32),
        sort: String(props.sort || '').slice(0, 16),
        dealStatus: String(props.dealStatus || '').slice(0, 16),
        tab: String(props.tab || '').slice(0, 16),
        rank: Number(props.rank) || 0,
        keywordLen: Number(props.keywordLen) || 0,
        hasKeyword: !!props.hasKeyword,
        anonymous: !!props.anonymous,
        result: String(props.result || '').slice(0, 32),
        reason: String(props.reason || '').slice(0, 64),
        props: {
          ...props,
          event: undefined,
          id: undefined,
          ts: undefined,
          userId: undefined,
          openid: undefined
        },
        createdAt: now
      }
    }).filter(Boolean)

    if (!docs.length) return { ok: true, accepted: 0 }

    // 分批写入，避免单次过大
    const chunk = 20
    for (let i = 0; i < docs.length; i += chunk) {
      const slice = docs.slice(i, i + chunk)
      await Promise.all(slice.map((doc) => db.collection('analytics_events').doc(doc.id).set({ data: doc })))
    }
    return { ok: true, accepted: docs.length }
  }
}

const APP_ADMIN_WECHAT_IDS = new Set(['ding1gggyd'])

function normalizeWechatId(value) {
  return String(value || '').trim().toLowerCase()
}

async function ensureAppAdmin(user) {
  if (!user || !user.id || user.id === 'guest_readonly') return user
  const alias = normalizeWechatId(user.wechatId)
  if (!APP_ADMIN_WECHAT_IDS.has(alias) || user.appAdmin) return user
  return saveUser({ ...user, appAdmin: true, postWhitelist: true, wechatId: alias })
}

const GUEST_OK = new Set([
  'listForum',
  'listWall',
  'listHome',
  'getPost',
  'bumpView',
  'listComments',
  'getWeeklyHot',
  'getMineCover',
  'listGuides',
  'getGuide',
  'getGuideCategories',
  'getPublicProfile',
  'listUserPosts',
  'getDigests',
  'stats',
  'trackEvents',
  'getShareCode',
  'generateSharePoster',
  'validateSharePoster'
])

const WEB_AUTH_ACTIONS = new Set(['webRegister', 'webLogin', 'createWebLoginTicket', 'pollWebLogin'])

exports.main = (event) => {
  const meter = { count: 0, start: Date.now() }
  return dbMeter.run(meter, () => handleEvent(event)).finally(() => {
    const action = (event && event.action) || ''
    const ms = Date.now() - meter.start
    console.log(`[db-meter] ${action} ${meter.count} ${ms}ms`)
    recordMeter(action, meter.count, ms)
    return flushMeter(false)
  })
}

async function handleEvent(event) {
  const action = (event && event.action) || ''
  const payload = (event && event.payload) || {}
  const handler = handlers[action]
  if (!handler) return { ok: false, message: `未知操作：${action}` }

  const wxContext = (cloud.getWXContext && cloud.getWXContext()) || {}
  const OPENID = wxContext.OPENID || ''
  const fromWeb = webSecretOk(event && event.webSecret)

  try {
    // 网页版已下线：拒绝一切带 webSecret 的调用
    if (fromWeb || WEB_AUTH_ACTIONS.has(action)) {
      return { ok: false, code: 'WEB_OFFLINE', message: '网页版已下线' }
    }

    let user = null
    if (OPENID) {
      const unionid = wxContext.UNIONID || ''
      user = await getUserByOpenid(OPENID)
      // 客户端声明的当前身份和本实例缓存对不上（刚在另一个实例切换过官方身份）：丢缓存重读库，
      // 否则最多 90 秒内会按旧身份发帖/评论
      const acting = event && event.acting
      if (user && (acting === 'official' || acting === 'self') && !!user.actingOfficial !== (acting === 'official')) {
        userByOpenidCache.delete(OPENID)
        user = await getUserByOpenid(OPENID)
      }
      if (!user && unionid) user = await getUserByField('unionid', unionid)
      if (!user) {
        user = await saveUser(createBlankUser(OPENID, unionid ? { unionid } : {}))
      } else {
        const patch = {}
        if (unionid && user.unionid !== unionid) patch.unionid = unionid
        if (isWeChatOpenid(OPENID) && user.openid !== OPENID) patch.openid = OPENID
        const profilePatch = defaultProfile.defaultProfilePatch(user)
        if (profilePatch) Object.assign(patch, profilePatch)
        if (Object.keys(patch).length) user = await saveUser({ ...user, ...patch })
        user = await backfillAuthorAvatars(user)
        user = await backfillAuthorNames(user)
      }
      user = await ensureAppAdmin(user)
      const keepIdentity = action === 'enterOfficial' || action === 'leaveOfficial'
      if (OPENID && !keepIdentity) userByOpenidCache.set(OPENID, { user, at: Date.now() })
      if (!keepIdentity && user.actingOfficial && user.id !== OFFICIAL_AUTHOR_ID) {
        if (user.officialLoginAllowed) {
          user = asOfficialSession(await ensureOfficialAuthor())
        } else {
          user = await saveUser({ ...user, actingOfficial: false })
        }
      }
    } else {
      return { ok: false, message: '未登录' }
    }

    const result = await handler(payload, user)
    if (!result || result.ok === false) return result
    return result
  } catch (err) {
    return { ok: false, message: err.message || '服务异常' }
  }
}
