const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const defaultProfile = require('../../utils/default-profile')

// 点别人头像时从底部弹出的资料卡：只有头像、昵称、认证标识和简介，不展示对方发过的内容
Component({
  data: {
    show: false,
    loading: false,
    error: '',
    profile: null
  },

  methods: {
    noop() {},

    async open(userId) {
      this._userId = userId
      this.setData({ show: true, loading: true, error: '', profile: null })
      // tab 页上先收起底部 tab 栏，否则会压住卡片；非 tab 页调用失败，忽略
      wx.hideTabBar({ animation: false, fail() {} })
      let result
      try {
        result = await repo.getPublicProfile(userId)
      } catch (err) {
        result = { ok: false, message: '加载失败，请稍后再试' }
      }
      if (this._userId !== userId || !this.data.show) return
      if (!result || !result.ok) {
        this.setData({ loading: false, error: (result && result.message) || '用户不存在' })
        return
      }
      if (result.isSelf) {
        this.close()
        wx.switchTab({ url: '/pages/mine/mine' })
        return
      }
      const profile = result.profile || {}
      this.setData({
        loading: false,
        profile: {
          ...profile,
          nickname: defaultProfile.resolveProfileNickname(profile.nickname, profile.id || userId)
        }
      })
    },

    close() {
      this._userId = ''
      this.setData({ show: false })
      wx.showTabBar({ animation: false, fail() {} })
    },

    onReport() {
      const targetId = this._userId
      if (!targetId || !auth.ensureCanReport()) return
      const sheet = this.selectComponent('#report-sheet')
      if (!sheet) return
      this.close()
      sheet.open({ targetType: 'user', targetId, onSubmit: (payload) => repo.submitReport(payload) })
    }
  }
})
