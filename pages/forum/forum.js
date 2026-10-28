const store = require('../../utils/store')
const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const share = require('../../utils/share')
const userNav = require('../../utils/user')
const media = require('../../utils/media')
const postNav = require('../../utils/post-nav')
const defaultProfile = require('../../utils/default-profile')
const { formatTime } = require('../../utils/util')
const { readNavMetrics } = require('../../utils/nav-bar')

const THUMB_MAX = { width: 320, height: 300 }

function unpackHome(data) {
  if (Array.isArray(data)) {
    const nextBefore = data.reduce((min, item) => {
      const time = Number(item && item.createdAt) || 0
      if (!time) return min
      return min ? Math.min(min, time) : time
    }, 0)
    return { posts: data, hasMore: data.length >= 20, nextBefore }
  }
  const posts = data && Array.isArray(data.posts) ? data.posts : []
  return {
    posts,
    hasMore: !!(data && data.hasMore),
    nextBefore: Number(data && data.nextBefore) || 0
  }
}

function feedBodyOverflows(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!raw) return false
  let lines = 0
  raw.split('\n').forEach((line) => {
    lines += Math.max(1, Math.ceil(Array.from(line).length / 24))
  })
  return lines > 6
}

Page({
  data: {
    masthead: { top: 20, height: 44, capsule: 100 },
    topics: ['全部', store.OFFICIAL_TOPIC, ...store.HOME_TOPICS, store.OTHER_TOPIC],
    topic: '全部',
    sortOptions: [
      { id: 'new', name: '最新' },
      { id: 'hot', name: '最热' }
    ],
    sort: 'new',
    keyword: '',
    posts: [],
    weeklyHot: null,
    canSpeak: false,
    speakCode: '',
    guestTip: '',
    loading: true,
    loadingMore: false,
    hasMore: false,
    loadError: ''
  },

  onLoad(query) {
    this.setData({ masthead: readNavMetrics() })
    this.fromShare = (query && query.from) || ''
    try { share.enableMenus() } catch (e) { /* ignore */ }
    try { this.consumeHomeIntent() } catch (e) { /* ignore */ }
    try {
      const peeked = repo.peekList('home', this.feedQuery())
      const pack = unpackHome(peeked && peeked.data)
      if (pack.posts.length) this.renderPosts(pack.posts, pack)
      else this.setData({ loading: true, loadError: '' })
    } catch (e) {
      this.setData({ loading: true, loadError: '' })
    }
    this.refresh().catch(() => {})
  },

  onShow() {
    try { share.enableMenus() } catch (e) { /* ignore */ }
    const intentChanged = this.consumeHomeIntent()
    if (!this._ready) {
      this._ready = true
      // 首进 onLoad 已拉列表；若仍空则补一次，避免启动竞态白屏
      if (intentChanged || !(this.data.posts || []).length) {
        this.loadPosts().catch(() => {})
      }
      return
    }
    this.refresh().catch(() => {})
  },

  consumeHomeIntent() {
    let intent = null
    try {
      intent = wx.getStorageSync('cw_home_intent')
    } catch (err) {
      intent = null
    }
    if (!intent || typeof intent !== 'object') return false
    try {
      wx.removeStorageSync('cw_home_intent')
    } catch (err) {
      // 意图只用一次
    }
    const topic = store.normalizeTopic(intent.topic || '全部')
    const keyword = String(intent.keyword || '')
    const known = topic === '全部'
      || topic === store.OFFICIAL_TOPIC
      || topic === store.OTHER_TOPIC
      || (store.HOME_TOPICS || []).indexOf(topic) >= 0
    const resolved = known ? topic : store.OTHER_TOPIC
    if (resolved === this.data.topic && keyword === this.data.keyword) return false
    this.setData({
      topic: resolved,
      keyword
    })
    return true
  },

  onReachBottom() {
    this.loadMore()
  },

  async onPullDownRefresh() {
    repo.invalidateLocalFeeds()
    await this.refresh({ force: true })
    wx.stopPullDownRefresh()
  },

  async refresh(options = {}) {
    const force = !!options.force
    const now = Date.now()
    if (!force && this._lastRefreshAt && now - this._lastRefreshAt < 60000) {
      // 节流时若列表仍空，仍允许补拉一次
      if ((this.data.posts || []).length) return
    }
    if (this._refreshing) return
    this._refreshing = true
    this._lastRefreshAt = now
    try {
      track.pageView('forum', { category: this.data.topic, sort: this.data.sort })
    } catch (e) {
      // 埋点失败不挡列表
    }
    const postsPromise = this.loadPosts(force)
    try {
      const ready = getApp().globalData.ready
      if (ready) {
        await Promise.race([
          ready.catch(() => null),
          new Promise((resolve) => setTimeout(resolve, 2500))
        ])
      }
    } catch (e) {
      // 启动失败也不挡浏览
    }
    try {
      await Promise.all([
        this.refreshGate().catch(() => {}),
        postsPromise
      ])
    } finally {
      this._refreshing = false
    }
  },

  async refreshGate() {
    try {
      const gate = await repo.getSpeakGate()
      const code = (gate && gate.code) || ''
      let tip = (gate && gate.message) || ''
      if (code === 'NEED_LOGIN') tip = '随便逛。发帖和评论需要先完成登录与学校认证'
      else if (code === 'NEED_AUTH') tip = '随便逛。发帖和评论需要先认证学校'
      else if (code === 'NEED_PHONE') tip = '随便逛。发帖和评论前需要验证一次手机号'
      this.setData({
        canSpeak: !!(gate && gate.ok),
        speakCode: code,
        guestTip: tip
      })
    } catch (e) {
      this.setData({
        canSpeak: false,
        speakCode: '',
        guestTip: ''
      })
    }
  },

  feedQuery() {
    return {
      topic: this.data.topic,
      keyword: this.data.keyword,
      sort: this.data.sort
    }
  },

  resolvePostId(item, datasetId) {
    const candidates = [
      datasetId,
      item && item.id,
      item && item._id,
      item && item.contentId
    ]
    for (let i = 0; i < candidates.length; i += 1) {
      const value = String(candidates[i] || '').trim()
      if (value && value !== 'undefined' && value !== 'null') return value
    }
    const key = String((item && item.feedKey) || '')
    const idx = key.indexOf(':')
    if (idx >= 0) {
      const rest = key.slice(idx + 1).trim()
      if (rest && rest !== 'undefined' && rest !== 'null') return rest
    }
    return ''
  },

  mapPosts(list) {
    const open = this._bodyOpen || {}
    return (Array.isArray(list) ? list : []).map((item, index) => {
      const bodyText = String(item.content || '').trim()
      const contentType = item.contentType === 'wall' ? 'wall' : 'forum'
      const id = this.resolvePostId(item)
      if (!id) return null
      const feedKey = item.feedKey && String(item.feedKey).indexOf(':') > 0
        ? item.feedKey
        : `${contentType}:${id}`
      const title = String(item.title || '').trim()
      // 标题若只是正文截断，列表里只展示正文，头像行更靠上（对齐参考图）
      const titleAsBody = !!title && !!bodyText && (
        bodyText === title || bodyText.indexOf(title) === 0 || title === bodyText.replace(/\s+/g, ' ').slice(0, 40)
      )
      return {
        ...item,
        id,
        contentType,
        feedKey,
        uniq: `${feedKey}:${index}`,
        displayTag: item.displayTag || '',
        images: item.images || [],
        thumbStyle: (this._thumbStyles || {})[feedKey] || '',
        timeText: formatTime(item.createdAt),
        bodyText,
        showTitle: !!title && !titleAsBody,
        bodyLong: feedBodyOverflows(bodyText),
        bodyOpen: !!open[feedKey],
        viewCount: Number(item.viewCount) || 0,
        authorName: defaultProfile.resolveAuthorName(item.authorName, item.authorId || id, {
          anonymous: !!item.anonymous
        }),
        authorAvatar: defaultProfile.resolveAuthorAvatar(
          item.authorAvatar,
          item.anonymous || item.authorName === '匿名同学' ? id : (item.authorId || id),
          { anonymous: !!item.anonymous, authorName: item.authorName }
        )
      }
    }).filter(Boolean)
  },

  toggleBody(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const type = e.currentTarget.dataset.type === 'wall' ? 'wall' : 'forum'
    const key = `${type}:${id}`
    if (!id) return
    if (!this._bodyOpen) this._bodyOpen = {}
    this._bodyOpen[key] = !this._bodyOpen[key]
    const index = (this.data.posts || []).findIndex((item) => item.feedKey === key)
    if (index < 0) return
    this.setData({ [`posts[${index}].bodyOpen`]: !!this._bodyOpen[key] })
  },

  renderPosts(list, page) {
    const pack = page || {}
    this._nextBefore = Number(pack.nextBefore) || 0
    this._hasMore = !!pack.hasMore
    this.setData({
      posts: this.mapPosts(list),
      loading: false,
      loadingMore: false,
      hasMore: !!pack.hasMore,
      loadError: ''
    })
  },

  appendPosts(list, page) {
    const pack = page || {}
    const seen = new Set((this.data.posts || []).map((item) => item.feedKey))
    const extra = this.mapPosts(list).filter((item) => item.feedKey && !seen.has(item.feedKey))
    this._nextBefore = Number(pack.nextBefore) || this._nextBefore || 0
    this._hasMore = !!pack.hasMore
    this.setData({
      posts: (this.data.posts || []).concat(extra),
      loadingMore: false,
      hasMore: !!pack.hasMore
    })
  },

  async loadPosts(force = false) {
    const payload = this.feedQuery()
    const token = (this._feedToken || 0) + 1
    this._feedToken = token
    const home = payload.topic === '全部' && !payload.keyword && payload.sort === 'new'
    let peeked = null
    try {
      peeked = !force ? repo.peekList('home', payload) : null
    } catch (e) {
      peeked = null
    }
    const peekedPack = unpackHome(peeked && peeked.data)
    const peekLen = peekedPack.posts.length
    if (peekLen) this.renderPosts(peekedPack.posts, peekedPack)
    else if (!(this.data.posts || []).length) this.setData({ loading: true, loadError: '' })

    // 缓存条数过少时不信任「新鲜」，强制回源（避免只剩 1 条时一直不刷新）
    const trustCache = !force && home && peeked && peeked.fresh && peekLen >= 3
    if (trustCache) {
      this.loadWeeklyHot(token)
      return
    }

    try {
      if (!force && peekLen > 0 && peekLen < 3) {
        try { repo.invalidateLocalFeeds() } catch (e) { /* ignore */ }
      }
      const list = await Promise.race([
        repo.listHome(payload),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('首页加载超时')), 8000)
        })
      ])
      if (token !== this._feedToken) return
      const pack = unpackHome(list)
      this.renderPosts(pack.posts, pack)
      this.loadWeeklyHot(token)
    } catch (e) {
      if (token !== this._feedToken) return
      const hasPosts = (this.data.posts || []).length > 0
      this.setData({
        loading: false,
        loadError: hasPosts ? '' : ((e && e.message) || '加载失败，下拉重试')
      })
      if (hasPosts) wx.showToast({ title: '加载失败，下拉重试', icon: 'none' })
    }
  },

  async loadMore() {
    if (this._paging || this.data.loading || !this._hasMore || !this._nextBefore) return
    const token = this._feedToken || 0
    this._paging = true
    this.setData({ loadingMore: true })
    try {
      let before = this._nextBefore
      for (let hop = 0; hop < 3; hop += 1) {
        const list = await repo.listHome({
          ...this.feedQuery(),
          before
        })
        if (token !== this._feedToken) return
        const pack = unpackHome(list)
        this.appendPosts(pack.posts, pack)
        if (pack.posts.length || !pack.hasMore || !pack.nextBefore || pack.nextBefore === before) break
        before = pack.nextBefore
      }
    } catch (e) {
      if (token !== this._feedToken) return
      this.setData({ loadingMore: false })
      wx.showToast({ title: '加载失败，上拉再试', icon: 'none' })
    } finally {
      this._paging = false
    }
  },

  async loadWeeklyHot(token) {
    try {
      const weeklyHot = await repo.getWeeklyHot({})
      if (token && token !== this._feedToken) return
      const source = weeklyHot && weeklyHot.enabled
        ? ((weeklyHot.items && weeklyHot.items.length) ? weeklyHot.items : (weeklyHot.preview || []))
        : []
      const preview = source.slice(0, 3).map((item) => ({
        ...item,
        previewKey: `${item.contentType || 'wall'}:${item.contentId}`,
        displayTag: item.tag || ''
      }))
      this.setData({
        weeklyHot: preview.length
          ? {
            ...weeklyHot,
            subtitle: store.publicWeeklySubtitle(weeklyHot.subtitle),
            preview
          }
          : null
      })
    } catch (e) {
      // 精选失败不挡列表
    }
  },

  goWeeklyHot() {
    track.weeklyHotOpen({ surface: 'forum', source: 'banner' })
    wx.navigateTo({ url: '/pages/weekly-hot/weekly-hot' })
  },

  goHotItem(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const type = e.currentTarget.dataset.type === 'forum' ? 'forum' : 'wall'
    if (!id || id === 'undefined' || id === 'null') {
      wx.showToast({ title: '缺少帖子 id', icon: 'none' })
      return
    }
    const preview = ((this.data.weeklyHot && this.data.weeklyHot.preview) || []).find(
      (item) => item.contentId === id && (item.contentType || 'wall') === type
    )
    track.weeklyHotClick({
      surface: 'forum',
      source: 'preview',
      contentId: id,
      contentType: type,
      rank: (preview && preview.rank) || 0,
      tag: (preview && (preview.displayTag || preview.tag)) || ''
    })
    this.openPost(type, id)
  },

  onTopicTap(e) {
    const topic = store.normalizeTopic(e.currentTarget.dataset.name)
    if (topic === this.data.topic) return
    track.tagFilter({ surface: 'forum', filterType: 'topic', category: topic })
    this.setData({ topic }, () => this.loadPosts())
  },

  onSortTap(e) {
    const sort = e.currentTarget.dataset.id
    if (!sort || sort === this.data.sort) return
    track.sortChange({ surface: 'forum', sort, from: this.data.sort })
    this.setData({ sort }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      this.loadPosts()
    })
  },

  openSearch() {
    wx.navigateTo({ url: `/pages/search/search?keyword=${encodeURIComponent(this.data.keyword || '')}` })
  },

  // 搜索页提交后回调
  applySearch(keyword) {
    const next = String(keyword || '').trim()
    if (next === this.data.keyword) return
    this.setData({ keyword: next }, () => {
      if (next) {
        track.search({
          surface: 'forum',
          keyword: next,
          category: this.data.topic,
          sort: this.data.sort
        })
      }
      this.loadPosts()
    })
  },

  clearSearch() {
    this.applySearch('')
  },

  openPost(type, id) {
    postNav.openPostDetail(type, id)
  },

  goDetail(e) {
    const ds = e.currentTarget.dataset || {}
    const type = ds.type === 'wall' ? 'wall' : 'forum'
    const post = (this.data.posts || []).find((item) => item.feedKey === ds.key)
      || (this.data.posts || []).find((item) => (
        String(item.id) === String(ds.id) && item.contentType === type
      ))
    const id = this.resolvePostId(post, ds.id)
    if (!id) {
      wx.showToast({ title: '缺少帖子 id', icon: 'none' })
      return
    }
    track.postClick({
      surface: 'forum',
      contentType: type,
      contentId: id,
      category: (post && post.displayTag) || this.data.topic,
      sort: this.data.sort
    })
    this.openPost(type, id)
  },

  onAuthorTap(e) {
    const { userid, anonymous } = e.currentTarget.dataset
    userNav.openProfile({
      userId: userid,
      anonymous: anonymous === true || anonymous === 'true'
    })
  },

  goPublish() {
    if (!auth.ensureCanSpeak()) {
      track.publishFail({ surface: 'forum', reason: 'speak_gate', speakCode: this.data.speakCode })
      return
    }
    track.publishClick({ surface: 'forum', source: 'fab' })
    wx.navigateTo({ url: '/pages/forum-publish/forum-publish' })
  },

  goAuth() {
    auth.goSchoolAuth()
  },

  goBindPhone() {
    auth.promptPhone()
  },

  goLogin() {
    auth.goLogin()
  },

  preventBubble() {},

  async onLike(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const type = e.currentTarget.dataset.type === 'wall' ? 'wall' : 'forum'
    const key = `${type}:${id}`
    if (!id || this._likingId === key) return
    const posts = this.data.posts || []
    const index = posts.findIndex((item) => item.feedKey === key)
    if (index < 0) return
    const post = posts[index]
    this._likingId = key
    const nextLiked = !post.liked
    const nextCount = Math.max(0, (Number(post.likeCount) || 0) + (nextLiked ? 1 : -1))
    this.setData({
      [`posts[${index}].liked`]: nextLiked,
      [`posts[${index}].likeCount`]: nextCount
    })
    track.like({
      surface: 'forum',
      contentType: type,
      contentId: id,
      category: post.displayTag || this.data.topic
    })
    try {
      const liked = await repo.toggleLike(type, id)
      if (!!liked !== nextLiked) {
        const syncedCount = Math.max(
          0,
          (Number(post.likeCount) || 0) + (!!liked === !!post.liked ? 0 : liked ? 1 : -1)
        )
        this.setData({
          [`posts[${index}].liked`]: !!liked,
          [`posts[${index}].likeCount`]: syncedCount
        })
      }
    } catch (err) {
      this.setData({
        [`posts[${index}].liked`]: post.liked,
        [`posts[${index}].likeCount`]: post.likeCount
      })
      wx.showToast({ title: '点赞失败', icon: 'none' })
    }
    this._likingId = ''
  },

  // 单图按原比例缩放到不超过 THUMB_MAX 的框里，完整显示不裁剪
  onThumbLoad(e) {
    const key = e.currentTarget.dataset.key
    const width = Number(e.detail && e.detail.width) || 0
    const height = Number(e.detail && e.detail.height) || 0
    if (!key || !width || !height) return
    const scale = Math.min(THUMB_MAX.width / width, THUMB_MAX.height / height)
    const style = `width: ${Math.round(width * scale)}rpx; height: ${Math.round(height * scale)}rpx;`
    this._thumbStyles = { ...(this._thumbStyles || {}), [key]: style }
    const index = (this.data.posts || []).findIndex((item) => item.feedKey === key)
    if (index < 0 || this.data.posts[index].thumbStyle === style) return
    this.setData({ [`posts[${index}].thumbStyle`]: style })
  },

  previewImage(e) {
    const postId = e.currentTarget.dataset.postid
    const type = e.currentTarget.dataset.type === 'wall' ? 'wall' : 'forum'
    const index = Number(e.currentTarget.dataset.index)
    const post = (this.data.posts || []).find((item) => item.feedKey === `${type}:${postId}`)
    const urls = (post && post.images) || []
    const current = urls[index] || urls[0]
    media.previewImages(current, urls)
  },

  onShareAppMessage() {
    const card = share.homeCard('forum')
    track.share({ channel: 'app_message', surface: 'forum', contentType: 'home' })
    return card.appMessage
  },

  onShareTimeline() {
    const card = share.homeCard('forum')
    track.share({ channel: 'timeline', surface: 'forum', contentType: 'home' })
    return card.timeline
  }
})
