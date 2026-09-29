const { about } = require('../../utils/legal')

Page({
  data: {
    about
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  }
})
