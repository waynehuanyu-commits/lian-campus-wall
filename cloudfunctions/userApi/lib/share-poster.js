const defaultProfile = require('./default-profile')
const TEMPLATE_VERSION = 'poster_v2'
const POSTER_WIDTH = 750

function cryptoHash(text) {
  // 轻量版本标识：不依赖 Node crypto，云端与小程序共用
  const raw = String(text || '')
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 16)
  }
  return (`00000000${(h1 >>> 0).toString(16)}`).slice(-8)
    + (`00000000${(h2 >>> 0).toString(16)}`).slice(-8)
}

function isPublicApproved(post) {
  if (!post) return false
  const status = post.reviewStatus
  return !status || status === 'approved'
}

function formatPosterTime(ts) {
  const n = Number(ts)
  if (!n || Number.isNaN(n)) return ''
  const date = new Date(n)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date)
  const map = {}
  parts.forEach((item) => {
    if (item.type !== 'literal') map[item.type] = item.value
  })
  if (!map.year || !map.month || !map.day || !map.hour || !map.minute) return ''
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`
}

function buildPostRevision(post, type) {
  const images = Array.isArray(post && post.images) ? post.images : []
  const category = type === 'wall'
    ? String((post && post.tag) || '')
    : String((post && (post.tag || post.category)) || '')
  const payload = [
    type,
    String((post && post.id) || ''),
    String((post && post.title) || ''),
    String((post && post.content) || ''),
    images.join('|'),
    post && post.anonymous ? '1' : '0',
    String((post && post.authorName) || ''),
    String((post && post.authorAvatar) || ''),
    String((post && post.authorSchool) || ''),
    category,
    String((post && post.createdAt) || 0),
    TEMPLATE_VERSION
  ].join('\n')
  return cryptoHash(payload)
}

function shapePublicPost(post, type) {
  if (!post || !isPublicApproved(post)) return null
  const anonymous = !!post.anonymous
  const images = Array.isArray(post.images) ? post.images.filter(Boolean) : []
  const category = type === 'wall'
    ? String(post.tag || '').trim()
    : String((post.tag || post.category || '')).trim()
  const title = String(post.title || '').trim()
  const content = String(post.content || '').trim()
  const createdAt = Number(post.createdAt) || 0
  return {
    id: String(post.id || ''),
    contentType: type === 'wall' ? 'wall' : 'forum',
    title,
    content,
    category,
    createdAt,
    createdText: formatPosterTime(createdAt),
    imageCount: images.length,
    firstImage: images[0] || '',
    anonymous,
    authorName: defaultProfile.resolveAuthorName(post.authorName, post.authorId || post.id, { anonymous }),
    authorAvatar: defaultProfile.resolveAuthorAvatar(post.authorAvatar, post.id, {
      anonymous,
      authorName: post.authorName
    }),
    authorSchool: anonymous ? '' : String(post.authorSchool || '').trim()
  }
}

function detailPageFor(type) {
  return type === 'wall'
    ? 'pages/wall-detail/wall-detail'
    : 'pages/forum-detail/forum-detail'
}

function sceneForPost(type, id) {
  // getUnlimited scene 最长 32；帖子 id 本身已含类型前缀时可直接用
  const raw = String(id || '').trim()
  if (!raw) return ''
  if (raw.length <= 32) return raw
  return raw.slice(0, 32)
}

function parseScene(scene) {
  let raw = String(scene || '').trim()
  if (!raw) return null
  try {
    raw = decodeURIComponent(raw)
  } catch (err) {
    // keep raw
  }
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      raw = decodeURIComponent(raw)
    } catch (err) {
      // keep
    }
  }
  raw = String(raw || '').trim()
  if (!raw) return null
  if (raw.startsWith('w_') || raw.startsWith('wall:')) {
    return { type: 'wall', id: raw.replace(/^wall:/, '') }
  }
  if (raw.startsWith('f_') || raw.startsWith('forum:')) {
    return { type: 'forum', id: raw.replace(/^forum:/, '') }
  }
  // 兜底：按页面自身类型解读纯 id
  return { type: '', id: raw }
}

function clipLine(ctx, line, maxWidth, tail) {
  const ellipsis = '…'
  const extra = String(tail || '')
  const suffix = ellipsis + extra
  const chars = Array.from(String(line || '').replace(/…$/, ''))
  if (ctx.measureText(suffix).width > maxWidth) return ellipsis
  while (chars.length && ctx.measureText(chars.join('') + suffix).width > maxWidth) {
    chars.pop()
  }
  return chars.join('') + ellipsis
}

function wrapLines(ctx, text, maxWidth, maxLines, tail) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim()
  const limit = Number(maxLines) || 0
  const expand = String(tail || '')
  if (!raw || limit < 1) return { lines: [], overflow: false, expand: '' }
  const paragraphs = raw.split('\n')
  const tokens = []
  paragraphs.forEach((para, index) => {
    Array.from(para).forEach((ch) => tokens.push(ch))
    if (index < paragraphs.length - 1) tokens.push('\n')
  })
  const moreAfter = (index) => tokens.slice(index).some((ch) => ch !== '\n')
  const lines = []
  const overflowResult = (line) => {
    lines.push(clipLine(ctx, line, maxWidth, expand))
    return { lines, overflow: true, expand }
  }
  let current = ''
  for (let i = 0; i < tokens.length; i += 1) {
    const ch = tokens[i]
    if (ch === '\n') {
      if (lines.length === limit - 1 && (current || moreAfter(i + 1))) {
        return overflowResult(current)
      }
      lines.push(current)
      current = ''
      if (lines.length >= limit) {
        if (!moreAfter(i + 1)) return { lines, overflow: false, expand: '' }
        const last = lines.pop()
        return overflowResult(last)
      }
      continue
    }
    const next = current + ch
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next
      continue
    }
    if (lines.length === limit - 1) return overflowResult(current)
    lines.push(current)
    current = ch
  }
  if (current) lines.push(current)
  return { lines, overflow: false, expand: '' }
}

module.exports = {
  TEMPLATE_VERSION,
  POSTER_WIDTH,
  isPublicApproved,
  formatPosterTime,
  buildPostRevision,
  shapePublicPost,
  detailPageFor,
  sceneForPost,
  parseScene,
  wrapLines
}
