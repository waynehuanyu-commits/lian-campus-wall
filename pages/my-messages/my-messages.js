const repo = require('../../utils/repo')
const inbox = require('../../utils/inbox')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    list: [],
    loading: true,
    loadError: ''
  },

  onShow() {
    // 会话列表只加载，不清任何会话未读
    this.loadList()
  },

  async loadList() {
    const token = (this._loadToken || 0) + 1
    this._loadToken = token
    if (!this.data.list.length) this.setData({ loading: true, loadError: '' })
    try {
      const rows = await repo.listConversations()
      if (token !== this._loadToken) return
      const list = (rows || []).map((item) => ({
        ...item,
        timeText: item.lastMessageAt ? formatTime(item.lastMessageAt) : '',
        hasUnread: (Number(item.unreadCount) || 0) > 0
      }))
      this.setData({ list, loading: false, loadError: '' })
      // 校准总红点，但不 mark 任何会话
      inbox.refresh(true).catch(() => {})
    } catch (err) {
      if (token !== this._loadToken) return
      this.setData({
        loading: false,
        loadError: this.data.list.length ? '' : ((err && err.message) || '加载失败')
      })
    }
  },

  goChat(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/dm-chat/dm-chat?id=${encodeURIComponent(id)}` })
  }
})
