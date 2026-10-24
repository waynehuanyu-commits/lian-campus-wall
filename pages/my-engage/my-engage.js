const repo = require('../../utils/repo')
const userNav = require('../../utils/user')
const auth = require('../../utils/auth')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    tabs: [
      { id: 'liked', name: '我赞过的' },
      { id: 'comments', name: '我评论过的' }
    ],
    tab: 'liked',
    loading: true,
    loadError: '',
    likedList: [],
    commentList: []
  },

  onShow() {
    // 个人历史不清收到的评论/赞/私信未读
    this.loadList()
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.id
    if (tab === this.data.tab) return
    this.setData({ tab }, () => this.loadList())
  },

  async loadList() {
    const token = (this._loadToken || 0) + 1
    this._loadToken = token
    this.setData({ loading: true, loadError: '' })
    const { tab } = this.data
    try {
      if (tab === 'liked') {
        const [forumRows, wallRows] = await Promise.all([
          repo.myLiked('forum'),
          repo.myLiked('wall')
        ])
        if (token !== this._loadToken) return
        const forumLiked = (forumRows || []).map((item) => ({
          ...item,
          type: 'forum',
          uniq: `forum:${item.id}`,
          badge: '学习分享',
          title: item.title,
          timeText: formatTime(item.createdAt)
        }))
        const wallLiked = (wallRows || []).map((item) => ({
          ...item,
          type: 'wall',
          uniq: `wall:${item.id}`,
          badge: '互助广场',
          title: item.headline || item.title,
          timeText: formatTime(item.createdAt)
        }))
        this.setData({
          loading: false,
          loadError: '',
          likedList: [...forumLiked, ...wallLiked].sort((a, b) => b.createdAt - a.createdAt)
        })
        return
      }
      const comments = (await repo.myComments() || []).map((item) => ({
        ...item,
        images: item.images || [],
        timeText: formatTime(item.createdAt)
      }))
      if (token !== this._loadToken) return
      this.setData({ loading: false, loadError: '', commentList: comments })
    } catch (err) {
      if (token !== this._loadToken) return
      this.setData({
        loading: false,
        loadError: (err && err.message) || '加载失败，请返回再进一次'
      })
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
