const repo = require('../../utils/repo')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    tabs: [
      { id: 'wall', name: '互助广场' },
      { id: 'forum', name: '学习分享' }
    ],
    tab: 'wall',
    list: [],
    loading: true,
    loadError: ''
  },

  onShow() {
    this.loadList()
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.id
    if (tab === this.data.tab) return
    this.setData({ tab }, () => this.loadList())
  },

  async loadList() {
    this.setData({ loading: true, loadError: '' })
    try {
      const { tab } = this.data
      const list = (await repo.myPosts(tab)).map((item) => ({
        ...item,
        type: tab,
        badge: item.reviewStatus && item.reviewStatus !== 'approved'
          ? (item.reviewStatusLabel || '审核中')
          : (tab === 'wall' ? item.tag : item.category),
        title: tab === 'wall' ? item.headline : item.title,
        timeText: formatTime(item.createdAt)
      }))
      this.setData({ list, loading: false, loadError: '' })
    } catch (err) {
      this.setData({
        list: [],
        loading: false,
        loadError: (err && err.message) || '加载失败'
      })
    }
  },

  goDetail(e) {
    const { id, type } = e.currentTarget.dataset
    if (type === 'forum') {
      wx.navigateTo({ url: `/pages/forum-detail/forum-detail?id=${id}` })
      return
    }
    wx.navigateTo({ url: `/pages/wall-detail/wall-detail?id=${id}` })
  }
})
