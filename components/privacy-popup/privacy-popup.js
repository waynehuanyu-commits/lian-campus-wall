Component({
  data: {
    show: false,
    privacyContractName: '《用户隐私保护指引》',
    canAgreePrivacy: typeof wx !== 'undefined' && typeof wx.onNeedPrivacyAuthorization === 'function'
  },

  lifetimes: {
    attached() {
      this._resolve = null
      if (typeof wx.onNeedPrivacyAuthorization === 'function') {
        wx.onNeedPrivacyAuthorization((resolve) => {
          this._resolve = resolve
          this.setData({ show: true, canAgreePrivacy: true })
        })
      }
      if (typeof wx.getPrivacySetting === 'function') {
        wx.getPrivacySetting({
          success: (res) => {
            if (res.needAuthorization) {
              this.setData({
                show: true,
                privacyContractName: res.privacyContractName || '《用户隐私保护指引》'
              })
            }
          }
        })
      }
    }
  },

  methods: {
    openContract() {
      if (typeof wx.openPrivacyContract === 'function') {
        wx.openPrivacyContract({
          fail: () => this.openAgreement()
        })
        return
      }
      this.openAgreement()
    },

    openAgreement() {
      wx.navigateTo({ url: '/pages/agreement/agreement' })
    },

    noop() {},

    onDisagree() {
      this.setData({ show: false })
      if (typeof this._resolve === 'function') {
        this._resolve({ event: 'disagree' })
      }
      this._resolve = null
    },

    onAgree() {
      this.setData({ show: false })
      if (typeof this._resolve === 'function') {
        this._resolve({ event: 'agree', buttonId: 'agree-privacy-btn' })
      }
      this._resolve = null
    }
  }
})
