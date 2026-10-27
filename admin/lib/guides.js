// 黎安攻略：公众号推文由运营录入（直接上线），用户投稿在这里审核；分类存 meta/guide_categories，
// 小程序云函数 listGuides / getGuide / submitGuide 读写同一个 guides 集合
const crypto = require('crypto')
const db = require('./db')

const COLLECTION = 'guides'
const CATEGORY_DOC = 'guide_categories'
const DEFAULT_CATEGORIES = ['吃喝玩乐', '学习', '生活办事', '出行', '新生必看']
const CATEGORY_MAX = 12
const CATEGORY_NAME_MAX = 6
const TITLE_MAX = 40
const SUMMARY_MAX = 40
const STATUSES = ['pending', 'approved', 'offline', 'rejected']
const ARTICLE_URL_RE = /^https:\/\/mp\.weixin\.qq\.com\//

async function getCategories() {
  const row = await db.getDoc('meta', CATEGORY_DOC)
  const list = ((row && row.list) || []).map((item) => String(item || '').trim()).filter(Boolean)
  return list.length ? list : DEFAULT_CATEGORIES.slice()
}

async function saveCategories(payload = {}, operator = '') {
  const raw = Array.isArray(payload.list) ? payload.list : String(payload.list || '').split(/[\n,，、]/)
  const list = Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)))
  if (!list.length) return { ok: false, message: '至少保留一个分类' }
  if (list.length > CATEGORY_MAX) return { ok: false, message: `最多 ${CATEGORY_MAX} 个分类` }
  const tooLong = list.find((item) => item.length > CATEGORY_NAME_MAX)
  if (tooLong) return { ok: false, message: `分类名最多 ${CATEGORY_NAME_MAX} 个字：${tooLong}` }
  await db.setDoc('meta', CATEGORY_DOC, { list, updatedAt: Date.now(), updatedBy: operator })
  return { ok: true, categories: list }
}

async function withPreview(rows) {
  const files = rows.flatMap((row) => [row.cover].concat(row.images || [])).filter(Boolean)
  const map = await db.resolveCloudUrls(files).catch(() => ({}))
  const url = (src) => (src ? (map[src] || (/^https?:|^\//.test(src) ? src : '')) : '')
  return rows.map((row) => ({
    ...row,
    id: row.id || row._id,
    coverUrl: url(row.cover),
    imageUrls: (row.images || []).map(url).filter(Boolean)
  }))
}

// 按状态直接查库（每个状态最近 200 条），数量用 count，攻略多了也不会漏
async function listGuides(status = 'pending') {
  await db.ensureCollection(COLLECTION).catch(() => {})
  const wanted = status === 'offline' ? ['offline', 'rejected'] : [STATUSES.includes(status) ? status : 'pending']
  const [groups, countList] = await Promise.all([
    Promise.all(wanted.map((key) => db.recentDocs(COLLECTION, 200, { reviewStatus: key }).catch(() => []))),
    Promise.all(STATUSES.map((key) => db.countDocs(COLLECTION, { reviewStatus: key }).catch(() => 0)))
  ])
  let items = groups.flat()
  if (status === 'approved') {
    items = await backfillSortAt(items)
    items.sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0))
  } else {
    items.sort((a, b) => (b.publishedAt || b.createdAt || 0) - (a.publishedAt || a.createdAt || 0))
  }
  const counts = STATUSES.reduce((acc, key, index) => ({ ...acc, [key]: countList[index] || 0 }), {})
  return {
    ok: true,
    categories: await getCategories(),
    counts,
    items: await withPreview(items)
  }
}

// 录入或修改一条公众号推文：保存即上线
async function saveArticle(payload = {}, operator = '') {
  const categories = await getCategories()
  const title = String(payload.title || '').trim()
  const category = String(payload.category || '').trim()
  // coverMode=text：不传图，小程序用标题 + 副标题排文字封面（和投稿同一样式）
  const textCover = payload.coverMode === 'text'
  const cover = textCover ? '' : String(payload.cover || '').trim()
  const summary = String(payload.summary || '').replace(/\s+/g, ' ').trim()
  const articleUrl = String(payload.articleUrl || '').trim()
  if (!title) return { ok: false, message: '请填写标题' }
  if (title.length > TITLE_MAX) return { ok: false, message: `标题最多 ${TITLE_MAX} 个字` }
  if (!categories.includes(category)) return { ok: false, message: '请选择分类' }
  if (summary.length > SUMMARY_MAX) return { ok: false, message: `副标题最多 ${SUMMARY_MAX} 个字` }
  if (!textCover && !cover) return { ok: false, message: '请上传横版封面，或选择「用文字封面」' }
  if (cover && !/^(cloud:\/\/|https:\/\/)/.test(cover) && !(db.useLocal() && cover.startsWith('/uploads/'))) {
    return { ok: false, message: '封面地址只能是云存储 fileID 或 https 链接' }
  }
  if (!ARTICLE_URL_RE.test(articleUrl)) return { ok: false, message: '推文链接要以 https://mp.weixin.qq.com/ 开头' }
  const now = Date.now()
  const id = String(payload.id || '').trim()
  const prev = id ? await db.getDoc(COLLECTION, id) : null
  if (id && (!prev || prev.kind !== 'article')) return { ok: false, message: '这条推文不存在' }
  const next = {
    ...(prev || {}),
    id: id || `gd_${crypto.randomBytes(8).toString('hex')}`,
    kind: 'article',
    title,
    category,
    cover,
    articleUrl,
    summary,
    reviewStatus: prev ? prev.reviewStatus : 'approved',
    createdAt: prev ? prev.createdAt : now,
    publishedAt: prev ? prev.publishedAt : now,
    sortAt: prev ? (prev.sortAt || prev.publishedAt || now) : now,
    viewCount: prev ? prev.viewCount || 0 : 0,
    updatedAt: now,
    updatedBy: operator
  }
  delete next._id
  await db.setDoc(COLLECTION, next.id, next)
  return { ok: true, guide: next }
}

// 审核与上下线：approve 通过（可顺便改分类）、reject 不通过、offline 下线、restore 重新上线、delete 删除
async function updateStatus(payload = {}, operator = '') {
  const id = String(payload.id || '').trim()
  const action = String(payload.action || '')
  const row = id ? await db.getDoc(COLLECTION, id) : null
  if (!row) return { ok: false, message: '这条攻略不存在' }
  if (action === 'delete') {
    await db.removeDoc(COLLECTION, id)
    return { ok: true }
  }
  const now = Date.now()
  const patch = { updatedAt: now, updatedBy: operator }
  if (action === 'approve' || action === 'restore') {
    const categories = await getCategories()
    const category = String(payload.category || row.category || '').trim()
    if (!categories.includes(category)) return { ok: false, message: '请选择分类' }
    patch.reviewStatus = 'approved'
    patch.category = category
    if (!row.publishedAt) patch.publishedAt = now
    if (action === 'approve' || !row.sortAt) patch.sortAt = now
    patch.reviewNote = ''
  } else if (action === 'reject') {
    patch.reviewStatus = 'rejected'
    patch.reviewNote = String(payload.note || '').trim().slice(0, 60) || '未通过审核'
  } else if (action === 'offline') {
    patch.reviewStatus = 'offline'
  } else {
    return { ok: false, message: '未知操作' }
  }
  const next = { ...row, ...patch }
  delete next._id
  await db.setDoc(COLLECTION, id, next)
  return { ok: true, guide: next }
}

// 老数据没有 sortAt：按上线时间补上，之后小程序按 sortAt 排序
async function backfillSortAt(rows) {
  const missing = rows.filter((row) => !row.sortAt)
  await Promise.all(missing.map((row) => {
    const sortAt = Number(row.publishedAt || row.createdAt) || Date.now()
    row.sortAt = sortAt
    const next = { ...row }
    delete next._id
    return db.setDoc(COLLECTION, row.id || row._id, next).catch(() => {})
  }))
  return rows
}

// 调整已上线攻略的顺序：up 上移一位、down 下移一位、top 移到最前（按 sortAt 倒序排列）
async function reorder(payload = {}, operator = '') {
  const id = String(payload.id || '').trim()
  const action = String(payload.action || '')
  if (!['up', 'down', 'top'].includes(action)) return { ok: false, message: '未知操作' }
  const rows = await backfillSortAt(await db.recentDocs(COLLECTION, 200, { reviewStatus: 'approved' }).catch(() => []))
  rows.sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0))
  const index = rows.findIndex((row) => (row.id || row._id) === id)
  if (index < 0) return { ok: false, message: '只能调整已上线的攻略' }
  const now = Date.now()
  const save = (row, sortAt) => {
    const next = { ...row, sortAt, updatedAt: now, updatedBy: operator }
    delete next._id
    return db.setDoc(COLLECTION, row.id || row._id, next)
  }
  const current = rows[index]
  if (action === 'top') {
    if (index === 0) return { ok: true }
    await save(current, (rows[0].sortAt || now) + 1)
    return { ok: true }
  }
  const other = rows[action === 'up' ? index - 1 : index + 1]
  if (!other) return { ok: true }
  // 交换两条的排序值；值相同时拉开 1，保证顺序真的变化
  const a = current.sortAt || 0
  const b = other.sortAt || 0
  if (a === b) {
    await save(current, action === 'up' ? b + 1 : b - 1)
  } else {
    await Promise.all([save(current, b), save(other, a)])
  }
  return { ok: true }
}

// ---- 从首页帖子圈选为攻略 ----
const POST_COLLECTIONS = { forum: 'forum_posts', wall: 'wall_posts' }
const SEARCH_LIMIT = 30

function postTitle(post) {
  const title = String(post.title || post.headline || '').trim()
  return title || String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 30)
}

function isPublicPost(post) {
  return !post.reviewStatus || post.reviewStatus === 'approved'
}

// 已通过审核的首页帖子，按关键词筛；标出已经圈选过的
async function searchPosts(keyword = '') {
  const word = String(keyword || '').trim().toLowerCase()
  const [forum, wall, guides] = await Promise.all([
    db.recentDocs(POST_COLLECTIONS.forum, 120).catch(() => []),
    db.recentDocs(POST_COLLECTIONS.wall, 120).catch(() => []),
    db.recentDocs(COLLECTION, 200).catch(() => [])
  ])
  const picked = new Set(guides.filter((row) => row.kind === 'pick').map((row) => `${row.refType}:${row.refId}`))
  const rows = forum.map((post) => ({ post, type: 'forum' }))
    .concat(wall.map((post) => ({ post, type: 'wall' })))
    .filter(({ post }) => isPublicPost(post))
    .filter(({ post }) => !word || `${post.title || ''}\n${post.content || ''}`.toLowerCase().includes(word))
    .sort((a, b) => (b.post.createdAt || 0) - (a.post.createdAt || 0))
    .slice(0, SEARCH_LIMIT)
  return {
    ok: true,
    items: rows.map(({ post, type }) => {
      const id = post.id || post._id
      return {
        contentType: type,
        contentId: id,
        title: postTitle(post),
        excerpt: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        authorName: post.authorName || '',
        authorId: post.authorId || '',
        anonymous: !!post.anonymous,
        tag: post.tag || post.category || '',
        createdAt: post.createdAt || 0,
        likeCount: Number(post.likeCount) || 0,
        commentCount: Number(post.commentCount) || 0,
        picked: picked.has(`${type}:${id}`)
      }
    })
  }
}

async function pickPost(payload = {}, operator = '') {
  const type = payload.contentType === 'wall' ? 'wall' : 'forum'
  const contentId = String(payload.contentId || '').trim()
  const categories = await getCategories()
  const category = String(payload.category || '').trim()
  if (!categories.includes(category)) return { ok: false, message: '请选择分类' }
  const post = contentId ? await db.getDoc(POST_COLLECTIONS[type], contentId) : null
  if (!post) return { ok: false, message: '帖子不存在' }
  if (!isPublicPost(post)) return { ok: false, message: '这条帖子还没通过审核，不能设为攻略' }
  const guides = await db.recentDocs(COLLECTION, 200).catch(() => [])
  if (guides.some((row) => row.kind === 'pick' && row.refType === type && row.refId === contentId)) {
    return { ok: false, message: '这条帖子已经在攻略里了' }
  }
  const title = String(payload.title || '').trim() || postTitle(post)
  if (title.length > TITLE_MAX) return { ok: false, message: `标题最多 ${TITLE_MAX} 个字` }
  const now = Date.now()
  const guide = {
    id: `gd_${crypto.randomBytes(8).toString('hex')}`,
    kind: 'pick',
    refType: type,
    refId: contentId,
    category,
    title,
    summary: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    authorId: post.authorId || '',
    authorName: post.authorName || '',
    authorAvatar: post.authorAvatar || '',
    anonymous: !!post.anonymous,
    reviewStatus: 'approved',
    createdAt: now,
    publishedAt: now,
    sortAt: now,
    viewCount: 0,
    updatedAt: now,
    updatedBy: operator
  }
  await db.setDoc(COLLECTION, guide.id, guide)
  return { ok: true, guide }
}

module.exports = {
  reorder,
  searchPosts,
  pickPost,
  getCategories,
  saveCategories,
  listGuides,
  saveArticle,
  updateStatus
}
