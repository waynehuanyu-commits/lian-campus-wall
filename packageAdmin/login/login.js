const adminAuth = require('../../utils/admin-auth')

Page({
  data: {
    account: '',
    password: '',
    loading: false,
    demoAccount: adminAuth.DEMO_ACCOUNT,
    demoPassword: adminAuth.DEMO_PASSWORD
  },

  onShow() {
    if (adminAuth.isLoggedIn()) {
      wx.redirectTo({ url: '/packageAdmin/console/console' })
    }
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  onLogin() {
    if (this.data.loading) return
    this.setData({ loading: true })
    const result = adminAuth.login(this.data.account, this.data.password)
    this.setData({ loading: false })
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    wx.redirectTo({ url: '/packageAdmin/console/console' })
  },

  goUser() {
    wx.switchTab({ url: '/pages/forum/forum' })
  }
})
