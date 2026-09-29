const repo = require('../../utils/repo')
const userNav = require('../../utils/user')
const auth = require('../../utils/auth')
const { formatTime } = require('../../utils/util')
const inbox = require('../../utils/inbox')

Page({
  data: {
    tabs: [
      { id: 'received', name: '收到的评论' },
      { id: 'liked', name: '我的点赞' },
      { id: 'comments', name: '我的评论' }
    ],
    tab: 'received',
    loading: true,
    loadError: '',
    likedList: [],
    commentList: [],
    receivedList: []
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
    const { tab } = this.data
    if (tab === 'received' && !this._markedCommentsSeen) {
      this._markedCommentsSeen = true
      repo.markInboxSeen({ likes: false, comments: true })
        .then(() => inbox.refresh(true))
        .catch(() => {})
    }
    if (tab === 'liked' && !this._markedLikesSeen) {
      this._markedLikesSeen = true
      repo.markInboxSeen({ likes: true, comments: false })
        .then(() => inbox.refresh(true))
        .catch(() => {})
    }
    try {
      if (tab === 'liked') {
        const [forumRows, wallRows] = await Promise.all([
          repo.myLiked('forum'),
          repo.myLiked('wall')
        ])
        const forumLiked = (forumRows || []).map((item) => ({
          ...item,
          type: 'forum',
          uniq: `forum_${item.id}`,
          badge: '学习分享',
          title: item.title,
          timeText: formatTime(item.createdAt)
        }))
        const wallLiked = (wallRows || []).map((item) => ({
          ...item,
          type: 'wall',
          uniq: `wall_${item.id}`,
          badge: '互助广场',
          title: item.headline,
          timeText: formatTime(item.createdAt)
        }))
        this.setData({
          loading: false,
          loadError: '',
          likedList: [...forumLiked, ...wallLiked].sort((a, b) => b.createdAt - a.createdAt)
        })
        return
      }
      if (tab === 'comments') {
        const comments = (await repo.myComments() || []).map((item) => ({
          ...item,
          images: item.images || [],
          timeText: formatTime(item.createdAt)
        }))
        this.setData({ loading: false, loadError: '', commentList: comments })
        return
      }
      const received = (await repo.myReceivedComments() || []).map((item) => ({
        ...item,
        images: item.images || [],
        timeText: formatTime(item.createdAt)
      }))
      this.setData({ loading: false, loadError: '', receivedList: received })
    } catch (err) {
      this.setData({
        loading: false,
        loadError: (err && err.message) || '加载失败，请返回再进一次'
      })
    }
  },

  goPost(e) {
    const { id, type } = e.currentTarget.dataset
    if (!id) return
    if (type === 'forum') {
      wx.navigateTo({ url: `/pages/forum-detail/forum-detail?id=${id}` })
      return
    }
    wx.navigateTo({ url: `/pages/wall-detail/wall-detail?id=${id}` })
  },

  goAuthor(e) {
    const userId = e.currentTarget.dataset.userid
    userNav.openProfile({ userId })
  },

  onDeleteComment(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除这条评论',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#FF6B81',
      success: async (res) => {
        if (!res.confirm) return
        const result = await repo.deleteComment(id)
        if (auth.showActionError(result)) return
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadList()
      }
    })
  }
})
