const store = require('../../utils/store')
const repo = require('../../utils/repo')
const track = require('../../utils/track')
const share = require('../../utils/share')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    board: null,
    items: [],
    loading: true,
    loadError: ''
  },

  onLoad(query) {
    this.fromShare = (query && query.from) || ''
    share.enableMenus()
    this.refresh({ initial: true })
  },

  onShow() {
    share.enableMenus()
    if (this._ready) this.refresh({ soft: true })
    this._ready = true
  },

  async onPullDownRefresh() {
    await this.refresh({ initial: true })
    wx.stopPullDownRefresh()
  },

  async refresh(options = {}) {
    const initial = !!options.initial || !this.data.board
    if (initial) this.setData({ loading: true, loadError: '' })
    try {
      const board = await repo.getWeeklyHot({ tab: '全部' })
      const items = ((board && board.items) || []).map((item, index) => ({
        ...item,
        key: `${item.contentType || 'wall'}:${item.contentId}`,
        tag: item.tag || '',
        rank: item.rank || index + 1,
        rankClass: index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : 'normal'
      }))
      track.pageView('weekly_hot', { totalCount: (board && board.totalCount) || 0 })
      this.setData({
        board: board
          ? {
            ...board,
            subtitle: store.publicWeeklySubtitle(board.subtitle),
            updatedText: board.updatedAt ? formatTime(board.updatedAt) : ''
          }
          : { title: '每周精选', subtitle: '本周校园精选' },
        items,
        loading: false,
        loadError: ''
      })
    } catch (err) {
      const message = (err && err.message) || '热榜加载失败'
      this.setData({
        loading: false,
        loadError: this.data.items.length ? '' : message
      })
      if (!this.data.items.length) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }
  },

  goDetail(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const type = e.currentTarget.dataset.type === 'forum' ? 'forum' : 'wall'
    if (!id || id === 'undefined' || id === 'null') {
      wx.showToast({ title: '缺少帖子 id', icon: 'none' })
      return
    }
    const item = (this.data.items || []).find(
      (row) => row.contentId === id && (row.contentType || 'wall') === type
    )
    track.weeklyHotClick({
      surface: 'weekly_hot',
      source: 'list',
      contentId: id,
      contentType: type,
      rank: (item && item.rank) || 0,
      tag: (item && item.tag) || '',
      tab: '全部'
    })
    require('../../utils/post-nav').openPostDetail(type, id)
  },

  onShareAppMessage() {
    const card = share.weeklyHotCard(this.data.board || {})
    track.share({ channel: 'app_message', surface: 'weekly_hot', contentType: 'weekly_hot' })
    return card.appMessage
  },

  onShareTimeline() {
    const card = share.weeklyHotCard(this.data.board || {})
    track.share({ channel: 'timeline', surface: 'weekly_hot', contentType: 'weekly_hot' })
    return card.timeline
  }
})
