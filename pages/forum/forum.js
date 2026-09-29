const store = require('../../utils/store')
const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const share = require('../../utils/share')
const userNav = require('../../utils/user')
const media = require('../../utils/media')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    categories: ['全部', ...store.FORUM_CATEGORIES],
    category: '全部',
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
    loadError: ''
  },

  onLoad(query) {
    this.fromShare = (query && query.from) || ''
    share.enableMenus()
    const peeked = repo.peekList('forum', this.feedQuery())
    if (peeked && peeked.data) this.renderPosts(peeked.data)
    this.refresh()
  },

  onShow() {
    share.enableMenus()
    if (!this._ready) {
      this._ready = true
      return
    }
    // 切 Tab 回来走缓存，不要先把列表缓存清掉
    this.refresh()
  },

  async onPullDownRefresh() {
    repo.invalidateLocalFeeds()
    await this.refresh({ force: true })
    wx.stopPullDownRefresh()
  },

  async refresh(options = {}) {
    const force = !!options.force
    const now = Date.now()
    if (!force && this._lastRefreshAt && now - this._lastRefreshAt < 60000) return
    if (this._refreshing) return
    this._refreshing = true
    this._lastRefreshAt = now
    track.pageView('forum', { category: this.data.category, sort: this.data.sort })
    const postsPromise = this.loadPosts(force)
    try {
      await (getApp().globalData.ready || Promise.resolve())
    } catch (e) {
      // 启动失败也不挡浏览
    }
    try {
      await Promise.all([this.refreshGate(), postsPromise])
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
      category: this.data.category,
      keyword: this.data.keyword,
      sort: this.data.sort
    }
  },

  mapPosts(list) {
    return (Array.isArray(list) ? list : []).map((item) => ({
      ...item,
      images: item.images || [],
      timeText: formatTime(item.createdAt)
    }))
  },

  renderPosts(list) {
    this.setData({
      posts: this.mapPosts(list),
      loading: false,
      loadError: ''
    })
  },

  async loadPosts(force = false) {
    const payload = this.feedQuery()
    const home = payload.category === '全部' && !payload.keyword && payload.sort === 'new'
    const peeked = !force ? repo.peekList('forum', payload) : null
    if (peeked && peeked.data) this.renderPosts(peeked.data)
    else if (!this.data.posts.length) this.setData({ loading: true, loadError: '' })

    if (!force && home) {
      if (peeked && peeked.fresh) {
        this.loadWeeklyHot()
        return
      }
      try {
        await (getApp().globalData.ready || Promise.resolve())
      } catch (e) {
        // 登录失败再单独拉列表
      }
      const seeded = repo.peekList('forum', payload)
      if (seeded && seeded.fresh && Array.isArray(seeded.data)) {
        this.renderPosts(seeded.data)
        this.loadWeeklyHot()
        return
      }
    }

    try {
      const list = await repo.listForum(payload)
      this.renderPosts(list)
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
    track.weeklyHotOpen({ surface: 'forum', source: 'banner' })
    wx.navigateTo({ url: '/pages/weekly-hot/weekly-hot' })
  },

  goHotItem(e) {
    const { id, type } = e.currentTarget.dataset
    if (!id) return
    const preview = ((this.data.weeklyHot && this.data.weeklyHot.preview) || []).find(
      (item) => item.contentId === id && (item.contentType || 'wall') === (type || 'wall')
    )
    track.weeklyHotClick({
      surface: 'forum',
      source: 'preview',
      contentId: id,
      contentType: type || 'wall',
      rank: (preview && preview.rank) || 0,
      tag: (preview && preview.tag) || ''
    })
    if (type === 'forum') {
      wx.navigateTo({ url: `/pages/forum-detail/forum-detail?id=${id}` })
      return
    }
    wx.navigateTo({ url: `/pages/wall-detail/wall-detail?id=${id}` })
  },

  onCategoryTap(e) {
    const category = e.currentTarget.dataset.name
    track.tagFilter({ surface: 'forum', filterType: 'category', category })
    this.setData({ category }, () => this.loadPosts())
  },

  onSortTap(e) {
    const sort = e.currentTarget.dataset.id
    if (sort === this.data.sort) return
    track.sortChange({ surface: 'forum', sort, from: this.data.sort })
    this.setData({ sort }, () => this.loadPosts())
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    track.search({
      surface: 'forum',
      keyword: this.data.keyword,
      category: this.data.category,
      sort: this.data.sort
    })
    this.loadPosts()
  },

  goDetail(e) {
    const { id } = e.currentTarget.dataset
    const post = (this.data.posts || []).find((item) => item.id === id)
    track.postClick({
      surface: 'forum',
      contentType: 'forum',
      contentId: id,
      category: (post && post.category) || this.data.category,
      sort: this.data.sort
    })
    wx.navigateTo({ url: `/pages/forum-detail/forum-detail?id=${id}` })
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
      surface: 'forum',
      contentType: 'forum',
      contentId: id,
      category: post.category || this.data.category
    })
    try {
      const liked = await repo.toggleLike('forum', id)
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
