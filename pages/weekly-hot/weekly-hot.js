const repo = require('../../utils/repo')
const track = require('../../utils/track')
const share = require('../../utils/share')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    board: null,
    tabs: [
      { id: '全部', name: '全部' },
      { id: 'forum', name: '学习分享' },
      { id: 'wall', name: '互助广场' }
    ],
    tab: '全部',
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
      const board = await repo.getWeeklyHot({ tab: this.data.tab })
      const items = ((board && board.items) || []).map((item, index) => ({
        ...item,
        key: `${item.contentType || 'wall'}_${item.contentId}`,
        rank: item.rank || index + 1,
        rankClass: index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : 'normal'
      }))
      track.pageView('weekly_hot', { tab: this.data.tab, totalCount: (board && board.totalCount) || 0 })
      this.setData({
        board: board
          ? {
            ...board,
            updatedText: board.updatedAt ? formatTime(board.updatedAt) : ''
          }
          : { title: '每周精选', subtitle: '学习分享 + 互助广场热榜' },
        tabs: [
          { id: '全部', name: '全部', count: (board && board.totalCount) || 0 },
          { id: 'forum', name: '学习分享', count: (board && board.forumCount) || 0 },
          { id: 'wall', name: '互助广场', count: (board && board.wallCount) || 0 }
        ],
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

  onTabTap(e) {
    const tab = e.currentTarget.dataset.id
    if (tab === this.data.tab) return
    track.weeklyHotTab({ surface: 'weekly_hot', tab, from: this.data.tab })
    this.setData({ tab, loading: true }, () => this.refresh({ initial: true }))
  },

  goDetail(e) {
    const { id, type } = e.currentTarget.dataset
    if (!id) return
    const item = (this.data.items || []).find(
      (row) => row.contentId === id && (row.contentType || 'wall') === (type || 'wall')
    )
    track.weeklyHotClick({
      surface: 'weekly_hot',
      source: 'list',
      contentId: id,
      contentType: type || 'wall',
      rank: (item && item.rank) || 0,
      tag: (item && item.tag) || '',
      tab: this.data.tab
    })
    if (type === 'forum') {
      wx.navigateTo({ url: `/pages/forum-detail/forum-detail?id=${id}` })
      return
    }
    wx.navigateTo({ url: `/pages/wall-detail/wall-detail?id=${id}` })
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
