Component({
  data: {
    visible: true,
    loaded: false,
    leaving: false
  },

  lifetimes: {
    attached() {
      this._gone = false
      // 硬超时：无论图片是否回调，都不得挡住业务页
      this._maxTimer = setTimeout(() => this.leave(true), 480)
      this._hardTimer = setTimeout(() => this.forceHide(), 900)
    },
    detached() {
      this.clearTimers()
    }
  },

  methods: {
    clearTimers() {
      if (this._maxTimer) clearTimeout(this._maxTimer)
      if (this._hideTimer) clearTimeout(this._hideTimer)
      if (this._hardTimer) clearTimeout(this._hardTimer)
      this._maxTimer = null
      this._hideTimer = null
      this._hardTimer = null
    },

    onLoad() {
      if (this._gone) return
      if (this._maxTimer) clearTimeout(this._maxTimer)
      this.setData({ loaded: true })
      this._maxTimer = setTimeout(() => this.leave(), 180)
    },

    onError() {
      this.leave(true)
    },

    forceHide() {
      this._gone = true
      this.clearTimers()
      this.setData({ visible: false, leaving: false })
    },

    leave(immediate) {
      if (this._gone) return
      this._gone = true
      if (this._maxTimer) clearTimeout(this._maxTimer)
      if (immediate || !this.data.loaded) {
        this.setData({ visible: false, leaving: false })
        return
      }
      this.setData({ leaving: true })
      this._hideTimer = setTimeout(() => {
        this.setData({ visible: false })
      }, 160)
    }
  }
})
