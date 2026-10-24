const repo = require('../../utils/repo')
const inbox = require('../../utils/inbox')
const track = require('../../utils/track')
const userNav = require('../../utils/user')
const postNav = require('../../utils/post-nav')
const { formatTime } = require('../../utils/util')

// 两个收件箱直接在消息页切换展示；字段映射与 inbox-comments / inbox-likes 一致
const SOURCES = {
  comments: {
    fetch: () => repo.myReceivedComments(),
    rows: (packed) => (packed && packed.comments) || [],
    map: (item) => ({
      ...item,
      uniq: item.id,
      postId: item.targetId,
      contentType: item.targetType,
      actorId: item.authorId,
      actorName: item.authorName,
      actorAvatar: item.authorAvatar,
      images: item.images || [],
      action: item.replyToName ? '回复了你' : '评论了你',
      timeText: formatTime(item.createdAt)
    }),
    seen: (cursor) => ({ comments: true, likes: false, commentsAt: cursor })
  },
  likes: {
    fetch: () => repo.myReceivedLikes(),
    rows: (packed) => (packed && packed.likes) || [],
    map: (item) => ({
      ...item,
      uniq: item.id || `${item.contentType}:${item.postId}:${item.userId}`,
      actorId: item.userId,
      actorName: item.userName,
      actorAvatar: item.userAvatar,
      anonymous: false,
      images: [],
      action: '赞了你的帖子',
      timeText: formatTime(item.createdAt)
    }),
    seen: (cursor) => ({ likes: true, comments: false, likesAt: cursor })
  }
}

Page({
  data: {
    tab: 'comments',
    unreadComments: false,
    unreadLikes: false,
    list: [],
    loading: true,
    loadError: ''
  },

  onLoad() {
    const badges = inbox.current() || {}
    const likesOnly = (Number(badges.unreadLikes) || 0) > 0 && !(Number(badges.unreadComments) || 0)
    this.setData({ tab: likesOnly ? 'likes' : 'comments' })
  },

  onShow() {
    this._visible = true
    track.pageView('messages')
    this.refreshBadges(false)
    this.loadList()
  },

  onHide() {
    this._visible = false
  },

  onUnload() {
    this._visible = false
    this._listToken = (this._listToken || 0) + 1
  },

  async onPullDownRefresh() {
    await Promise.all([this.refreshBadges(true), this.loadList({ force: true })])
    wx.stopPullDownRefresh()
  },

  async refreshBadges(force) {
    const token = (this._badgeToken || 0) + 1
    this._badgeToken = token
    const badges = await inbox.refresh(!!force).catch(() => inbox.current())
    if (token !== this._badgeToken) return
    this.setData({
      unreadComments: (Number(badges && badges.unreadComments) || 0) > 0,
      unreadLikes: (Number(badges && badges.unreadLikes) || 0) > 0
    })
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (!SOURCES[tab] || tab === this.data.tab) return
    this.setData({ tab, list: [], loading: true, loadError: '' })
    this.loadList()
  },

  async loadList(options = {}) {
    const tab = this.data.tab
    const source = SOURCES[tab]
    const token = (this._listToken || 0) + 1
    this._listToken = token
    if (!this.data.list.length || options.force) {
      this.setData({ loading: true, loadError: '' })
    }
    try {
      const packed = await source.fetch()
      if (token !== this._listToken || !this._visible) return
      const list = source.rows(packed).map(source.map)
      const cursor = inbox.seenCursor(list, packed && packed.snapshotAt)
      this.setData({ loading: false, loadError: '', list }, () => {
        this.markShown(token, source, cursor)
      })
    } catch (err) {
      if (token !== this._listToken) return
      this.setData({
        loading: false,
        loadError: this.data.list.length ? '' : ((err && err.message) || '加载失败，请下拉重试')
      })
      if (this.data.list.length) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }
  },

  async markShown(token, source, cursor) {
    if (!this._visible || token !== this._listToken || !cursor) return
    try {
      const seen = await repo.markInboxSeen(source.seen(cursor))
      if (!seen || seen.ok === false) return
      await this.refreshBadges(true)
    } catch (err) {
      // 列表已展示，已读写入失败时未读保留
    }
  },

  goPost(e) {
    const { id, type, exists } = e.currentTarget.dataset
    if (exists === false || exists === 'false') {
      wx.showToast({ title: '原帖已不可用', icon: 'none' })
      return
    }
    postNav.openPostDetail(type === 'wall' ? 'wall' : 'forum', id)
  },

  goAuthor(e) {
    const { userid, anonymous } = e.currentTarget.dataset
    userNav.openProfile({
      userId: userid,
      anonymous: anonymous === true || anonymous === 'true'
    })
  }
})
