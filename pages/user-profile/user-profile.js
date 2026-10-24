const repo = require('../../utils/repo')
const defaultProfile = require('../../utils/default-profile')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    userId: '',
    profile: null,
    stats: { postCount: 0, receivedLikes: 0, receivedComments: 0 },
    tabs: [
      { id: 'wall', name: '互助广场' },
      { id: 'forum', name: '学习分享' }
    ],
    tab: 'wall',
    list: [],
    loading: true,
    error: '',
    messaging: false,
    moreOpen: false
  },

  onLoad(query) {
    this.userId = decodeURIComponent(query.id || '')
    this.setData({ userId: this.userId })
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    if (!this.data.profile) this.setData({ loading: true, error: '' })
    if (!this.userId) {
      this.setData({ profile: null, loading: false, error: '用户不存在' })
      return
    }
    // 帖子列表不依赖资料结果，一起发出去，省一次往返
    const [result, rows] = await Promise.all([
      repo.getPublicProfile(this.userId),
      repo.listUserPosts(this.userId, this.data.tab).catch(() => [])
    ])
    if (!result || !result.ok) {
      this.setData({ profile: null, loading: false, error: (result && result.message) || '用户不存在' })
      return
    }
    if (result.isSelf) {
      wx.switchTab({ url: '/pages/mine/mine' })
      return
    }
    track.pageView('user_profile', { contentId: this.userId })
    const profile = result.profile || {}
    this.setData({
      profile: {
        ...profile,
        nickname: defaultProfile.resolveProfileNickname(profile.nickname, profile.id || this.userId)
      },
      stats: result.stats || { postCount: 0, receivedLikes: 0, receivedComments: 0 },
      list: this.decorateList(rows, this.data.tab),
      loading: false,
      error: ''
    })
  },

  decorateList(rows, tab) {
    return (rows || []).map((item) => ({
      ...item,
      type: tab,
      badge: tab === 'wall' ? item.tag : item.category,
      title: tab === 'wall' ? item.headline : item.title,
      timeText: formatTime(item.createdAt)
    }))
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.id
    if (tab === this.data.tab) return
    this.setData({ tab }, () => this.loadList())
  },

  async loadList() {
    const { tab } = this.data
    const rows = await repo.listUserPosts(this.userId, tab)
    if (tab !== this.data.tab) return
    this.setData({ list: this.decorateList(rows, tab) })
  },

  async onMessageTap() {
    if (this.data.messaging || !auth.ensureCanSpeak()) return
    const peerId = this.data.profile && this.data.profile.id
    if (!peerId) return
    this.setData({ messaging: true })
    const result = await repo.openOrCreateConversation(peerId)
    this.setData({ messaging: false })
    if (auth.showActionError(result)) return
    const id = result.conversation && result.conversation.id
    if (!id) {
      wx.showToast({ title: '无法发起私信', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/dm-chat/dm-chat?id=${encodeURIComponent(id)}` })
  },

  openMore() {
    this.setData({ moreOpen: true })
  },

  closeMore() {
    this.setData({ moreOpen: false })
  },

  onReport() {
    this.setData({ moreOpen: false })
    const targetId = this.userId || this.data.userId
    if (!targetId) {
      wx.showToast({ title: '这个用户还不能举报', icon: 'none' })
      return
    }
    const sheet = this.selectComponent('#report-sheet')
    if (!sheet) {
      wx.showToast({ title: '举报菜单没打开', icon: 'none' })
      return
    }
    sheet.open({
      targetType: 'user',
      targetId,
      onSubmit: (payload) => repo.submitReport(payload)
    })
  },

  goDetail(e) {
    const { id, type } = e.currentTarget.dataset
    require('../../utils/post-nav').openPostDetail(type === 'forum' ? 'forum' : 'wall', id)
  }
})
