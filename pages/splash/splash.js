Page({
  data: {
    ready: false,
    leaving: false
  },

  onLoad() {
    this._entered = false
    this._minTimer = null
    this._maxTimer = null
    this._minReady = false
    this.setData({ ready: true })

    this._minTimer = setTimeout(() => {
      this._minReady = true
      this.tryEnter()
    }, 280)

    this._maxTimer = setTimeout(() => {
      this.enter()
    }, 800)

    this.bootstrap()
  },

  onUnload() {
    if (this._minTimer) clearTimeout(this._minTimer)
    if (this._maxTimer) clearTimeout(this._maxTimer)
  },

  async bootstrap() {
    try {
      const app = getApp()
      if (app && app.globalData && app.globalData.ready) {
        await app.globalData.ready
      }
    } catch (e) {
      // ignore bootstrap errors on splash
    }
    this._bootDone = true
    this.tryEnter()
  },

  tryEnter() {
    if (!this._minReady || !this._bootDone) return
    this.enter()
  },

  enter() {
    if (this._entered) return
    this._entered = true
    if (this._minTimer) clearTimeout(this._minTimer)
    if (this._maxTimer) clearTimeout(this._maxTimer)
    this.setData({ leaving: true })

    setTimeout(() => {
      wx.switchTab({
        url: '/pages/forum/forum',
        fail: (err) => {
          console.warn('[splash] switchTab fail', err)
          wx.reLaunch({ url: '/pages/forum/forum' })
        }
      })
    }, 160)
  }
})
