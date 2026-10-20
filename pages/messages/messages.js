const inbox = require('../../utils/inbox')
const repo = require('../../utils/repo')
const track = require('../../utils/track')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    unreadComments: false,
    unreadLikes: false,
    list: [],
    loading: false,
    loadError: ''
  },

  onLoad() {
    this.refreshAll(false)
  },

  onShow() {
    track.pageView('messages')
    this.refreshAll(false)
  },

  onPullDownRefresh() {
    this.refreshAll(true).finally(() => wx.stopPullDownRefresh())
  },

  async refreshAll(force) {
    const token = (this._loadToken || 0) + 1
    this._loadToken = token
    if (!this.data.list.length) {
      this.setData({ loading: true, loadError: '' })
    }

    let badges = inbox.current()
    let rows = null
    try {
      const pair = await Promise.all([
        inbox.refresh(!!force).catch(() => inbox.current()),
        repo.listConversations().catch(() => null)
      ])
      badges = pair[0] || badges
      rows = pair[1]
    } catch (err) {
      rows = null
    }
    if (token !== this._loadToken) return

    const patch = {
      unreadComments: (Number(badges && badges.unreadComments) || 0) > 0,
      unreadLikes: (Number(badges && badges.unreadLikes) || 0) > 0,
      loading: false
    }
    if (Array.isArray(rows)) {
      patch.list = rows.map((item) => ({
        ...item,
        timeText: item.lastMessageAt ? formatTime(item.lastMessageAt) : '',
        hasUnread: (Number(item.unreadCount) || 0) > 0
      }))
      patch.loadError = ''
    } else if (!this.data.list.length) {
      patch.loadError = '私信暂时加载不出来，下拉重试'
    }
    this.setData(patch)
  },

  goComments() {
    wx.navigateTo({ url: '/pages/inbox-comments/inbox-comments' })
  },

  goLikes() {
    wx.navigateTo({ url: '/pages/inbox-likes/inbox-likes' })
  },

  goChat(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/dm-chat/dm-chat?id=${encodeURIComponent(id)}` })
  }
})
