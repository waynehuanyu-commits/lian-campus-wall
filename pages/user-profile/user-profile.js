const repo = require('../../utils/repo')
const defaultProfile = require('../../utils/default-profile')
const track = require('../../utils/track')
const { readNavMetrics } = require('../../utils/nav-bar')
const coverStore = require('../../utils/cover')

Page({
  data: {
    nav: { top: 20, height: 44, capsule: 100 },
    cover: coverStore.DEFAULT_COVER,
    userId: '',
    profile: null,
    loading: true,
    error: '',
    moreOpen: false
  },

  onLoad(query) {
    this.userId = decodeURIComponent(query.id || '')
    this.setData({ userId: this.userId, nav: readNavMetrics(), cover: coverStore.cachedCover() })
    coverStore.fetchCover().then((next) => {
      if (!coverStore.sameCover(this.data.cover, next)) this.setData({ cover: next })
    })
  },

  onCoverError() {
    if (coverStore.sameCover(this.data.cover, coverStore.DEFAULT_COVER)) return
    this.setData({ cover: coverStore.fallbackCover() })
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/forum/forum' })
      }
    })
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
    const result = await repo.getPublicProfile(this.userId)
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
      loading: false,
      error: ''
    })
  },

  openMore() {
    this.setData({ moreOpen: true })
  },

  noop() {},

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
  }

})
