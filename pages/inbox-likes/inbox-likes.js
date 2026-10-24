const repo = require('../../utils/repo')
const inbox = require('../../utils/inbox')
const userNav = require('../../utils/user')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    loading: true,
    loadError: '',
    list: []
  },

  onShow() {
    this._visible = true
    this.loadList()
  },

  onHide() {
    this._visible = false
  },

  onUnload() {
    this._visible = false
    this._loadToken = (this._loadToken || 0) + 1
  },

  async onPullDownRefresh() {
    await this.loadList({ force: true })
    wx.stopPullDownRefresh()
  },

  async loadList(options = {}) {
    const token = (this._loadToken || 0) + 1
    this._loadToken = token
    if (!this.data.list.length || options.force) {
      this.setData({ loading: true, loadError: '' })
    }
    try {
      const packed = await repo.myReceivedLikes()
      if (token !== this._loadToken || !this._visible) return
      const rows = (packed && packed.likes) || []
      const list = rows.map((item) => ({
        ...item,
        uniq: item.id || `${item.contentType}:${item.postId}:${item.userId}`,
        timeText: formatTime(item.createdAt),
        postBadge: item.postBadge || (item.contentType === 'wall' ? '互助广场' : '学习分享')
      }))
      const cursor = inbox.seenCursor(list, packed && packed.snapshotAt)
      this.setData({ loading: false, loadError: '', list }, () => {
        this.markShown(token, cursor)
      })
    } catch (err) {
      if (token !== this._loadToken) return
      this.setData({
        loading: false,
        loadError: this.data.list.length ? '' : ((err && err.message) || '加载失败，请下拉重试')
      })
      if (this.data.list.length) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }
  },

  async markShown(token, cursor) {
    if (!this._visible || token !== this._loadToken || !cursor) return
    try {
      const seen = await repo.markInboxSeen({ likes: true, comments: false, likesAt: cursor })
      if (!seen || seen.ok === false) return
      await inbox.refresh(true)
    } catch (err) {
      // 展示成功但已读写入失败时，未读保留
    }
  },

  goPost(e) {
    const { id, type, exists } = e.currentTarget.dataset
    if (exists === false || exists === 'false') {
      wx.showToast({ title: '原帖已不可用', icon: 'none' })
      return
    }
    require('../../utils/post-nav').openPostDetail(type === 'wall' ? 'wall' : 'forum', id)
  },

  goAuthor(e) {
    const userId = e.currentTarget.dataset.userid
    userNav.openProfile({ userId })
  }
})
