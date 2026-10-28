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
    },

    close() {
      this.setData({ show: false })
    },

    async onGetPhoneNumber(e) {
      if (this.data.binding) return
      this.setData({ binding: true })
      const ok = await phoneBind.bindFromEvent(e)
      this.setData({ binding: false })
      if (!ok) return
      this.setData({ show: false })
      if (this._onBound) this._onBound()
    }
  }
})
