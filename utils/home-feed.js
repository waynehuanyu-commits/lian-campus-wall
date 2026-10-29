const defaultProfile = require('./default-profile')
const HOME_TOPICS = ['日常投稿', '学习交流', '二手闲置', '拼车', '失物招领', '求助']
const OTHER_TOPIC = '其他'
const OFFICIAL_TOPIC = '官方'
const OFFICIAL_AUTHOR_ID = 'official_lian_wall'
const OFFICIAL_AUTHOR_NAME = '黎安校园墙'
const DEFAULT_HOME_TAG = '日常投稿'
const TAG_FALLBACK = '校园话题'

const LEGACY_WALL_TOPICS = {
  二手闲置流转: '二手闲置',
  出行拼车: '拼车',
  拼单互助: '求助',
  求物求助: '求助',
  失物招领: '失物招领'
}

function primaryTag(post, type) {
  const raw = type === 'wall'
    ? String((post && post.tag) || '').trim()
    : String((post && (post.tag || post.category)) || '').trim()
  return raw || TAG_FALLBACK
}

function isPublicPost(post) {
  const status = post && post.reviewStatus
  if (!status) return true
  return status === 'approved'
}

function cleanTag(value) {
  return String(value || '').replace(/^[#＃]+/, '').replace(/\s+/g, '').trim().slice(0, 8)
}

function normalizeTopic(value) {
  const text = String(value || '').trim()
  if (!text || text === '全部') return '全部'
  if (text === OTHER_TOPIC) return OTHER_TOPIC
  if (text === OFFICIAL_TOPIC) return OFFICIAL_TOPIC
  if (HOME_TOPICS.includes(text)) return text
  if (LEGACY_WALL_TOPICS[text]) return LEGACY_WALL_TOPICS[text]
  return text
}

function searchableText(post, type) {
  const source = post || {}
  const tag = primaryTag(source, type)
  return [
    tag,
    normalizeTopic(tag),
    source.category,
    source.tag,
    source.title,
    source.headline,
    source.content,
    source.summary,
    source.price,
    source.extra,
    source.routeFrom,
    source.routeTo,
    source.departTime
  ].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).join('\n')
}

function isOfficialPost(post) {
  if (!post || post.anonymous) return false
  if (post.official || post.authorOfficial) return true
  if (post.authorId === OFFICIAL_AUTHOR_ID) return true
  return String(post.authorName || '').trim() === OFFICIAL_AUTHOR_NAME
}

function topicMatches(post, type, topicName) {
  const topic = normalizeTopic(topicName)
  if (!topic || topic === '全部') return true
  if (topic === OFFICIAL_TOPIC) return isOfficialPost(post)
  if (topic === OTHER_TOPIC) {
    const tag = normalizeTopic(primaryTag(post, type))
    return !HOME_TOPICS.includes(tag)
  }
  return textHit(post, type, topic)
}

function textHit(post, type, needle) {
  const q = String(needle || '').trim().toLowerCase()
  if (!q) return true
  const tag = primaryTag(post, type)
  if (normalizeTopic(tag).toLowerCase() === q) return true
  const category = String((post && post.category) || '').trim()
  if (category && normalizeTopic(category).toLowerCase() === q) return true
  return searchableText(post, type).includes(q)
}

function homeHeatScore(post, now = Date.now()) {
  const created = Number(post && post.createdAt) || now
  const ageHours = Math.max(0.5, (now - created) / 3600000)
  const comments = Number(post && post.commentCount) || 0
  const likes = Number(post && post.likeCount) || 0
  const views = Number(post && post.viewCount) || 0
  // 评论/回复是主要贡献，赞和浏览是辅助。新鲜度沿用现有时间衰减，具体权重待联调样例确认。
  const discussion = comments * 100
  const assist = likes * 2 + views * 0.02
  const freshness = 100 / (1 + ageHours / 24)
  return discussion + assist + freshness
}

function sortHomePosts(list, hot, now = Date.now()) {
  return list.slice().sort((a, b) => {
    const ap = a.pinned ? 1 : 0
    const bp = b.pinned ? 1 : 0
    if (ap !== bp) return bp - ap
    if (ap && bp) return (Number(b.pinnedAt) || 0) - (Number(a.pinnedAt) || 0)
    if (hot) {
      const diff = homeHeatScore(b, now) - homeHeatScore(a, now)
      if (diff !== 0) return diff
    }
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
  })
}

function publicWeeklySubtitle(text) {
  const raw = String(text || '').trim()
  if (!raw || raw === '学习分享 + 互助广场热榜' || raw === '管理员精选热榜') return '本周校园精选'
  return raw
}

function toHomeCard(post, type) {
  const source = post || {}
  let id = String(source.id || source._id || source.contentId || '').trim()
  if (!id || id === 'undefined' || id === 'null') id = ''
  const title = String(source.title || source.headline || '').trim()
    || String(source.content || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return {
    id,
    contentType: type,
    feedKey: id ? `${type}:${id}` : '',
    title,
    content: source.content || '',
    images: source.images || [],
    displayTag: primaryTag(source, type),
    authorId: source.authorId,
    authorName: defaultProfile.resolveAuthorName(source.authorName, source.authorId || id, {
      anonymous: !!source.anonymous
    }),
    authorAvatar: defaultProfile.resolveAuthorAvatar(
      source.authorAvatar,
      source.anonymous || source.authorName === '匿名同学' ? id : (source.authorId || id),
      { anonymous: !!source.anonymous, authorName: source.authorName }
    ),
    anonymous: !!source.anonymous,
    createdAt: source.createdAt,
    likeCount: source.likeCount || 0,
    commentCount: source.commentCount || 0,
    viewCount: Number(source.viewCount) || 0,
    liked: !!source.liked,
    pinned: !!source.pinned,
    pinnedAt: source.pinnedAt || 0,
    official: isOfficialPost(source),
    reviewStatus: source.reviewStatus || 'approved'
  }
}

/**
 * 帖子对外显示的话题标签（消息、分享、我的互动等处统一用它）。
 * type 仍是 'forum' / 'wall'（两张帖子表的历史分法，不能改），但显示上不要再出现「学习分享 / 互助广场」
 */
function postTopic(post, type) {
  if (!post) return TAG_FALLBACK
  if (isOfficialPost(post)) return OFFICIAL_TOPIC
  return normalizeTopic(primaryTag(post, type))
}

/**
 * 企微自动推送队列（digest_queue）里的一条。云函数发帖、后台人工审核通过时都用它入队，
 * 文档 id 固定为 dq_<帖子id>，重复入队只会覆盖同一条，不会重复推送。
 */
// 按完整字符截断：String.slice 会把表情（😭 等两个码元）切成半个，企微收到会报 40058 参数错误
function clipChars(text, max) {
  return Array.from(String(text || '')).slice(0, max).join('')
}

function digestQueueItem(post, type) {
  const id = String((post && (post.id || post._id)) || '')
  const kind = type === 'wall' ? 'wall' : 'forum'
  const content = String((post && post.content) || '').replace(/\s+/g, ' ').trim()
  const route = kind === 'wall' && (post.routeFrom || post.routeTo)
    ? `${post.routeFrom || '出发地'} → ${post.routeTo || '目的地'}`
    : ''
  const title = String((post && post.title) || route || clipChars(content, 20) || postTopic(post, kind)).trim()
  const page = kind === 'wall' ? 'pages/wall-detail/wall-detail' : 'pages/forum-detail/forum-detail'
  return {
    id: `dq_${id}`,
    contentType: kind,
    contentId: id,
    title: clipChars(title, 40),
    summary: clipChars(content, 80),
    channel: postTopic(post, kind),
    pagepath: `${page}?id=${id}`,
    queuedAt: Date.now()
  }
}

// 话题配色：每个话题一个辅助色（样式在 app.wxss .tone-*），没列出的话题用灰
const TOPIC_TONES = {
  学习交流: 'blue',
  日常投稿: 'violet',
  二手闲置: 'teal',
  拼车: 'coral',
  失物招领: 'amber',
  求助: 'rose',
  官方: 'gold'
}

function topicTone(topic) {
  return TOPIC_TONES[normalizeTopic(topic)] || 'gray'
}

module.exports = {
  topicTone,
  postTopic,
  digestQueueItem,
  clipChars,
  HOME_TOPICS,
  OTHER_TOPIC,
  OFFICIAL_TOPIC,
  OFFICIAL_AUTHOR_ID,
  OFFICIAL_AUTHOR_NAME,
  isOfficialPost,
  cleanTag,
  DEFAULT_HOME_TAG,
  TAG_FALLBACK,
  LEGACY_WALL_TOPICS,
  primaryTag,
  isPublicPost,
  normalizeTopic,
  topicMatches,
  textHit,
  homeHeatScore,
  sortHomePosts,
  publicWeeklySubtitle,
  toHomeCard
}
