const phoneBind = require('../../utils/phone-bind')

// 需要手机号时从底部弹出；绑定入口只在这里出现，「我的」里不常驻
Component({
  data: {
    show: false,
    binding: false,
    message: ''
  },

  methods: {
    noop() {},

    open(opts = {}) {
      this._onBound = typeof opts.onBound === 'function' ? opts.onBound : null
      this.setData({ show: true, binding: false, message: opts.message || '' })
      // 在 tab 页上弹出时先收起底部 tab 栏，否则会压住弹窗下半部分；非 tab 页调用会失败，忽略即可
      wx.hideTabBar({ animation: false, fail() {} })
    },

    close() {
      this.setData({ show: false })
      wx.showTabBar({ animation: false, fail() {} })
    },

    async onGetPhoneNumber(e) {
      if (this.data.binding) return
      this.setData({ binding: true })
      const ok = await phoneBind.bindFromEvent(e)
      this.setData({ binding: false })
      if (!ok) return
      this.close()
      if (this._onBound) this._onBound()
    }
  }
})
