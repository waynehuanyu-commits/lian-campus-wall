const repo = require('../../utils/repo')
const store = require('../../utils/store')
const share = require('../../utils/share')
const track = require('../../utils/track')
const { readNavMetrics } = require('../../utils/nav-bar')

const ALL = '全部'
const TONE_COUNT = 5

Page({
  data: {
    masthead: { top: 20, height: 44, capsule: 100 },
    categories: [ALL].concat(store.GUIDE_CATEGORIES),
    active: ALL,
    items: [],
    page: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: ''
  },

  onLoad() {
    this.setData({ masthead: readNavMetrics() })
    share.enableMenus()
    this.load(true)
  },

  onShow() {
    track.pageView('guide', { category: this.data.active })
  },

  async onPullDownRefresh() {
    await this.load(true)
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) this.load(false)
  },

  // 切分类时旧请求可能晚到，用序号丢弃过期结果
  async load(reset) {
    const seq = (this._seq || 0) + 1
    this._seq = seq
    const page = reset ? 0 : this.data.page + 1
    this.setData(reset ? { loading: true, error: '' } : { loadingMore: true })
    const active = this.data.active
    const result = await repo.listGuides({ category: active === ALL ? '' : active, page })
    if (seq !== this._seq) return
    if (!result || result.ok === false) {
      this.setData({
        loading: false,
        loadingMore: false,
        error: (result && result.message) || '加载失败'
      })
      return
    }
    const categories = result.categories && result.categories.length
      ? result.categories
      : store.GUIDE_CATEGORIES
    if (active !== ALL && categories.indexOf(active) < 0) {
      this.setData({ active: ALL, items: [] }, () => this.load(true))
      return
    }
    const items = (result.items || []).map((item) => ({
      ...item,
      tone: Math.max(0, categories.indexOf(item.category)) % TONE_COUNT
    }))
    this.setData({
      categories: [ALL].concat(categories),
      items: reset ? items : this.data.items.concat(items),
      page,
      hasMore: !!result.hasMore,
      loading: false,
      loadingMore: false,
      error: ''
    })
  },

  onTabTap(e) {
    const name = e.currentTarget.dataset.name
    if (!name || name === this.data.active) return
    track.tagFilter({ surface: 'guide', filterType: 'category', category: name })
    this.setData({ active: name, items: [] }, () => this.load(true))
  },

  openGuide(e) {
    const item = this.data.items[Number(e.currentTarget.dataset.index)]
    if (!item) return
    if (item.kind === 'article') {
      this.openArticle(item)
      return
    }
    // 从首页帖子圈选的攻略：直接进原帖，评论和点赞都在原帖里
    if (item.kind === 'pick' && item.refId) {
      const page = item.refType === 'wall' ? 'wall-detail' : 'forum-detail'
      wx.navigateTo({ url: `/pages/${page}/${page}?id=${item.refId}` })
      return
    }
    wx.navigateTo({ url: `/pages/guide-detail/guide-detail?id=${item.id}` })
  },

  // 公众号文章：基础库 3.4.8+ 直接打开（必须由点击触发），低版本退回复制链接
  openArticle(item) {
    const url = item.articleUrl
    if (!url) return
    const copyLink = () => {
      wx.setClipboardData({
        data: url,
        success: () => wx.showToast({ title: '链接已复制，可在微信里打开', icon: 'none' })
      })
    }
    if (typeof wx.openOfficialAccountArticle !== 'function') {
      copyLink()
      return
    }
    wx.openOfficialAccountArticle({ url, fail: copyLink })
  },

  goPublish() {
    const active = this.data.active
    const query = active === ALL ? '' : `?category=${encodeURIComponent(active)}`
    wx.navigateTo({ url: `/pages/guide-publish/guide-publish${query}` })
  },

  onShareAppMessage() {
    track.share({ channel: 'app_message', surface: 'guide', contentType: 'guide_list' })
    return share.guideListCard().appMessage
  },

  onShareTimeline() {
    track.share({ channel: 'timeline', surface: 'guide', contentType: 'guide_list' })
    return share.guideListCard().timeline
  }
})
