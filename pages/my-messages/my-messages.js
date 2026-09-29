const repo = require('../../utils/repo')
const { formatTime } = require('../../utils/util')
const inbox = require('../../utils/inbox')

Page({
  data: {
    list: []
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    const list = (await repo.listConversations()).map((item) => ({
      ...item,
      timeText: item.lastMessageAt ? formatTime(item.lastMessageAt) : ''
    }))
    this.setData({ list })
    inbox.refresh(true).catch(() => {})
  },

  goChat(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/dm-chat/dm-chat?id=${encodeURIComponent(id)}` })
  }
})
