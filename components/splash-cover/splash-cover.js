Component({
  data: {
    visible: true,
    loaded: false,
    leaving: false
  },

  lifetimes: {
    attached() {
      this._gone = false
      this._maxTimer = setTimeout(() => this.leave(), 700)
    },
    detached() {
      if (this._maxTimer) clearTimeout(this._maxTimer)
      if (this._hideTimer) clearTimeout(this._hideTimer)
    }
  },

  methods: {
    onLoad() {
      if (this._gone) return
      if (this._maxTimer) clearTimeout(this._maxTimer)
      this.setData({ loaded: true })
      this._maxTimer = setTimeout(() => this.leave(), 220)
    },

    onError() {
      this.leave()
    },

    leave() {
      if (this._gone) return
      this._gone = true
      if (this._maxTimer) clearTimeout(this._maxTimer)
      if (!this.data.loaded) {
        this.setData({ visible: false })
        return
      }
      this.setData({ leaving: true })
      this._hideTimer = setTimeout(() => {
        this.setData({ visible: false })
      }, 180)
    }
  }
})
