const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const RATE_LIMITS = {
  post: { windowMs: 10 * MINUTE, max: 5, dayMax: 15, label: '发布' },
  comment: { windowMs: 10 * MINUTE, max: 8, dayMax: 40, label: '评论' },
  dm: { windowMs: 10 * MINUTE, max: 30, dayMax: 120, label: '私信' },
  contactView: { windowMs: HOUR, max: 8, dayMax: 20, label: '查看联系方式' },
  contactFeedback: { windowMs: 10 * MINUTE, max: 6, dayMax: 30, label: '联系反馈' },
  schoolAuth: { windowMs: DAY, max: 3, dayMax: 3, label: '学校认证' }
}

const LOCKED_KEYWORDS = [
  '代考', '代课', '代上', '替课', '替考', '代写', '代做', '帮上课',
  '办证', '发票', '色情', '赌博', '博彩', '枪支', '毒品', '迷药',
  '校园贷', '裸贷', '刷单', '垫付', '跑分', '洗钱'
]

const DEFAULT_KEYWORDS = LOCKED_KEYWORDS.concat([
  '贷款中介', '有偿代', '代刷', '兼职刷单', '日赚', '稳赚',
  '加群领', '加v领', '免费领取', '小额贷款'
])

function pruneTimestamps(list, now, windowMs) {
  return (list || []).filter((ts) => now - Number(ts) < windowMs)
}

function checkRateLimit(buckets, action, now = Date.now()) {
  const rule = RATE_LIMITS[action]
  if (!rule) return { ok: true }
  const all = buckets[action] || []
  const inWindow = pruneTimestamps(all, now, rule.windowMs)
  const inDay = pruneTimestamps(all, now, DAY)
  if (inWindow.length >= rule.max) {
    return { ok: false, code: 'RATE_LIMIT', message: `${rule.label}过于频繁，请稍后再试` }
  }
  if (inDay.length >= rule.dayMax) {
    return { ok: false, code: 'RATE_LIMIT', message: `今日${rule.label}次数已达上限` }
  }
  return { ok: true, inWindow: inWindow.length, inDay: inDay.length }
}

function hitRateLimit(buckets, action, now = Date.now()) {
  const next = { ...(buckets || {}) }
  next[action] = pruneTimestamps(next[action] || [], now, DAY).concat(now)
  return next
}

function contentFingerprint(...parts) {
  return parts
    .map((part) => String(part || '').replace(/\s+/g, '').toLowerCase())
    .join('|')
    .slice(0, 240)
}

function countRecentByAuthor(list, authorId, windowMs, now = Date.now()) {
  return (list || []).filter((item) => item.authorId === authorId && now - item.createdAt < windowMs).length
}

function hasDuplicateContent(list, authorId, fingerprint, getFingerprint, windowMs = HOUR, now = Date.now()) {
  return (list || []).some((item) => (
    item.authorId === authorId &&
    now - item.createdAt < windowMs &&
    (getFingerprint ? getFingerprint(item) : contentFingerprint(item.title, item.content)) === fingerprint
  ))
}

function isLockedKeyword(word) {
  return LOCKED_KEYWORDS.includes(String(word || '').trim())
}

module.exports = {
  MINUTE,
  HOUR,
  DAY,
  RATE_LIMITS,
  LOCKED_KEYWORDS,
  DEFAULT_KEYWORDS,
  checkRateLimit,
  hitRateLimit,
  contentFingerprint,
  countRecentByAuthor,
  hasDuplicateContent,
  isLockedKeyword
}
