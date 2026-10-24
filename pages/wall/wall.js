const store = require('../../utils/store')
const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const share = require('../../utils/share')
const userNav = require('../../utils/user')
const media = require('../../utils/media')
const postNav = require('../../utils/post-nav')
const { formatTime, dedupePostsById } = require('../../utils/util')

function feedBodyOverflows(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!raw) return false
  let lines = 0
  raw.split('\n').forEach((line) => {
    lines += Math.max(1, Math.ceil(Array.from(line).length / 24))
  })
  return lines > 3
}

Page({
  data: {
    tags: ['全部', ...store.WALL_BOARDS],
    tag: '全部',
    dealStatusOptions: [
      { id: '全部', label: '全部状态' },
      ...store.WALL_DEAL_STATUSES
    ],
    dealStatus: '全部',
    sortOptions: [
      { id: 'new', name: '最新' },
      { id: 'hot', name: '最热' }
    ],
    sort: 'new',
    keyword: '',
    officialOnly: false,
    posts: [],
    weeklyHot: null,
    canSpeak: false,
    speakCode: '',
    guestTip: '',
    loading: true,
    loadError: ''
  },

  onLoad(query) {
    const topic = store.normalizeTopic((query && (query.tag || query.topic)) || '')
    const keyword = String((query && (query.keyword || query.q)) || '')
    try {
      wx.setStorageSync('cw_home_intent', { topic, keyword })
    } catch (err) {
      // 带不上筛选时仍回到首页
    }
    wx.switchTab({ url: '/pages/forum/forum' })
  },

  onShow() {
    wx.switchTab({ url: '/pages/forum/forum' })
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
      this.refreshGate()
      return
    }
    if (this._refreshing) return
    this._refreshing = true
    this._lastRefreshAt = now
    track.pageView('wall', { sort: this.data.sort, tag: this.data.tag })
    const postsPromise = this.loadPosts(force)
    try {
      await (getApp().globalData.ready || Promise.resolve())
    } catch (e) {
      // ignore
    }
    try {
      await Promise.all([this.refreshGate(), postsPromise])
    } finally {
      this._refreshing = false
    }
  },

  async refreshGate() {
    try {
      const gate = (await repo.getSpeakGate()) || {}
      const code = gate.code || ''
      let tip = gate.message || ''
      if (code === 'NEED_LOGIN') tip = '浏览开放。发布和留言前请先完成登录与学校认证'
      else if (code === 'NEED_AUTH') tip = '浏览开放。发布和留言前请先认证学校'
      this.setData({
        canSpeak: !!gate.ok,
        speakCode: code,
        guestTip: tip
      })
    } catch (e) {
      this.setData({ canSpeak: false, speakCode: '', guestTip: '' })
    }
  },

  feedQuery() {
    return {
      tag: this.data.officialOnly ? '全部' : this.data.tag,
      keyword: this.data.keyword,
      sort: this.data.sort,
      dealStatus: this.data.dealStatus,
      official: !!this.data.officialOnly
    }
  },

  renderPosts(feed) {
    const open = this._bodyOpen || {}
    const posts = dedupePostsById((feed && feed.posts) || [])
    this.setData({
      posts: posts.map((item) => {
        const content = String(item.content || '').trim()
        const summary = String(item.summary || '').trim()
        const bodyText = content || summary
        return {
          ...item,
          images: item.images || [],
          timeText: formatTime(item.createdAt),
          bodyText,
          bodyLong: feedBodyOverflows(bodyText),
          bodyOpen: !!open[item.id],
          showSummary: !!(summary && content && summary !== content),
          viewCount: item.viewCount || 0
        }
      }),
      loading: false,
      loadError: ''
    })
  },

  toggleBody(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    if (!this._bodyOpen) this._bodyOpen = {}
    this._bodyOpen[id] = !this._bodyOpen[id]
    const index = (this.data.posts || []).findIndex((item) => String(item.id) === id)
    if (index < 0) return
    this.setData({ [`posts[${index}].bodyOpen`]: !!this._bodyOpen[id] })
  },

  async loadPosts(force = false) {
    const payload = this.feedQuery()
    const home = !payload.official && payload.tag === '全部' && !payload.keyword && payload.sort === 'new' && payload.dealStatus === '全部'
    const peeked = !force ? repo.peekList('wall', payload) : null
    if (peeked && peeked.data) this.renderPosts(peeked.data)
    else if (!this.data.posts.length) this.setData({ loading: true, loadError: '' })
    if (!force && peeked && peeked.fresh) {
      this.loadWeeklyHot()
      return
    }
    if (!force && home) {
      try {
        await (getApp().globalData.ready || Promise.resolve())
      } catch (e) {
        // 登录失败再单独拉列表
      }
      const seeded = repo.peekList('wall', payload)
      if (seeded && seeded.fresh && seeded.data && Array.isArray(seeded.data.posts)) {
        this.renderPosts(seeded.data)
        this.loadWeeklyHot()
        return
      }
    }
    try {
      const wallFeed = await repo.listWall(payload)
      this.renderPosts(wallFeed)
      this.loadWeeklyHot()
    } catch (e) {
      this.setData({
        loading: false,
        loadError: this.data.posts.length ? '' : '加载失败，下拉重试'
      })
    }
  },

  async loadWeeklyHot() {
    try {
      const weeklyHot = await repo.getWeeklyHot({})
      this.setData({
        weeklyHot: weeklyHot && weeklyHot.enabled && weeklyHot.totalCount
          ? {
            ...weeklyHot,
            preview: (weeklyHot.items && weeklyHot.items.length ? weeklyHot.items : (weeklyHot.preview || [])).map((item) => ({
              ...item,
              previewKey: `${item.contentType || 'wall'}_${item.contentId}`
            }))
          }
          : null
      })
    } catch (e) {
      // 热榜失败不挡列表
    }
  },

  goWeeklyHot() {
    track.weeklyHotOpen({ surface: 'wall', source: 'banner' })
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
      surface: 'wall',
      source: 'preview',
      contentId: id,
      contentType: type,
      rank: (preview && preview.rank) || 0,
      tag: (preview && preview.tag) || ''
    })
    postNav.openPostDetail(type, id)
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.name
    if (!this.data.officialOnly && tag === this.data.tag) return
    track.tagFilter({ surface: 'wall', filterType: 'board', tag })
    this._lastRefreshAt = 0
    this.setData({ tag, officialOnly: false }, () => this.loadPosts())
  },

  onOfficialTap() {
    if (this.data.officialOnly) return
    track.tagFilter({ surface: 'wall', filterType: 'official', tag: '官方' })
    this._lastRefreshAt = 0
    this.setData({ officialOnly: true }, () => this.loadPosts())
  },

  onDealStatusTap(e) {
    const dealStatus = e.currentTarget.dataset.id
    if (dealStatus === this.data.dealStatus) return
    track.tagFilter({ surface: 'wall', filterType: 'deal_status', dealStatus })
    this._lastRefreshAt = 0
    this.setData({ dealStatus }, () => this.loadPosts())
  },

  onSortTap(e) {
    const sort = e.currentTarget.dataset.id
    if (sort === this.data.sort) return
    track.sortChange({ surface: 'wall', sort, from: this.data.sort })
    this._lastRefreshAt = 0
    this.setData({ sort }, () => this.loadPosts())
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    track.search({ surface: 'wall', keyword: this.data.keyword, tag: this.data.tag, sort: this.data.sort })
    this._lastRefreshAt = 0
    this.loadPosts()
  },

  goDetail(e) {
    const id = String(
      (e.currentTarget.dataset && e.currentTarget.dataset.id)
      || ''
    ).trim()
    if (!id || id === 'undefined' || id === 'null') {
      wx.showToast({ title: '缺少帖子 id', icon: 'none' })
      return
    }
    const post = (this.data.posts || []).find((item) => item.id === id || item._id === id)
    track.postClick({
      surface: 'wall',
      contentType: 'wall',
      contentId: id,
      tag: (post && post.tag) || this.data.tag,
      sort: this.data.sort
    })
    postNav.openPostDetail('wall', id)
  },

  goPublish() {
    if (!auth.ensureCanSpeak()) {
      track.publishFail({ surface: 'wall', reason: 'speak_gate', speakCode: this.data.speakCode })
      return
    }
    const tag = this.data.tag !== '全部' ? this.data.tag : ''
    track.publishClick({ surface: 'wall', source: 'fab', tag })
    const query = tag ? `?tag=${encodeURIComponent(tag)}` : ''
    wx.navigateTo({ url: `/pages/wall-publish/wall-publish${query}` })
  },

  goAuth() {
    auth.goSchoolAuth()
  },

  goLogin() {
    auth.goLogin()
  },

  preventBubble() {},

  async onLike(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || this._likingId === id) return
    const posts = this.data.posts || []
    const index = posts.findIndex((item) => String(item.id) === id)
    if (index < 0) return
    const post = posts[index]
    this._likingId = id
    const nextLiked = !post.liked
    const nextCount = Math.max(0, (Number(post.likeCount) || 0) + (nextLiked ? 1 : -1))
    this.setData({
      [`posts[${index}].liked`]: nextLiked,
      [`posts[${index}].likeCount`]: nextCount
    })
    track.like({
      surface: 'wall',
      contentType: 'wall',
      contentId: id,
      tag: post.tag || this.data.tag
    })
    try {
      const liked = await repo.toggleLike('wall', id)
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

  previewImage(e) {
    const postId = e.currentTarget.dataset.postid
    const index = Number(e.currentTarget.dataset.index)
    const post = (this.data.posts || []).find((item) => String(item.id) === String(postId))
    const urls = (post && post.images) || []
    const current = urls[index] || urls[0]
    media.previewImages(current, urls)
  },

  onAuthorTap(e) {
    const { userid, anonymous } = e.currentTarget.dataset
    userNav.openProfile({
      userId: userid,
      anonymous: anonymous === true || anonymous === 'true'
    })
  },

  onShareAppMessage() {
    const card = share.homeCard('wall')
    track.share({ channel: 'app_message', surface: 'wall', contentType: 'home' })
    return card.appMessage
  },

  onShareTimeline() {
    const card = share.homeCard('wall')
    track.share({ channel: 'timeline', surface: 'wall', contentType: 'home' })
    return card.timeline
  }
})
