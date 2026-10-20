const config = require('./config')
const store = require('./store')
const defaultProfile = require('./default-profile')
const LIST_TTL_MS = 60000
const WEEKLY_TTL_MS = 5 * 60 * 1000
const FEED_STORAGE_KEY = 'cw_feed_cache_v5'
const LEGACY_FEED_KEYS = ['cw_feed_cache_v1', 'cw_feed_cache_v2', 'cw_feed_cache_v3']
const LOGOUT_KEY = 'cw_logged_out'
const HOME_FORUM_QUERY = { category: '全部', keyword: '', sort: 'new' }
const HOME_WALL_QUERY = { tag: '全部', keyword: '', sort: 'new', dealStatus: '全部' }
const feedLocal = {
  forum: new Map(),
  wall: new Map(),
  home: new Map(),
  weekly: { at: 0, data: null, inflight: null }
}

function isLoggedOut() {
  try {
    return !!wx.getStorageSync(LOGOUT_KEY)
  } catch (err) {
    return false
  }
}

function setLoggedOut(value) {
  try {
    if (value) wx.setStorageSync(LOGOUT_KEY, 1)
    else wx.removeStorageSync(LOGOUT_KEY)
  } catch (err) {
    // ignore
  }
}

function guestUser() {
  return {
    id: 'guest_readonly',
    nickname: '访客',
    avatar: defaultProfile.stableAvatar('guest_readonly'),
    bio: '',
    schoolName: '',
    schoolCampus: '',
    schoolLocked: false,
    showSchoolTag: false,
    studentAuthStatus: 'none',
    status: 'active',
    officialLogin: false,
    officialLoginAllowed: false,
    appAdmin: false
  }
}

function guestSpeakGate() {
  return {
    ok: false,
    code: 'NEED_LOGIN',
    title: '开通发言',
    message: '发帖、评论前请先登录'
  }
}

function applyGuestSession() {
  const user = guestUser()
  const speakGate = guestSpeakGate()
  cacheUser(user, speakGate)
  return { ok: true, user, speakGate, loggedOut: true }
}

function cacheKey(payload) {
  try {
    return JSON.stringify(payload || {})
  } catch (err) {
    return String(Date.now())
  }
}

function readFeedStore() {
  try {
    const raw = wx.getStorageSync(FEED_STORAGE_KEY)
    return raw && typeof raw === 'object' ? raw : {}
  } catch (err) {
    return {}
  }
}

function writeFeedStore(kind, key, data) {
  try {
    const all = readFeedStore()
    all[kind] = { key, at: Date.now(), data }
    wx.setStorage({ key: FEED_STORAGE_KEY, data: all })
  } catch (err) {
    // 缓存写失败不影响列表
  }
}

function rememberList(kind, key, data) {
  feedLocal[kind].set(key, { at: Date.now(), data })
  writeFeedStore(kind, key, data)
}

function peekList(kind, payload) {
  const key = cacheKey(payload)
  const bucket = feedLocal[kind]
  if (!bucket || !bucket.get) return null
  const hit = bucket.get(key)
  if (hit && hit.data) {
    const data = Array.isArray(hit.data) ? paintList(hit.data) : hit.data
    return { data, fresh: Date.now() - hit.at < LIST_TTL_MS }
  }
  const stored = readFeedStore()[kind]
  if (!stored || stored.key !== key || stored.data == null) return null
  const painted = Array.isArray(stored.data) ? paintList(stored.data) : stored.data
  bucket.set(key, { at: stored.at || 0, data: painted })
  return { data: painted, fresh: Date.now() - (stored.at || 0) < LIST_TTL_MS }
}

function invalidateLocalFeeds() {
  feedLocal.forum.clear()
  feedLocal.wall.clear()
  feedLocal.home.clear()
  feedLocal.weekly = { at: 0, data: null, inflight: null }
  try {
    wx.removeStorageSync(FEED_STORAGE_KEY)
  } catch (err) {
    // ignore
  }
  LEGACY_FEED_KEYS.forEach((key) => {
    try { wx.removeStorageSync(key) } catch (err) { /* ignore */ }
  })
}

function purgeStaleFeedCaches() {
  LEGACY_FEED_KEYS.forEach((key) => {
    try { wx.removeStorageSync(key) } catch (err) { /* ignore */ }
  })
}

async function cachedList(kind, payload, loader) {
  const key = cacheKey(payload)
  const bucket = feedLocal[kind]
  const hit = bucket.get(key)
  const now = Date.now()
  if (hit && hit.data && now - hit.at < LIST_TTL_MS) return hit.data
  if (hit && hit.inflight) return hit.inflight
  const inflight = loader().then((data) => {
    rememberList(kind, key, data)
    return data
  }).catch((err) => {
    const prev = bucket.get(key)
    if (prev) {
      const next = { ...prev }
      delete next.inflight
      bucket.set(key, next)
    } else {
      bucket.delete(key)
    }
    throw err
  })
  bucket.set(key, {
    at: (hit && hit.at) || 0,
    data: (hit && hit.data) || null,
    inflight
  })
  return inflight
}

function cacheUser(user, speakGate) {
  const app = getApp()
  if (!app || !app.globalData) return
  if (user && user.id && user.id !== 'official_lian_wall' && user.id !== 'guest_readonly') {
    const nickname = defaultProfile.resolveProfileNickname(user.nickname, user.id)
    if (nickname !== user.nickname) user = { ...user, nickname }
  }
  if (user) app.globalData.user = user
  if (speakGate) {
    app.globalData.speakGate = speakGate
    app.globalData.speakGateAt = Date.now()
  }
}

async function callCloud(action, payload = {}) {
  try {
    const res = await wx.cloud.callFunction({
      name: 'userApi',
      data: { action, payload }
    })
    const result = (res && res.result) || { ok: false, message: '云函数无响应' }
    if (!isLoggedOut()) {
      cacheUser(result.user, result.speakGate)
    }
    return result
  } catch (err) {
    const message = (err && (err.errMsg || err.message)) || '云函数调用失败'
    console.error('[userApi]', action, message)
    return { ok: false, message }
  }
}

function guessExt(filePath) {
  const clean = String(filePath || '').split('?')[0]
  const ext = clean.split('.').pop()
  if (!ext || ext === clean || ext.length > 5) return 'jpg'
  return ext.toLowerCase()
}

function downloadRemote(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode && res.statusCode !== 200) {
          reject(new Error(`下载失败(${res.statusCode})`))
          return
        }
        if (!res.tempFilePath) {
          reject(new Error('下载无临时文件'))
          return
        }
        resolve(res.tempFilePath)
      },
      fail: (err) => reject(err || new Error('下载失败'))
    })
  })
}

function copyToUserFile(src) {
  return new Promise((resolve) => {
    const root = wx.env && wx.env.USER_DATA_PATH
    if (!src || !root || typeof wx.getFileSystemManager !== 'function') {
      resolve(src)
      return
    }
    const fsm = wx.getFileSystemManager()
    const dest = `${root}/avatar_${Date.now()}.jpg`
    fsm.readFile({
      filePath: src,
      success: (res) => {
        fsm.writeFile({
          filePath: dest,
          data: res.data,
          success: () => resolve(dest),
          fail: () => resolve(src)
        })
      },
      fail: () => resolve(src)
    })
  })
}

function asUploadPath(raw) {
  return new Promise((resolve) => {
    const localTemp = raw.startsWith('wxfile://') || raw.startsWith('http://tmp') || raw.startsWith('https://tmp')
    const finish = (path) => {
      const next = path || raw
      if (next.startsWith('http://tmp') || next.startsWith('https://tmp')) {
        copyToUserFile(next).then(resolve)
        return
      }
      resolve(next)
    }
    if (!localTemp) {
      finish(raw)
      return
    }
    const fsm = wx.getFileSystemManager && wx.getFileSystemManager()
    const root = wx.env && wx.env.USER_DATA_PATH
    if (fsm && root && typeof fsm.copyFile === 'function') {
      const dest = `${root}/avatar_${Date.now()}.jpg`
      fsm.copyFile({
        srcPath: raw,
        destPath: dest,
        success: () => resolve(dest),
        fail: () => compressTemp(raw, finish)
      })
      return
    }
    compressTemp(raw, finish)
  })
}

function compressTemp(raw, finish) {
  if (typeof wx.compressImage === 'function') {
    wx.compressImage({
      src: raw,
      quality: 80,
      success: (res) => finish((res && res.tempFilePath) || raw),
      fail: () => {
        if (typeof wx.getImageInfo !== 'function') {
          finish(raw)
          return
        }
        wx.getImageInfo({
          src: raw,
          success: (res) => finish((res && res.path) || raw),
          fail: () => finish(raw)
        })
      }
    })
    return
  }
  finish(raw)
}

/**
 * 上传到云存储，存 cloud://；小程序 <image> 直接绑 fileID（半个月前的做法）。
 * chooseAvatar 的临时图要先换成本地路径再上传，否则微信会拒绝。
 */
async function uploadImages(paths = [], folder = 'posts') {
  if (!config.useCloud) return paths
  const dir = String(folder || 'posts').replace(/\/+/g, '') || 'posts'
  return Promise.all((paths || []).map(async (filePath) => {
    const raw = String(filePath || '').trim()
    if (!raw) return ''
    if (raw.startsWith('cloud://') || raw.startsWith('/images/')) return raw

    let localPath = raw
    const localTemp = raw.startsWith('wxfile://') || raw.startsWith('http://tmp') || raw.startsWith('https://tmp')
    if (/^https?:\/\//i.test(raw) && !localTemp) {
      localPath = await downloadRemote(raw)
    } else if (localTemp) {
      localPath = await asUploadPath(raw)
    }

    const upload = await wx.cloud.uploadFile({
      cloudPath: `${dir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${guessExt(localPath || raw)}`,
      filePath: localPath
    })
    if (!upload || !upload.fileID) {
      throw new Error((upload && upload.errMsg) || '上传失败')
    }
    return upload.fileID
  }))
}

function rememberForumSeed(result) {
  if (!result || !Array.isArray(result.posts)) return
  rememberList('forum', cacheKey(HOME_FORUM_QUERY), result.posts.filter(visibleInFeed))
}

function rememberWallSeed(result) {
  const wall = result && result.wall
  if (!wall || !Array.isArray(wall.posts)) return
  rememberList('wall', cacheKey(HOME_WALL_QUERY), {
    posts: wall.posts.filter(visibleInFeed),
    digests: wall.digests || []
  })
}

async function bootstrap(options = {}) {
  if (isLoggedOut() && !options.forceLogin) {
    return applyGuestSession()
  }
  if (!config.useCloud) {
    store.ensureInit()
    const user = store.getUser()
    const speakGate = store.getSpeakGate(user)
    cacheUser(user, speakGate)
    return { ok: true, user, speakGate }
  }
  const payload = {
    includeForum: !!options.includeForum,
    includeWall: !!options.includeWall
  }
  let result = await callCloud('bootstrap', payload)
  if (!result.ok) {
    try {
      const login = await wx.cloud.callFunction({ name: 'login' })
      const loginResult = (login && login.result) || {}
      if (!loginResult.ok) {
        return loginResult.ok === false
          ? loginResult
          : { ok: false, message: '登录云函数无响应，请确认已上传 login' }
      }
      cacheUser(loginResult.user, null)
      result = await callCloud('bootstrap', payload)
    } catch (err) {
      const message = (err && (err.errMsg || err.message)) || '登录失败'
      console.error('[login]', message)
      return { ok: false, message }
    }
  }
  if (result && result.user) cacheUser(result.user, result.speakGate)
  rememberForumSeed(result)
  rememberWallSeed(result)
  return result
}

function prefetchWallHome() {
  if (!config.useCloud) return Promise.resolve(null)
  return listWall(HOME_WALL_QUERY)
}

/**
 * 每个云函数响应都会回写 speakGate，所以进页面时直接用缓存值渲染，
 * 只在后台静默校准一次，避免列表加载被多一次往返卡住。
 */
async function getSpeakGate(options = {}) {
  if (isLoggedOut()) {
    cacheUser(guestUser(), guestSpeakGate())
    return guestSpeakGate()
  }
  if (!config.useCloud) {
    const speakGate = store.getSpeakGate()
    cacheUser(store.getUser(), speakGate)
    return speakGate
  }
  const app = getApp()
  const globalData = (app && app.globalData) || {}
  const cached = globalData.speakGate
  if (cached && !options.force) return cached
  if (!options.force && globalData.ready) {
    try {
      await globalData.ready
    } catch (err) {
      // 登录失败时再单独问一次
    }
    if (globalData.speakGate) return globalData.speakGate
  }
  const result = await callCloud('getSpeakGate')
  return result.speakGate || { ok: false, code: 'NEED_AUTH', title: '需要先认证学校', message: result.message || '' }
}

async function getUser(options = {}) {
  if (isLoggedOut()) {
    const user = guestUser()
    cacheUser(user, guestSpeakGate())
    return user
  }
  if (!config.useCloud) return store.getUser()
  const force = !!(options && options.force)
  const app = getApp()
  if (!force && app && app.globalData && app.globalData.user) return app.globalData.user
  const result = await callCloud('me')
  return result.user || null
}

async function logout() {
  const app = getApp()
  const current = (app && app.globalData && app.globalData.user) || null
  if (current && current.officialLogin) {
    try {
      await leaveOfficial()
    } catch (err) {
      // 本地仍可退出
    }
  }
  setLoggedOut(true)
  invalidateLocalFeeds()
  try {
    const inbox = require('./inbox')
    inbox.reset('')
  } catch (err) {
    // ignore
  }
  return applyGuestSession()
}

async function login() {
  setLoggedOut(false)
  if (!config.useCloud) {
    store.ensureInit()
    const user = store.getUser()
    const speakGate = store.getSpeakGate()
    cacheUser(user, speakGate)
    return { ok: true, user, speakGate }
  }
  const result = await bootstrap({
    includeForum: false,
    includeWall: false,
    forceLogin: true
  })
  if (!result || !result.ok) {
    setLoggedOut(true)
    applyGuestSession()
    return result || { ok: false, message: '登录失败' }
  }
  try {
    const inbox = require('./inbox')
    inbox.reset((result.user && result.user.id) || '')
    inbox.refresh(true).catch(() => {})
  } catch (err) {
    // ignore
  }
  return result
}

function requireLoginResult() {
  if (!isLoggedOut()) return null
  return {
    ok: false,
    code: 'NEED_LOGIN',
    message: '请先登录'
  }
}

async function updateUser(patch) {
  const blocked = requireLoginResult()
  if (blocked) return blocked
  if (!config.useCloud) return store.updateUser(patch)
  return callCloud('updateUser', patch)
}

async function enterOfficial() {
  if (!config.useCloud) return { ok: false, message: '当前不能登录公共账号' }
  return callCloud('enterOfficial', {})
}

async function leaveOfficial() {
  if (!config.useCloud) return { ok: false, message: '当前不能退出公共账号' }
  return callCloud('leaveOfficial', {})
}

async function submitSchoolInfo(payload) {
  if (!config.useCloud) return store.submitSchoolInfo(payload)
  return callCloud('submitSchoolInfo', payload)
}

async function submitStudentAuth(payload) {
  if (!config.useCloud) return store.submitStudentAuth(payload)
  return callCloud('submitStudentAuth', payload)
}

async function requestSchoolChange(payload) {
  if (!config.useCloud) return store.requestSchoolChange(payload)
  return callCloud('requestSchoolChange', payload)
}

function visibleInFeed(post) {
  if (!post) return false
  if (post.isOwner) return true
  return !post.reviewStatus || post.reviewStatus === 'approved'
}

function keepOfficial(posts, payload) {
  if (!payload || !payload.official) return posts || []
  return (posts || []).filter((item) => require('./home-feed').isOfficialPost(item))
}

function paintAvatar(item) {
  if (!item || typeof item !== 'object') return item
  const idSeed = item.id || item._id || item.contentId || ''
  const authorSeed = item.anonymous || item.authorName === '匿名同学'
    ? idSeed
    : (item.authorId || item.userId || item.peerId || idSeed)
  const next = { ...item }
  if (item.authorName != null || item.anonymous) {
    next.authorName = defaultProfile.resolveAuthorName(item.authorName, item.authorId || authorSeed, {
      anonymous: !!item.anonymous
    })
  }
  next.authorAvatar = defaultProfile.resolveAuthorAvatar(item.authorAvatar, authorSeed, {
    anonymous: !!item.anonymous,
    authorName: item.authorName
  })
  if (item.avatar != null || item.id || item._id) {
    next.avatar = defaultProfile.resolveAvatar(item.avatar, item.id || item._id || authorSeed)
  }
  if (item.userAvatar != null || item.userId) {
    next.userAvatar = defaultProfile.resolveAvatar(item.userAvatar, item.userId || authorSeed)
  }
  if (item.peerAvatar != null || item.peerId) {
    next.peerAvatar = defaultProfile.resolveAvatar(item.peerAvatar, item.peerId || authorSeed)
  }
  return next
}

function paintList(list) {
  return (Array.isArray(list) ? list : []).map(paintAvatar)
}

function visiblePublic(post) {
  if (!post) return false
  return !post.reviewStatus || post.reviewStatus === 'approved'
}

function mergeHomeLists(forumPosts, wallPosts, query) {
  const homeFeed = require('./home-feed')
  const topicName = homeFeed.normalizeTopic((query && query.topic) || '全部')
  const keyword = String((query && query.keyword) || '').trim()
  const rows = []
  ;(forumPosts || []).forEach((item) => {
    if (!visiblePublic(item)) return
    if (!homeFeed.topicMatches(item, 'forum', topicName)) return
    if (keyword && !homeFeed.textHit(item, 'forum', keyword)) return
    rows.push({ ...item, contentType: 'forum' })
  })
  ;(wallPosts || []).forEach((item) => {
    if (!visiblePublic(item)) return
    if (!homeFeed.topicMatches(item, 'wall', topicName)) return
    if (keyword && !homeFeed.textHit(item, 'wall', keyword)) return
    rows.push({ ...item, contentType: 'wall' })
  })
  return homeFeed.sortHomePosts(rows, query && query.sort === 'hot')
    .map((item) => homeFeed.toHomeCard(item, item.contentType))
}

function oldestTime(list) {
  return (list || []).reduce((min, item) => {
    const time = Number(item && item.createdAt) || 0
    if (!time) return min
    return min ? Math.min(min, time) : time
  }, 0)
}

function packHome(posts, extra) {
  const list = paintList(Array.isArray(posts) ? posts : [])
  const nextBefore = Number(extra && extra.nextBefore) || oldestTime(list)
  return {
    posts: list,
    hasMore: !!(extra && extra.hasMore),
    nextBefore
  }
}

function readOlderCollection(collection, before, limit) {
  const db = wx.cloud.database()
  const _ = db.command
  return db.collection(collection)
    .where({ createdAt: _.lt(before) })
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()
    .then((res) => (res && res.data) || [])
}

async function pageOlderFromDb(query) {
  const before = Number(query && query.before) || 0
  if (!before || !wx.cloud || typeof wx.cloud.database !== 'function') return null
  const homeFeed = require('./home-feed')
  const topicName = homeFeed.normalizeTopic((query && query.topic) || '全部')
  const keyword = String((query && query.keyword) || '').trim()
  const batch = 40
  let cursor = before
  const matched = []
  const seen = new Set()
  let hasMore = false
  for (let round = 0; round < 4 && matched.length < 24; round += 1) {
    const [forum, wall] = await Promise.all([
      readOlderCollection('forum_posts', cursor, batch),
      readOlderCollection('wall_posts', cursor, batch)
    ])
    const raw = forum.concat(wall)
    if (!raw.length) {
      hasMore = false
      break
    }
    forum.forEach((item) => {
      const id = item && (item.id || item._id)
      if (!id || seen.has(id) || !visiblePublic(item)) return
      if (!homeFeed.topicMatches(item, 'forum', topicName)) return
      if (keyword && !homeFeed.textHit(item, 'forum', keyword)) return
      seen.add(id)
      matched.push({ ...item, id, contentType: 'forum' })
    })
    wall.forEach((item) => {
      const id = item && (item.id || item._id)
      if (!id || seen.has(id) || !visiblePublic(item)) return
      if (!homeFeed.topicMatches(item, 'wall', topicName)) return
      if (keyword && !homeFeed.textHit(item, 'wall', keyword)) return
      seen.add(id)
      matched.push({ ...item, id, contentType: 'wall' })
    })
    const oldest = oldestTime(raw)
    const full = forum.length >= batch || wall.length >= batch
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
  if (matched.length > 24) {
    page = matched.slice(0, 24)
    hasMore = true
  }
  const cards = homeFeed.sortHomePosts(page, query && query.sort === 'hot')
    .map((item) => homeFeed.toHomeCard(item, item.contentType))
    .filter((item) => item && item.id)
  return packHome(cards, { hasMore, nextBefore: oldestTime(page) || cursor })
}

async function listHome(payload = {}) {
  const before = Number(payload.before) || 0
  const query = {
    topic: payload.topic || '全部',
    keyword: payload.keyword || '',
    sort: payload.sort || 'new'
  }
  const request = { ...query, before }
  if (!config.useCloud) return store.listHome(request)
  if (before) {
    const result = await callCloud('listHome', request)
    if (result && result.paged) {
      const posts = result.ok !== false && Array.isArray(result.posts)
        ? result.posts.filter(visiblePublic)
        : []
      return packHome(posts, result)
    }
    return pageOlderFromDb(request)
  }
  return cachedList('home', query, async () => {
    const result = await callCloud('listHome', request)
    const cloudPosts = result && result.ok !== false && Array.isArray(result.posts)
      ? result.posts.filter(visiblePublic)
      : null
    if (cloudPosts && cloudPosts.length && result && result.paged) return packHome(cloudPosts, result)
    if (cloudPosts && cloudPosts.length) {
      return packHome(cloudPosts, { hasMore: cloudPosts.length >= 20, nextBefore: oldestTime(cloudPosts) })
    }
    const [forum, wall] = await Promise.all([
      listForum(HOME_FORUM_QUERY),
      listWall(HOME_WALL_QUERY)
    ])
    const merged = mergeHomeLists(forum, (wall && wall.posts) || [], query)
    if (merged.length) return packHome(merged, { hasMore: false, nextBefore: 0 })
    return packHome(cloudPosts || [], result)
  })
}

async function listForum(payload) {
  if (!config.useCloud) return store.listForum(payload)
  return cachedList('forum', payload, async () => {
    const result = await callCloud('listForum', payload)
    return paintList(keepOfficial((result.posts || []).filter(visibleInFeed), payload))
  })
}

async function listWall(payload) {
  if (!config.useCloud) {
    return {
      posts: paintList(store.listWall(payload)),
      digests: (store.getDigests() || []).slice(0, 8)
    }
  }
  return cachedList('wall', payload, async () => {
    const result = await callCloud('listWall', payload)
    return {
      posts: paintList(keepOfficial((result.posts || []).filter(visibleInFeed), payload)),
      digests: result.digests || []
    }
  })
}

async function getDigests() {
  if (!config.useCloud) return store.getDigests()
  const result = await callCloud('getDigests')
  return result.digests || []
}

async function getDigest(id) {
  if (!config.useCloud) return store.getDigest(id)
  const result = await callCloud('getDigest', { id })
  return result.digest || null
}

async function getWeeklyHot(options = {}) {
  if (!config.useCloud) return store.getWeeklyHot(options)
  const now = Date.now()
  if (feedLocal.weekly.data && now - feedLocal.weekly.at < WEEKLY_TTL_MS && !options.force) {
    return feedLocal.weekly.data
  }
  if (feedLocal.weekly.inflight && !options.force) return feedLocal.weekly.inflight
  const inflight = (async () => {
    const result = await callCloud('getWeeklyHot', options)
    if (!result || result.ok === false) {
      const err = new Error((result && result.message) || '热榜加载失败')
      err.code = 'CLOUD_ERROR'
      throw err
    }
    const board = result.board || { id: 'current', title: '每周精选', enabled: false, items: [], preview: [], count: 0, totalCount: 0 }
    feedLocal.weekly = { at: Date.now(), data: board, inflight: null }
    return board
  })().catch((err) => {
    feedLocal.weekly.inflight = null
    throw err
  })
  feedLocal.weekly.inflight = inflight
  return inflight
}

async function fetchPostResult(type, id, extra = {}) {
  let result = await callCloud('getPost', { type, id, ...extra })
  if (result && result.ok === false && result.code === 'DB_ERROR') {
    result = await callCloud('getPost', { type, id, ...extra })
  }
  return result
}

function postFromResult(result) {
  if (result && result.ok === false && result.code === 'DB_ERROR') {
    const err = new Error(result.message || '帖子加载失败')
    err.code = 'CLOUD_ERROR'
    throw err
  }
  if (result && result.ok === false && !result.notFound) {
    const err = new Error(result.message || '帖子加载失败')
    err.code = 'CLOUD_ERROR'
    throw err
  }
  const post = (result && result.post) || null
  if (post && !visibleInFeed(post)) return null
  return post ? paintAvatar(post) : null
}

async function getPost(type, id) {
  if (!config.useCloud) return store.getPost(type, id)
  const result = await fetchPostResult(type, id)
  return postFromResult(result)
}

async function getPostBundle(type, id) {
  const postId = String(id || '').trim()
  if (!postId || postId === 'undefined' || postId === 'null') {
    const err = new Error('缺少帖子 id')
    err.code = 'BAD_REQUEST'
    throw err
  }
  if (!config.useCloud) {
    return {
      post: store.getPost(type, postId),
      comments: store.listComments(type, postId)
    }
  }
  const result = await fetchPostResult(type, postId, { includeComments: true })
  const post = postFromResult(result)
  const comments = result && Array.isArray(result.comments)
    ? result.comments.map(paintAvatar)
    : await listComments(type, postId)
  return { post, comments }
}

const viewedOnce = new Set()

async function bumpView(type, id) {
  if (!config.useCloud) return store.bumpView(type, id)
  const key = `${type}:${id}`
  if (!id || viewedOnce.has(key)) return { ok: true }
  viewedOnce.add(key)
  return callCloud('bumpView', { type, id })
}

async function createForumPost(payload) {
  const blocked = requireLoginResult()
  if (blocked) return blocked
  if (!config.useCloud) return store.createForumPost(payload)
  const images = await uploadImages(payload.images || [])
  const result = await callCloud('createForumPost', { ...payload, images })
  if (result && result.ok) invalidateLocalFeeds()
  return result
}

async function createWallPost(payload) {
  const blocked = requireLoginResult()
  if (blocked) return blocked
  if (!config.useCloud) return store.createWallPost(payload)
  const images = await uploadImages(payload.images || [])
  const result = await callCloud('createWallPost', { ...payload, images })
  if (result && result.ok) invalidateLocalFeeds()
  return result
}

async function updateWallDealStatus(id, dealStatus) {
  if (!config.useCloud) return store.updateWallDealStatus(id, dealStatus)
  const result = await callCloud('updateWallDealStatus', { id, dealStatus })
  if (result && result.ok) invalidateLocalFeeds()
  return result
}

async function pinPost(type, id, pinned) {
  if (!config.useCloud) return { ok: false, message: '当前未连接云端' }
  const result = await callCloud('pinPost', { type, id, pinned })
  if (result && result.ok) invalidateLocalFeeds()
  return result
}

async function deletePost(type, id) {
  if (!config.useCloud) return store.deletePost(type, id)
  const result = await callCloud('deletePost', { type, id })
  if (result && result.ok) invalidateLocalFeeds()
  return !!result.ok
}

async function toggleLike(type, id) {
  if (!config.useCloud) return store.toggleLike(type, id)
  const result = await callCloud('toggleLike', { type, id })
  return !!result.liked
}

async function listComments(type, id) {
  if (!config.useCloud) return store.listComments(type, id)
  const result = await callCloud('listComments', { type, id })
  return (result.comments || []).map(paintAvatar)
}

async function addComment(type, id, content, extra = {}) {
  const blocked = requireLoginResult()
  if (blocked) return blocked
  if (!config.useCloud) return store.addComment(type, id, content, extra)
  const images = await uploadImages(extra.images || [])
  return callCloud('addComment', {
    type,
    id,
    content,
    parentId: extra.parentId || '',
    replyToId: extra.replyToId || '',
    replyToName: extra.replyToName || '',
    images
  })
}

async function deleteComment(id) {
  if (!config.useCloud) return store.deleteComment(id)
  return callCloud('deleteComment', { id })
}

async function myPosts(type) {
  if (!config.useCloud) return store.myPosts(type)
  const result = await callCloud('myPosts', { type })
  return (result.posts || []).map(paintAvatar)
}

async function myLiked(type) {
  if (!config.useCloud) return store.myLiked(type)
  const result = await callCloud('myLiked', { type })
  return (result.posts || []).map(paintAvatar)
}

async function myComments() {
  if (!config.useCloud) return store.myComments()
  const result = await callCloud('myComments')
  return (result.comments || []).map(paintAvatar)
}

async function myReceivedComments() {
  if (!config.useCloud) return store.myReceivedComments()
  const result = await callCloud('myReceivedComments')
  if (!result || result.ok === false) throw new Error((result && result.message) || '加载失败')
  return { comments: (result.comments || []).map(paintAvatar), snapshotAt: Number(result.snapshotAt) || 0 }
}

async function myReceivedLikes() {
  if (!config.useCloud) return store.myReceivedLikes()
  const result = await callCloud('myReceivedLikes')
  if (!result || result.ok === false) throw new Error((result && result.message) || '加载失败')
  return { likes: (result.likes || []).map(paintAvatar), snapshotAt: Number(result.snapshotAt) || 0 }
}

async function getInboxBadges() {
  if (!config.useCloud) return store.getInboxBadges()
  return callCloud('getInboxBadges')
}

async function markInboxSeen(payload = {}) {
  if (!config.useCloud) return store.markInboxSeen(payload)
  return callCloud('markInboxSeen', payload)
}

async function getShareCode(payload = {}) {
  if (!config.useCloud) return store.getShareCode(payload)
  return callCloud('getShareCode', payload)
}

async function generateSharePoster(payload = {}) {
  if (!config.useCloud) return store.generateSharePoster(payload)
  return callCloud('generateSharePoster', payload)
}

async function validateSharePoster(payload = {}) {
  if (!config.useCloud) return store.validateSharePoster(payload)
  return callCloud('validateSharePoster', payload)
}

async function listConversations() {
  if (!config.useCloud) return store.listConversations()
  const result = await callCloud('listConversations')
  if (!result || result.ok === false) {
    const err = new Error((result && result.message) || '私信加载失败')
    err.code = (result && result.code) || 'CLOUD_ERROR'
    throw err
  }
  return Array.isArray(result.conversations) ? result.conversations : []
}

async function openOrCreateConversation(peerId) {
  if (!config.useCloud) return store.openOrCreateConversation(peerId)
  return callCloud('openOrCreateConversation', { peerId })
}

async function getConversation(conversationId) {
  if (!config.useCloud) return store.getConversation(conversationId)
  return callCloud('getConversation', { conversationId })
}

async function listMessages(conversationId) {
  if (!config.useCloud) return store.listMessages(conversationId)
  const result = await callCloud('listMessages', { conversationId })
  return result.messages || []
}

async function markConversationRead(conversationId, unreadAtOpen) {
  if (!config.useCloud) return store.markConversationRead(conversationId, unreadAtOpen)
  return callCloud('markConversationRead', { conversationId, unreadAtOpen })
}

async function sendMessage(conversationId, content, images = []) {
  const blocked = requireLoginResult()
  if (blocked) return blocked
  if (!config.useCloud) return store.sendMessage(conversationId, content, images)
  const uploaded = await uploadImages(images || [], 'dm')
  return callCloud('sendMessage', { conversationId, content, images: uploaded })
}

async function getPublicProfile(userId) {
  if (!config.useCloud) return store.getPublicProfile(userId)
  return callCloud('getPublicProfile', { userId })
}

async function listUserPosts(userId, type) {
  if (!config.useCloud) return store.listUserPosts(userId, type)
  const result = await callCloud('listUserPosts', { userId, type })
  return result.posts || []
}

async function stats() {
  if (!config.useCloud) return store.stats()
  const result = await callCloud('stats')
  return result.stats || { postCount: 0, receivedLikes: 0, receivedComments: 0 }
}

async function revealWallContact(id, options = {}) {
  if (!config.useCloud) return store.revealWallContact(id)
  return callCloud('revealWallContact', {
    id,
    type: options.type === 'forum' ? 'forum' : 'wall'
  })
}

async function submitContactFeedback(id, payload = {}) {
  if (!config.useCloud) return store.submitContactFeedback(id, payload)
  return callCloud('submitContactFeedback', { id, ...payload })
}

async function submitReport(payload = {}) {
  if (!config.useCloud) return store.submitReport(payload)
  return callCloud('submitReport', payload)
}

async function trackEvents(events = []) {
  if (!config.useCloud) return { ok: true, accepted: 0, localOnly: true }
  const list = Array.isArray(events) ? events.slice(0, 50) : []
  if (!list.length) return { ok: true, accepted: 0 }
  return callCloud('trackEvents', { events: list })
}

function formatSchool(user) {
  return store.formatSchool(user || {})
}

module.exports = {
  bootstrap,
  getSpeakGate,
  getUser,
  updateUser,
  logout,
  login,
  isLoggedOut,
  enterOfficial,
  leaveOfficial,
  submitSchoolInfo,
  submitStudentAuth,
  requestSchoolChange,
  listForum,
  listWall,
  listHome,
  getDigests,
  getDigest,
  getWeeklyHot,
  getPost,
  getPostBundle,
  peekList,
  prefetchWallHome,
  HOME_FORUM_QUERY,
  HOME_WALL_QUERY,
  bumpView,
  createForumPost,
  createWallPost,
  updateWallDealStatus,
  deletePost,
  pinPost,
  toggleLike,
  listComments,
  addComment,
  deleteComment,
  myPosts,
  myLiked,
  myComments,
  myReceivedComments,
  myReceivedLikes,
  getInboxBadges,
  markInboxSeen,
  getShareCode,
  generateSharePoster,
  validateSharePoster,
  listConversations,
  openOrCreateConversation,
  getConversation,
  listMessages,
  markConversationRead,
  sendMessage,
  getPublicProfile,
  listUserPosts,
  stats,
  revealWallContact,
  submitContactFeedback,
  submitReport,
  trackEvents,
  formatSchool,
  uploadImages,
  invalidateLocalFeeds,
  purgeStaleFeedCaches
}
